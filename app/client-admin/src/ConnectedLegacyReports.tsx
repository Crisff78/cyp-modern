import { useState } from "react";
import { exportSections, formatMoney, printSections, type OutputSection } from "../../shared/remittances/output";
import type { Snapshot } from "./types";

type ReportRow = { id: string; date: string; clientId: string; routeId: string; zoneId: string; client: string; route: string; zone: string; collector: string; concept: string; currency: string; amount: number; received: number; pending: number };
const businessDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const currencyOf = (value?: string) => !value || ["DOP", "Peso Dominicano"].includes(value) ? "DOP" : ["USD", "Dólar Americano", "Dólar Estadounidense"].includes(value) ? "USD" : ["EUR", "Euro"].includes(value) ? "EUR" : value;

export function ConnectedLegacyReports({ page, title, snapshot, onRefresh }: { page: string; title: string; snapshot: Snapshot; onRefresh: () => void }) {
  const pendingReport = ["reportClientPendingPayouts", "reportPendingPayoutsByRoutes", "reportPendingPayoutsByZones"].includes(page);
  const servicesReport = page === "reportServicesByZone";
  const [from, setFrom] = useState(`${snapshot.businessDate.slice(0, 7)}-01`);
  const [to, setTo] = useState(snapshot.businessDate);
  const [routeId, setRouteId] = useState("");
  const [zone, setZone] = useState("");
  const [collectorId, setCollectorId] = useState("");
  const [concept, setConcept] = useState("");
  const [currency, setCurrency] = useState("all");
  const [grouping, setGrouping] = useState("detail");
  const [error, setError] = useState("");
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
  const outputAction = (kind: "csv" | "print") => { setError(""); try { if (kind === "csv") exportSections(page, output); else printSections(title, output, "CyP · Cobros y pagos"); } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo generar la salida."); } };
  return <section className="connected-catalog connected-legacy-report"><h2>{title}</h2><div className="connected-report-filters"><label>Desde<input type="date" disabled={pendingReport} value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Hasta<input type="date" disabled={pendingReport} value={to} onChange={(event) => setTo(event.target.value)} /></label><label>Ruta<select value={routeId} onChange={(event) => setRouteId(event.target.value)}><option value="">Todas</option>{snapshot.routes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Zona<select value={zone} onChange={(event) => setZone(event.target.value)}><option value="">Todas</option>{Array.from(new Map(source.map((row) => [row.zoneId, row.zone])).entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Cobrador<select value={collectorId} onChange={(event) => setCollectorId(event.target.value)}><option value="">Todos</option>{snapshot.collectors.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>{servicesReport ? "Servicio" : "Concepto"}<select value={concept} onChange={(event) => setConcept(event.target.value)}><option value="">Todos</option>{Array.from(new Set(source.map((row) => row.concept))).sort().map((value) => <option key={value}>{value}</option>)}</select></label><label>Moneda<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="all">Todas, separadas</option>{Array.from(new Set(source.map((row) => row.currency))).sort().map((value) => <option key={value}>{value}</option>)}</select></label><label>Presentación<select value={grouping} onChange={(event) => setGrouping(event.target.value)}><option value="detail">Detalle / agrupación del reporte</option><option value="range">Resumen del rango</option><option value="day" disabled={pendingReport}>Resumen diario</option></select></label></div><p className="location-feedback">{notes}</p><div className="connected-row-actions"><button type="button" onClick={onRefresh}>Refrescar datos</button><button type="button" disabled={Boolean(invalidRange)} onClick={() => outputAction("print")}>Imprimir</button><button type="button" disabled={Boolean(invalidRange)} onClick={() => outputAction("csv")}>Exportar CSV</button></div>{error && <p role="alert">{error}</p>}{invalidRange && <p role="alert">La fecha inicial debe ser anterior o igual a la final.</p>}{sections.map((section) => <div key={section.title}><h3>{section.title}</h3><div className="connected-catalog-scroll"><table className="legacy-mdi-table"><thead><tr>{section.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{section.rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table></div></div>)}{!rows.length && !invalidRange && <p>No hay registros para los filtros seleccionados.</p>}</section>;
}
