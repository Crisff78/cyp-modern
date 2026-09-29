import { useState } from "react";
import { Modal } from "./components";
import { remittancesApi } from "./remittancesApi";
import { formatMoney } from "../../shared/remittances/output";
import type { Balance, Snapshot } from "./types";

export function ConnectedSettlements({ snapshot, onRefresh }: { snapshot: Snapshot; onRefresh: () => void }) {
  const [collectorId, setCollectorId] = useState("");
  const [date, setDate] = useState(snapshot.businessDate);
  const [preview, setPreview] = useState<{ collectorId: string; date: string; balance: Balance } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const calculate = async () => {
    if (!collectorId || !date || busy) return;
    const selection = { collectorId, date };
    setBusy(true); setError(""); setMessage(""); setPreview(null);
    try { const balance = await remittancesApi<Balance>(`/cuadres/preview?collectorId=${encodeURIComponent(selection.collectorId)}&date=${selection.date}`); setPreview({ ...selection, balance }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo calcular el cuadre."); }
    finally { setBusy(false); }
  };
  const close = async () => {
    if (!preview || preview.balance.difference !== 0 || busy) return;
    setBusy(true); setError("");
    try { await remittancesApi("/cuadres", { method: "POST", body: JSON.stringify({ collectorId: preview.collectorId, date: preview.date }) }); setPreview(null); setMessage("Jornada cerrada correctamente."); onRefresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo cerrar la jornada."); }
    finally { setBusy(false); }
  };
  const rows = snapshot.settlements.filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
  return <section className="connected-catalog"><p>Cuadres del libro de cobros y pagos en DOP. La caja de Envíos de Dinero se consulta dentro de Envíos.</p><div className="connected-catalog-toolbar"><label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button type="button" onClick={onRefresh}>Refrescar</button></div><div className="connected-catalog-scroll"><table className="legacy-mdi-table"><thead><tr><th>Fecha</th><th>Cobrador</th><th>Cobrado</th><th>Depositado</th><th>Entregado</th><th>Pagado</th><th>Diferencia</th><th>Estado</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.date}</td><td>{snapshot.collectors.find((collector) => collector.id === (row as typeof row & { collectorId: string }).collectorId)?.name ?? "Cobrador no disponible"}</td>{[row.collected, row.deposited, row.officeDelivered, row.paidToClients, row.difference].map((amount, index) => <td key={index}>{formatMoney(amount, "DOP")}</td>)}<td>Cerrado</td></tr>)}</tbody></table>{!rows.length && <p>No hay jornadas cerradas en este rango.</p>}</div><hr /><div className="connected-catalog-toolbar"><label>Cobrador<select value={collectorId} disabled={busy} onChange={(event) => { setCollectorId(event.target.value); setPreview(null); }}><option value="">Selecciona…</option>{snapshot.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}</option>)}</select></label><label>Jornada<input type="date" value={date} disabled={busy} onChange={(event) => { setDate(event.target.value); setPreview(null); }} /></label><button type="button" disabled={!collectorId || !date || busy} onClick={() => void calculate()}>{busy ? "Consultando…" : "Calcular cuadre"}</button></div>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}<Modal className="connected-catalog-dialog" overlayClassName="connected-catalog-overlay" open={Boolean(preview)} title="Confirmar cierre de jornada" onClose={() => { if (!busy) setPreview(null); }}><p>{snapshot.collectors.find((collector) => collector.id === preview?.collectorId)?.name} · {preview?.date}</p>{preview && <dl>{Object.entries({ Cobrado: preview.balance.collected, Depositado: preview.balance.deposited, Entregado: preview.balance.officeDelivered, Pagado: preview.balance.paidToClients, Diferencia: preview.balance.difference }).map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{formatMoney(amount, "DOP")}</dd></div>)}</dl>}<p>Solo se puede cerrar con diferencia cero. Los movimientos de la jornada quedarán cerrados.</p>{error && <p role="alert">{error}</p>}<div className="connected-row-actions"><button type="button" disabled={busy} onClick={() => setPreview(null)}>Cancelar</button><button type="button" disabled={busy || preview?.balance.difference !== 0} onClick={() => void close()}>{busy ? "Cerrando…" : "Cerrar jornada"}</button></div></Modal></section>;
}
