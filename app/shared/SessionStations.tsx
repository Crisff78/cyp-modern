import { useEffect, useId, useRef, useState } from "react";
import { listLocalStationInstallations } from "./remittances/localStationInstallations";
import type { StrictApi } from "./remittances/strictApi";
import { STATION_NOTICE_KEY } from "./sessionHandoff";
import { readSessionStations, type SessionStation } from "./sessionStationsApi";
import "./session-stations.css";

type Result = { stations: SessionStation[]; browserReadable: boolean };
type Props = {
  actorId: string;
  api: StrictApi;
  registerStation?: (actorId: string, station: SessionStation) => Promise<void>;
};

export function SessionStations({ actorId, api, registerStation }: Props) {
  const [open, setOpen] = useState(() => sessionStorage.getItem(STATION_NOTICE_KEY) === actorId);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState(false);
  const [choice, setChoice] = useState<SessionStation | null>(null);
  const [busy, setBusy] = useState(false);
  const [registrationError, setRegistrationError] = useState("");
  const working = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();

  useEffect(() => {
    const refresh = () => setAttempt(n => n + 1);
    window.addEventListener("cyp-stations-updated", refresh);
    return () => window.removeEventListener("cyp-stations-updated", refresh);
  }, []);
  useEffect(() => {
    let current = true;
    setError(false);
    setResult(null);
    async function load() {
      let browserReadable = true;
      const installations = await listLocalStationInstallations().catch(() => {
        browserReadable = false;
        return [];
      });
      if (!current) return;
      const stations = await readSessionStations(api, installations);
      if (current) setResult({ stations, browserReadable });
    }
    void load().catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [actorId, api, attempt]);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);

  const linked = result?.stations.filter(row => row.linked) ?? [];
  const current = linked.length === 1 ? linked[0] : undefined;
  const status = error ? "No se pudieron consultar las estaciones." : !result ? "Consultando estaciones…"
    : !result.browserReadable ? "No se pudo identificar este navegador."
    : current ? `Estación actual: ${current.number} · ${current.name}`
    : linked.length > 1 ? "Este navegador está vinculado a varias estaciones. No hay una estación única en uso."
    : "Este navegador no tiene una estación activa vinculada.";
  const canChoose = Boolean(registerStation && result?.browserReadable && result.stations.length && !linked.length);
  const selected = canChoose && choice ? result?.stations.find(row => row.number === choice.number && row.name === choice.name) : undefined;
  const register = async () => {
    if (working.current || !selected || !registerStation) return;
    working.current = true; setBusy(true); setRegistrationError("");
    try {
      await registerStation(actorId, selected);
      setChoice(null);
    } catch (failure) {
      setRegistrationError(failure instanceof Error ? failure.message : "No se pudo registrar este navegador.");
    } finally {
      working.current = false; setBusy(false);
    }
  };
  const reopen = () => { setAttempt(n => n + 1); setOpen(true); };
  const dismiss = () => {
    setOpen(false);
    if (!registrationError || current) {
      setChoice(null);
      setRegistrationError("");
    }
    if (sessionStorage.getItem(STATION_NOTICE_KEY) === actorId) sessionStorage.removeItem(STATION_NOTICE_KEY);
  };
  return <>
    <button type="button" className="session-station-trigger" title={status} aria-label={`Ver estaciones. ${status}`} onClick={reopen}>
      {current ? `Estación · ${current.number}` : "Estaciones"}
    </button>
    {open && <dialog ref={dialog} className="session-stations" aria-labelledby={title} onCancel={event => { if (working.current) event.preventDefault(); }} onClose={dismiss}>
      <h2 id={title}>Estaciones disponibles</h2>
      <p role="status">{status}</p>
      {canChoose && <p>Selecciona la estación que usarás en este navegador.</p>}
      {result && (result.stations.length
        ? <ul aria-label="Estaciones activas">{result.stations.map(row =>
          <li key={row.number}>{canChoose ? <label>
            <input type="radio" name={`${title}-station`} checked={selected === row} disabled={busy}
              onChange={() => { setChoice(row); setRegistrationError(""); }} />
            <span>{row.number} · {row.name}</span>
          </label> : <span>{row.number} · {row.name}</span>}
            {row.linked && <strong>{current ? "En uso" : "Vinculada"}</strong>}
          </li>)}</ul>
        : <p>No hay estaciones activas.</p>)}
      {registrationError && !current && <p role="alert">{registrationError}</p>}
      <div className="session-stations-actions">
        {(error || result?.browserReadable === false) && <button type="button" onClick={() => setAttempt(n => n + 1)}>Reintentar</button>}
        {registrationError && !error && !current && <button type="button" disabled={busy} onClick={() => { setRegistrationError(""); setAttempt(n => n + 1); }}>Actualizar listado</button>}
        {canChoose && <button type="button" disabled={!selected || busy} onClick={() => void register()}>
          {busy ? "Registrando…" : selected ? `${registrationError ? "Reintentar registro en" : "Registrar en"} ${selected.number}` : "Registrar este navegador"}
        </button>}
        <button type="button" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>{canChoose ? (registrationError ? "Cerrar" : "Continuar sin registrar") : "Continuar"}</button>
      </div>
    </dialog>}
  </>;
}
