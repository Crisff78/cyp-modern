import { useEffect, useId, useRef, useState } from "react";
import { listLocalStationInstallations } from "./remittances/localStationInstallations";
import type { StrictApi } from "./remittances/strictApi";
import { STATION_NOTICE_KEY } from "./sessionHandoff";
import "./session-stations.css";

type Station = { name: string; number: string; linked: boolean };
type Result = { stations: Station[]; browserReadable: boolean };

export function SessionStations({ actorId, api }: { actorId: string; api: StrictApi }) {
  const [open, setOpen] = useState(() => sessionStorage.getItem(STATION_NOTICE_KEY) === actorId);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState(false);
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
      const stations = await api<Station[]>("/auth/estaciones", {
        method: "POST", readOnly: true, body: JSON.stringify({ installations }),
      });
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
  const reopen = () => { setAttempt(n => n + 1); setOpen(true); };
  const dismiss = () => {
    setOpen(false);
    if (sessionStorage.getItem(STATION_NOTICE_KEY) === actorId) sessionStorage.removeItem(STATION_NOTICE_KEY);
  };
  return <>
    <button type="button" className="session-station-trigger" title={status} aria-label={`Ver estaciones. ${status}`} onClick={reopen}>
      {current ? `Estación · ${current.number}` : "Estaciones"}
    </button>
    {open && <dialog ref={dialog} className="session-stations" aria-labelledby={title} onClose={dismiss}>
      <h2 id={title}>Estaciones disponibles</h2>
      <p role="status">{status}</p>
      {result && (result.stations.length
        ? <ul aria-label="Estaciones activas">{result.stations.map(row =>
          <li key={row.number}><span>{row.number} · {row.name}</span>
            {row.linked && <strong>{current ? "En uso" : "Vinculada"}</strong>}
          </li>)}</ul>
        : <p>No hay estaciones activas.</p>)}
      <div className="session-stations-actions">
        {(error || result?.browserReadable === false) && <button type="button" onClick={() => setAttempt(n => n + 1)}>Reintentar</button>}
        <button type="button" autoFocus onClick={() => dialog.current?.close()}>Continuar</button>
      </div>
    </dialog>}
  </>;
}
