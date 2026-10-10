import { useEffect, useRef, useState } from "react";
import { Database, Download, FileSearch, KeyRound, Plus, Printer, RefreshCw } from "lucide-react";
import { LegacyDialog, handleKeyboardActivation } from "./LegacyConnectedUi";
import { remittancesApi } from "./remittancesApi";
import { exportSections, formatMoney, printSections, type OutputSection } from "../../shared/remittances/output";
import type { Balance, Snapshot } from "./types";
import { currentOperationalWeek } from "../../shared/operationalWeek";
import { settlementBalances, settlementCurrencyCodes, settlementRows, type SettlementBalance, type SettlementCurrency } from "./settlementCurrencies";
import "./connected-report-layout.css";

const balanceFields = [
  ["Cobrado", "collected"], ["Depositado", "deposited"],
  ["Entregado", "officeDelivered"], ["Pagado", "paidToClients"],
] as const;

function SettlementTotals({ balance, currency }: { balance: Balance; currency: SettlementCurrency }) {
  return <div className="settlement-breakdown-cell">
    {balanceFields.map(([label, key]) => <div key={key}><span>{label}:</span><strong>{formatMoney(balance[key], currency)}</strong></div>)}
  </div>;
}

export function ConnectedSettlements({ snapshot, onRefresh }: { snapshot: Snapshot; onRefresh: () => void }) {
  const [collectorId, setCollectorId] = useState("");
  const [date, setDate] = useState(snapshot.businessDate);
  const [preview, setPreview] = useState<{ collectorId: string; date: string; balance: SettlementBalance } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [from, setFrom] = useState(() => currentOperationalWeek().from);
  const [to, setTo] = useState(() => currentOperationalWeek().to);
  const [currency, setCurrency] = useState<SettlementCurrency | "">("");
  const [filterCollectorId, setFilterCollectorId] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [detailId, setDetailId] = useState("");
  const [generationOpen, setGenerationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => { gridRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [selectedId]);
  const collectorName = (id: string) => snapshot.collectors.find((collector) => collector.id === id)?.name ?? "Cobrador no disponible";
  const invalidRange = Boolean(from && to && from > to);
  const allRows = settlementRows(snapshot.settlements);
  const rows = invalidRange ? [] : allRows.filter((row) => (!from || row.date >= from) && (!to || row.date <= to) && (!currency || row.currency === currency) && (!filterCollectorId || row.collectorId === filterCollectorId));
  const selected = rows.find((row) => row.id === selectedId);
  const detail = allRows.find((row) => row.id === detailId);
  const totals = settlementCurrencyCodes.filter((code) => rows.some((row) => row.currency === code)).map((code) => ({ currency: code, ...rows.filter((row) => row.currency === code).reduce((sum, row) => ({ collected: sum.collected + row.collected, officeDelivered: sum.officeDelivered + row.officeDelivered, difference: sum.difference + row.difference }), { collected: 0, officeDelivered: 0, difference: 0 }) }));
  const canClose = Boolean(preview && settlementBalances(preview.balance).every(({ balance }) => balance.difference === 0));
  const calculate = async () => {
    if (!collectorId || !date || busy) return;
    const selection = { collectorId, date };
    setBusy(true); setError(""); setMessage(""); setPreview(null);
    try { const balance = await remittancesApi<SettlementBalance>(`/cuadres/preview?collectorId=${encodeURIComponent(selection.collectorId)}&date=${selection.date}`); setPreview({ ...selection, balance }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo calcular el cuadre."); }
    finally { setBusy(false); }
  };
  const close = async () => {
    if (!preview || !canClose || busy) return;
    setBusy(true); setError("");
    try { await remittancesApi("/cuadres", { method: "POST", body: JSON.stringify({ collectorId: preview.collectorId, date: preview.date }) }); setPreview(null); setGenerationOpen(false); setMessage("Jornada cerrada correctamente."); onRefresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo cerrar la jornada."); }
    finally { setBusy(false); }
  };
  const moveSelection = (direction: "first" | "previous" | "next" | "last") => {
    if (!rows.length) return;
    const current = rows.findIndex((row) => row.id === selectedId);
    const next = direction === "first" ? 0 : direction === "last" ? rows.length - 1 : current < 0 ? 0 : direction === "previous" ? Math.max(0, current - 1) : Math.min(rows.length - 1, current + 1);
    setSelectedId(rows[next].id);
  };
  const output: OutputSection[] = [
    { title: "Criterios", columns: ["Dato", "Valor"], rows: [["Desde", from || "Inicio"], ["Hasta", to || "Fin"], ["Cobrador", filterCollectorId ? collectorName(filterCollectorId) : "Todos"], ["Moneda", currency || "Todas, con totales separados"], ["Alcance", "Jornadas cerradas del libro de cobros y pagos. La caja de Envíos de Dinero es independiente."]] },
    { title: "Cuadres diarios", columns: ["Fecha", "Cobrador", "Moneda", "Cobrado", "Depositado", "Entregado", "Pagado", "Diferencia", "Estado"], rows: rows.map((row) => [row.date, collectorName(row.collectorId), row.currency, ...balanceFields.map(([, key]) => formatMoney(row[key], row.currency)), formatMoney(row.difference, row.currency), "Cerrado"]) },
    { title: "Totales por moneda", columns: ["Moneda", "Cobrado", "Entregado", "Diferencia"], rows: totals.map((total) => [total.currency, formatMoney(total.collected, total.currency), formatMoney(total.officeDelivered, total.currency), formatMoney(total.difference, total.currency)]) },
  ];
  const outputAction = (kind: "csv" | "print") => {
    if (invalidRange) return;
    setError("");
    try {
      if (kind === "csv") { exportSections("cuadres-diarios", output); setExportOpen(false); }
      else printSections("Cuadres Diarios", output, "CyP · Cobros y pagos");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo generar la salida."); }
  };
  const dismissGeneration = () => { if (!busy) { setGenerationOpen(false); setPreview(null); } };

  return <div className="daily-settlements-mdi connected-settlements-mdi">
    <div className="legacy-mdi-toolbar" aria-label="Herramientas de cuadres diarios">
      <button type="button" className={filtersVisible ? "nav-tool active" : "nav-tool"} title="Mostrar/Ocultar filtros" aria-label="Mostrar/Ocultar filtros" aria-pressed={filtersVisible} onClick={() => setFiltersVisible((visible) => !visible)}><KeyRound size={15} /></button>
      <button type="button" className="nav-tool" title="Primer cuadre" disabled={!rows.length} onClick={() => moveSelection("first")}>|&lt;</button>
      <button type="button" className="nav-tool" title="Cuadre anterior" disabled={!rows.length} onClick={() => moveSelection("previous")}>&lt;</button>
      <button type="button" className="nav-tool" title="Cuadre siguiente" disabled={!rows.length} onClick={() => moveSelection("next")}>&gt;</button>
      <button type="button" className="nav-tool" title="Último cuadre" disabled={!rows.length} onClick={() => moveSelection("last")}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      <button type="button" title="Generar cuadre" aria-label="Generar cuadre" disabled={busy} onClick={() => { setDate(snapshot.businessDate); setCollectorId(filterCollectorId); setPreview(null); setError(""); setGenerationOpen(true); }}><span className="settlement-generate-icon"><Database size={14} /><Plus size={9} /></span></button>
      <button type="button" title="Ver balance del día" aria-label="Ver balance del día" disabled={!selected} onClick={() => selected && setDetailId(selected.id)}><FileSearch size={15} /></button>
      <button type="button" title="Refrescar" aria-label="Refrescar" disabled={busy} onClick={onRefresh}><RefreshCw size={15} /></button>
      <button type="button" title="Imprimir" aria-label="Imprimir" disabled={invalidRange} onClick={() => outputAction("print")}><Printer size={15} /></button>
      <button type="button" title="Exportar CSV" aria-label="Exportar CSV" disabled={invalidRange} onClick={() => setExportOpen(true)}><Download size={15} /></button>
    </div>
    {error && !generationOpen && !exportOpen && <p className="connected-report-feedback" role="alert">{error}</p>}
    {message && <p className="connected-report-feedback" role="status">{message}</p>}
    <div className="daily-settlements-workspace">
      {filtersVisible && <aside className="daily-settlements-filter">
        <h2>Panel de Filtro</h2>
        <label>Fecha Inicial:<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Fecha Final:<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label>Moneda:<select value={currency} onChange={(event) => setCurrency(event.target.value as SettlementCurrency | "")}><option value="">Todas</option>{settlementCurrencyCodes.map((code) => <option value={code} key={code}>{code}</option>)}</select></label>
        <label>Cobrador:<select value={filterCollectorId} onChange={(event) => setFilterCollectorId(event.target.value)}><option value="">Todos</option>{snapshot.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}</option>)}</select></label>
        {invalidRange && <p role="alert">La fecha inicial debe ser anterior o igual a la final.</p>}
        <p className="connected-settlement-scope">Cada cierre abarca todas las monedas con movimientos y muestra sus totales por separado. La caja de Envíos de Dinero se consulta dentro de Envíos.</p>
        <div className="legacy-dialog-actions"><button type="button" disabled={busy} onClick={onRefresh}>Refrescar</button></div>
      </aside>}
      <section className="daily-settlements-grid-panel" aria-label="Cuadres diarios cerrados">
        <div className="daily-settlements-grid-scroll legacy-mdi-table-wrap" ref={gridRef}>
          <table className="daily-settlements-grid connected-settlements-grid">
            <colgroup><col className="settlement-date-column" /><col className="connected-settlement-collector-column" /><col className="settlement-total-column" /><col className="settlement-balance-column" /><col className="connected-settlement-state-column" /></colgroup>
            <thead><tr><th scope="col">Fecha</th><th scope="col">Cobrador / moneda</th><th scope="col">Total</th><th scope="col">Balance</th><th scope="col">Estado</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} className={selectedId === row.id ? "selected-row" : undefined} aria-selected={selectedId === row.id} tabIndex={0} onClick={() => setSelectedId(row.id)} onDoubleClick={() => { setSelectedId(row.id); setDetailId(row.id); }} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedId(row.id))}>
              <td className="settlement-date-cell">{row.date}</td><td>{collectorName(row.collectorId)} · {row.currency}</td><td><SettlementTotals balance={row} currency={row.currency} /></td><td className="settlement-balance-value">{formatMoney(row.difference, row.currency)}</td><td>Cerrado</td>
            </tr>)}</tbody>
          </table>
          {!rows.length && <div className="daily-settlements-empty">{invalidRange ? "Corrige el rango de fechas para consultar los cuadres." : "No hay jornadas cerradas en este rango."}</div>}
        </div>
        <footer className="daily-settlements-footer"><span>Filas: <strong>{rows.length}</strong></span>{totals.map((total) => <span key={total.currency}>{total.currency} · Cobrado: <strong>{formatMoney(total.collected, total.currency)}</strong> · Entregado: <strong>{formatMoney(total.officeDelivered, total.currency)}</strong> · Balance: <strong>{formatMoney(total.difference, total.currency)}</strong></span>)}</footer>
      </section>
    </div>
    {generationOpen && <LegacyDialog title={preview ? "Confirmar cierre de jornada..." : "Generar cuadre..."} onClose={dismissGeneration} className={preview ? "settlement-balance-editor-dialog connected-settlement-dialog" : "settlement-date-dialog"}>
      {!preview ? <form className="legacy-dialog-form" onSubmit={(event) => { event.preventDefault(); void calculate(); }}>
        <label>Cobrador:<select value={collectorId} disabled={busy} onChange={(event) => setCollectorId(event.target.value)} required><option value="">Selecciona…</option>{snapshot.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}</option>)}</select></label>
        <label>Jornada:<input type="date" value={date} disabled={busy} required onChange={(event) => setDate(event.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="legacy-dialog-actions centered"><button type="submit" disabled={!collectorId || !date || busy}>{busy ? "Consultando…" : "Calcular cuadre"}</button><button type="button" disabled={busy} onClick={dismissGeneration}>Cancelar</button></div>
      </form> : <div className="settlement-balance-editor">
        <div className="settlement-balance-header"><label>Fecha:<input value={preview.date} readOnly /></label><label>Monedas:<input value="Todas con movimientos" readOnly /></label></div>
        <p className="connected-report-dialog-note">{collectorName(preview.collectorId)}</p>
        {settlementBalances(preview.balance).map(({ currency: code, balance }) => <section key={code} aria-label={`Cuadre ${code}`}><h3>{code}</h3>{[...balanceFields, ["Diferencia", "difference"] as const].map(([label, key]) => <label className="settlement-balance-row connected-settlement-balance-row" key={key}><span>{label}:</span><input value={formatMoney(balance[key], code)} readOnly /></label>)}</section>)}
        <p className="connected-report-dialog-note">Solo se puede cerrar con diferencia cero en cada moneda. Los movimientos de toda la jornada quedarán cerrados.</p>
        {error && <p role="alert">{error}</p>}
        <div className="legacy-dialog-actions centered"><button type="button" disabled={busy || !canClose} onClick={() => void close()}>{busy ? "Cerrando…" : "Cerrar jornada"}</button><button type="button" disabled={busy} onClick={() => { setPreview(null); setError(""); }}>Volver</button><button type="button" disabled={busy} onClick={dismissGeneration}>Cancelar</button></div>
      </div>}
    </LegacyDialog>}
    {detail && <LegacyDialog title="Balance del Día..." onClose={() => setDetailId("")} className="settlement-balance-editor-dialog connected-settlement-dialog">
      <div className="settlement-balance-editor">
        <div className="settlement-balance-header"><label>Fecha:<input value={detail.date} readOnly /></label><label>Moneda:<input value={detail.currency} readOnly /></label></div>
        <p className="connected-report-dialog-note">{collectorName(detail.collectorId)} · Cerrado</p>
        {[...balanceFields, ["Diferencia", "difference"] as const].map(([label, key]) => <label className="settlement-balance-row connected-settlement-balance-row" key={key}><span>{label}:</span><input value={formatMoney(detail[key], detail.currency)} readOnly /></label>)}
        <div className="legacy-dialog-actions centered"><button type="button" onClick={() => setDetailId("")}>Cerrar</button></div>
      </div>
    </LegacyDialog>}
    {exportOpen && <LegacyDialog title="Seleccione un valor..." onClose={() => setExportOpen(false)} className="pending-charges-export-dialog">
      <form className="pending-charges-export-form" onSubmit={(event) => { event.preventDefault(); outputAction("csv"); }}>
        <label><span>Formato:</span><select defaultValue="csv"><option value="csv">CSV (separado por punto y coma)</option></select></label>
        {error && <p role="alert">{error}</p>}
        <div className="pending-charges-export-actions"><button type="submit" disabled={invalidRange}>oK</button><button type="button" onClick={() => setExportOpen(false)}>Cancelar</button></div>
      </form>
    </LegacyDialog>}
  </div>;
}
