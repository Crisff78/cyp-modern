import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { operationKey, StrictApiError, type StrictApi } from "./strictApi";
import type { Cash, Currency, Quotation, RemittanceSnapshot, Report, Transfer } from "./types";
import { decimalCents, exportSections, formatDate, formatMoney, printSections, type OutputSection } from "./output";
import "./remittances.css";

type Tab = "envios" | "recibos" | "tasas" | "caja" | "reportes";
type Actor = { id: string; name: string };
type Confirmation = { title: string; path: string; body: Record<string, unknown>; description: ReactNode; kind: "create" | "pay" | "cancel" | "rate" | "open" | "close"; idempotencyKey?: string };
// Only in-memory: retain an uncertain action across route changes and same-actor login.
const pendingByActor = new Map<string, Confirmation>();
// These domain errors are produced only after the server's idempotency lookup.
const definitiveDomainErrors = new Set(["QUOTE_CHANGED", "CASH_NOT_OPEN", "RATE_MISSING", "RATE_DATE", "DOP_RATE", "CASH_EXISTS", "PREVIOUS_CASH_OPEN", "CASH_CLOSED", "CASH_UNBALANCED", "CASH_NOT_FOUND", "CLIENT_INACTIVE", "CLIENT_NOT_FOUND", "SAME_CLIENT", "TRANSFER_NOT_PENDING", "TRANSFER_NOT_FOUND", "INSUFFICIENT_CASH", "SEQUENCE_EXHAUSTED", "MONEY_RANGE", "INVALID_AMOUNT", "INVALID_RATE", "INVALID_CURRENCY", "INVALID_COMMISSION", "AMOUNT_TOO_SMALL", "REASON_REQUIRED"]);
type Draft = { senderClientId: string; recipientClientId: string; sendingUserId: string; sourceCurrency: Currency; destinationCurrency: Currency; amount: string; commission: string; note: string };
const statusText = { pending: "Pendiente de entrega", paid: "Pagado", cancelled: "Cancelado" };
const tabs: { id: Tab; label: string }[] = [{ id: "envios", label: "Envíos" }, { id: "recibos", label: "Recibos" }, { id: "tasas", label: "Tasas" }, { id: "caja", label: "Caja" }, { id: "reportes", label: "Reportes" }];
const money = formatMoney;

function Dialog({ title, children, onClose, locked = false }: { title: string; children: ReactNode; onClose: () => void; locked?: boolean }) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => { element.current?.showModal(); return () => element.current?.close(); }, []);
  return <dialog ref={element} className="remittances-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); if (!locked) onClose(); }}>
    <header><h2>{title}</h2><button type="button" disabled={locked} onClick={onClose} aria-label={`Cerrar ${title}`}>×</button></header>
    <div className="remittances-dialog-body">{children}</div>
  </dialog>;
}

function QuoteDetails({ quote }: { quote: Quotation }) {
  return <dl className="remittance-summary">
    <div><dt>Principal</dt><dd>{money(quote.amount, quote.sourceCurrency)}</dd></div>
    <div><dt>Comisión ({quote.commissionBps / 100}%)</dt><dd>{money(quote.commissionAmount, quote.sourceCurrency)}</dd></div>
    <div className="remittance-total"><dt>Total que paga el remitente</dt><dd>{money(quote.totalAmount, quote.sourceCurrency)}</dd></div>
    <div className="remittance-total"><dt>Recibe el destinatario</dt><dd>{money(quote.receiveAmount, quote.destinationCurrency)}</dd></div>
    <div><dt>Tasas del {quote.quote.date}</dt><dd>1 {quote.sourceCurrency} = {quote.quote.sourceRate} DOP<br />1 {quote.destinationCurrency} = {quote.quote.destinationRate} DOP</dd></div>
  </dl>;
}

