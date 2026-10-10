import { useCallback, useEffect, useRef, useState } from "react";
import { LegacyDialog } from "./LegacyConnectedUi";
import { remittancesApi } from "./remittancesApi";
import { StrictApiError, operationKey } from "../../shared/remittances/strictApi";
import {
  INSTALLATION_PROTOCOL_VERSION, signingPayload,
  type StationInstallationChallenge, type StationInstallationSummary, type StationInstallationData,
} from "../../server/src/station-installation-protocol";
import {
  getOrCreateStationInstallationKey, readStationInstallationKey, signStationInstallationPayload,
  type StationInstallationKey,
} from "./stationInstallationKey";
import { normalizeRole, type User } from "./types";

type Actor = Pick<User, "id" | "role">;
export type InstallationStation = { id: string; name: string; deviceId: string; active: boolean; rraaValidated: boolean };
type InstallationList = { installations: StationInstallationSummary[]; identityKind: "installation" };
type Review = { kind: "register"; identity: StationInstallationKey } | { kind: "revoke"; installation: StationInstallationSummary };
type PendingRequest = {
  kind: "register" | "query" | "revoke";
  stage: "challenge" | "complete";
  path: string;
  body: string;
  key: string;
  identity?: StationInstallationKey;
  installationId: string;
  inFlight?: Promise<unknown>;
  uncertain?: boolean;
};
// Pending intents survive closing and reopening a view during this page session.
// Proofs and operation keys are never serialized, logged or put in localStorage.
const pendingIntents = new Map<string, PendingRequest>();
const errorText = (failure: unknown) => failure instanceof Error ? failure.message : "No se pudo completar la operación.";
const dateTime = (date?: string) => date ? new Date(date).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }) : "—";
const scopeFor = (stationId: string, user?: Actor) => JSON.stringify([window.location.origin, stationId, user?.id ?? ""]);
const statusText = (status?: string) => status === "active" ? "Vigente" : status === "revoked" ? "Revocada" : "Sin registro en esta estación";
const invalidResponse = () => new StrictApiError("La API no devolvió una confirmación válida. Reintenta la misma solicitud y revisa el listado.", 200, true);

export function pendingStationInstallationStationId(user?: Actor): string {
  if (!user) return "";
  for (const scope of pendingIntents.keys()) {
    const [origin, stationId, actorId] = JSON.parse(scope) as string[];
    if (origin === window.location.origin && actorId === user.id) return stationId;
  }
  return "";
}

function validSummary(value: unknown, stationId: string, installationId?: string): value is StationInstallationSummary {
  const row = value as Partial<StationInstallationSummary> | null;
  return Boolean(row && row.stationId === stationId && typeof row.installationId === "string" &&
    (!installationId || row.installationId === installationId) && (row.status === "active" || row.status === "revoked") &&
    typeof row.revision === "string" && row.revision.length > 0 && typeof row.registeredBy === "string" &&
    typeof row.registeredAt === "string" && Number.isFinite(Date.parse(row.registeredAt)) &&
    (row.revokedAt === undefined || (typeof row.revokedAt === "string" && Number.isFinite(Date.parse(row.revokedAt)))) &&
    (row.revocationReason === undefined || typeof row.revocationReason === "string"));
}

function validateChallenge(challenge: StationInstallationChallenge, request: PendingRequest, stationId: string, user: Actor) {
  if (!challenge || challenge.version !== INSTALLATION_PROTOCOL_VERSION || challenge.stationId !== stationId ||
      challenge.installationId !== request.installationId || challenge.purpose !== request.kind ||
      challenge.origin !== window.location.origin || challenge.actorId !== user.id ||
      typeof challenge.challengeId !== "string" || !challenge.challengeId ||
      typeof challenge.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge.nonce) ||
      typeof challenge.scopeId !== "string" || !challenge.scopeId ||
      typeof challenge.sessionId !== "string" || !challenge.sessionId ||
      !Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= Date.now() ||
      (request.kind === "register" && challenge.publicKeySpki !== request.identity?.publicKeySpki)) {
    throw new Error("El desafío no corresponde a esta estación, usuario, navegador y operación, o ya venció. No se firmó ni se registró una instalación.");
  }
}

