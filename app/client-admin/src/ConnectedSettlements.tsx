import { useEffect, useRef, useState } from "react";
import { Database, Download, FileSearch, Plus, Printer, RefreshCw } from "lucide-react";
import { FiltersPanelIcon } from "./PanelIcons";
import { LegacyDialog, handleKeyboardActivation } from "./LegacyConnectedUi";
import { remittancesApi } from "./remittancesApi";
import { SettlementCashDialog } from "./SettlementCashDialog";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";
import { exportSections, formatMoney, printSections, type OutputSection } from "../../shared/remittances/output";
import type { Balance, Snapshot } from "./types";
import type { PreviousCashPreview } from "../../shared/cashReconciliation";
import { currentOperationalWeek } from "../../shared/operationalWeek";
import { settlementBalances, settlementCurrencyCodes, settlementWorkspaceRows, type SettlementBalance, type SettlementCurrency, type SettlementWorkspaceRow } from "./settlementCurrencies";
import "./connected-report-layout.css";

const balanceFields = [
  ["Cobrado", "collected"], ["Depositado", "deposited"],
  ["Entregado", "officeDelivered"], ["Pagado", "paidToClients"],
] as const;
type Selection = { collectorId: string; date: string };
const cashRemaining = (balance: Balance) => [
  balance.collected - balance.deposited - (balance.returnedCollection ?? 0),
  balance.officeDelivered - balance.paidToClients - (balance.returnedPayout ?? 0),
];
const balanced = (balance: Balance) => cashRemaining(balance).every((value) => Number.isSafeInteger(value) && value === 0);

function SettlementTotals({ balance, currency }: { balance: Balance; currency: SettlementCurrency }) {
  return <div className="settlement-breakdown-cell">
    {balanceFields.map(([label, key]) => <div key={key}><span>{label}:</span><strong>{formatMoney(balance[key], currency)}</strong></div>)}
    {(balance.returnedCollection ?? 0) + (balance.returnedPayout ?? 0) > 0 && <div><span>Devuelto / conciliado:</span><strong>{formatMoney((balance.returnedCollection ?? 0) + (balance.returnedPayout ?? 0), currency)}</strong></div>}
  </div>;
}