function DataTable({ section }: { section: OutputSection }) {
  return <div className="remittance-table-wrap"><table className="remittance-table"><caption>{section.title}</caption><thead><tr>{section.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{section.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} data-label={section.columns[cellIndex]}>{cell}</td>)}</tr>)}{!section.rows.length && <tr><td colSpan={section.columns.length}>No hay resultados para esta consulta.</td></tr>}</tbody></table></div>;
}

export default function RemittancesWorkspace({ api, user, isAdmin, initialTab = "envios" }: { api: StrictApi; user: Actor; isAdmin: boolean; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab === "tasas" && !isAdmin ? "envios" : initialTab);
  const [snapshot, setSnapshot] = useState<RemittanceSnapshot | null>(null);
  const [sent, setSent] = useState<Transfer[]>([]);
  const [received, setReceived] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ senderClientId: "", recipientClientId: "", sendingUserId: user.id, sourceCurrency: "DOP", destinationCurrency: "DOP", amount: "", commission: "0", note: "" });
  const [quote, setQuote] = useState<Quotation | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(() => pendingByActor.get(user.id) ?? null);
  const [uncertain, setUncertain] = useState(() => pendingByActor.has(user.id));
  const [confirmationError, setConfirmationError] = useState("");
  const [rate, setRate] = useState({ currency: "USD" as Currency, value: "" });
  const [opening, setOpening] = useState({ operatorId: user.id, currency: "DOP" as Currency, amount: "0" });
  const [closing, setClosing] = useState<Cash | null>(null);
  const [counted, setCounted] = useState("");
  const [reportFilters, setReportFilters] = useState({ from: "", to: "", grouping: "range" as "range" | "day", type: "amounts" });
  const [report, setReport] = useState<Report | null>(null);
  const mutationLock = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [data, outgoing, incoming] = await Promise.all([api<RemittanceSnapshot>("/envios/snapshot"), api<Transfer[]>("/envios"), api<Transfer[]>("/envios/recibos")]);
      setSnapshot(data); setSent(outgoing); setReceived(incoming);
      setReportFilters((current) => ({ ...current, from: current.from || data.businessDate, to: current.to || data.businessDate }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No pudimos cargar los envíos."); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (uncertain || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uncertain, busy]);

  const clientName = (id: string) => snapshot?.clients.find((client) => client.id === id)?.name ?? "Cliente";
  const operatorName = (id?: string) => snapshot?.operators.find((operator) => operator.id === id)?.name ?? (id === user.id ? user.name : id || "—");
  const detail = snapshot?.transfers.find((transfer) => transfer.id === detailId);
  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setQuote(null); setError(""); };
  const confirm = (action: Confirmation) => { setConfirmation({ ...action, idempotencyKey: operationKey() }); setConfirmationError(""); setUncertain(false); setNotice(""); };
  const failureMessage = (failure: unknown) => failure instanceof Error ? failure.message : "No pudimos completar la operación.";
  const runOutput = (action: () => void) => { try { action(); } catch (failure) { setError(failureMessage(failure)); } };

  async function submitConfirmation() {
    if (!confirmation || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setConfirmationError("");
    pendingByActor.set(user.id, confirmation);
    try {
      await api(confirmation.path, { method: "POST", headers: { "Idempotency-Key": confirmation.idempotencyKey! }, body: JSON.stringify(confirmation.body) });
      pendingByActor.delete(user.id);
      setNotice("Operación registrada correctamente.");
      if (confirmation.kind === "create") { setFormOpen(false); setQuote(null); setDraft((current) => ({ ...current, amount: "", note: "" })); }
      if (confirmation.kind === "close") { setClosing(null); setCounted(""); }
      if (confirmation.kind === "cancel") setCancelReason("");
      setConfirmation(null); setUncertain(false); setReport(null);
      await refresh();
    } catch (failure) {
      setConfirmationError(failureMessage(failure));
      const definitive = failure instanceof StrictApiError && definitiveDomainErrors.has(failure.code ?? "");
      const unresolved = !definitive && (uncertain || (failure instanceof StrictApiError && failure.uncertain));
      setUncertain(unresolved);
      if (!unresolved) pendingByActor.delete(user.id);
      if (failure instanceof StrictApiError && failure.code === "QUOTE_CHANGED") setQuote(null);
    } finally { mutationLock.current = false; setBusy(false); }
  }

  async function requestQuote(event: FormEvent) {
    event.preventDefault(); setError(""); setQuote(null); setBusy(true);
    try {
      if (!draft.senderClientId || !draft.recipientClientId || draft.senderClientId === draft.recipientClientId) throw new Error("Selecciona un remitente y un destinatario distintos.");
      const amount = decimalCents(draft.amount);
      const commissionBps = decimalCents(draft.commission, true);
      if (commissionBps > 10000) throw new Error("La comisión debe estar entre 0% y 100%.");
      const params = new URLSearchParams({ sourceCurrency: draft.sourceCurrency, destinationCurrency: draft.destinationCurrency, amount: String(amount), commissionBps: String(commissionBps) });
      setQuote(await api<Quotation>(`/envios/cotizacion?${params}`));
    } catch (failure) { setError(failureMessage(failure)); }
    finally { setBusy(false); }
  }

  function confirmCreate() {
    if (!quote) return;
    confirm({ title: "Confirmar envío", path: "/envios", kind: "create", body: {
      senderClientId: draft.senderClientId, recipientClientId: draft.recipientClientId,
      ...(isAdmin ? { sendingUserId: draft.sendingUserId } : {}), sourceCurrency: quote.sourceCurrency, destinationCurrency: quote.destinationCurrency,
      amount: quote.amount, commissionBps: quote.commissionBps, quote: quote.quote, note: draft.note.trim(),
    }, description: <><p><strong>{clientName(draft.senderClientId)}</strong> envía a <strong>{clientName(draft.recipientClientId)}</strong>.</p><QuoteDetails quote={quote} /><p>Operador: {operatorName(draft.sendingUserId)}. Registrado por: {user.name}.</p><p>Confirma después de recibir el total del remitente. La tasa queda guardada para este envío.</p></> });
  }

  function prepareRate(event: FormEvent) {
    event.preventDefault();
    if (!snapshot) return;
    if (!/^\d+(\.\d{1,6})?$/.test(rate.value) || Number(rate.value) <= 0) { setError("Escribe una tasa positiva con hasta seis decimales."); return; }
    confirm({ title: "Guardar tasa del día", path: "/envios/tasas", kind: "rate", body: { currency: rate.currency, rate: rate.value, date: snapshot.businessDate }, description: <p>1 {rate.currency} = <strong>{rate.value} DOP</strong> para {snapshot.businessDate}. Los envíos anteriores conservan su tasa.</p> });
  }

  function prepareOpening(event: FormEvent) {
    event.preventDefault();
    try {
      const openingAmount = decimalCents(opening.amount, true);
      confirm({ title: "Abrir caja de envíos", path: "/envios/cajas/abrir", kind: "open", body: { operatorId: opening.operatorId, currency: opening.currency, openingAmount }, description: <p>Operador: <strong>{operatorName(opening.operatorId)}</strong><br />Fecha: {snapshot?.businessDate}<br />Efectivo inicial: <strong>{money(openingAmount, opening.currency)}</strong></p> });
    } catch (failure) { setError(failureMessage(failure)); }
  }

  function prepareClosing(event: FormEvent) {
    event.preventDefault(); if (!closing) return;
    try {
      const countedAmount = decimalCents(counted, true);
      if (countedAmount !== closing.expected) throw new Error(`El efectivo contado debe coincidir con ${money(closing.expected, closing.currency)}. Revisa el conteo y actualiza la caja.`);
      confirm({ title: "Confirmar cierre de caja", path: `/envios/cajas/${encodeURIComponent(closing.id)}/cerrar`, kind: "close", body: { countedAmount }, description: <p>Cerrar caja de {operatorName(closing.operatorId)} · {closing.date}, con <strong>{money(countedAmount, closing.currency)}</strong>. Después del cierre esta caja no admite movimientos.</p> });
    } catch (failure) { setError(failureMessage(failure)); }
  }

  async function loadReport(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!reportFilters.from || !reportFilters.to || reportFilters.from > reportFilters.to) throw new Error("Revisa las fechas del reporte.");
      const query = new URLSearchParams({ from: reportFilters.from, to: reportFilters.to, grouping: reportFilters.grouping });
      setReport(await api<Report>(`/envios/reportes?${query}`));
    } catch (failure) { setError(failureMessage(failure)); }
    finally { setBusy(false); }
  }

  const transferOutput = (transfer: Transfer): OutputSection[] => [{ title: `${transfer.envioReference} · ${transfer.reciboReference}`, columns: ["Dato", "Valor"], rows: [
    ["Estado", statusText[transfer.status]], ["Referencia operativa", transfer.operatingCode], ["Remitente", clientName(transfer.senderClientId)], ["Destinatario", clientName(transfer.recipientClientId)],
    ["Operador del envío", operatorName(transfer.sendingUserId)], ["Registrado por", operatorName(transfer.registeredBy)], ["Creado", formatDate(transfer.createdAt)],
    ["Principal", money(transfer.amount, transfer.sourceCurrency)], ["Comisión", money(transfer.commissionAmount, transfer.sourceCurrency)], ["Total recibido del remitente", money(transfer.totalAmount, transfer.sourceCurrency)],
    ["Importe para destinatario", money(transfer.receiveAmount, transfer.destinationCurrency)], ["Tasa origen DOP/unidad", transfer.quote.sourceRate], ["Tasa destino DOP/unidad", transfer.quote.destinationRate], ["Fecha tasa", transfer.quote.date],
    ["Pagado", formatDate(transfer.paidAt)], ["Pagado por", operatorName(transfer.paidBy)], ["Cancelado", formatDate(transfer.cancelledAt)], ["Motivo cancelación", transfer.cancelReason || "—"], ["Nota", transfer.note || "—"],
  ] }];
  const reportSections: OutputSection[] = !report ? [] : reportFilters.type === "amounts" ? [{ title: "Montos de envíos por moneda de origen y destino", columns: ["Fecha", "Origen", "Destino", "Envíos", "Pendientes", "Pagados", "Cancelados", "Principal origen", "Comisión origen", "Total origen", "A entregar destino"], rows: report.amounts.map((row) => [row.date, row.sourceCurrency, row.destinationCurrency, row.count, row.pendingCount, row.paidCount, row.cancelledCount, money(row.amount, row.sourceCurrency), money(row.commissionAmount, row.sourceCurrency), money(row.totalAmount, row.sourceCurrency), money(row.receiveAmount, row.destinationCurrency)]) }]
    : reportFilters.type === "times" ? [{ title: "Tiempo desde el envío hasta el pago", columns: ["Fecha", "Pagados", "Mínimo (min)", "Máximo (min)", "Promedio (min)"], rows: (report.deliveryTimeSummary ?? []).map((row) => [row.date, row.count, (row.minSeconds / 60).toFixed(1), (row.maxSeconds / 60).toFixed(1), (row.averageSeconds / 60).toFixed(1)]) }, { title: "Detalle de emisión y pago", columns: ["Envío", "Emitido", "Pagado", "Tiempo (min)"], rows: report.deliveryTimes.map((row) => [row.envioReference, formatDate(row.createdAt), formatDate(row.paidAt), (row.elapsedSeconds / 60).toFixed(1)]) }]
    : reportFilters.type === "delivered" ? [{ title: "Entregados por fecha de pago y moneda", columns: ["Fecha", "Moneda", "Pagados", "Importe entregado"], rows: report.delivered.map((row) => [row.date, row.currency, row.count, money(row.amount, row.currency)]) }]
    : [{ title: "Caja de envíos por operador y moneda", columns: ["Fecha", "Operador", "Moneda", "Cajas", "Primera apertura", "Ingresos envíos", "Devoluciones", "Pagos", "Último esperado"], rows: (report.cashSummary ?? []).map((row) => [row.date, operatorName(row.operatorId), row.currency, row.sessionCount, money(row.firstOpening, row.currency), money(row.sentTotal, row.currency), money(row.cancelRefund, row.currency), money(row.paid, row.currency), money(row.lastExpected, row.currency)]) }];
  const reportTitle = report ? `Envíos · ${report.from} a ${report.to} · ${report.grouping === "day" ? "Diario" : "Resumido"}` : "Envíos";
  const list = (tab === "recibos" ? received : sent).filter((transfer) => (status === "all" || transfer.status === status) && [transfer.envioReference, transfer.reciboReference, transfer.operatingCode, clientName(transfer.senderClientId), clientName(transfer.recipientClientId)].join(" ").toLocaleLowerCase().includes(search.toLocaleLowerCase()));

  return <section className="remittances" aria-label="Envíos de Dinero">
    <header className="remittance-heading"><div><h1>Envíos de Dinero</h1><p>{snapshot ? `Fecha de operación: ${snapshot.businessDate}` : "Conexión con la API"} · {user.name}</p></div><button type="button" onClick={() => void refresh()} disabled={loading || busy}>{loading ? "Cargando…" : "Actualizar"}</button></header>
    <nav className="remittance-tabs" aria-label="Secciones de Envíos">{tabs.filter((item) => item.id !== "tasas" || isAdmin).map((item) => <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); setError(""); }}>{item.label}</button>)}</nav>
    {error && <div className="remittance-error" role="alert">{error}</div>}
    {notice && <div className="remittance-notice" role="status">{notice}</div>}
    {!snapshot ? <div className="remittance-empty">{loading ? "Cargando clientes, tasas y cajas…" : "No hay datos conectados. Actualiza para volver a intentar."}</div> : <>
      {(tab === "envios" || tab === "recibos") && <>
        <div className="remittance-toolbar"><label>Buscar<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Referencia o cliente" /></label><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos</option><option value="pending">Pendientes</option><option value="paid">Pagados</option><option value="cancelled">Cancelados</option></select></label>{tab === "envios" && <button type="button" className="remittance-primary" onClick={() => { setFormOpen(!formOpen); setError(""); }}>{formOpen ? "Ocultar formulario" : "Nuevo envío"}</button>}</div>
        {tab === "envios" && formOpen && <form className="remittance-panel" onSubmit={(event) => void requestQuote(event)}>
          <h2>Nuevo envío</h2><fieldset disabled={busy} className="remittance-form-grid">
            <label>Remitente<select required value={draft.senderClientId} onChange={(event) => updateDraft("senderClientId", event.target.value)}><option value="">Selecciona un cliente</option>{snapshot.clients.filter((client) => client.active && client.canSendFrom).map((client) => <option key={client.id} value={client.id}>{client.code} · {client.name}</option>)}</select></label>
            <label>Destinatario<select required value={draft.recipientClientId} onChange={(event) => updateDraft("recipientClientId", event.target.value)}><option value="">Selecciona un cliente</option>{snapshot.clients.filter((client) => client.active && client.id !== draft.senderClientId).map((client) => <option key={client.id} value={client.id}>{client.code} · {client.name}</option>)}</select></label>
            {isAdmin && <label>Operador del envío<select required value={draft.sendingUserId} onChange={(event) => updateDraft("sendingUserId", event.target.value)}>{snapshot.operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label>}
            <label>Moneda que se recibe<select value={draft.sourceCurrency} onChange={(event) => updateDraft("sourceCurrency", event.target.value as Currency)}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <label>Moneda que se entrega<select value={draft.destinationCurrency} onChange={(event) => updateDraft("destinationCurrency", event.target.value as Currency)}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <label>Principal ({draft.sourceCurrency})<input required inputMode="decimal" value={draft.amount} onChange={(event) => updateDraft("amount", event.target.value)} placeholder="0.00" /></label>
            <label>Comisión (%)<input required inputMode="decimal" value={draft.commission} onChange={(event) => updateDraft("commission", event.target.value)} /></label>
            <label className="remittance-wide">Nota (opcional)<textarea maxLength={500} rows={2} value={draft.note} onChange={(event) => updateDraft("note", event.target.value)} /></label>
          </fieldset><p className="remittance-help">La comisión se suma al principal. Se necesita una caja abierta del operador en la moneda de origen.</p>
          <button disabled={busy} type="submit">{busy ? "Cotizando…" : "Calcular cotización"}</button>
          {quote && <div className="remittance-quote"><QuoteDetails quote={quote} /><button type="button" className="remittance-primary" disabled={busy} onClick={confirmCreate}>Revisar y confirmar envío</button></div>}
        </form>}
        <p className="remittance-help">{tab === "recibos" ? "Recibos por destino. Abre un pendiente para registrar su entrega completa." : "Envíos registrados por tu operación. Abre una referencia para consultar su detalle."}</p>
        <div className="remittance-table-wrap"><table className="remittance-table remittance-transfer-table"><caption>{tab === "recibos" ? "Recepción de dinero" : "Listado de envíos"} · {list.length}</caption><thead><tr><th>Referencia</th><th>Fecha</th><th>Remitente → destinatario</th><th>Total recibido</th><th>A entregar</th><th>Estado</th></tr></thead><tbody>{list.map((transfer) => <tr key={transfer.id}><td data-label="Referencia"><button type="button" className="remittance-link" onClick={() => { setDetailId(transfer.id); setCancelReason(""); }}>{tab === "recibos" ? transfer.reciboReference : transfer.envioReference}</button><small>{transfer.operatingCode}</small></td><td data-label="Fecha">{formatDate(transfer.createdAt)}</td><td data-label="Clientes">{clientName(transfer.senderClientId)}<br />→ {clientName(transfer.recipientClientId)}</td><td data-label="Total recibido">{money(transfer.totalAmount, transfer.sourceCurrency)}</td><td data-label="A entregar">{money(transfer.receiveAmount, transfer.destinationCurrency)}</td><td data-label="Estado"><span className={`remittance-status ${transfer.status}`}>{statusText[transfer.status]}</span></td></tr>)}{!list.length && <tr><td colSpan={6}>No hay {tab === "envios" ? "envíos" : "recibos"} para estos filtros.</td></tr>}</tbody></table></div>
      </>}
      {tab === "tasas" && isAdmin && <>
        <form className="remittance-panel" onSubmit={prepareRate}><h2>Tasa diaria</h2><p>Fecha: {snapshot.businessDate}. DOP vale 1. Las demás monedas necesitan tasa de hoy.</p><fieldset disabled={busy} className="remittance-form-grid"><label>Moneda<select value={rate.currency} onChange={(event) => setRate({ currency: event.target.value as Currency, value: event.target.value === "DOP" ? "1.000000" : "" })}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><label>DOP por 1 {rate.currency}<input required inputMode="decimal" value={rate.value} readOnly={rate.currency === "DOP"} onChange={(event) => setRate((current) => ({ ...current, value: event.target.value }))} placeholder="0.000000" /></label></fieldset><button className="remittance-primary" disabled={busy}>Revisar tasa</button></form>
        <DataTable section={{ title: "Tasas guardadas", columns: ["Fecha", "Moneda", "DOP por unidad"], rows: snapshot.rates.map((row) => [row.date, row.currency, row.rate]) }} />
      </>}
      {tab === "caja" && <>
        <p className="remittance-help">Caja exclusiva de envíos. Saldo = apertura + ingresos de envíos − devoluciones − pagos. Cada moneda se cuenta por separado.</p>
        {isAdmin && <form className="remittance-panel" onSubmit={prepareOpening}><h2>Abrir caja del {snapshot.businessDate}</h2><fieldset disabled={busy} className="remittance-form-grid"><label>Operador<select required value={opening.operatorId} onChange={(event) => setOpening((current) => ({ ...current, operatorId: event.target.value }))}>{snapshot.operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label><label>Moneda<select value={opening.currency} onChange={(event) => setOpening((current) => ({ ...current, currency: event.target.value as Currency }))}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><label>Efectivo inicial<input required inputMode="decimal" value={opening.amount} onChange={(event) => setOpening((current) => ({ ...current, amount: event.target.value }))} /></label></fieldset><button className="remittance-primary" disabled={busy}>Revisar apertura</button></form>}
        <div className="remittance-cash-grid">{snapshot.cashSessions.map((cash) => <article className="remittance-panel" key={cash.id}><h2>{cash.currency} · {operatorName(cash.operatorId)}</h2><p>{cash.date} · {cash.status === "open" ? "Abierta" : "Cerrada"}</p><dl className="remittance-summary"><div><dt>Apertura</dt><dd>{money(cash.openingAmount, cash.currency)}</dd></div><div><dt>Ingresos por envíos</dt><dd>{money(cash.sentTotal, cash.currency)}</dd></div><div><dt>Devoluciones</dt><dd>{money(cash.cancelRefund, cash.currency)}</dd></div><div><dt>Pagos</dt><dd>{money(cash.paid, cash.currency)}</dd></div><div className="remittance-total"><dt>Efectivo esperado</dt><dd>{money(cash.expected, cash.currency)}</dd></div>{cash.countedAmount !== undefined && <div><dt>Contado al cierre</dt><dd>{money(cash.countedAmount, cash.currency)}</dd></div>}</dl>{cash.canClose && <button type="button" onClick={() => { setClosing(cash); setCounted(""); setError(""); }}>Contar y cerrar</button>}</article>)}{!snapshot.cashSessions.length && <div className="remittance-empty">No hay cajas de envíos. Un administrador debe abrir la caja antes de operar.</div>}</div>
      </>}
      {tab === "reportes" && <>
        <form className="remittance-panel" onSubmit={(event) => void loadReport(event)}><h2>Reportes de envíos</h2><fieldset disabled={busy} className="remittance-form-grid"><label>Desde<input type="date" required value={reportFilters.from} onChange={(event) => { setReportFilters((current) => ({ ...current, from: event.target.value })); setReport(null); }} /></label><label>Hasta<input type="date" required value={reportFilters.to} onChange={(event) => { setReportFilters((current) => ({ ...current, to: event.target.value })); setReport(null); }} /></label><label>Presentación<select value={reportFilters.grouping} onChange={(event) => { setReportFilters((current) => ({ ...current, grouping: event.target.value as "range" | "day" })); setReport(null); }}><option value="range">Resumido del rango</option><option value="day">Diario</option></select></label><label>Reporte<select value={reportFilters.type} onChange={(event) => setReportFilters((current) => ({ ...current, type: event.target.value }))}><option value="amounts">Montos y cantidad de envíos</option><option value="times">Tiempos de entrega</option><option value="delivered">Envíos pagados</option><option value="cash">Caja</option></select></label></fieldset><button className="remittance-primary" disabled={busy}>{busy ? "Consultando…" : "Consultar"}</button></form>
        {report && <><div className="remittance-toolbar"><strong>{reportTitle}</strong><button type="button" onClick={() => runOutput(() => printSections(reportTitle, reportSections))}>Imprimir</button><button type="button" onClick={() => runOutput(() => exportSections(`envios-${reportFilters.type}-${report.from}-${report.to}`, reportSections))}>Exportar CSV</button></div><p className="remittance-help">{reportFilters.type === "amounts" ? "Por fecha de envío. Los cancelados cuentan, pero sus importes se excluyen de las sumas." : reportFilters.type === "cash" ? "Por fecha de caja. Aperturas y saldos finales no se suman entre días." : "Por fecha de pago. Cada moneda conserva sus propios importes."}</p>{reportSections.map((section) => <DataTable key={section.title} section={section} />)}</>}
      </>}
    </>}
    {detail && <Dialog title={`${detail.envioReference} · ${detail.reciboReference}`} onClose={() => setDetailId(null)}>
      <p><span className={`remittance-status ${detail.status}`}>{statusText[detail.status]}</span> · {detail.operatingCode}</p><p><strong>{clientName(detail.senderClientId)}</strong> → <strong>{clientName(detail.recipientClientId)}</strong></p><QuoteDetails quote={detail} /><p>Creado: {formatDate(detail.createdAt)}<br />Operador: {operatorName(detail.sendingUserId)}<br />Registrado por: {operatorName(detail.registeredBy)}</p>{detail.note && <p>Nota: {detail.note}</p>}
      {detail.paidAt && <p>Pagado: {formatDate(detail.paidAt)} · {operatorName(detail.paidBy)}</p>}{detail.cancelReason && <p>Cancelado: {formatDate(detail.cancelledAt)}. Motivo: {detail.cancelReason}</p>}
      <div className="remittance-actions"><button type="button" onClick={() => runOutput(() => printSections(`Comprobante ${detail.envioReference}`, transferOutput(detail)))}>Imprimir comprobante</button>{detail.status === "pending" && detail.canPay && <button type="button" className="remittance-primary" onClick={() => confirm({ title: "Confirmar entrega al destinatario", path: `/envios/${encodeURIComponent(detail.id)}/pagar`, body: {}, kind: "pay", description: <p>Registrar entrega única de <strong>{money(detail.receiveAmount, detail.destinationCurrency)}</strong> a <strong>{clientName(detail.recipientClientId)}</strong>. Se descuenta de tu caja abierta de hoy. Confirma después de entregar el dinero.</p> })}>Registrar pago completo</button>}</div>
      {detail.status === "pending" && detail.canCancel && <form className="remittance-cancel" onSubmit={(event) => { event.preventDefault(); if (!cancelReason.trim()) return; confirm({ title: "Cancelar envío pendiente", path: `/envios/${encodeURIComponent(detail.id)}/cancelar`, body: { reason: cancelReason.trim() }, kind: "cancel", description: <><p>Devolver <strong>{money(detail.totalAmount, detail.sourceCurrency)}</strong> (principal y comisión) al remitente, desde la caja del operador {operatorName(detail.sendingUserId)}.</p><p>Motivo: {cancelReason.trim()}</p></> }); }}><label>Motivo de cancelación<textarea required maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label><button className="remittance-danger" type="submit" disabled={!cancelReason.trim()}>Revisar cancelación</button></form>}
    </Dialog>}
    {closing && <Dialog title={`Contar caja ${closing.currency}`} onClose={() => setClosing(null)}><form onSubmit={prepareClosing}><p>{operatorName(closing.operatorId)} · {closing.date}</p><p>Esperado: <strong>{money(closing.expected, closing.currency)}</strong></p><label>Efectivo contado<input autoFocus required inputMode="decimal" value={counted} onChange={(event) => setCounted(event.target.value)} /></label>{error && <p role="alert" className="remittance-error">{error}</p>}<button className="remittance-primary" type="submit">Revisar cierre</button></form></Dialog>}
    {confirmation && <Dialog title={confirmation.title} onClose={() => setConfirmation(null)} locked={busy || uncertain}>{confirmation.description}{confirmationError && <p className="remittance-error" role="alert">{confirmationError}</p>}{uncertain && <p>No cambies los datos ni cierres esta ventana. El reintento usa la misma referencia de operación.</p>}<div className="remittance-actions"><button type="button" disabled={busy || uncertain} onClick={() => setConfirmation(null)}>Volver</button><button type="button" className={confirmation.kind === "cancel" ? "remittance-danger" : "remittance-primary"} disabled={busy} onClick={() => void submitConfirmation()}>{busy ? "Registrando…" : uncertain ? "Reintentar misma operación" : "Confirmar"}</button></div></Dialog>}
  </section>;
}