async function sendPending(request: PendingRequest): Promise<unknown> {
  if (request.inFlight) return request.inFlight;
  const response = remittancesApi<unknown>(request.path, { method: "POST", body: request.body, headers: { "Idempotency-Key": request.key } });
  request.inFlight = response;
  try { return await response; }
  finally { if (request.inFlight === response) request.inFlight = undefined; }
}

export function StationInstallationPanel({ station, user, disabled = false, onLockChange }: {
  station: InstallationStation | null;
  user?: Actor;
  disabled?: boolean;
  onLockChange?: (locked: boolean) => void;
}) {
  const stationId = station?.id ?? "", actorId = user?.id ?? "";
  const role = user ? normalizeRole(user.role) : "UNDEFINED";
  const canManage = role === "ADMIN" || role === "SUPERADMIN", canRead = canManage || role === "SUPERVISOR";
  const intentScope = scopeFor(stationId, user);
  const [identity, setIdentity] = useState<StationInstallationKey | null>(null);
  const [installations, setInstallations] = useState<StationInstallationSummary[]>([]);
  const [data, setData] = useState<StationInstallationData | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [listConfirmed, setListConfirmed] = useState(false);
  const [error, setError] = useState(""), [listError, setListError] = useState(""), [message, setMessage] = useState("");
  const [review, setReview] = useState<Review | null>(null), [reason, setReason] = useState(""), [revocationReview, setRevocationReview] = useState(false);
  const pending = useRef<PendingRequest | null>(null), working = useRef(false), epoch = useRef(0);
  const locked = busy || uncertain || Boolean(review);
  const current = installations.find((row) => row.installationId === identity?.installationId);
  useEffect(() => { onLockChange?.(locked); return () => { onLockChange?.(false); }; }, [locked, onLockChange]);

  const refresh = useCallback(async () => {
    if (!stationId || !canRead) return;
    const version = epoch.current;
    setLoading(true); setListError("");
    try {
      const result = await remittancesApi<InstallationList>(`/estaciones/${encodeURIComponent(stationId)}/instalaciones`);
      if (result.identityKind !== "installation" || !Array.isArray(result.installations) || result.installations.some((row) => !validSummary(row, stationId))) throw new Error("La API no devolvió un listado válido de instalaciones.");
      if (version === epoch.current) { setInstallations(result.installations); setListConfirmed(true); }
    } catch (failure) {
      if (version === epoch.current) { setListError(errorText(failure)); setListConfirmed(false); }
    } finally { if (version === epoch.current) setLoading(false); }
  }, [stationId, canRead]);

  useEffect(() => {
    const version = ++epoch.current;
    setIdentity(null); setData(null); setInstallations([]); setError(""); setMessage(""); setReview(null); setReason(""); setRevocationReview(false); setListConfirmed(false);
    const saved = pendingIntents.get(intentScope) ?? null;
    pending.current = saved; setUncertain(Boolean(saved));
    if (saved?.identity) setIdentity(saved.identity);
    if (stationId) {
      void readStationInstallationKey(stationId).then((key) => { if (version === epoch.current) setIdentity((value) => value ?? key); }).catch((failure) => { if (version === epoch.current) setError(errorText(failure)); });
      void refresh();
    }
    return () => { epoch.current += 1; };
  }, [stationId, actorId, intentScope, refresh]);

  const run = async (initial: PendingRequest) => {
    if (working.current || !station || !user) return;
    working.current = true; setBusy(true); setError(""); setMessage("");
    const version = epoch.current;
    let request = initial;
    try {
      if (request.stage === "challenge") {
        const challenge = await sendPending(request) as StationInstallationChallenge;
        validateChallenge(challenge, request, station.id, user);
        if (!request.identity) throw new Error("La identidad local no está disponible.");
        const signature = await signStationInstallationPayload(request.identity, signingPayload(challenge));
        request = {
          kind: request.kind, stage: "complete", key: operationKey(), identity: request.identity,
          installationId: request.installationId,
          path: `/estaciones/${encodeURIComponent(station.id)}/${request.kind === "register" ? "instalaciones" : "datos"}`,
          body: JSON.stringify(request.kind === "register"
            ? { challengeId: challenge.challengeId, installationId: request.installationId, publicKeySpki: request.identity.publicKeySpki, signature, confirmed: true }
            : { challengeId: challenge.challengeId, installationId: request.installationId, signature }),
        };
        pending.current = request; pendingIntents.set(intentScope, request);
      }
      const result = await sendPending(request);
      if (request.kind === "query") {
        const response = result as StationInstallationData;
        if (!response || response.stationId !== station.id || response.installationId !== request.installationId ||
            response.installationStatus !== "active" || typeof response.active !== "boolean" || typeof response.stationCode !== "string" ||
            !["validated", "not_validated"].includes(response.rraaValidationStatus) || typeof response.queriedAt !== "string" ||
            !Number.isFinite(Date.parse(response.queriedAt)) ||
            (response.rraaValidatedAt !== undefined && (typeof response.rraaValidatedAt !== "string" || !Number.isFinite(Date.parse(response.rraaValidatedAt)))) ||
            (response.cypBuildVersion !== undefined && typeof response.cypBuildVersion !== "string")) throw invalidResponse();
        if (version === epoch.current) setData(response);
      } else if (!validSummary(result, station.id, request.installationId) ||
                 (request.kind === "register" ? result.status !== "active" : result.status !== "revoked")) throw invalidResponse();
      if (pendingIntents.get(intentScope) === request) pendingIntents.delete(intentScope);
      pending.current = null;
      if (version === epoch.current) {
        setUncertain(false); setReview(null); setReason(""); setRevocationReview(false);
        if (request.kind !== "query") setData(null);
        setMessage(request.kind === "register" ? "Este navegador quedó registrado en CyP para esta estación." : request.kind === "revoke" ? "Instalación revocada en CyP." : "Datos de CyP consultados. La estación y su estado RRAA se conservan.");
        await refresh();
      }
    } catch (failure) {
      // A local offline/authentication rejection of a retry cannot settle the
      // outcome of an earlier request that may already have reached the server.
      const resultUncertain = failure instanceof StrictApiError && (failure.uncertain ||
        (request.uncertain === true && [0, 401, 403, 429].includes(failure.status)));
      if (resultUncertain) request.uncertain = true;
      if (!resultUncertain) {
        if (pendingIntents.get(intentScope) === request) pendingIntents.delete(intentScope);
        pending.current = null;
      }
      if (version === epoch.current) { setUncertain(resultUncertain); setError(errorText(failure)); }
    } finally { working.current = false; if (version === epoch.current) setBusy(false); }
  };

  const start = async (kind: "register" | "query") => {
    if (disabled || locked || loading || working.current || !station || !user || !canRead || (kind === "register" && !canManage)) return;
    const saved = pendingIntents.get(intentScope);
    if (saved) { pending.current = saved; setUncertain(true); return; }
    working.current = true; setBusy(true); setError(""); setMessage(""); setData(null);
    const version = epoch.current;
    try {
      const key = kind === "register" ? await getOrCreateStationInstallationKey(station.id) : await readStationInstallationKey(station.id);
      if (!key) throw new Error("Registra este navegador en CyP para esta estación antes de consultar sus datos. No se creó una identidad ni se envió un desafío.");
      if (version !== epoch.current) return;
      setIdentity(key);
      if (kind === "register") { setReview({ kind, identity: key }); return; }
      const request: PendingRequest = {
        kind, stage: "challenge", identity: key, installationId: key.installationId, key: operationKey(),
        path: `/estaciones/${encodeURIComponent(station.id)}/instalaciones/desafios`,
        body: JSON.stringify({ purpose: kind, installationId: key.installationId }),
      };
      pending.current = request; pendingIntents.set(intentScope, request);
      working.current = false; setBusy(false); await run(request);
    } catch (failure) { if (version === epoch.current) setError(errorText(failure)); }
    finally { working.current = false; if (version === epoch.current) setBusy(false); }
  };

  const confirm = () => {
    if (busy || uncertain || !review || !station || !canManage) return;
    let request: PendingRequest;
    if (review.kind === "register") {
      request = {
        kind: "register", stage: "challenge", identity: review.identity, installationId: review.identity.installationId, key: operationKey(),
        path: `/estaciones/${encodeURIComponent(station.id)}/instalaciones/desafios`,
        body: JSON.stringify({ purpose: "register", installationId: review.identity.installationId, publicKeySpki: review.identity.publicKeySpki }),
      };
    } else {
      if (!revocationReview) {
        if (!reason.trim() || reason.trim().length > 1000) { setError("Escribe un motivo de revocación de 1 a 1000 caracteres."); return; }
        setError(""); setRevocationReview(true); return;
      }
      request = {
        kind: "revoke", stage: "complete", installationId: review.installation.installationId, key: operationKey(),
        path: `/estaciones/${encodeURIComponent(station.id)}/instalaciones/${encodeURIComponent(review.installation.installationId)}/revocar`,
        body: JSON.stringify({ revision: review.installation.revision, reason: reason.trim() }),
      };
    }
    pending.current = request; pendingIntents.set(intentScope, request); void run(request);
  };
  const closeReview = () => { if (!busy && !uncertain) { setReview(null); setReason(""); setRevocationReview(false); setError(""); } };
  const actionDisabled = disabled || locked || loading || !canRead || !station;

  return <section className="cyp-installation-panel" aria-label="Instalaciones propias de CyP" aria-busy={loading || busy}>
    <div className="cyp-installation-heading"><strong>Instalación de CyP</strong><span>Perfil de este navegador · identidad lógica</span></div>
    {!station ? <p>Selecciona una estación del listado.</p> : <>
      <div className="cyp-installation-fields">
        <label>Estación CyP<input readOnly value={station.name} /></label>
        <label>ID de instalación CyP<input readOnly value={identity?.installationId ?? "Sin identidad guardada"} /></label>
        <label>ID dispositivo RRAA<input readOnly value={station.deviceId || "Sin ID RRAA"} /></label>
        <label>Vínculo de este navegador<input readOnly value={!listConfirmed ? "Sin comprobar" : statusText(current?.status)} /></label>
        <label className="cyp-installation-readonly-check"><input type="checkbox" readOnly disabled checked={station.active && station.rraaValidated} /><span>Estación activa y validada por RRAA</span></label>
      </div>
      <p className="cyp-installation-note">Este ID identifica una clave guardada en el perfil del navegador. El registro requiere confirmación de un Admin y no obtiene licencias ni activa la estación.</p>
      <div className="cyp-installation-actions">
        {canManage && <button type="button" disabled={Boolean(actionDisabled || current)} onClick={() => void start("register")}>Registrar este navegador</button>}
        <button type="button" title="Consultar datos de CyP con la clave de este navegador, sin registrar instalaciones." disabled={Boolean(actionDisabled)} onClick={() => void start("query")}>Obtener Datos de CyP</button>
        <button type="button" disabled={loading || busy || !canRead} onClick={() => void refresh()}>Refrescar instalaciones</button>
      </div>
      {!canRead && <p className="cyp-installation-note">La lista y consulta requieren una sesión de Admin o Supervisor.</p>}
      {current?.status === "revoked" && <p className="cyp-installation-note">La clave de este perfil está revocada. Su ID se conserva; volver a consultar no crea otro registro.</p>}
      {data && <div className="cyp-installation-data" aria-label="Datos obtenidos de CyP">
        <strong>Consulta de datos de CyP</strong>
        <label>Código de estación<input readOnly value={data.stationCode} /></label>
        <label>Instalación<input readOnly value={statusText(data.installationStatus)} /></label>
        <label>Estado de la estación<input readOnly value={data.active ? "Activa" : "Inactiva"} /></label>
        <label>Validación RRAA registrada<input readOnly value={data.rraaValidationStatus === "validated" ? "Validada" : "No validada"} /></label>
        <label>Última validación RRAA<input readOnly value={dateTime(data.rraaValidatedAt)} /></label>
        {data.cypBuildVersion && <label>Versión CyP<input readOnly value={data.cypBuildVersion} /></label>}
        <p>Consultado: {dateTime(data.queriedAt)}</p>
      </div>}
      <div className="cyp-installation-table-wrap"><table className="cyp-installation-table"><thead><tr><th>ID de instalación CyP</th><th>Estado</th><th>Registro</th><th>Revocación / motivo</th>{canManage && <th>Acción</th>}</tr></thead>
        <tbody>{installations.map((row) => <tr key={row.installationId}>
          <td><span>{row.installationId}</span>{row.installationId === identity?.installationId && <small>Este navegador</small>}</td>
          <td>{statusText(row.status)} · revisión {row.revision}</td><td>{dateTime(row.registeredAt)}</td>
          <td>{dateTime(row.revokedAt)}{row.revocationReason && <span className="cyp-installation-reason">{row.revocationReason}</span>}</td>
          {canManage && <td><button type="button" disabled={Boolean(actionDisabled || row.status !== "active" || !listConfirmed)} onClick={() => { setReview({ kind: "revoke", installation: row }); setReason(""); setRevocationReview(false); setError(""); }}>Revocar…</button></td>}
        </tr>)}{!installations.length && <tr><td colSpan={canManage ? 5 : 4}>{loading ? "Cargando instalaciones…" : listConfirmed ? "Sin instalaciones registradas." : "Listado sin confirmar."}</td></tr>}</tbody>
      </table></div>
    </>}
    {listError && <p className="cyp-installation-error" role="alert">{listError}</p>}
    {error && !review && <p className="cyp-installation-error" role="alert">{error}</p>}
    {message && <p className="cyp-installation-success" role="status">{message}</p>}
    {uncertain && <div className="cyp-installation-pending" role="status">
      <p>El resultado de la solicitud está sin confirmar. Se conserva el cuerpo y la clave de reintento. Revisar la lista no cancela una solicitud enviada.</p>
      <button type="button" disabled={busy || !pending.current} onClick={() => { if (pending.current) void run(pending.current); }}>Reintentar la misma solicitud</button>
    </div>}
    {review && station && <LegacyDialog title={review.kind === "register" ? "Registrar este navegador en CyP" : revocationReview ? "Confirmar revocación de instalación" : "Revocar instalación de CyP"} onClose={closeReview} className="cyp-installation-dialog legacy-admin-dialog">
      <div className="cyp-installation-review">
        <label>Estación<input readOnly value={station.name} /></label>
        <label>ID de instalación CyP<input readOnly value={review.kind === "register" ? review.identity.installationId : review.installation.installationId} /></label>
        {review.kind === "register" ? <p>Confirma como Admin el vínculo de este perfil de navegador con la estación. Solo se registrará esta identidad de CyP.</p> : <>
          <label>Revisión esperada<input readOnly value={String(review.installation.revision)} /></label>
          <label>Motivo<textarea rows={3} maxLength={1000} value={reason} readOnly={revocationReview || busy || uncertain} onChange={(event) => setReason(event.target.value)} /></label>
          {revocationReview && <p>Confirma la revocación. Esta instalación dejará de consultar datos de CyP; su historial se conservará.</p>}
        </>}
        {error && <p className="cyp-installation-error" role="alert">{error}</p>}
        {uncertain && <><p>Resultado sin confirmar. Reintenta la misma solicitud; no se puede afirmar que fue cancelada.</p><p>Estado observado en el listado: {listConfirmed ? statusText(installations.find((row) => row.installationId === pending.current?.installationId)?.status) : "Sin comprobar"}. Esta lectura no confirma por sí sola la solicitud enviada.</p></>}
        <div className="cyp-installation-actions">
          <button type="button" disabled={busy || uncertain || !canManage} onClick={confirm}>{busy ? "Procesando…" : review.kind === "register" ? "Confirmar registro" : revocationReview ? "Confirmar revocación" : "Revisar revocación"}</button>
          {uncertain && <button type="button" disabled={busy || !pending.current} onClick={() => { if (pending.current) void run(pending.current); }}>Reintentar la misma solicitud</button>}
          {uncertain && <button type="button" disabled={busy || loading || !canRead} onClick={() => void refresh()}>Refrescar instalaciones</button>}
          <button type="button" disabled={busy || uncertain} onClick={closeReview}>Volver</button>
        </div>
      </div>
    </LegacyDialog>}
  </section>;
}
