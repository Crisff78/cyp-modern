import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { operationKey, StrictApiError, type StrictApi } from "./strictApi";
import type { Cash, Currency, Quotation, Rate, RemittanceSnapshot, Report, Transfer } from "./types";
import { decimalCents, exportSections, formatDate, formatMoney, printSections, type OutputSection } from "./output";
import { clientCurrency, clientLabel, commissionSections, contactRows, eligibleClients, LatestRequestGate, managerCommissionMatches, managerCommissionRows, managerCommissionSections, matchingClients, parseManagerCommission, quoteHistoryRows, rateMoment, selectRemittanceClient, type ClientSide, type RemittanceClient } from "./suggestions";
import "./remittances.css";
import { formatCrossRate } from "./crossRate";
import { INPUT_LIMITS, isDecimalDraft, validateText } from "../inputRules";
import { RateRegistrationTime } from "./RateRegistrationTime";
import { confirmedRateInput, rateInputDraft, RATE_INPUT_MAX_LENGTH } from "./rateInput";
import { confirmedRateResponse } from "./rateResponse";

type Tab = "envios" | "recibos" | "tasas" | "caja" | "reportes";
type Actor = { id: string; name: string };
type Confirmation = { title: string; path: string; body: Record<string, unknown>; description: ReactNode; kind: "create" | "pay" | "cancel" | "rate" | "open" | "close"; idempotencyKey?: string };
// Only in-memory: retain an uncertain action across route changes and same-actor login.
const pendingByActor = new Map<string, Confirmation>();
// These domain errors are produced only after the server's idempotency lookup.
const definitiveDomainErrors = new Set(["QUOTE_CHANGED", "CASH_NOT_OPEN", "RATE_MISSING", "RATE_DATE", "DOP_RATE", "CASH_EXISTS", "PREVIOUS_CASH_OPEN", "CASH_CLOSED", "CASH_UNBALANCED", "CASH_NOT_FOUND", "CLIENT_INACTIVE", "CLIENT_NOT_FOUND", "SAME_CLIENT", "TRANSFER_NOT_PENDING", "TRANSFER_NOT_FOUND", "INSUFFICIENT_CASH", "SEQUENCE_EXHAUSTED", "MONEY_RANGE", "INVALID_AMOUNT", "INVALID_RATE", "INVALID_CURRENCY", "INVALID_COMMISSION", "AMOUNT_TOO_SMALL", "REASON_REQUIRED"]);
type Draft = { senderClientId: string; recipientClientId: string; sendingUserId: string; sourceCurrency: Currency; destinationCurrency: Currency; amount: string; commission: string; note: string; managerInfo: boolean; managerName: string; managerAmount: string; managerCurrency: Currency | "" };
const statusText = { pending: "Pendiente de entrega", paid: "Pagado", cancelled: "Cancelado" };
const tabs: { id: Tab; label: string }[] = [{ id: "envios", label: "Envíos" }, { id: "recibos", label: "Recibos" }, { id: "tasas", label: "Tasas" }, { id: "caja", label: "Caja" }, { id: "reportes", label: "Reportes" }];
const money = formatMoney;
const moneyInputLength = 17;

function Dialog({ title, children, onClose, locked = false }: { title: string; children: ReactNode; onClose: () => void; locked?: boolean }) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => { element.current?.showModal(); return () => element.current?.close(); }, []);
  return <dialog ref={element} className="remittances-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); if (!locked) onClose(); }}>
    <header><h2>{title}</h2><button type="button" disabled={locked} onClick={onClose} aria-label={`Cerrar ${title}`} title={`Cerrar ${title}`}>×</button></header>
    <div className="remittances-dialog-body">{children}</div>
  </dialog>;
}

function QuoteDetails({ quote }: { quote: Quotation }) {
  const crossRate = formatCrossRate(quote.quote.sourceRate, quote.quote.destinationRate);
  return <dl className="remittance-summary">
    <div><dt>Principal</dt><dd>{money(quote.amount, quote.sourceCurrency)}</dd></div>
    <div><dt>Comisión ({quote.commissionBps / 100}%)</dt><dd>{money(quote.commissionAmount, quote.sourceCurrency)}</dd></div>
    <div className="remittance-total"><dt>Total que paga el remitente</dt><dd>{money(quote.totalAmount, quote.sourceCurrency)}</dd></div>
    <div className="remittance-total"><dt>Recibe el destinatario</dt><dd>{money(quote.receiveAmount, quote.destinationCurrency)}</dd></div>
    <div><dt>Tasas del {quote.quote.date}</dt><dd>1 {quote.sourceCurrency} = {quote.quote.sourceRate} DOP<br />1 {quote.destinationCurrency} = {quote.quote.destinationRate} DOP</dd></div>
    <div><dt>Tasa de origen a destino</dt><dd>1 {quote.sourceCurrency} {crossRate.approximate ? "≈" : "="} {crossRate.text} {quote.destinationCurrency}{crossRate.approximate && <small> (tasa mostrada redondeada)</small>}</dd></div>
    <div><dt>Hora de cotización</dt><dd>{rateMoment(quote.quote.quotedAt)}</dd></div>
  </dl>;
}

function DataTable({ section }: { section: OutputSection }) {
  return <div className="remittance-table-wrap"><table className="remittance-table"><caption>{section.title}</caption><thead><tr>{section.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{section.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} data-label={section.columns[cellIndex]}>{cell}</td>)}</tr>)}{!section.rows.length && <tr><td colSpan={section.columns.length}>No hay resultados para esta consulta.</td></tr>}</tbody></table></div>;
}

