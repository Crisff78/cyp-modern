import { useEffect, useRef, useState } from "react";
import { Download, KeyRound, Printer, RefreshCw } from "lucide-react";
import { exportSections, formatMoney, printSections, type OutputSection } from "../../shared/remittances/output";
import { LegacyDialog } from "./LegacyConnectedUi";
import type { Snapshot } from "./types";
import { currentOperationalWeek } from "../../shared/operationalWeek";
import "./connected-report-layout.css";

type ReportRow = { id: string; date: string; clientId: string; routeId: string; zoneId: string; client: string; route: string; zone: string; collector: string; concept: string; currency: string; amount: number; received: number; pending: number };
const businessDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const currencyOf = (value?: string) => !value || ["DOP", "Peso Dominicano"].includes(value) ? "DOP" : ["USD", "Dólar Americano", "Dólar Estadounidense"].includes(value) ? "USD" : ["EUR", "Euro"].includes(value) ? "EUR" : value;

export function ConnectedLegacyReports({ page, title, snapshot, onRefresh }: { page: string; title: string; snapshot: Snapshot; onRefresh: () => void }) {
  const pendingReport = ["reportClientPendingPayouts", "reportPendingPayoutsByRoutes", "reportPendingPayoutsByZones"].includes(page);
  const servicesReport = page === "reportServicesByZone";
  const [from, setFrom] = useState(() => currentOperationalWeek().from);
  const [to, setTo] = useState(() => currentOperationalWeek().to);
  const [routeId, setRouteId] = useState("");
  const [zone, setZone] = useState("");
  const [collectorId, setCollectorId] = useState("");
  const [concept, setConcept] = useState("");
  const [currency, setCurrency] = useState("all");
  const [grouping, setGrouping] = useState("detail");
  const [error, setError] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [selectedKey, setSelectedKey] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => { gridRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [selectedKey]);
  const metadata = (clientId?: string, collector?: string) => {
    const client = snapshot.clients.find((row) => row.id === clientId);
    const route = snapshot.routes.find((row) => row.id === client?.routeId);
    const assignedZone = snapshot.zones?.find((row) => row.id === route?.zoneId);
    return { clientId: clientId ?? "", client: client?.name ?? "Cliente no disponible", route: route?.name ?? "Sin ruta", zone: assignedZone?.name || route?.sector || "Sin zona", zoneId: assignedZone?.id || `sector:${route?.sector || "Sin zona"}`, collector: snapshot.collectors.find((row) => row.id === collector)?.name ?? "Sin cobrador", routeId: route?.id ?? "", collectorId: collector ?? "" };
  };
  const source = pendingReport ? snapshot.payouts.filter((payout) => payout.status !== "cancelled" && payout.amount > payout.paid).map((payout) => ({ ...metadata(payout.clientId, payout.collectorId), id: payout.id, date: "", concept: payout.concept, currency: "DOP", amount: payout.amount, received: payout.paid, pending: payout.amount - payout.paid })) : servicesReport ? snapshot.charges.filter((charge) => charge.status !== "cancelled").map((charge) => {
    const client = snapshot.clients.find((row) => row.id === charge.clientId);
    const owner = snapshot.routes.find((row) => row.id === client?.routeId)?.collectorId;
    return { ...metadata(charge.clientId, owner), id: charge.id, date: charge.dueDate, concept: charge.service, currency: currencyOf(charge.currency), amount: charge.amount, received: charge.collected, pending: Math.max(0, charge.amount - charge.collected) };
  }) : snapshot.movements.filter((movement) => movement.type === "payout" && !movement.cancelledAt).map((movement) => {
    const payout = snapshot.payouts.find((row) => row.id === movement.payoutId);
    return { ...metadata(movement.clientId ?? payout?.clientId, movement.collectorId), id: movement.id, date: businessDay(movement.createdAt), concept: payout?.concept ?? "Concepto no disponible", currency: "DOP", amount: movement.amount, received: 0, pending: 0 };
  });
  const invalidRange = !pendingReport && from && to && from > to;
  const rows: ReportRow[] = invalidRange ? [] : source.filter((row) => (!routeId || row.routeId === routeId) && (!zone || row.zoneId === zone) && (!collectorId || row.collectorId === collectorId) && (!concept || row.concept === concept) && (currency === "all" || row.currency === currency) && (pendingReport || ((!from || row.date >= from) && (!to || row.date <= to))));
  const notes = pendingReport ? "Saldo pendiente actual de las autorizaciones. El sistema no expone su fecha de alta ni vencimiento; por eso no se puede reconstruir un saldo histórico o diario con estos datos." : servicesReport ? "Servicios facturados por zona según fecha de vencimiento del cargo. Recibido y pendiente son sus saldos actuales, no saldos históricos del día indicado." : "Pagos registrados por fecha del movimiento (hora de República Dominicana). El sistema vincula el pago a un concepto, no a un catálogo de servicios; las agrupaciones por servicio se presentan por ese concepto.";
  const sections: OutputSection[] = [];
  const currencies = Array.from(new Set(rows.map((row) => row.currency))).sort();
  for (const code of currencies) {
    const entries = rows.filter((row) => row.currency === code);
    const byRoute = page === "reportPendingPayoutsByRoutes";
    const byZone = page === "reportPendingPayoutsByZones";
    const byConcept = page === "reportPaymentsByServiceSummary" || servicesReport;
    const aggregated = grouping !== "detail" || byRoute || byZone || byConcept;
    let columns: string[];
    let data: (string | number)[][];
    if (aggregated) {
      const buckets = new Map<string, { label: string; date: string; count: number; amount: number; received: number; pending: number }>();
      for (const row of entries) {
        const label = byRoute ? row.route : byZone ? row.zone : servicesReport ? `${row.zone} · ${row.concept}` : byConcept || page === "reportPaymentsByServiceDetailed" ? row.concept : pendingReport ? row.client : "Todos los pagos";
        const date = grouping === "day" && !pendingReport ? row.date : "";
        const identity = byRoute ? row.routeId : byZone ? row.zoneId : servicesReport ? [row.zoneId, row.concept] : byConcept || page === "reportPaymentsByServiceDetailed" ? row.concept : pendingReport ? row.clientId : "all";
        const key = JSON.stringify([date, identity]);
        const bucket = buckets.get(key) ?? { label, date, count: 0, amount: 0, received: 0, pending: 0 };
        bucket.count++; bucket.amount += row.amount; bucket.received += row.received; bucket.pending += row.pending; buckets.set(key, bucket);
      }
      columns = [...(grouping === "day" && !pendingReport ? ["Fecha"] : []), byRoute ? "Ruta" : byZone ? "Zona" : servicesReport ? "Zona · servicio" : "Grupo", "Registros", "Importe", ...(pendingReport || servicesReport ? [pendingReport ? "Pagado" : "Recibido", "Pendiente"] : [])];
      data = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label)).map((row) => [...(grouping === "day" && !pendingReport ? [row.date] : []), row.label, row.count, formatMoney(row.amount, code), ...(pendingReport || servicesReport ? [formatMoney(row.received, code), formatMoney(row.pending, code)] : [])]);
    } else {
      columns = [...(!pendingReport ? ["Fecha"] : []), "Cliente", "Ruta", "Zona", "Cobrador", servicesReport ? "Servicio" : "Concepto", "Importe", ...(pendingReport ? ["Pagado", "Pendiente"] : [])];
      data = entries.sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client)).map((row) => [...(!pendingReport ? [row.date] : []), row.client, row.route, row.zone, row.collector, row.concept, formatMoney(row.amount, code), ...(pendingReport ? [formatMoney(row.received, code), formatMoney(row.pending, code)] : [])]);
    }
    sections.push({ title: code, columns, rows: data });
    sections.push({ title: `Totales ${code}`, columns: ["Registros", "Importe", ...(pendingReport || servicesReport ? [pendingReport ? "Pagado" : "Recibido", "Pendiente"] : [])], rows: [[entries.length, formatMoney(entries.reduce((sum, row) => sum + row.amount, 0), code), ...(pendingReport || servicesReport ? [formatMoney(entries.reduce((sum, row) => sum + row.received, 0), code), formatMoney(entries.reduce((sum, row) => sum + row.pending, 0), code)] : [])]] });
  }
  const output = [{ title: "Criterios y alcance", columns: ["Dato", "Valor"], rows: [["Período", pendingReport ? `Saldo actual · ${snapshot.businessDate}` : `${from || "Inicio"} a ${to || "Fin"}`], ["Ruta", snapshot.routes.find((row) => row.id === routeId)?.name ?? "Todas"], ["Zona", source.find((row) => row.zoneId === zone)?.zone ?? "Todas"], ["Cobrador", snapshot.collectors.find((row) => row.id === collectorId)?.name ?? "Todos"], ["Concepto / servicio", concept || "Todos"], ["Moneda", currency === "all" ? "Todas, separadas" : currency], ["Alcance", notes]] }, ...sections] satisfies OutputSection[];
  const outputAction = (kind: "csv" | "print") => {
    if (invalidRange) return;
    setError("");
    try {
      if (kind === "csv") { exportSections(page, output); setExportOpen(false); }
      else printSections(title, output, "CyP · Cobros y pagos");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo generar la salida."); }
  };
  const rowKey = (code: string, index: number, row: (string | number)[]) => JSON.stringify([code, index, row]);
  const detailSections = sections.filter((_, index) => index % 2 === 0);
  const selectionKeys = detailSections.flatMap((section) => section.rows.map((row, index) => rowKey(section.title, index, row)));
  const moveSelection = (direction: "first" | "previous" | "next" | "last") => {
    if (!selectionKeys.length) return;
    const current = selectionKeys.indexOf(selectedKey);
    const next = direction === "first" ? 0 : direction === "last" ? selectionKeys.length - 1 : current < 0 ? 0 : direction === "previous" ? Math.max(0, current - 1) : Math.min(selectionKeys.length - 1, current + 1);
    setSelectedKey(selectionKeys[next]);
  };
  return <div className="connected-report-mdi">
    <div className="legacy-mdi-toolbar" aria-label="Herramientas del reporte">
      <button type="button" className={filtersVisible ? "nav-tool active" : "nav-tool"} title="Mostrar/Ocultar filtros" aria-label="Mostrar/Ocultar filtros" aria-pressed={filtersVisible} onClick={() => setFiltersVisible((visible) => !visible)}><KeyRound size={15} /></button>
      <button type="button" className="nav-tool" title="Primer registro" disabled={!selectionKeys.length} onClick={() => moveSelection("first")}>|&lt;</button>
      <button type="button" className="nav-tool" title="Registro anterior" disabled={!selectionKeys.length} onClick={() => moveSelection("previous")}>&lt;</button>
      <button type="button" className="nav-tool" title="Registro siguiente" disabled={!selectionKeys.length} onClick={() => moveSelection("next")}>&gt;</button>
      <button type="button" className="nav-tool" title="Último registro" disabled={!selectionKeys.length} onClick={() => moveSelection("last")}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      <button type="button" title="Refrescar" aria-label="Refrescar" onClick={onRefresh}><RefreshCw size={15} /></button>
      <button type="button" title="Imprimir" aria-label="Imprimir" disabled={Boolean(invalidRange)} onClick={() => outputAction("print")}><Printer size={15} /></button>
      <button type="button" title="Exportar CSV" aria-label="Exportar CSV" disabled={Boolean(invalidRange)} onClick={() => setExportOpen(true)}><Download size={15} /></button>
    </div>
    <div className="report-layout connected-report-layout">
      {filtersVisible && <aside className="report-filter-panel">
        <div className="report-filter-fields">
          <label>Fecha inicial:<input type="date" disabled={pendingReport} value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Fecha final:<input type="date" disabled={pendingReport} value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <label>Moneda:<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="all">Todas, separadas</option>{Array.from(new Set(source.map((row) => row.currency))).sort().map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Ruta:<select value={routeId} onChange={(event) => setRouteId(event.target.value)}><option value="">Todas</option>{snapshot.routes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>Zona:<select value={zone} onChange={(event) => setZone(event.target.value)}><option value="">Todas</option>{Array.from(new Map(source.map((row) => [row.zoneId, row.zone])).entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Cobrador:<select value={collectorId} onChange={(event) => setCollectorId(event.target.value)}><option value="">Todos</option>{snapshot.collectors.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>{servicesReport ? "Servicio:" : "Concepto:"}<select value={concept} onChange={(event) => setConcept(event.target.value)}><option value="">Todos</option>{Array.from(new Set(source.map((row) => row.concept))).sort().map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Presentación:<select value={grouping} onChange={(event) => setGrouping(event.target.value)}><option value="detail">Detalle / agrupación del reporte</option><option value="range">Resumen del rango</option><option value="day" disabled={pendingReport}>Resumen diario</option></select></label>
        </div>
        <div className="report-filter-actions">
          <div className="report-separator">---</div>
          <button type="button" className="btn full" onClick={onRefresh}><RefreshCw size={14} /> Refrescar</button>
          <div className="report-action-row">
            <button type="button" disabled={Boolean(invalidRange)} onClick={() => outputAction("print")}><Printer size={14} /> Imprimir</button>
            <button type="button" disabled={Boolean(invalidRange)} onClick={() => setExportOpen(true)}><Download size={14} /> Exportar</button>
          </div>
        </div>
      </aside>}
      <section className="report-results-panel" aria-label={`Resultados de ${title}`}>
        <div className="report-results-header"><strong>{title}</strong><span>{pendingReport ? `Saldo actual · ${snapshot.businessDate}` : `${from || "Inicio"} a ${to || "Fin"}`}</span></div>
        <details className="connected-report-scope"><summary>Alcance del reporte</summary><p>{notes}</p></details>
        {error && <p className="connected-report-feedback" role="alert">{error}</p>}
        {invalidRange && <p className="connected-report-feedback" role="alert">La fecha inicial debe ser anterior o igual a la final.</p>}
        <div className="legacy-mdi-table-wrap connected-report-grid-scroll" ref={gridRef}>
          {detailSections.map((section, sectionIndex) => {
            const totals = sections[sectionIndex * 2 + 1];
            return <section className="connected-report-currency" key={section.title} aria-label={`Resultados en ${section.title}`}>
              <div className="connected-report-currency-heading">{section.title}</div>
              <table className="legacy-mdi-table">
                <thead><tr><th scope="col">Nro.</th>{section.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
                <tbody>{section.rows.map((row, index) => {
                  const key = rowKey(section.title, index, row);
                  const selected = selectedKey === key;
                  return <tr key={key} className={selected ? "selected-row" : undefined} aria-selected={selected} tabIndex={0} onClick={() => setSelectedKey(key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedKey(key); } }}>
                    <td><span className={`mdi-row-select ${selected ? "selected" : ""}`}>{index + 1}</span></td>
                    {row.map((value, cell) => <td key={cell} className={["Importe", "Pagado", "Recibido", "Pendiente", "Registros"].includes(section.columns[cell]) ? "numeric-cell" : undefined}>{value}</td>)}
                  </tr>;
                })}</tbody>
                <tfoot><tr><td colSpan={section.columns.length + 1}><div className="connected-report-totals">{totals.columns.map((column, index) => <span key={column}>{column}: <strong>{totals.rows[0][index]}</strong></span>)}</div></td></tr></tfoot>
              </table>
            </section>;
          })}
          {!rows.length && <div className="daily-settlements-empty">{invalidRange ? "Corrige el rango de fechas para consultar el reporte." : "No hay registros para los filtros seleccionados."}</div>}
        </div>
        <footer className="legacy-footerbar connected-report-footer"><span>Cantidad: <strong>{rows.length}</strong></span><span>Monedas: <strong>{currencies.join(" / ") || "—"}</strong></span></footer>
      </section>
    </div>
    {exportOpen && <LegacyDialog title="Seleccione un valor..." onClose={() => setExportOpen(false)} className="pending-charges-export-dialog">
      <form className="pending-charges-export-form" onSubmit={(event) => { event.preventDefault(); outputAction("csv"); }}>
        <label><span>Formato:</span><select defaultValue="csv"><option value="csv">CSV (separado por punto y coma)</option></select></label>
        <p className="connected-report-dialog-note">Se exportan los filtros, el alcance y todos los resultados, con sus totales separados por moneda.</p>
        {error && <p role="alert">{error}</p>}
        <div className="pending-charges-export-actions"><button type="submit" disabled={Boolean(invalidRange)}>oK</button><button type="button" onClick={() => setExportOpen(false)}>Cancelar</button></div>
      </form>
    </LegacyDialog>}
  </div>;
}
