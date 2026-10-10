import { useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api, getToken } from "./api";
import { isMockToken } from "./mock";
import { operationKey } from "../../shared/remittances/strictApi";
import { INPUT_LIMITS, validateText } from "../../shared/inputRules";
import { ACCOUNT_ROLE_OPTIONS, accountRoleLabel, type AccountRole } from "../../shared/accountRoles";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";
import { collectorOptionsForAccount } from "./collectorAccountOptions";
import { HelpNote, Modal } from "./components";
import type { PublicAccount, Snapshot } from "./types";

export type AccountOperation =
  | { type: "create" }
  | { type: "password"; account: PublicAccount }
  | { type: "status"; account: PublicAccount; status: "active" | "disabled" };

// Match the account password policy enforced by the API.
const MIN_LENGTH = 3;
const labelFor = (operation: AccountOperation) =>
  operation.type === "create"
    ? "Nueva cuenta"
    : operation.type === "password"
      ? "Restablecer contraseña"
      : operation.status === "disabled"
        ? "Desactivar cuenta"
        : "Activar cuenta";

export default function AccountModal({
  operation,
  snapshot,
  actorId,
  onClose,
  onComplete,
}: {
  operation: AccountOperation | null;
  snapshot: Snapshot;
  actorId: string;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  if (!operation) return null;
  return (
    <AccountForm
      key={
        operation.type === "create"
          ? "create"
          : `${operation.type}-${operation.account.id}`
      }
      operation={operation}
      snapshot={snapshot}
      actorId={actorId}
      onClose={onClose}
      onComplete={onComplete}
    />
  );
}

function AccountForm({
  operation,
  snapshot,
  actorId,
  onClose,
  onComplete,
}: {
  operation: AccountOperation;
  snapshot: Snapshot;
  actorId: string;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const collectorName = (id?: string) =>
    snapshot.collectors.find((collector) => collector.id === id)?.name ??
    "Sin asignar";
  const scope = operation.type === "create" ? "account-create" : `account-${operation.type}:${operation.account.id}${operation.type === "status" ? `:${operation.status}` : ""}`;
  const request = useMovementRequest(actorId, scope);
  const mockInFlight = useRef(false);
  const [mockBusy, setMockBusy] = useState(false);
  const busy = request.busy || mockBusy;
  const locked = request.locked || mockBusy;
  const pending = pendingMovementDraft<{ name: string; email: string; role: AccountRole; collectorId: string; nickname: string; note: string; password: string }>(actorId, scope);
  const [name, setName] = useState(pending?.name ?? ""),
    [email, setEmail] = useState(pending?.email ?? ""),
    [role, setRole] = useState<AccountRole>(pending?.role ?? "undefined"),
    [collectorId, setCollectorId] = useState(pending?.collectorId ?? ""),
    [nickname, setNickname] = useState(pending?.nickname ?? ""),
    [note, setNote] = useState(pending?.note ?? ""),
    [password, setPassword] = useState(pending?.password ?? ""),
    [error, setError] = useState("");
  const creating = operation.type === "create",
    rotating = operation.type === "password";
  const close = () => { if (!locked) { request.clear(); onClose(); } };

  async function runAccount<T>(path: string, body: unknown, draft: unknown, valid: (result: T) => boolean): Promise<T> {
    // Mock operations resolve locally; an unsupported mock route remains a
    // cancelable error. Preserve any already pending connected intent.
    if (!request.attempt && isMockToken(getToken())) {
      if (mockInFlight.current) throw new Error("La operación ya se está enviando.");
      mockInFlight.current = true;
      setMockBusy(true);
      try {
        const result = await api<T>(path, { method: "POST", headers: { "Idempotency-Key": operationKey() }, body: JSON.stringify(body) });
        if (!valid(result)) throw new Error("No se pudo confirmar la respuesta del modo de demostración.");
        return result;
      } finally {
        mockInFlight.current = false;
        setMockBusy(false);
      }
    }
    return request.run<T>(path, body, draft, valid);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || mockInFlight.current) return;
    if (creating && !name.trim()) return setError("Escribe el nombre.");
    if ((creating || rotating) && Array.from(password).length < MIN_LENGTH)
      return setError(
        `La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`,
      );
    setError("");
    try {
      if (creating) {
        validateText(name, "Nombre", INPUT_LIMITS.name, { required: true });
        validateText(email, "Usuario / correo", INPUT_LIMITS.email, { required: true });
        validateText(nickname, "Apodo", INPUT_LIMITS.userNickname);
        validateText(note, "Nota", INPUT_LIMITS.userNote, { multiline: true });
        if (!request.attempt && role === "collector" && !snapshot.collectors.some((collector) => collector.id === collectorId && collector.active !== false)) throw new Error("Selecciona un cobrador activo para vincular esta cuenta.");
      }
      if ((creating || rotating) && password.length > INPUT_LIMITS.password) throw new Error(`La contraseña admite un máximo de ${INPUT_LIMITS.password} caracteres.`);
      const draft = { name, email, role, collectorId, nickname, note, password };
      if (creating) {
        const account = await runAccount<PublicAccount>("/usuarios", { name, email, role, ...(role === "collector" ? { collectorId } : {}), nickname, note, password }, draft, (result) => Boolean(result?.id && result.email));
        toast.success(`Cuenta creada para ${account.email}.`);
      } else if (rotating) {
        await runAccount<{ ok: boolean }>(`/usuarios/${operation.account.id}/clave`, { password }, draft, (result) => result?.ok === true);
        toast.success(
          `Contraseña actualizada. Las demás sesiones de ${operation.account.email} se cerraron.`,
        );
      } else {
        await runAccount<PublicAccount>(`/usuarios/${operation.account.id}/estado`, { status: operation.status }, draft, (result) => result?.id === operation.account.id && result.status === operation.status);
        toast.success(
          operation.status === "disabled"
            ? `${operation.account.email} desactivada.`
            : `${operation.account.email} activada.`,
        );
      }
      try { await onComplete(); }
      catch { toast.warning("La operación quedó confirmada. Actualiza el listado; no repitas el guardado."); }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operación fallida.");
    }
  }

  return (
    <Modal
      open
      onClose={close}
      title={labelFor(operation)}
      description={
        creating
          ? "La cuenta entra al portal con su nombre de usuario o correo y contraseña."
          : rotating
            ? `La nueva contraseña cierra las sesiones abiertas de ${operation.account.email}.`
            : operation.status === "disabled"
              ? `Una cuenta desactivada no puede iniciar sesión y sus sesiones abiertas se cierran.`
              : `La cuenta vuelve a poder iniciar sesión.`
      }
    >
      <form className="dialog-form" onSubmit={submit}>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, display: "contents" }}>
        {creating && (
          <>
            <label className="field">
              Nombre
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nombre de la persona"
                autoComplete="name"
                maxLength={INPUT_LIMITS.name}
                required
              />
            </label>
            <label className="field">Apodo<input maxLength={INPUT_LIMITS.userNickname} value={nickname} onChange={(event) => setNickname(event.target.value)} /></label>
            <label className="field">Nota<textarea maxLength={INPUT_LIMITS.userNote} value={note} onChange={(event) => setNote(event.target.value)} rows={2} /></label>
            <label className="field">
              Usuario / correo
              <input
                type="text"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="usuario o correo@empresa.com"
                autoComplete="username"
                maxLength={INPUT_LIMITS.email}
                required
              />
            </label>
            <label className="field">
              Rol
              <select
                aria-label="Rol"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as AccountRole)
                }
              >
                {ACCOUNT_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {role === "collector" && (
              <label className="field">
                Cobrador asignado
                <select
                  required
                  aria-label="Cobrador asignado"
                  value={collectorId}
                  onChange={(event) => setCollectorId(event.target.value)}
                >
                  <option value="">Selecciona un cobrador…</option>
                  {collectorOptionsForAccount(snapshot.collectors, collectorId).map((collector) => (
                    <option key={collector.value} value={collector.value} disabled={collector.disabled}>
                      {collector.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {role === "collector" && <p className="catalog-association-note">Selecciona la ficha de un cobrador activo. Sus datos personales y límites se administran desde Cobradores.</p>}
          </>
        )}
        {!creating && (
          <div className="readonly-summary">
            <div>
              <span>Nombre</span>
              <strong>{operation.account.name}</strong>
            </div>
            <div>
              <span>Usuario / correo</span>
              <strong>{operation.account.email}</strong>
            </div>
            <div>
              <span>Rol</span>
              <strong>
                {accountRoleLabel(operation.account.role)}
                {operation.account.role === "collector" && ` · ${collectorName(operation.account.collectorId)}`}
              </strong>
            </div>
          </div>
        )}
        {(creating || rotating) && (
          <label className="field">
            Contraseña ({MIN_LENGTH} caracteres mínimo)
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Contraseña inicial"
              autoComplete="new-password"
              required
              minLength={MIN_LENGTH}
              maxLength={INPUT_LIMITS.password}
            />
          </label>
        )}
        </fieldset>
        {(error || request.error) && (
          <div className="inline-error" role="alert">
            <CircleAlert size={17} />
            {request.error || error}
          </div>
        )}
        {request.uncertain && <p role="status">El resultado está pendiente de confirmación. Reintenta la misma operación antes de cambiar datos o cerrar.</p>}
        {(creating || rotating) && (
          <HelpNote>
            Entrega esta contraseña personalmente. El cobrador puede cambiarla
            desde su portal; cambiarla aquí cierra las sesiones abiertas.
          </HelpNote>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            disabled={locked}
            onClick={close}
          >
            Cancelar
          </button>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : rotating ? (
              <KeyRound size={17} />
            ) : operation.type === "status" ? (
              <ShieldCheck size={17} />
            ) : (
              <Check size={17} />
            )}{" "}
            {busy
              ? "Guardando…"
              : request.uncertain
                ? "Reintentar misma operación"
              : creating
                ? "Crear cuenta"
                : rotating
                  ? "Cambiar contraseña"
                  : operation.status === "disabled"
                    ? "Desactivar"
                    : "Activar"}
            {!busy && <ArrowRight size={15} />}
          </button>
        </div>
      </form>
    </Modal>
  );
}