export function ClientPicker({ api, side, senderId, label, clients, value, query, onQuery, onSelect }: { api: StrictApi; side: ClientSide; senderId: string; label: string; clients: RemittanceClient[]; value: string; query: string; onQuery: (value: string) => void; onSelect: (client: RemittanceClient) => void }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [lookup, setLookup] = useState<{ query: string; ids: string[]; hasMore: boolean } | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  useEffect(() => {
    let retired = false;
    setLookup(null); setLookupError(""); setLookupBusy(Boolean(query.trim()));
    if (!query.trim()) return () => { retired = true; };
    const timer = window.setTimeout(async () => {
      try {
        const input = new URLSearchParams({ query: query.trim(), side, ...(senderId ? { senderId } : {}) });
        const result = await api<{ ids: string[]; hasMore: boolean }>(`/envios/clientes/buscar?${input}`);
        if (!result || !Array.isArray(result.ids) || result.ids.length > 100 || result.ids.some((id) => typeof id !== "string" || !id || id.length > 80) || typeof result.hasMore !== "boolean")
          throw new Error("La búsqueda devolvió una respuesta inválida. Reintenta la búsqueda.");
        if (!retired) setLookup({ ...result, query });
      } catch (failure) { if (!retired) setLookupError(failure instanceof Error ? failure.message : "No pudimos buscar por teléfono. Reintenta la búsqueda."); }
      finally { if (!retired) setLookupBusy(false); }
    }, 200);
    return () => { retired = true; window.clearTimeout(timer); };
  }, [api, side, senderId, query]);
  const matches = lookup?.query === query ? clients.filter((client) => lookup.ids.includes(client.id)) : matchingClients(clients, query);
  const visible = matches.slice(0, 20);
  const selected = clients.find((client) => client.id === value);
  const choose = (client: RemittanceClient) => { onSelect(client); setExpanded(false); setHighlight(-1); };
  return <div className="remittance-client-picker">
    <label htmlFor={id}>{label}<input id={id} type="search" inputMode="text" autoComplete="off" value={query} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-options`} aria-activedescendant={expanded && visible[highlight] ? `${id}-${highlight}` : undefined} onFocus={() => { setExpanded(true); setHighlight(-1); }} onBlur={() => setExpanded(false)} onChange={(event) => { onQuery(event.target.value); setExpanded(true); setHighlight(-1); }} onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setExpanded(true); setHighlight((current) => Math.min(Math.max(current + (event.key === "ArrowDown" ? 1 : -1), 0), Math.max(visible.length - 1, 0))); }
      if (event.key === "Enter" && expanded) { event.preventDefault(); if (visible[Math.max(highlight, 0)]) choose(visible[Math.max(highlight, 0)]); }
      if (event.key === "Escape" && expanded) { event.preventDefault(); setExpanded(false); }
    }} maxLength={160} placeholder="Teléfono, código o nombre del cliente" /></label>
    {expanded && <div className="remittance-client-options" id={`${id}-options`} role="listbox" aria-label={`Clientes para ${label.toLocaleLowerCase()}`}>{visible.map((client, index) => <button type="button" key={client.id} id={`${id}-${index}`} role="option" aria-selected={client.id === value} className={index === highlight ? "highlighted" : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(client)}>{clientLabel(client)}<small>Moneda habitual: {clientCurrency(client)}</small></button>)}{!visible.length && <p role="status">No hay clientes disponibles que coincidan.</p>}{matches.length > visible.length && <p>Escribe más caracteres para acotar los {matches.length} resultados.</p>}</div>}
    {expanded && lookupBusy && <p role="status">Buscando contactos…</p>}
    {expanded && lookupError && <p role="alert">{lookupError}</p>}
    {expanded && lookup?.query === query && lookup.hasMore && <p role="status">Hay más coincidencias. Escribe más caracteres para acotar la búsqueda.</p>}
    <span className="remittance-client-selection" aria-live="polite">{selected ? `Seleccionado: ${clientLabel(selected)}` : "Selecciona un resultado para usar este cliente."}</span>
  </div>;
}

export default function RemittancesWorkspace({ api, user, isAdmin, initialTab = "envios" }: { api: StrictApi; user: Actor; isAdmin: boolean; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab === "tasas" && !isAdmin ? "envios" : initialTab);
  const [snapshot, setSnapshot] = useState<RemittanceSnapshot | null>(null);
  const [sent, setSent] = useState<Transfer[]>([]);
  const [received, setReceived] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outputError, setOutputError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ senderClientId: "", recipientClientId: "", sendingUserId: user.id, sourceCurrency: "DOP", destinationCurrency: "DOP", amount: "", commission: "0", note: "", managerInfo: false, managerName: "", managerAmount: "", managerCurrency: "" });
  const [senderSearch, setSenderSearch] = useState("");
  const [recipientSearch, setRecipientSearch] = useState("");
  const [quote, setQuote] = useState<Quotation | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
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
  const quoteLock = useRef(false);
  const quoteRequests = useRef(new LatestRequestGate());
  const reportRequests = useRef(new LatestRequestGate());
  const refreshRequests = useRef(new LatestRequestGate());
  const working = busy || quoteBusy || reportBusy;

  const retireQuote = useCallback(() => { quoteRequests.current.invalidate(); quoteLock.current = false; setQuoteBusy(false); setQuote(null); }, []);

  const refresh = useCallback(async () => {
    const request = refreshRequests.current.begin();
    setLoading(true); setError(""); setOutputError("");
    try {
      const [data, outgoing, incoming] = await Promise.all([api<RemittanceSnapshot>("/envios/snapshot"), api<Transfer[]>("/envios"), api<Transfer[]>("/envios/recibos")]);
      if (!refreshRequests.current.accepts(request)) return;
      retireQuote();
      setSnapshot(data); setSent(outgoing); setReceived(incoming);
      setReportFilters((current) => ({ ...current, from: current.from || data.businessDate, to: current.to || data.businessDate }));
    } catch (failure) { if (refreshRequests.current.accepts(request)) setError(failure instanceof Error ? failure.message : "No pudimos cargar los envíos."); }
    finally { if (refreshRequests.current.accepts(request)) setLoading(false); }
  }, [api, retireQuote]);
  useEffect(() => { void refresh(); return () => { refreshRequests.current.invalidate(); quoteRequests.current.invalidate(); reportRequests.current.invalidate(); }; }, [refresh]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (uncertain || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uncertain, busy]);

  const clientName = (id: string) => snapshot?.clients.find((client) => client.id === id)?.name ?? "Cliente";
  const operatorName = (id?: string) => snapshot?.operators.find((operator) => operator.id === id)?.name ?? (id === user.id ? user.name : id || "—");
  const detail = snapshot?.transfers.find((transfer) => transfer.id === detailId);
  const clearErrors = () => { setError(""); setOutputError(""); };
  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (typeof value === "string") {
      if ((key === "amount" || key === "managerAmount") && !isDecimalDraft(value)) return;
      if (key === "commission" && !isDecimalDraft(value, { wholeDigits: 3 })) return;
    }
    setDraft((current) => ({ ...current, [key]: value })); retireQuote(); clearErrors();
  };
  const chooseClient = (side: ClientSide, client: RemittanceClient) => {
    setDraft((current) => selectRemittanceClient(current, side, client));
    if (side === "sender") { setSenderSearch(clientLabel(client)); if (draft.recipientClientId === client.id) setRecipientSearch(""); }
    else setRecipientSearch(clientLabel(client));
    retireQuote(); clearErrors();
  };
  const closeForm = () => { retireQuote(); setFormOpen(false); clearErrors(); };
  const updateReportFilter = (values: Partial<typeof reportFilters>) => { reportRequests.current.invalidate(); setReportBusy(false); setReportFilters((current) => ({ ...current, ...values })); setReport(null); };
  const confirm = (action: Confirmation) => { setConfirmation({ ...action, idempotencyKey: operationKey() }); setConfirmationError(""); setUncertain(false); setNotice(""); };
  const failureMessage = (failure: unknown) => failure instanceof Error ? failure.message : "No pudimos completar la operación.";
  const runOutput = (action: () => void) => { try { action(); setOutputError(""); } catch (failure) { setOutputError(failureMessage(failure)); } };
  useEffect(() => {
    if (!snapshot) return;
    const invalidSender = Boolean(draft.senderClientId && !eligibleClients(snapshot.clients, "sender", draft.senderClientId).some((client) => client.id === draft.senderClientId));
    const invalidRecipient = Boolean(draft.recipientClientId && !eligibleClients(snapshot.clients, "recipient", draft.senderClientId).some((client) => client.id === draft.recipientClientId));
    const sender = snapshot.clients.find((client) => client.id === draft.senderClientId);
    const recipient = snapshot.clients.find((client) => client.id === draft.recipientClientId);
    if (sender && !invalidSender) setSenderSearch(clientLabel(sender));
    if (recipient && !invalidRecipient) setRecipientSearch(clientLabel(recipient));
    if (invalidSender || invalidRecipient) {
      setDraft((current) => ({ ...current, ...(invalidSender ? { senderClientId: "" } : {}), ...(invalidRecipient ? { recipientClientId: "" } : {}) }));
      if (invalidSender) setSenderSearch("");
      if (invalidRecipient) setRecipientSearch("");
      retireQuote();
    }
  }, [snapshot, draft.senderClientId, draft.recipientClientId, retireQuote]);

  async function submitConfirmation() {
    if (!confirmation || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setConfirmationError("");
    pendingByActor.set(user.id, confirmation);
    try {
      const result = await api<Transfer>(confirmation.path, { method: "POST", headers: { "Idempotency-Key": confirmation.idempotencyKey! }, body: JSON.stringify(confirmation.body) });
      if (confirmation.kind === "rate") confirmedRateResponse(result, confirmation.body as Pick<Rate, "currency" | "date" | "rate">);
      if (confirmation.kind === "create" && !managerCommissionMatches(confirmation.body.managerCommission as Transfer["managerCommission"], result?.managerCommission)) throw new StrictApiError("La respuesta no confirmó la información del gestor. Conservamos los datos: reintenta esta misma operación sin cambiarlos.", 200, true, "REMITTANCE_CONFIRMATION_INVALID");
      pendingByActor.delete(user.id);
      setNotice("Operación registrada correctamente.");
      if (confirmation.kind === "create") { setFormOpen(false); setQuote(null); setDraft((current) => ({ ...current, amount: "", note: "", managerInfo: false, managerName: "", managerAmount: "", managerCurrency: "" })); }
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
    event.preventDefault();
    if (quoteLock.current || mutationLock.current || !snapshot) return;
    const request = quoteRequests.current.begin();
    quoteLock.current = true; clearErrors(); setQuote(null); setQuoteBusy(true);
    try {
      if (!draft.senderClientId || !draft.recipientClientId || draft.senderClientId === draft.recipientClientId) throw new Error("Selecciona un remitente y un destinatario distintos.");
      if (!eligibleClients(snapshot.clients, "sender", draft.senderClientId).some((client) => client.id === draft.senderClientId) || !eligibleClients(snapshot.clients, "recipient", draft.senderClientId).some((client) => client.id === draft.recipientClientId)) throw new Error("El cliente seleccionado ya no está disponible. Selecciónalo de nuevo.");
      if (!isDecimalDraft(draft.amount) || !isDecimalDraft(draft.commission, { wholeDigits: 3 })) throw new Error("Revisa el importe y la comisión: admiten hasta dos decimales.");
      const amount = decimalCents(draft.amount);
      const commissionBps = decimalCents(draft.commission, true);
      if (commissionBps > 10000) throw new Error("La comisión debe estar entre 0% y 100%.");
      const params = new URLSearchParams({ sourceCurrency: draft.sourceCurrency, destinationCurrency: draft.destinationCurrency, amount: String(amount), commissionBps: String(commissionBps) });
      const result = await api<Quotation>(`/envios/cotizacion?${params}`);
      if (quoteRequests.current.accepts(request)) setQuote(result);
    } catch (failure) { if (quoteRequests.current.accepts(request)) setError(failureMessage(failure)); }
    finally { if (quoteRequests.current.accepts(request)) { quoteLock.current = false; setQuoteBusy(false); } }
  }

  function confirmCreate() {
    if (!quote) return;
    let managerCommission;
    try {
      validateText(draft.note, "La nota", INPUT_LIMITS.freeNote, { multiline: true });
      if (draft.managerInfo) {
        validateText(draft.managerName, "El nombre del gestor", INPUT_LIMITS.name, { required: true });
        if (!isDecimalDraft(draft.managerAmount)) throw new Error("La comisión del gestor admite hasta dos decimales.");
      }
      managerCommission = parseManagerCommission(draft.managerInfo, draft.managerName, draft.managerAmount, draft.managerCurrency);
    }
    catch (failure) { setError(failureMessage(failure)); return; }
    confirm({ title: "Confirmar envío", path: "/envios", kind: "create", body: {
      senderClientId: draft.senderClientId, recipientClientId: draft.recipientClientId,
      ...(isAdmin ? { sendingUserId: draft.sendingUserId } : {}), sourceCurrency: quote.sourceCurrency, destinationCurrency: quote.destinationCurrency,
      amount: quote.amount, commissionBps: quote.commissionBps, quote: quote.quote, note: draft.note.trim(), ...(managerCommission ? { managerCommission } : {}),
    }, description: <><p><strong>{clientName(draft.senderClientId)}</strong> envía a <strong>{clientName(draft.recipientClientId)}</strong>.</p><QuoteDetails quote={quote} />{managerCommission && <DataTable section={{ title: "Comisión del gestor (información manual)", columns: ["Dato", "Valor"], rows: managerCommissionRows(managerCommission) }} />}<p>Operador: {operatorName(draft.sendingUserId)}. Registrado por: {user.name}.</p><p>Confirma después de recibir el total del remitente. La tasa queda guardada para este envío.</p></> });
  }

  function prepareRate(event: FormEvent) {
    event.preventDefault();
    if (!snapshot) return;
    let value: string;
    try { value = confirmedRateInput(rate.value); }
    catch (failure) { setError(failureMessage(failure)); return; }
    setError(""); setRate({ ...rate, value });
    confirm({ title: "Guardar tasa del día", path: "/envios/tasas", kind: "rate", body: { currency: rate.currency, rate: value, date: snapshot.businessDate }, description: <><p>1 {rate.currency} = <strong>{value} DOP</strong> para {snapshot.businessDate}. Los envíos anteriores conservan su tasa.</p><RateRegistrationTime rate={snapshot.rates.find((row) => row.currency === rate.currency && row.date === snapshot.businessDate)} /></> });
  }

  function prepareOpening(event: FormEvent) {
    event.preventDefault();
    try {
      if (!isDecimalDraft(opening.amount)) throw new Error("El efectivo inicial admite hasta dos decimales.");
      const openingAmount = decimalCents(opening.amount, true);
      confirm({ title: "Abrir caja de envíos", path: "/envios/cajas/abrir", kind: "open", body: { operatorId: opening.operatorId, currency: opening.currency, openingAmount }, description: <p>Operador: <strong>{operatorName(opening.operatorId)}</strong><br />Fecha: {snapshot?.businessDate}<br />Efectivo inicial: <strong>{money(openingAmount, opening.currency)}</strong></p> });
    } catch (failure) { setError(failureMessage(failure)); }
  }

  function prepareClosing(event: FormEvent) {
    event.preventDefault(); if (!closing) return;
    try {
      if (!isDecimalDraft(counted)) throw new Error("El efectivo contado admite hasta dos decimales.");
      const countedAmount = decimalCents(counted, true);
      if (countedAmount !== closing.expected) throw new Error(`El efectivo contado debe coincidir con ${money(closing.expected, closing.currency)}. Revisa el conteo y actualiza la caja.`);
      confirm({ title: "Confirmar cierre de caja", path: `/envios/cajas/${encodeURIComponent(closing.id)}/cerrar`, kind: "close", body: { countedAmount }, description: <p>Cerrar caja de {operatorName(closing.operatorId)} · {closing.date}, con <strong>{money(countedAmount, closing.currency)}</strong>. Después del cierre esta caja no admite movimientos.</p> });
    } catch (failure) { setError(failureMessage(failure)); }
  }

  function prepareCancellation(event: FormEvent) {
    event.preventDefault(); if (!detail) return;
    try {
      validateText(cancelReason, "El motivo de cancelación", INPUT_LIMITS.freeNote, { required: true, multiline: true });
      const reason = cancelReason.trim();
      confirm({ title: "Cancelar envío pendiente", path: `/envios/${encodeURIComponent(detail.id)}/cancelar`, body: { reason }, kind: "cancel", description: <><p>Devolver <strong>{money(detail.totalAmount, detail.sourceCurrency)}</strong> (principal y comisión) al remitente, desde la caja del operador {operatorName(detail.sendingUserId)}.</p><p>Motivo: {reason}</p></> });
    } catch (failure) { setError(failureMessage(failure)); }
  }

  async function loadReport(event: FormEvent) {
    event.preventDefault(); if (reportBusy) return;
    const request = reportRequests.current.begin(); setReportBusy(true); clearErrors();
    try {
      if (!reportFilters.from || !reportFilters.to || reportFilters.from > reportFilters.to) throw new Error("Revisa las fechas del reporte.");
      const query = new URLSearchParams({ from: reportFilters.from, to: reportFilters.to, grouping: reportFilters.grouping });
      const result = await api<Report>(`/envios/reportes?${query}`);
      if (reportRequests.current.accepts(request)) setReport(result);
    } catch (failure) { if (reportRequests.current.accepts(request)) setError(failureMessage(failure)); }
    finally { if (reportRequests.current.accepts(request)) setReportBusy(false); }
  }

  const transferOutput = (transfer: Transfer): OutputSection[] => [{ title: `${transfer.envioReference} · ${transfer.reciboReference}`, columns: ["Dato", "Valor"], rows: [
    ["Estado", statusText[transfer.status]], ["Referencia operativa", transfer.operatingCode], [transfer.senderContact ? "Remitente" : "Remitente (nombre actual en catálogo)", transfer.senderContact?.name ?? clientName(transfer.senderClientId)], [transfer.recipientContact ? "Destinatario" : "Destinatario (nombre actual en catálogo)", transfer.recipientContact?.name ?? clientName(transfer.recipientClientId)],
    ...contactRows(transfer),
    ...managerCommissionRows(transfer.managerCommission),
    ["Operador del envío", operatorName(transfer.sendingUserId)], ["Registrado por", operatorName(transfer.registeredBy)], ["Creado", formatDate(transfer.createdAt)],
    ["Principal", money(transfer.amount, transfer.sourceCurrency)], ["Comisión", money(transfer.commissionAmount, transfer.sourceCurrency)], ["Total recibido del remitente", money(transfer.totalAmount, transfer.sourceCurrency)],
    ["Importe para destinatario", money(transfer.receiveAmount, transfer.destinationCurrency)], ["Tasa origen DOP/unidad", transfer.quote.sourceRate], ["Tasa destino DOP/unidad", transfer.quote.destinationRate], ...quoteHistoryRows(transfer.quote, transfer.sourceCurrency, transfer.destinationCurrency),
    ["Pagado", formatDate(transfer.paidAt)], ["Pagado por", operatorName(transfer.paidBy)], ["Cancelado", formatDate(transfer.cancelledAt)], ["Motivo cancelación", transfer.cancelReason || "—"], ["Nota", transfer.note || "—"],
  ] }];
  const reportSections: OutputSection[] = !report ? [] : reportFilters.type === "amounts" ? [{ title: "Montos de envíos por moneda de origen y destino", columns: ["Fecha", "Origen", "Destino", "Envíos", "Pendientes", "Pagados", "Cancelados", "Principal origen", "Comisión origen", "Total origen", "A entregar destino"], rows: report.amounts.map((row) => [row.date, row.sourceCurrency, row.destinationCurrency, row.count, row.pendingCount, row.paidCount, row.cancelledCount, money(row.amount, row.sourceCurrency), money(row.commissionAmount, row.sourceCurrency), money(row.totalAmount, row.sourceCurrency), money(row.receiveAmount, row.destinationCurrency)]) }]
    : reportFilters.type === "times" ? [{ title: "Tiempo desde el envío hasta el pago", columns: ["Fecha", "Pagados", "Mínimo (min)", "Máximo (min)", "Promedio (min)"], rows: (report.deliveryTimeSummary ?? []).map((row) => [row.date, row.count, (row.minSeconds / 60).toFixed(1), (row.maxSeconds / 60).toFixed(1), (row.averageSeconds / 60).toFixed(1)]) }, { title: "Detalle de emisión y pago", columns: ["Envío", "Emitido", "Pagado", "Tiempo (min)"], rows: report.deliveryTimes.map((row) => [row.envioReference, formatDate(row.createdAt), formatDate(row.paidAt), (row.elapsedSeconds / 60).toFixed(1)]) }]
    : reportFilters.type === "delivered" ? [{ title: "Entregados por fecha de pago y moneda", columns: ["Fecha", "Moneda", "Pagados", "Importe entregado"], rows: report.delivered.map((row) => [row.date, row.currency, row.count, money(row.amount, row.currency)]) }]
    : reportFilters.type === "commissions" ? commissionSections(report.commissions ?? { details: [], totals: [] }, (id) => operatorName(id))
    : reportFilters.type === "managerCommissions" ? managerCommissionSections(report.managerCommissions ?? { details: [], totals: [] })
    : [{ title: "Caja de envíos por operador y moneda", columns: ["Fecha", "Operador", "Moneda", "Cajas", "Primera apertura", "Ingresos envíos", "Devoluciones", "Pagos", "Último esperado"], rows: (report.cashSummary ?? []).map((row) => [row.date, operatorName(row.operatorId), row.currency, row.sessionCount, money(row.firstOpening, row.currency), money(row.sentTotal, row.currency), money(row.cancelRefund, row.currency), money(row.paid, row.currency), money(row.lastExpected, row.currency)]) }];
  const reportTitle = report ? `Envíos · ${report.from} a ${report.to} · ${report.grouping === "day" ? "Diario" : "Resumido"}` : "Envíos";
  const list = (tab === "recibos" ? received : sent).filter((transfer) => (status === "all" || transfer.status === status) && [transfer.envioReference, transfer.reciboReference, transfer.operatingCode, clientName(transfer.senderClientId), clientName(transfer.recipientClientId)].join(" ").toLocaleLowerCase().includes(search.toLocaleLowerCase()));

  return <section className="remittances" aria-label="Envíos de Dinero">
    <header className="remittance-heading"><div><h1>Envíos de Dinero</h1><p>{snapshot ? `Fecha de operación: ${snapshot.businessDate}` : "Conexión con la API"} · {user.name}</p></div><button type="button" onClick={() => void refresh()} disabled={loading || working}>{loading ? "Cargando…" : "Actualizar"}</button></header>
    <nav className="remittance-tabs" aria-label="Secciones de Envíos">{tabs.filter((item) => item.id !== "tasas" || isAdmin).map((item) => <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} onClick={() => { retireQuote(); reportRequests.current.invalidate(); setReportBusy(false); setTab(item.id); clearErrors(); }}>{item.label}</button>)}</nav>
    {error && <div className="remittance-error" role="alert">{error}</div>}
    {outputError && <div className="remittance-error" role="alert">{outputError}</div>}
    {notice && <div className="remittance-notice" role="status">{notice}</div>}
    {!snapshot ? <div className="remittance-empty">{loading ? "Cargando clientes, tasas y cajas…" : "No hay datos conectados. Actualiza para volver a intentar."}</div> : <>
      {(tab === "envios" || tab === "recibos") && <>
        <div className="remittance-toolbar"><label>Buscar<input type="search" maxLength={INPUT_LIMITS.name} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Referencia o cliente" /></label><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos</option><option value="pending">Pendientes</option><option value="paid">Pagados</option><option value="cancelled">Cancelados</option></select></label>{tab === "envios" && <button type="button" className="remittance-primary" disabled={busy || uncertain} onClick={() => { if (formOpen) closeForm(); else { setFormOpen(true); clearErrors(); } }}>{formOpen ? "Cancelar nuevo envío" : "Nuevo envío"}</button>}</div>
        {tab === "envios" && formOpen && <form className="remittance-panel" onSubmit={(event) => void requestQuote(event)}>
          <h2>Nuevo envío</h2><fieldset disabled={working || uncertain} className="remittance-form-grid">
            <ClientPicker api={api} side="sender" senderId="" label="Remitente" clients={eligibleClients(snapshot.clients, "sender", draft.senderClientId)} value={draft.senderClientId} query={senderSearch} onQuery={(value) => { setSenderSearch(value); updateDraft("senderClientId", ""); }} onSelect={(client) => chooseClient("sender", client)} />
            <ClientPicker api={api} side="recipient" senderId={draft.senderClientId} label="Destinatario" clients={eligibleClients(snapshot.clients, "recipient", draft.senderClientId)} value={draft.recipientClientId} query={recipientSearch} onQuery={(value) => { setRecipientSearch(value); updateDraft("recipientClientId", ""); }} onSelect={(client) => chooseClient("recipient", client)} />
            {isAdmin && <label>Operador del envío<select required value={draft.sendingUserId} onChange={(event) => updateDraft("sendingUserId", event.target.value)}>{snapshot.operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label>}
            <label>Moneda del remitente<select value={draft.sourceCurrency} onChange={(event) => updateDraft("sourceCurrency", event.target.value as Currency)}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <label>Monto a enviar ({draft.sourceCurrency})<input required inputMode="decimal" maxLength={moneyInputLength} value={draft.amount} onChange={(event) => updateDraft("amount", event.target.value)} placeholder="0.00" /></label>
            <label>Moneda del destinatario<select value={draft.destinationCurrency} onChange={(event) => updateDraft("destinationCurrency", event.target.value as Currency)}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <label>Comisión (%)<input required inputMode="decimal" maxLength={6} value={draft.commission} onChange={(event) => updateDraft("commission", event.target.value)} /></label>
            <label className="remittance-wide remittance-manager-toggle"><span><input type="checkbox" checked={draft.managerInfo} onChange={(event) => updateDraft("managerInfo", event.target.checked)} />Informar comisión del gestor (opcional)</span></label>
            {draft.managerInfo && <>
              <label>Gestor (información manual)<input required maxLength={INPUT_LIMITS.name} value={draft.managerName} onChange={(event) => updateDraft("managerName", event.target.value)} /></label>
              <label>Comisión informativa del gestor<input required inputMode="decimal" maxLength={moneyInputLength} value={draft.managerAmount} onChange={(event) => updateDraft("managerAmount", event.target.value)} placeholder="0.00" /></label>
              <label>Moneda de comisión del gestor<select required value={draft.managerCurrency} onChange={(event) => updateDraft("managerCurrency", event.target.value as Currency | "")}><option value="">Selecciona una moneda</option>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
              <p className="remittance-help remittance-wide">Importe declarado manualmente: no se calcula, no se añade al cobro y no registra un pago al gestor.</p>
            </>}
            <label className="remittance-wide">Nota (opcional)<textarea maxLength={INPUT_LIMITS.freeNote} rows={2} value={draft.note} onChange={(event) => updateDraft("note", event.target.value)} /></label>
          </fieldset><p className="remittance-help">Selecciona cada cliente para cargar su moneda habitual; después puedes ajustar cada moneda por separado. La comisión se suma al principal. Se necesita una caja abierta del operador en la moneda de origen.</p>
          <button disabled={working || uncertain} type="submit">{quoteBusy ? "Cotizando…" : "Calcular cotización"}</button>
          {quote && <div className="remittance-quote"><QuoteDetails quote={quote} /><button type="button" className="remittance-primary" disabled={working || uncertain} onClick={confirmCreate}>Revisar y confirmar envío</button></div>}
        </form>}
        <p className="remittance-help">{tab === "recibos" ? "Recibos por destino. Abre un pendiente para registrar su entrega completa." : "Envíos registrados por tu operación. Abre una referencia para consultar su detalle."}</p>
        <div className="remittance-table-wrap"><table className="remittance-table remittance-transfer-table"><caption>{tab === "recibos" ? "Recepción de dinero" : "Listado de envíos"} · {list.length}</caption><thead><tr><th>Referencia</th><th>Fecha</th><th>Remitente → destinatario</th><th>Total recibido</th><th>A entregar</th><th>Estado</th></tr></thead><tbody>{list.map((transfer) => <tr key={transfer.id}><td data-label="Referencia"><button type="button" className="remittance-link" onClick={() => { setDetailId(transfer.id); setCancelReason(""); }}>{tab === "recibos" ? transfer.reciboReference : transfer.envioReference}</button><small>{transfer.operatingCode}</small></td><td data-label="Fecha">{formatDate(transfer.createdAt)}</td><td data-label="Clientes">{clientName(transfer.senderClientId)}<br />→ {clientName(transfer.recipientClientId)}</td><td data-label="Total recibido">{money(transfer.totalAmount, transfer.sourceCurrency)}</td><td data-label="A entregar">{money(transfer.receiveAmount, transfer.destinationCurrency)}</td><td data-label="Estado"><span className={`remittance-status ${transfer.status}`}>{statusText[transfer.status]}</span></td></tr>)}{!list.length && <tr><td colSpan={6}>No hay {tab === "envios" ? "envíos" : "recibos"} para estos filtros.</td></tr>}</tbody></table></div>
      </>}
      {tab === "tasas" && isAdmin && <>
        <form className="remittance-panel" onSubmit={prepareRate}><h2>Tasa</h2><p>Fecha: {snapshot.businessDate}. DOP vale 1. Las demás monedas necesitan tasa de hoy. Cada cambio queda en el historial; los envíos anteriores conservan su tasa.</p><fieldset disabled={working} className="remittance-form-grid"><label>Moneda<select value={rate.currency} onChange={(event) => setRate({ currency: event.target.value as Currency, value: event.target.value === "DOP" ? "1.000000" : "" })}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><label>Tasa<input required aria-describedby="remittance-rate-unit" inputMode="decimal" maxLength={RATE_INPUT_MAX_LENGTH} value={rate.value} readOnly={rate.currency === "DOP"} onChange={(event) => { setRate((current) => ({ ...current, value: rateInputDraft(event.target.value) })); setError(""); }} placeholder="0.000000" /><span id="remittance-rate-unit">1 {rate.currency} = esta tasa en DOP</span></label><RateRegistrationTime rate={snapshot.rates.find((row) => row.currency === rate.currency && row.date === snapshot.businessDate)} /></fieldset><button className="remittance-primary" disabled={working}>Revisar tasa</button></form>
        <DataTable section={{ title: "Tasas vigentes", columns: ["Fecha", "Moneda", "Tasa", "Último cambio (America/Santo_Domingo)"], rows: snapshot.rates.map((row) => [row.date, row.currency, row.rate, rateMoment(row.updatedAt)]) }} />
        <DataTable section={{ title: "Historial de cambios de tasa", columns: ["Fecha de operación", "Moneda", "Tasa", "Fecha y hora (America/Santo_Domingo)", "Registrado por"], rows: (snapshot.rateHistory ?? []).map((row) => [row.date, row.currency, row.rate, rateMoment(row.createdAt), operatorName(row.actorId)]) }} />
      </>}
      {tab === "caja" && <>
        <p className="remittance-help">Caja exclusiva de envíos. Saldo = apertura + ingresos de envíos − devoluciones − pagos. Cada moneda se cuenta por separado.</p>
        {isAdmin && <form className="remittance-panel" onSubmit={prepareOpening}><h2>Abrir caja del {snapshot.businessDate}</h2><fieldset disabled={busy} className="remittance-form-grid"><label>Operador<select required value={opening.operatorId} onChange={(event) => setOpening((current) => ({ ...current, operatorId: event.target.value }))}>{snapshot.operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label><label>Moneda<select value={opening.currency} onChange={(event) => setOpening((current) => ({ ...current, currency: event.target.value as Currency }))}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><label>Efectivo inicial<input required inputMode="decimal" maxLength={moneyInputLength} value={opening.amount} onChange={(event) => { if (isDecimalDraft(event.target.value)) setOpening((current) => ({ ...current, amount: event.target.value })); }} /></label></fieldset><button className="remittance-primary" disabled={busy}>Revisar apertura</button></form>}
        <div className="remittance-cash-grid">{snapshot.cashSessions.map((cash) => <article className="remittance-panel" key={cash.id}><h2>{cash.currency} · {operatorName(cash.operatorId)}</h2><p>{cash.date} · {cash.status === "open" ? "Abierta" : "Cerrada"}</p><dl className="remittance-summary"><div><dt>Apertura</dt><dd>{money(cash.openingAmount, cash.currency)}</dd></div><div><dt>Ingresos por envíos</dt><dd>{money(cash.sentTotal, cash.currency)}</dd></div><div><dt>Devoluciones</dt><dd>{money(cash.cancelRefund, cash.currency)}</dd></div><div><dt>Pagos</dt><dd>{money(cash.paid, cash.currency)}</dd></div><div className="remittance-total"><dt>Efectivo esperado</dt><dd>{money(cash.expected, cash.currency)}</dd></div>{cash.countedAmount !== undefined && <div><dt>Contado al cierre</dt><dd>{money(cash.countedAmount, cash.currency)}</dd></div>}</dl>{cash.canClose && <button type="button" onClick={() => { setClosing(cash); setCounted(""); clearErrors(); }}>Contar y cerrar</button>}</article>)}{!snapshot.cashSessions.length && <div className="remittance-empty">No hay cajas de envíos. Un administrador debe abrir la caja antes de operar.</div>}</div>
      </>}
      {tab === "reportes" && <>
        <form className="remittance-panel" onSubmit={(event) => void loadReport(event)}><h2>Reportes de envíos</h2><fieldset disabled={working} className="remittance-form-grid"><label>Desde<input type="date" required value={reportFilters.from} onChange={(event) => updateReportFilter({ from: event.target.value })} /></label><label>Hasta<input type="date" required value={reportFilters.to} onChange={(event) => updateReportFilter({ to: event.target.value })} /></label><label>Presentación<select value={reportFilters.grouping} onChange={(event) => updateReportFilter({ grouping: event.target.value as "range" | "day" })}><option value="range">Resumido del rango</option><option value="day">Diario</option></select></label><label>Reporte<select value={reportFilters.type} onChange={(event) => setReportFilters((current) => ({ ...current, type: event.target.value }))}><option value="amounts">Montos y cantidad de envíos</option><option value="commissions">Comisiones del negocio</option><option value="managerCommissions">Información de comisiones de gestores</option><option value="times">Tiempos de entrega</option><option value="delivered">Envíos pagados</option><option value="cash">Caja</option></select></label></fieldset><button className="remittance-primary" disabled={working}>{reportBusy ? "Consultando…" : "Consultar"}</button></form>
        {report && <><div className="remittance-toolbar"><strong>{reportTitle}</strong><button type="button" onClick={() => runOutput(() => printSections(reportTitle, reportSections))}>Imprimir</button><button type="button" onClick={() => runOutput(() => exportSections(`envios-${reportFilters.type}-${report.from}-${report.to}`, reportSections))}>Exportar CSV</button></div><p className="remittance-help">{reportFilters.type === "managerCommissions" ? "Información declarada manualmente, por fecha de emisión y estado actual. Cada gestor y moneda se presenta por separado. Las canceladas se excluyen del vigente; este reporte no calcula ni registra pagos al gestor." : reportFilters.type === "commissions" ? "Por fecha de emisión y estado actual de cada envío. Comisiones del negocio separadas por moneda; las canceladas se muestran aparte y no se suman al total vigente. La información manual del gestor se consulta por separado." : reportFilters.type === "amounts" ? "Por fecha de envío. Los cancelados cuentan, pero sus importes se excluyen de las sumas." : reportFilters.type === "cash" ? "Por fecha de caja. Aperturas y saldos finales no se suman entre días." : "Por fecha de pago. Cada moneda conserva sus propios importes."}</p>{reportSections.map((section) => <DataTable key={section.title} section={section} />)}</>}
      </>}
    </>}
    {detail && <Dialog title={`${detail.envioReference} · ${detail.reciboReference}`} onClose={() => setDetailId(null)}>
      <p><span className={`remittance-status ${detail.status}`}>{statusText[detail.status]}</span> · {detail.operatingCode}</p><p><strong>{detail.senderContact?.name ?? clientName(detail.senderClientId)}</strong> → <strong>{detail.recipientContact?.name ?? clientName(detail.recipientClientId)}</strong></p><QuoteDetails quote={detail} /><p>Creado: {formatDate(detail.createdAt)}<br />Operador: {operatorName(detail.sendingUserId)}<br />Registrado por: {operatorName(detail.registeredBy)}</p>{detail.note && <p>Nota: {detail.note}</p>}
      <DataTable section={{ title: "Contactos guardados en esta operación", columns: ["Dato", "Valor"], rows: contactRows(detail) }} />
      <DataTable section={{ title: "Comisión del gestor (información manual)", columns: ["Dato", "Valor"], rows: managerCommissionRows(detail.managerCommission) }} />
      {detail.paidAt && <p>Pagado: {formatDate(detail.paidAt)} · {operatorName(detail.paidBy)}</p>}{detail.cancelReason && <p>Cancelado: {formatDate(detail.cancelledAt)}. Motivo: {detail.cancelReason}</p>}
      <div className="remittance-actions"><button type="button" onClick={() => runOutput(() => printSections(`Comprobante ${detail.envioReference}`, transferOutput(detail)))}>Imprimir comprobante</button>{detail.status === "pending" && detail.canPay && <button type="button" className="remittance-primary" onClick={() => confirm({ title: "Confirmar entrega al destinatario", path: `/envios/${encodeURIComponent(detail.id)}/pagar`, body: {}, kind: "pay", description: <p>Registrar entrega única de <strong>{money(detail.receiveAmount, detail.destinationCurrency)}</strong> a <strong>{clientName(detail.recipientClientId)}</strong>. Se descuenta de tu caja abierta de hoy. Confirma después de entregar el dinero.</p> })}>Registrar pago completo</button>}</div>
      {detail.status === "pending" && detail.canCancel && <form className="remittance-cancel" onSubmit={prepareCancellation}><label>Motivo de cancelación<textarea required maxLength={INPUT_LIMITS.freeNote} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label><button className="remittance-danger" type="submit" disabled={!cancelReason.trim()}>Revisar cancelación</button></form>}
    </Dialog>}
    {closing && <Dialog title={`Contar caja ${closing.currency}`} onClose={() => setClosing(null)}><form onSubmit={prepareClosing}><p>{operatorName(closing.operatorId)} · {closing.date}</p><p>Esperado: <strong>{money(closing.expected, closing.currency)}</strong></p><label>Efectivo contado<input autoFocus required inputMode="decimal" maxLength={moneyInputLength} value={counted} onChange={(event) => { if (isDecimalDraft(event.target.value)) setCounted(event.target.value); }} /></label>{error && <p role="alert" className="remittance-error">{error}</p>}<button className="remittance-primary" type="submit">Revisar cierre</button></form></Dialog>}
    {confirmation && <Dialog title={confirmation.title} onClose={() => setConfirmation(null)} locked={busy || uncertain}>{confirmation.description}{confirmationError && <p className="remittance-error" role="alert">{confirmationError}</p>}{uncertain && <p>No cambies los datos ni cierres esta ventana. El reintento usa la misma referencia de operación.</p>}<div className="remittance-actions"><button type="button" disabled={busy || uncertain} onClick={() => setConfirmation(null)}>Volver</button><button type="button" className={confirmation.kind === "cancel" ? "remittance-danger" : "remittance-primary"} disabled={busy} onClick={() => void submitConfirmation()}>{busy ? "Registrando…" : uncertain ? "Reintentar misma operación" : "Confirmar"}</button></div></Dialog>}
  </section>;
}