export function ConnectedSettlements({ snapshot, actorId = "", canManage = false, onRefresh }: {
  snapshot: Snapshot; actorId?: string; canManage?: boolean;
  onRefresh: () => void | boolean | Promise<void | boolean>;
}) {
  const request = useMovementRequest(actorId, "daily-settlement");
  const pendingClose = pendingMovementDraft<Selection>(actorId, "daily-settlement");
  const [collectorId, setCollectorId] = useState(pendingClose?.collectorId ?? "");
  const [date, setDate] = useState(pendingClose?.date ?? snapshot.businessDate);
  const [preview, setPreview] = useState<(Selection & { balance: SettlementBalance }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedClose, setSavedClose] = useState<Selection | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const allRows = settlementWorkspaceRows(snapshot);
  const receiptDraftFor = (id: string) => pendingMovementDraft<{ preview: PreviousCashPreview }>(actorId, `previous-cash:${id}`);
  const outstandingReceipt = snapshot.collectors.map((row) => ({ collectorId: row.id, draft: receiptDraftFor(row.id) })).find((row) => row.draft);
  const receiptDraft = receiptDraftFor(collectorId);
  const receiptTarget: Selection | null = receiptDraft ? { collectorId,
    date: receiptDraft.preview.date ?? receiptDraft.preview.rows[0]?.date ?? date } : preview;
  const [from, setFrom] = useState(() => {
    const start = currentOperationalWeek().from;
    return allRows.filter((row) => row.state === "Pendiente" && !balanced(row)).reduce((first, row) => row.date < first ? row.date : first, start);
  });
  const [to, setTo] = useState(() => currentOperationalWeek().to);
  const [currency, setCurrency] = useState<SettlementCurrency | "">("");
  const [filterCollectorId, setFilterCollectorId] = useState("");
  const [filterState, setFilterState] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [detailId, setDetailId] = useState("");
  const [generationOpen, setGenerationOpen] = useState(Boolean(pendingClose));
  const [receiptSelection, setReceiptSelection] = useState<Selection | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => { gridRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [selectedId]);
  const collectorName = (id: string) => snapshot.collectors.find((collector) => collector.id === id)?.name ?? "Cobrador no disponible";
  const invalidRange = Boolean(from && to && from > to);
  const rows = invalidRange ? [] : allRows.filter((row) => (!from || row.date >= from) && (!to || row.date <= to) &&
    (!currency || row.currency === currency) && (!filterCollectorId || row.collectorId === filterCollectorId) && (!filterState || row.state === filterState));
  const selected = rows.find((row) => row.id === selectedId);
  const detail = allRows.find((row) => row.id === detailId);
  const totals = settlementCurrencyCodes.filter((code) => rows.some((row) => row.currency === code)).map((code) => ({ currency: code,
    ...rows.filter((row) => row.currency === code).reduce((sum, row) => ({ collected: sum.collected + row.collected, officeDelivered: sum.officeDelivered + row.officeDelivered,
      difference: sum.difference + row.difference }), { collected: 0, officeDelivered: 0, difference: 0 }) }));
  const alreadyClosed = Boolean(preview && snapshot.settlements.some((row) => row.collectorId === preview.collectorId && row.date === preview.date));
  const earlier = preview ? allRows.filter((row) => row.collectorId === preview.collectorId && row.date < preview.date && row.state === "Pendiente" && !balanced(row))
    .sort((a, b) => a.date.localeCompare(b.date))[0] : undefined;
  const balances = preview ? settlementBalances(preview.balance) : [];
  const canClose = Boolean(canManage && actorId && preview && preview.date <= snapshot.businessDate && !alreadyClosed && !earlier && !outstandingReceipt && balances.every(({ balance }) => balanced(balance)));
  const canReceive = Boolean(canManage && actorId && preview && !alreadyClosed && !earlier && !outstandingReceipt && preview.date <= snapshot.businessDate &&
    balances.some(({ balance }) => !balanced(balance)) && balances.every(({ balance }) => cashRemaining(balance).every((value) => Number.isSafeInteger(value) && value >= 0)));
  const busy = loading || request.busy;
  const selectionLocked = busy || request.uncertain || Boolean(savedClose) || Boolean(receiptDraft);

  const calculate = async (selection: Selection = { collectorId, date }) => {
    if (!selection.collectorId || !selection.date || busy || request.uncertain || outstandingReceipt) return;
    setCollectorId(selection.collectorId); setDate(selection.date); setGenerationOpen(true);
    setLoading(true); setError(""); setMessage(""); setPreview(null); request.clear();
    try {
      const balance = await remittancesApi<SettlementBalance>(`/cuadres/preview?collectorId=${encodeURIComponent(selection.collectorId)}&date=${selection.date}`);
      setPreview({ ...selection, balance });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo calcular el cuadre."); }
    finally { setLoading(false); }
  };
  const finish = async (selection: Selection, text: string) => {
    if (await onRefresh() === false) throw new Error("La recarga no fue confirmada.");
    setFrom((current) => current && current <= selection.date ? current : selection.date);
    setTo((current) => current && current >= selection.date ? current : selection.date);
    setFilterState(""); setFilterCollectorId(selection.collectorId);
    setMessage(text); setPreview(null); setSavedClose(null); setGenerationOpen(false); setError("");
  };
  const close = async () => {
    const selection = pendingClose ?? preview;
    if (!canManage || !actorId || !selection || busy || savedClose || (!pendingClose && !canClose)) return;
    setError("");
    try {
      await request.run<Snapshot["settlements"][number]>("/cuadres", { collectorId: selection.collectorId, date: selection.date },
        { collectorId: selection.collectorId, date: selection.date },
        (result) => typeof result?.id === "string" && result.collectorId === selection.collectorId && result.date === selection.date && result.status === "closed");
      setSavedClose(selection);
      try { await finish(selection, "Cuadre guardado y jornada cerrada correctamente."); }
      catch { setError("El cuadre ya se guardó. Actualiza la vista para consultar el cierre; no hace falta repetirlo."); }
    } catch { /* The original closing intent remains available when a response is lost. */ }
  };
  const refreshSaved = async () => {
    if (!savedClose || busy) return;
    setLoading(true);
    try { await finish(savedClose, "Cuadre guardado y jornada cerrada correctamente."); }
    catch { setError("El cuadre ya se guardó. Actualiza la vista para consultar el cierre; no hace falta repetirlo."); }
    finally { setLoading(false); }
  };
  const openGeneration = () => {
    const pending = pendingMovementDraft<Selection>(actorId, "daily-settlement");
    setCollectorId(savedClose?.collectorId ?? pending?.collectorId ?? outstandingReceipt?.collectorId ?? filterCollectorId);
    setDate(savedClose?.date ?? pending?.date ?? outstandingReceipt?.draft?.preview.date ?? outstandingReceipt?.draft?.preview.rows[0]?.date ?? snapshot.businessDate);
    setPreview(null); setError(""); setGenerationOpen(true);
  };
  const inspect = (row: SettlementWorkspaceRow) => {
    setSelectedId(row.id);
    if (canManage && (request.uncertain || savedClose || outstandingReceipt)) { openGeneration(); return; }
    if (row.state === "Pendiente" && canManage && actorId) {
      if (request.uncertain || savedClose) { setGenerationOpen(true); return; }
      void calculate(row);
    } else setDetailId(row.id);
  };
  const moveSelection = (direction: "first" | "previous" | "next" | "last") => {
    if (!rows.length) return;
    const current = rows.findIndex((row) => row.id === selectedId);
    const next = direction === "first" ? 0 : direction === "last" ? rows.length - 1 : current < 0 ? 0 : direction === "previous" ? Math.max(0, current - 1) : Math.min(rows.length - 1, current + 1);
    setSelectedId(rows[next].id);
  };
  const output: OutputSection[] = [
    { title: "Criterios", columns: ["Dato", "Valor"], rows: [["Desde", from || "Inicio"], ["Hasta", to || "Fin"], ["Cobrador", filterCollectorId ? collectorName(filterCollectorId) : "Todos"],
      ["Moneda", currency || "Todas, con totales separados"], ["Estado", filterState || "Todos"], ["Alcance", "Cuadres pendientes, cerrados y conciliados del libro de cobros y pagos. La caja de remesas se cuadra aparte, en Cuadres Diarios → Caja de remesas."]] },
    { title: "Cuadres diarios", columns: ["Fecha", "Cobrador", "Moneda", "Cobrado", "Depositado", "Entregado", "Pagado", "Devuelto / conciliado", "Diferencia", "Estado"],
      rows: rows.map((row) => [row.date, collectorName(row.collectorId), row.currency, ...balanceFields.map(([, key]) => formatMoney(row[key], row.currency)),
        formatMoney((row.returnedCollection ?? 0) + (row.returnedPayout ?? 0), row.currency), formatMoney(row.difference, row.currency), row.state]) },
    { title: "Totales por moneda", columns: ["Moneda", "Cobrado", "Entregado", "Diferencia"], rows: totals.map((total) => [total.currency, formatMoney(total.collected, total.currency), formatMoney(total.officeDelivered, total.currency), formatMoney(total.difference, total.currency)]) },
  ];
  const outputAction = (kind: "csv" | "print") => {
    if (invalidRange) return;
    setError("");
    try { if (kind === "csv") { exportSections("cuadres-diarios", output); setExportOpen(false); } else printSections("Cuadres Diarios", output, "CyP · Cobros y pagos"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo generar la salida."); }
  };
  const dismissGeneration = () => { if (!busy) { setGenerationOpen(false); setPreview(null); } };
  const openReceipt = () => { if (receiptTarget) setReceiptSelection({ collectorId: receiptTarget.collectorId, date: receiptTarget.date }); };

  return <div className="daily-settlements-mdi connected-settlements-mdi">
    <div className="legacy-mdi-toolbar" aria-label="Herramientas de cuadres diarios">
      <button type="button" className={filtersVisible ? "nav-tool active" : "nav-tool"} title="Mostrar/Ocultar filtros" aria-label="Mostrar/Ocultar filtros" aria-pressed={filtersVisible} onClick={() => setFiltersVisible((visible) => !visible)}><FiltersPanelIcon /></button>
      <button type="button" className="nav-tool" title="Primer cuadre" disabled={!rows.length} onClick={() => moveSelection("first")}>|&lt;</button>
      <button type="button" className="nav-tool" title="Cuadre anterior" disabled={!rows.length} onClick={() => moveSelection("previous")}>&lt;</button>
      <button type="button" className="nav-tool" title="Cuadre siguiente" disabled={!rows.length} onClick={() => moveSelection("next")}>&gt;</button>
      <button type="button" className="nav-tool" title="Último cuadre" disabled={!rows.length} onClick={() => moveSelection("last")}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      <button type="button" title="Generar cuadre" aria-label="Generar cuadre" disabled={busy || !canManage || !actorId} onClick={openGeneration}><span className="settlement-generate-icon"><Database size={14} /><Plus size={9} /></span></button>
      <button type="button" title="Revisar cuadre" aria-label="Revisar cuadre" disabled={!selected || busy} onClick={() => selected && inspect(selected)}><FileSearch size={15} /></button>
      <button type="button" title="Refrescar" aria-label="Refrescar" disabled={busy} onClick={() => void onRefresh()}><RefreshCw size={15} /></button>
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
        <label>Moneda:<select aria-label="Moneda:" value={currency} onChange={(event) => setCurrency(event.target.value as SettlementCurrency | "")}><option value="">Todas</option>{settlementCurrencyCodes.map((code) => <option value={code} key={code}>{code}</option>)}</select></label>
        <label>Cobrador:<select aria-label="Cobrador:" value={filterCollectorId} onChange={(event) => setFilterCollectorId(event.target.value)}><option value="">Todos</option>{snapshot.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}</option>)}</select></label>
        <label>Estado:<select aria-label="Estado:" value={filterState} onChange={(event) => setFilterState(event.target.value)}><option value="">Todos</option><option>Pendiente</option><option>Cerrado</option><option>Conciliado</option></select></label>
        {invalidRange && <p role="alert">La fecha inicial debe ser anterior o igual a la final.</p>}
        <p className="connected-settlement-scope">Selecciona una jornada pendiente y pulsa Revisar cuadre. Aquí se recibe el efectivo pendiente y se guarda el cierre. Cada moneda se mantiene separada. La caja de remesas (apertura, conteo y cierre) está en la sección «Caja de remesas» de Cuadres Diarios.</p>
      </aside>}
      <section className="daily-settlements-grid-panel" aria-label="Cuadres diarios pendientes y guardados">
        <div className="daily-settlements-grid-scroll legacy-mdi-table-wrap" ref={gridRef}>
          <table className="daily-settlements-grid connected-settlements-grid">
            <colgroup><col className="settlement-date-column" /><col className="connected-settlement-collector-column" /><col className="settlement-total-column" /><col className="settlement-balance-column" /><col className="connected-settlement-state-column" /></colgroup>
            <thead><tr><th scope="col">Fecha</th><th scope="col">Cobrador / moneda</th><th scope="col">Total</th><th scope="col">Balance</th><th scope="col">Estado</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} className={selectedId === row.id ? "selected-row" : undefined} aria-selected={selectedId === row.id} tabIndex={0}
              onClick={() => setSelectedId(row.id)} onDoubleClick={() => inspect(row)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedId(row.id))}>
              <td className="settlement-date-cell">{row.date}</td><td>{collectorName(row.collectorId)} · {row.currency}</td><td><SettlementTotals balance={row} currency={row.currency} /></td><td className="settlement-balance-value">{formatMoney(row.difference, row.currency)}</td><td>{row.state}</td>
            </tr>)}</tbody>
          </table>
          {!rows.length && <div className="daily-settlements-empty">{invalidRange ? "Corrige el rango de fechas para consultar los cuadres." : "No hay jornadas en este rango. Usa Generar cuadre para consultar una fecha y un cobrador."}</div>}
        </div>
        <footer className="daily-settlements-footer"><span>Filas: <strong>{rows.length}</strong></span>{totals.map((total) => <span key={total.currency}>{total.currency} · Cobrado: <strong>{formatMoney(total.collected, total.currency)}</strong> · Entregado: <strong>{formatMoney(total.officeDelivered, total.currency)}</strong> · Balance: <strong>{formatMoney(total.difference, total.currency)}</strong></span>)}</footer>
      </section>
    </div>
    {generationOpen && <LegacyDialog title={preview ? "Confirmar cierre de jornada..." : "Generar cuadre..."} onClose={dismissGeneration} className={preview ? "settlement-balance-editor-dialog connected-settlement-dialog" : "settlement-date-dialog"}>
      {!preview ? <form className="legacy-dialog-form" onSubmit={(event) => { event.preventDefault(); void (pendingClose ? close() : calculate()); }}>
        <label>Cobrador:<select aria-label="Cobrador:" value={collectorId} disabled={selectionLocked} onChange={(event) => setCollectorId(event.target.value)} required><option value="">Selecciona…</option>{snapshot.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}</option>)}</select></label>
        <label>Jornada:<input type="date" value={date} max={snapshot.businessDate} disabled={selectionLocked} required onChange={(event) => setDate(event.target.value)} /></label>
        {request.uncertain && <p role="status">Recupera la confirmación del cierre pendiente antes de cambiar de jornada. Se reutilizará la misma operación.</p>}
        {(error || request.error) && <p role="alert">{error || request.error}</p>}
        {receiptDraft && <p role="status">Hay una devolución pendiente de confirmación para esta jornada. Recupera su resultado antes de iniciar otro cierre.</p>}
        <div className="legacy-dialog-actions centered">{savedClose ? <button type="button" disabled={busy} onClick={() => void refreshSaved()}>Actualizar vista</button> : receiptDraft ? <button type="button" disabled={busy} onClick={openReceipt}>Reintentar devolución</button> : <button type="submit" disabled={!collectorId || !date || busy || !canManage}>{busy ? "Consultando…" : pendingClose ? "Reintentar cierre" : "Calcular cuadre"}</button>}<button type="button" disabled={busy} onClick={dismissGeneration}>Cancelar</button></div>
      </form> : <div className="settlement-balance-editor">
        <div className="settlement-balance-header"><label>Fecha:<input type="date" value={preview.date} readOnly /></label><label>Monedas:<input value="Todas con movimientos" readOnly /></label></div>
        <p className="connected-report-dialog-note">{collectorName(preview.collectorId)}</p>
        {balances.map(({ currency: code, balance }) => <section key={code} aria-label={`Cuadre ${code}`}><h3>{code}</h3>{[...balanceFields, ["Devuelto en cobros", "returnedCollection"] as const, ["Devuelto para pagos", "returnedPayout"] as const, ["Diferencia", "difference"] as const].map(([label, key]) => <label className="settlement-balance-row connected-settlement-balance-row" key={key}><span>{label}:</span><input value={formatMoney(balance[key] ?? 0, code)} readOnly /></label>)}</section>)}
        <p className="connected-report-dialog-note">El cierre se guarda para este cobrador y esta fecha en todas sus monedas. Si queda efectivo, registra su devolución antes de cerrar. Al cerrar hoy, no se podrán registrar más movimientos hoy para este cobrador.</p>
        {earlier && <p role="alert">Completa primero el cuadre pendiente del {earlier.date}.</p>}
        {alreadyClosed && <p role="status">Esta jornada ya tiene un cierre guardado.</p>}
        {!alreadyClosed && !canClose && !canReceive && !earlier && !receiptDraft && <p role="alert">La diferencia requiere revisar los movimientos. No se puede forzar el cierre ni compensar una moneda con otra.</p>}
        {(error || request.error) && <p role="alert">{error || request.error}</p>}
        {request.uncertain && <p role="status">La confirmación no llegó. Reintenta el mismo cierre para recuperar su resultado.</p>}
        <div className="legacy-dialog-actions centered">
          {savedClose ? <button type="button" disabled={busy} onClick={() => void refreshSaved()}>Actualizar vista</button> : <>
            {receiptDraft && <button type="button" disabled={busy} onClick={openReceipt}>Reintentar devolución</button>}
            {(canClose || request.uncertain) && <button type="button" disabled={busy || !canManage} onClick={() => void close()}>{busy ? "Cerrando…" : request.uncertain ? "Reintentar cierre" : "Cerrar jornada"}</button>}
            {canReceive && <button type="button" disabled={busy || request.locked} onClick={openReceipt}>Registrar devolución y cerrar</button>}
            <button type="button" disabled={selectionLocked} onClick={() => { setPreview(null); setError(""); request.clear(); }}>Volver</button>
          </>}
          <button type="button" disabled={busy} onClick={dismissGeneration}>Cancelar</button>
        </div>
      </div>}
    </LegacyDialog>}
    {receiptSelection && <SettlementCashDialog key={receiptSelection.collectorId + receiptSelection.date} actorId={actorId} collectorId={receiptSelection.collectorId} date={receiptSelection.date}
      onClose={() => setReceiptSelection(null)} onRefresh={async () => { await finish(receiptSelection, "Devolución registrada y cuadre guardado correctamente."); return true; }} />}
    {detail && <LegacyDialog title="Balance del Día..." onClose={() => setDetailId("")} className="settlement-balance-editor-dialog connected-settlement-dialog">
      <div className="settlement-balance-editor">
        <div className="settlement-balance-header"><label>Fecha:<input type="date" value={detail.date} readOnly /></label><label>Moneda:<input value={detail.currency} readOnly /></label></div>
        <p className="connected-report-dialog-note">{collectorName(detail.collectorId)} · {detail.state}{detail.closedAt ? ` · ${detail.closedAt}` : ""}</p>
        <SettlementTotals balance={detail} currency={detail.currency} />
        <label className="settlement-balance-row connected-settlement-balance-row"><span>Diferencia:</span><input value={formatMoney(detail.difference, detail.currency)} readOnly /></label>
        <div className="legacy-dialog-actions centered"><button type="button" onClick={() => setDetailId("")}>Cerrar</button></div>
      </div>
    </LegacyDialog>}
    {exportOpen && <LegacyDialog title="Seleccione un valor..." onClose={() => setExportOpen(false)} className="pending-charges-export-dialog">
      <form className="pending-charges-export-form" onSubmit={(event) => { event.preventDefault(); outputAction("csv"); }}>
        <label><span>Formato:</span><select defaultValue="csv"><option value="csv">CSV (separado por punto y coma)</option></select></label>
        {error && <p role="alert">{error}</p>}
        <div className="pending-charges-export-actions"><button type="submit" disabled={invalidRange}>Aceptar</button><button type="button" onClick={() => setExportOpen(false)}>Cancelar</button></div>
      </form>
    </LegacyDialog>}
  </div>;
}
