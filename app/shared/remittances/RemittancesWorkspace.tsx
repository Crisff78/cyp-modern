import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { operationKey, StrictApiError, type StrictApi } from "./strictApi";
import type { Cash, CommissionReportGroupBy, CommissionReportStatus, ConsolidatedCommissionReport, Currency, NewRemittanceClient, Quotation, RemittanceContact, RemittanceSnapshot, Report, Transfer } from "./types";
import { decimalCents, exportSections, formatDate, formatMoney, printSections, type OutputSection } from "./output";
import { clientCurrency, clientLabel, contactRows, eligibleClients, LatestRequestGate, managerCommissionRows, matchingClients, quoteHistoryRows, rateMoment, selectRemittanceClient, type ClientSide, type RemittanceClient } from "./suggestions";
import "./remittances.css";
import { formatCrossRate } from "./crossRate";
import { INPUT_LIMITS, isDecimalDraft, validatePhone, validateText } from "../inputRules";
import { useClientContact } from "./useClientContact";
import { changedRecipientPhone, confirmedCreatedTransfer } from "./createdTransferResponse";
import { allocationRows, commissionReportStatusLabels } from "./commissionOutput";
import { accessRole, hasRemittancePermission, type EffectiveAccess, type RemittancePermission } from "../access.mjs";
import { RemittanceDialog as Dialog } from "./RemittanceDialog";
import { QuickClientDialog } from "./QuickClientDialog";
import { advanceCaptureField } from "./formKeyboard";
import { currentOperationalWeek } from "../operationalWeek";
import { remittanceReportDefinitions, remittanceReportDefinition, remittanceReportPath, remittanceReportSections, remittanceReportTitle, type RemittanceReportFilters, type RemittanceReportType } from "./reporting";
import { previousOpenCashDate, remittanceCashNotice } from "./cashNotice";

export type RemittanceSection = "envios" | "recibos" | "caja" | "reportes";
type Tab = RemittanceSection;
const allSections: readonly RemittanceSection[] = ["envios", "recibos", "caja", "reportes"];
// Every window of the workspace announces a saved operation; the others reload what they show.
export const REMITTANCES_CHANGED_EVENT = "cyp-remittances-changed";
const cashPlace = "Reportes & Monitoreo → Cuadres Diarios → Caja de envíos";
const tabPermission: Record<Tab, RemittancePermission> = { envios: "remittances.view", recibos: "remittances.receipts", caja: "remittances.cash.view", reportes: "remittances.reports" };
// A phone matches however it was typed: with spaces, dashes, parentheses or country code.
const digitsOf = (value: string) => value.replace(/\D/g, "");
// Text matches without regard to case or accents: "maria" finds "María".
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
type Actor = { id: string; name: string; role?: string; access?: EffectiveAccess };
type Confirmation = { title: string; path: string; body: Record<string, unknown>; description: ReactNode; kind: "create" | "pay" | "cancel" | "open" | "close"; idempotencyKey?: string; expectedQuotation?: Quotation };
// Only in-memory: retain an uncertain action across route changes and same-actor login.
// Keyed by actor and sections, so one window does not show the uncertain action of another.
const pendingByActor = new Map<string, Confirmation>();
// These domain errors are produced only after the server's idempotency lookup.
// VALIDATION comes before it, for a body that could never have been saved: the same body cannot succeed on a retry.
const definitiveDomainErrors = new Set(["QUOTE_CHANGED", "COMMISSION_POLICY_MISMATCH", "CASH_NOT_OPEN", "RATE_MISSING", "RATE_DATE", "DOP_RATE", "CASH_EXISTS", "PREVIOUS_CASH_OPEN", "CASH_CLOSED", "CASH_UNBALANCED", "CASH_NOT_FOUND", "CLIENT_INACTIVE", "CLIENT_NOT_FOUND", "CLIENT_ALREADY_EXISTS", "CLIENT_INACTIVE_EXISTS", "CLIENT_OTHER_ROUTE", "ROUTE_NOT_FOUND", "SAME_CLIENT", "TRANSFER_NOT_PENDING", "TRANSFER_NOT_FOUND", "INSUFFICIENT_CASH", "SEQUENCE_EXHAUSTED", "MONEY_RANGE", "INVALID_AMOUNT", "INVALID_RATE", "INVALID_CURRENCY", "INVALID_COMMISSION", "INVALID_AMOUNT_MODE", "COMMISSION_EXCEEDS_TOTAL", "AMOUNT_TOO_SMALL", "REASON_REQUIRED", "VALIDATION"]);
type Draft = { senderClientId: string; recipientClientId: string; sendingUserId: string; sourceCurrency: Currency; destinationCurrency: Currency; amount: string; amountMode: "source" | "destination"; note: string };
const statusText = { pending: "Pendiente de entrega", paid: "Pagado", cancelled: "Cancelado" };
const tabs: { id: Tab; label: string }[] = [{ id: "envios", label: "Envíos" }, { id: "recibos", label: "Recibos" }, { id: "caja", label: "Caja" }, { id: "reportes", label: "Reportes" }];
const money = formatMoney;
const moneyInputLength = 17;

function QuoteDetails({ quote }: { quote: Quotation }) {
  const crossRate = formatCrossRate(quote.quote.sourceRate, quote.quote.destinationRate);
  return <dl className="remittance-summary">
    <div><dt>Principal</dt><dd>{money(quote.amount, quote.sourceCurrency)}</dd></div>
    <div><dt>Equivalente del principal en DOP</dt><dd>{quote.amountDop === undefined ? "No disponible para esta operación" : money(quote.amountDop, "DOP")}</dd></div>
    <div><dt>Comisión ({quote.commissionBps / 100}%)</dt><dd>{money(quote.commissionAmount, quote.sourceCurrency)}</dd></div>
    <div className="remittance-total"><dt>Total que paga el remitente</dt><dd>{money(quote.totalAmount, quote.sourceCurrency)}</dd></div>
    <div className="remittance-total"><dt>Recibe el destinatario</dt><dd>{money(quote.receiveAmount, quote.destinationCurrency)}</dd></div>
    {quote.requestedReceiveAmount !== undefined && <div><dt>Destino solicitado</dt><dd>{money(quote.requestedReceiveAmount, quote.destinationCurrency)}{Boolean(quote.receiveRoundingDifference) && <small role="status"> El importe real difiere por redondeo: {money(quote.receiveRoundingDifference!, quote.destinationCurrency)}. Confirma el importe real antes de continuar.</small>}</dd></div>}
    {quote.commissionAllocation && allocationRows(quote.commissionAllocation, "status" in quote ? (quote as Transfer).status : undefined).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    <div><dt>Tasas del {quote.quote.date}</dt><dd>1 {quote.sourceCurrency} = {quote.quote.sourceRate} DOP<br />1 {quote.destinationCurrency} = {quote.quote.destinationRate} DOP</dd></div>
    <div><dt>Tasa de origen a destino</dt><dd>1 {quote.sourceCurrency} {crossRate.approximate ? "≈" : "="} {crossRate.text} {quote.destinationCurrency}{crossRate.approximate && <small> (tasa mostrada redondeada)</small>}</dd></div>
    <div><dt>Hora de cotización</dt><dd>{rateMoment(quote.quote.quotedAt)}</dd></div>
  </dl>;
}

function DataTable({ section, wide = false }: { section: OutputSection; wide?: boolean }) {
  return <div className="remittance-table-wrap"><table className={"remittance-table" + (wide ? " remittance-consolidated-table" : "")}><caption>{section.title}</caption><thead><tr>{section.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{section.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} data-label={section.columns[cellIndex]}>{cell}</td>)}</tr>)}{!section.rows.length && <tr><td colSpan={section.columns.length}>No hay resultados para esta consulta.</td></tr>}</tbody></table></div>;
}

function ContactDetails({ contact, label }: { contact: RemittanceContact; label: string }) {
  return <dl className="remittance-summary remittance-contact" aria-label={`Datos de contacto del ${label.toLocaleLowerCase()}`}>
    <div><dt>Teléfono</dt><dd>{contact.phone || "No registrado"}</dd></div>
    <div><dt>Celular</dt><dd>{contact.cellular || "No registrado"}</dd></div>
    <div><dt>Dirección</dt><dd>{contact.address || "No registrada"}</dd></div>
  </dl>;
}

export function ClientPicker({ api, side, senderId, label, clients, value, query, onQuery, onSelect, onCreate, contactState }: { api: StrictApi; side: ClientSide; senderId: string; label: string; clients: RemittanceClient[]; value: string; query: string; onQuery: (value: string) => void; onSelect: (client: RemittanceClient) => void; onCreate?: () => void; contactState?: ReturnType<typeof useClientContact> }) {
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
  const missingSnapshotClients = lookup?.query === query && lookup.ids.some((id) => !clients.some((client) => client.id === id));
  // Coming back to the chosen client changes nothing: its currencies and the quote stay.
  const choose = (client: RemittanceClient) => { if (client.id !== value) onSelect(client); setExpanded(false); setHighlight(-1); };
  const missingNotice = missingSnapshotClients && <p role="status">Hay clientes recientes que todavía no están en esta vista. Pulsa Actualizar antes de seleccionar o registrar otra ficha.</p>;
  return <div className="remittance-client-picker" data-client-side={side}>
    {/* While the search runs, fails or finds clients missing from this view, registering waits; the button keeps its place so the field does not move. */}
    {onCreate && !selected && <button type="button" className="remittance-client-create" disabled={lookupBusy || Boolean(lookupError) || missingSnapshotClients} onClick={() => { setExpanded(false); onCreate(); }}>Registrar cliente nuevo</button>}
    <div className="remittance-client-anchor">
    <label htmlFor={id}>{label}<input id={id} type="search" inputMode="text" autoComplete="off" value={query} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-options`} aria-activedescendant={expanded && visible[highlight] ? `${id}-${highlight}` : undefined} onFocus={() => { setExpanded(true); setHighlight(-1); }} onBlur={() => setExpanded(false)} onChange={(event) => { onQuery(event.target.value); setExpanded(true); setHighlight(-1); }} onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setExpanded(true); setHighlight((current) => Math.min(Math.max(current + (event.key === "ArrowDown" ? 1 : -1), 0), Math.max(visible.length - 1, 0))); }
      // Enter picks only a highlighted option, or the only match of a typed search when the view holds all of them.
      // With nothing typed or highlighted, Enter goes on to the next field.
      if (event.key === "Enter" && expanded && !event.shiftKey && (query.trim() || highlight >= 0)) {
        event.preventDefault();
        if (!lookupBusy && !lookupError && (highlight >= 0 || (visible.length === 1 && !lookup?.hasMore && !missingSnapshotClients))) {
          const candidate = visible[Math.max(highlight, 0)]; if (candidate) choose(candidate);
        } else if (visible.length && !missingSnapshotClients) setHighlight(0);
      }
      if (event.key === "Escape" && expanded) { event.preventDefault(); setExpanded(false); }
    }} maxLength={160} placeholder="Teléfono, código, identificación o nombre" /></label>
    {expanded && <div className="remittance-client-options" id={`${id}-options`} role="listbox" aria-label={`Clientes para ${label.toLocaleLowerCase()}`}>{missingNotice}{visible.map((client, index) => <button type="button" key={client.id} id={`${id}-${index}`} role="option" aria-selected={client.id === value} className={index === highlight ? "highlighted" : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(client)}>{clientLabel(client)}<small>Moneda habitual: {clientCurrency(client)}</small></button>)}{!visible.length && <p role="status">No hay clientes disponibles que coincidan.</p>}{matches.length > visible.length && <p>Escribe más caracteres para acotar los {matches.length} resultados.</p>}</div>}
    </div>
    {expanded && lookupBusy && <p role="status">Buscando contactos…</p>}
    {expanded && lookupError && <p role="alert">{lookupError}</p>}
    {/* With the list open the notice goes inside it, where the list cannot cover it. */}
    {!expanded && missingNotice}
    {expanded && lookup?.query === query && lookup.hasMore && <p role="status">Hay más coincidencias. Escribe más caracteres para acotar la búsqueda.</p>}
    <span className="remittance-client-selection" aria-live="polite">{selected ? `Seleccionado: ${clientLabel(selected)}` : "Selecciona un resultado para usar este cliente."}</span>
    {selected && contactState?.loading && <p className="remittance-help" role="status">Cargando teléfono y dirección…</p>}
    {selected && contactState?.error && <p className="remittance-error" role="alert">{contactState.error} Usa Actualizar para volver a cargar.</p>}
    {selected && contactState?.contact && <ContactDetails contact={contactState.contact} label={label} />}
  </div>;
}

// Last request to open the delivery list that was already applied. The request object
// outlives the window, so reopening the module later must not repeat an old search.
let appliedPayoutRequest = 0;

// sections: the parts this window shows; the collector terminal keeps all four.
// fixedForm: the sending window of Administración, with the form always open above its list.
// onOpenCash: opens the window where the box of envíos is opened and closed.
export default function RemittancesWorkspace({ api, user, isAdmin, initialTab = "envios", sections = allSections, heading = "Envíos de Dinero", fixedForm = false, onOpenCash, payoutRequest }: {
  api: StrictApi; user: Actor; isAdmin: boolean; initialTab?: Tab; sections?: readonly RemittanceSection[]; heading?: string; fixedForm?: boolean; onOpenCash?: () => void;
  /** @deprecated Ignored: the reports of envíos open from Reportes & Monitoreo → Reportes. */
  reportRequest?: number; payoutRequest?: { id: number; search: string };
}) {
  const sectionsKey = sections.join(",");
  const pendingKey = `${user.id}\n${sectionsKey}`;
  const sendsShown = sections.includes("envios"), payoutsShown = sections.includes("recibos"), cashShown = sections.includes("caja");
  const pendingPayout = payoutsShown && payoutRequest && payoutRequest.id > appliedPayoutRequest ? payoutRequest : undefined;
  const [tab, setTab] = useState<Tab>(pendingPayout ? "recibos" : sections.includes(initialTab) ? initialTab : sections[0] ?? initialTab);
  const [snapshot, setSnapshot] = useState<RemittanceSnapshot | null>(null);
  const [sent, setSent] = useState<Transfer[]>([]);
  const [received, setReceived] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outputError, setOutputError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState(pendingPayout?.search ?? "");
  const [status, setStatus] = useState("all");
  const [formOpen, setFormOpen] = useState(true);
  const [draft, setDraft] = useState<Draft>({ senderClientId: "", recipientClientId: "", sendingUserId: user.id, sourceCurrency: "DOP", destinationCurrency: "DOP", amount: "", amountMode: "source", note: "" });
  const [newClients, setNewClients] = useState<{ sender?: NewRemittanceClient; recipient?: NewRemittanceClient }>({});
  const [clientEditor, setClientEditor] = useState<ClientSide | null>(null);
  const senderStoredContact = useClientContact(api, formOpen ? draft.senderClientId : "", "sender", "", snapshot);
  const recipientStoredContact = useClientContact(api, formOpen ? draft.recipientClientId : "", "recipient", draft.senderClientId, snapshot);
  const draftContact = (side: ClientSide): RemittanceContact | undefined => newClients[side] ? { ...newClients[side]!, id: `new-${side}`, code: "Se asignará al guardar", cellular: "" } : undefined;
  const senderContact = newClients.sender ? { contact: draftContact("sender"), loading: false, error: undefined } : senderStoredContact;
  const recipientContact = newClients.recipient ? { contact: draftContact("recipient"), loading: false, error: undefined } : recipientStoredContact;
  // Phone of the recipient: it starts with the one of the client record and can be typed or corrected.
  const knownRecipientPhone = recipientContact.contact ? recipientContact.contact.phone || recipientContact.contact.cellular || "" : "";
  const [recipientPhone, setRecipientPhone] = useState("");
  // What the user typed wins: the record refills the field only while it is untouched for this recipient.
  const recipientPhoneTyped = useRef(false);
  useEffect(() => { recipientPhoneTyped.current = false; }, [draft.recipientClientId]);
  useEffect(() => { if (!recipientPhoneTyped.current) setRecipientPhone(knownRecipientPhone); }, [draft.recipientClientId, knownRecipientPhone]);
  const [senderSearch, setSenderSearch] = useState("");
  const [recipientSearch, setRecipientSearch] = useState("");
  const [quote, setQuote] = useState<Quotation | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(() => pendingByActor.get(pendingKey) ?? null);
  const [uncertain, setUncertain] = useState(() => pendingByActor.has(pendingKey));
  const [confirmationError, setConfirmationError] = useState("");
  const [printTransfer, setPrintTransfer] = useState<Transfer | null>(null);
  const [receiptPrintError, setReceiptPrintError] = useState("");
  const [opening, setOpening] = useState({ operatorId: user.id, currency: "DOP" as Currency, amount: "0" });
  const [closing, setClosing] = useState<Cash | null>(null);
  const [counted, setCounted] = useState("");
  const [reportFilters, setReportFilters] = useState<RemittanceReportFilters>({ ...currentOperationalWeek(), grouping: "range", type: "amounts",
    groupBy: "managerCurrency" as CommissionReportGroupBy, operationStatus: "all" as CommissionReportStatus, managerId: "", currency: "" as Currency | "" });
  const [report, setReport] = useState<Report | null>(null);
  const [allocationReport, setAllocationReport] = useState<ConsolidatedCommissionReport | null>(null);
  const mutationLock = useRef(false);
  const quoteLock = useRef(false);
  const quoteRequests = useRef(new LatestRequestGate());
  const reportRequests = useRef(new LatestRequestGate());
  const refreshRequests = useRef(new LatestRequestGate());
  const working = busy || quoteBusy || reportBusy;
  const root = useRef<HTMLElement>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const lastFocus = useRef("");
  const actor = { role: user.role ?? (isAdmin ? "admin" : "collector"), access: user.access && user.access.revision > (snapshot?.access?.revision ?? -1) ? user.access : snapshot?.access ?? user.access };
  const can = (permission: RemittancePermission) => hasRemittancePermission(actor, permission);
  const permittedTabs = tabs.filter(({ id }) => sections.includes(id) && can(tabPermission[id]));
  // What is drawn: the chosen section while it is allowed, otherwise the first allowed one (none: a notice).
  const view = permittedTabs.some(({ id }) => id === tab) ? tab : permittedTabs[0]?.id;
  // Administración opens the box of a cashier only to that cashier; an administrator opens any.
  const canOpenCash = can("remittances.cash.open") && (isAdmin || accessRole(actor.role) === "cashier");
  const canOpenCashOf = (operatorId: string) => canOpenCash && (isAdmin || operatorId === user.id);
  useEffect(() => {
    if (snapshot && !permittedTabs.some(({ id }) => id === tab) && permittedTabs[0]) setTab(permittedTabs[0].id);
  }, [snapshot, tab, permittedTabs.map(({ id }) => id).join(",")]);
  useEffect(() => {
    const marker = `${tab}:${focusVersion}`;
    if (!snapshot || loading || busy || confirmation || printTransfer || clientEditor || detailId || marker === lastFocus.current) return;
    const field = tab === "envios" ? root.current?.querySelector<HTMLInputElement>('[data-client-side="sender"] input')
      : tab === "recibos" ? root.current?.querySelector<HTMLInputElement>('[data-receipt-search]') : null;
    if (field) { lastFocus.current = marker; field.focus(); }
  }, [tab, focusVersion, snapshot, loading, busy, confirmation, printTransfer, clientEditor, detailId]);
  // The fixed form scrolls inside its window: a new quote brings its confirm button into view.
  useEffect(() => {
    if (fixedForm && quote) root.current?.querySelector<HTMLElement>(".remittance-quote .remittance-primary")?.scrollIntoView({ block: "nearest" });
  }, [fixedForm, quote]);

  const retireQuote = useCallback(() => { quoteRequests.current.invalidate(); quoteLock.current = false; setQuoteBusy(false); setQuote(null); }, []);
  const changeTab = useCallback((next: Tab) => { retireQuote(); reportRequests.current.invalidate(); setReportBusy(false); setTab(next); setError(""); setOutputError(""); }, [retireQuote]);
  // Coming from "Entregas de Dinero": show the transfers to deliver, already filtered.
  // Only a window with Recibos takes the request; another one leaves it for that window.
  useEffect(() => {
    if (!payoutsShown || !payoutRequest || payoutRequest.id <= appliedPayoutRequest) return;
    appliedPayoutRequest = payoutRequest.id;
    changeTab("recibos"); setSearch(payoutRequest.search); setStatus("pending");
  }, [payoutRequest, payoutsShown, changeTab]);

  const refresh = useCallback(async () => {
    const request = refreshRequests.current.begin();
    setLoading(true); setError(""); setOutputError("");
    try {
      const data = await api<RemittanceSnapshot>("/envios/snapshot");
      const accessActor = { role: user.role ?? (isAdmin ? "admin" : "collector"), access: data.access ?? user.access };
      // Only the lists this window shows.
      const [outgoing, incoming] = await Promise.all([
        sendsShown && hasRemittancePermission(accessActor, "remittances.view") ? api<Transfer[]>("/envios") : Promise.resolve([]),
        payoutsShown && hasRemittancePermission(accessActor, "remittances.receipts") ? api<Transfer[]>("/envios/recibos") : Promise.resolve([]),
      ]);
      if (!refreshRequests.current.accepts(request)) return;
      retireQuote();
      setSnapshot(data); setSent(outgoing); setReceived(incoming);
    } catch (failure) { if (refreshRequests.current.accepts(request)) setError(failure instanceof Error ? failure.message : "No pudimos cargar los envíos."); }
    finally { if (refreshRequests.current.accepts(request)) setLoading(false); }
  }, [api, retireQuote, user.id, user.role, user.access?.revision, isAdmin, sendsShown, payoutsShown]);
  useEffect(() => { void refresh(); return () => { refreshRequests.current.invalidate(); quoteRequests.current.invalidate(); reportRequests.current.invalidate(); }; }, [refresh]);
  // Only the rates are read: the lists and a quote in progress are left untouched.
  const refreshRates = useCallback(async () => {
    try {
      const data = await api<RemittanceSnapshot>("/envios/snapshot");
      setSnapshot((current) => current ? { ...current, rates: data.rates, rateHistory: data.rateHistory } : current);
    } catch { /* The "Actualizar" button reports a failed read. */ }
  }, [api]);
  // Administración announces a saved rate; the view shows it without leaving the tab.
  // A transfer, payment or box saved in another window (Envíos, Pagos, Caja) reloads this one.
  const instanceId = useId();
  useEffect(() => {
    const onRates = () => { void refreshRates(); };
    const onPolicy = () => { void refresh(); };
    const onChanged = (event: Event) => { if ((event as CustomEvent<{ source?: string }>).detail?.source !== instanceId) void refresh(); };
    window.addEventListener("cyp-exchange-rates-updated", onRates);
    window.addEventListener("cyp-remittance-commissions-updated", onPolicy);
    window.addEventListener(REMITTANCES_CHANGED_EVENT, onChanged);
    return () => { window.removeEventListener("cyp-exchange-rates-updated", onRates); window.removeEventListener("cyp-remittance-commissions-updated", onPolicy); window.removeEventListener(REMITTANCES_CHANGED_EVENT, onChanged); };
  }, [refreshRates, refresh, instanceId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (uncertain || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uncertain, busy]);

  const clientName = (id: string) => snapshot?.clients.find((client) => client.id === id)?.name ?? "Cliente";
  const operatorName = (id?: string) => snapshot?.operators.find((operator) => operator.id === id)?.name ?? (id === user.id ? user.name : id || "—");
  const detail = snapshot?.transfers.find((transfer) => transfer.id === detailId);
  // Only an administrator chooses the operator of a box; anyone else opens their own.
  const openingOperator = isAdmin ? opening.operatorId : user.id;
  const clearErrors = () => { setError(""); setOutputError(""); };
  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (typeof value === "string") {
      if (key === "amount" && !isDecimalDraft(value)) return;
    }
    setDraft((current) => ({ ...current, [key]: value })); retireQuote(); clearErrors();
  };
  const chooseClient = (side: ClientSide, client: RemittanceClient) => {
    setNewClients((current) => ({ ...current, [side]: undefined }));
    setDraft((current) => selectRemittanceClient(current, side, client));
    if (side === "sender") { setSenderSearch(clientLabel(client)); if (draft.recipientClientId === client.id) setRecipientSearch(""); }
    else setRecipientSearch(clientLabel(client));
    retireQuote(); clearErrors();
    window.requestAnimationFrame(() => root.current?.querySelector<HTMLSelectElement>(`[data-client-side="${side}"] + label select`)?.focus());
  };
  const resetForm = () => {
    retireQuote(); setFormOpen(true); clearErrors(); setNewClients({}); setSenderSearch(""); setRecipientSearch("");
    setDraft({ senderClientId: "", recipientClientId: "", sendingUserId: user.id, sourceCurrency: "DOP", destinationCurrency: "DOP", amount: "", amountMode: "source", note: "" });
    recipientPhoneTyped.current = false; setRecipientPhone(""); setFocusVersion((value) => value + 1);
  };
  const updateReportFilter = (values: Partial<typeof reportFilters>) => { reportRequests.current.invalidate(); setReportBusy(false); setReportFilters((current) => ({ ...current, ...values })); setReport(null); setAllocationReport(null); setOutputError(""); };
  const confirm = (action: Confirmation) => { setConfirmation({ ...action, idempotencyKey: operationKey() }); setConfirmationError(""); setUncertain(false); setNotice(""); };
  const failureMessage = (failure: unknown) => failure instanceof Error ? failure.message : "No pudimos completar la operación.";
  const runOutput = (action: () => void) => { try { action(); setOutputError(""); } catch (failure) { setOutputError(failureMessage(failure)); } };
  const closePrintPrompt = () => { setPrintTransfer(null); setReceiptPrintError(""); setFocusVersion((value) => value + 1); };
  const printSavedReceipt = () => {
    if (!printTransfer) return;
    try { printSections(`Comprobante ${printTransfer.envioReference}`, transferOutput(printTransfer, true), "CyP · Envíos de Dinero", { footerNote: snapshot?.receiptFooterNote }); closePrintPrompt(); }
    catch (failure) { setReceiptPrintError(failureMessage(failure)); }
  };
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
    pendingByActor.set(pendingKey, confirmation);
    try {
      const result = await api<Transfer>(confirmation.path, { method: "POST", headers: { "Idempotency-Key": confirmation.idempotencyKey! }, body: JSON.stringify(confirmation.body) });
      const savedTransfer = confirmation.kind === "create" ? confirmedCreatedTransfer(result, confirmation.body, user.id, confirmation.expectedQuotation) : null;
      pendingByActor.delete(pendingKey);
      window.dispatchEvent(new CustomEvent(REMITTANCES_CHANGED_EVENT, { detail: { source: instanceId, kind: confirmation.kind } }));
      setNotice("Operación registrada correctamente.");
      // The phone typed for this transfer is not carried to the next one.
      if (confirmation.kind === "create") resetForm();
      if (confirmation.kind === "close") { setClosing(null); setCounted(""); }
      if (confirmation.kind === "cancel") setCancelReason("");
      setConfirmation(null); setUncertain(false); setReport(null); setAllocationReport(null);
      if (savedTransfer) { setPrintTransfer(savedTransfer); setReceiptPrintError(""); }
      await refresh();
    } catch (failure) {
      // An answer 200 that does not match what was sent: the API finished this operation and a retry repeats the
      // same answer. The window is not locked, its data are not offered again and the list shows what was saved.
      if (failure instanceof StrictApiError && failure.code === "REMITTANCE_CONFIRMATION_INVALID") {
        pendingByActor.delete(pendingKey);
        window.dispatchEvent(new CustomEvent(REMITTANCES_CHANGED_EVENT, { detail: { source: instanceId, kind: confirmation.kind } }));
        resetForm(); setConfirmation(null); setUncertain(false);
        await refresh(); setError(failure.message);
        return;
      }
      setConfirmationError(failureMessage(failure));
      const definitive = failure instanceof StrictApiError && definitiveDomainErrors.has(failure.code ?? "");
      // A refusal (403) comes before the API looks the operation up, so every retry is refused again: the window is
      // unlocked and, after an uncertain attempt, asks to check the list before repeating it.
      const refused = failure instanceof StrictApiError && failure.status === 403;
      const unresolved = !definitive && !refused && (uncertain || (failure instanceof StrictApiError && failure.uncertain));
      if (refused && uncertain) { setConfirmationError(`${failureMessage(failure)} No pudimos confirmar si el intento anterior quedó registrado: revisa el listado antes de repetirlo.`); void refresh(); }
      setUncertain(unresolved);
      if (!unresolved) pendingByActor.delete(pendingKey);
      if (failure instanceof StrictApiError && ["QUOTE_CHANGED", "COMMISSION_POLICY_MISMATCH"].includes(failure.code ?? "")) setQuote(null);
    } finally { mutationLock.current = false; setBusy(false); }
  }

  async function requestQuote(event: FormEvent) {
    event.preventDefault();
    if (quoteLock.current || mutationLock.current || !snapshot) return;
    const request = quoteRequests.current.begin();
    quoteLock.current = true; clearErrors(); setQuote(null); setQuoteBusy(true);
    try {
      if ((!draft.senderClientId && !newClients.sender) || (!draft.recipientClientId && !newClients.recipient) || (draft.senderClientId && draft.senderClientId === draft.recipientClientId)) throw new Error("Selecciona un remitente y un destinatario distintos.");
      if ((draft.senderClientId && !eligibleClients(snapshot.clients, "sender", draft.senderClientId).some((client) => client.id === draft.senderClientId)) || (draft.recipientClientId && !eligibleClients(snapshot.clients, "recipient", draft.senderClientId).some((client) => client.id === draft.recipientClientId))) throw new Error("El cliente seleccionado ya no está disponible. Selecciónalo de nuevo.");
      if (!isDecimalDraft(draft.amount)) throw new Error("Revisa el importe: admite hasta dos decimales.");
      const amount = decimalCents(draft.amount);
      const params = new URLSearchParams({ sourceCurrency: draft.sourceCurrency, destinationCurrency: draft.destinationCurrency, amount: String(amount), amountMode: draft.amountMode });
      const result = await api<Quotation>(`/envios/cotizacion?${params}`);
      if (quoteRequests.current.accepts(request)) setQuote(result);
    } catch (failure) { if (quoteRequests.current.accepts(request)) setError(failureMessage(failure)); }
    finally { if (quoteRequests.current.accepts(request)) { quoteLock.current = false; setQuoteBusy(false); } }
  }

  // A record created with this transfer: the review shows its document and route, which its contact does not carry.
  const newRecordDetails = (side: ClientSide, label: string) => {
    const client = newClients[side];
    return client && <dl className="remittance-summary" aria-label={`Ficha nueva del ${label.toLocaleLowerCase()}`}>
      <div><dt>Ficha nueva</dt><dd>Se registrará al confirmar el envío</dd></div>
      <div><dt>Cédula o pasaporte</dt><dd>{client.identification}</dd></div>
      <div><dt>Ruta</dt><dd>{snapshot?.clientRoutes?.find(({ id }) => id === client.routeId)?.name ?? client.routeId}</dd></div>
    </dl>;
  };

  function confirmCreate() {
    if (!quote) return;
    if (!senderContact.contact || !recipientContact.contact) { setError("Espera a que se carguen el teléfono y la dirección de ambos clientes. Si hubo un error, pulsa Actualizar y vuelve a cotizar."); return; }
    // A phone edited here is checked as typed, and sent only when its digits differ from the record's:
    // the same rule the server applies, so the saved copy matches what the confirmation expects.
    const editedRecipientPhone = recipientPhone.trim() !== knownRecipientPhone ? recipientPhone.trim() : "";
    const typedRecipientPhone = changedRecipientPhone(editedRecipientPhone, knownRecipientPhone);
    try {
      validateText(draft.note, "La nota", INPUT_LIMITS.freeNote, { multiline: true });
      validatePhone(editedRecipientPhone, "Teléfono del destinatario");
    }
    catch (failure) { setError(failureMessage(failure)); return; }
    setError("");
    confirm({ title: "Confirmar envío", path: "/envios", kind: "create", expectedQuotation: quote, body: {
      ...(newClients.sender ? { newSenderClient: newClients.sender } : { senderClientId: draft.senderClientId }),
      ...(newClients.recipient ? { newRecipientClient: newClients.recipient } : { recipientClientId: draft.recipientClientId }),
      ...(typedRecipientPhone ? { recipientPhone: typedRecipientPhone } : {}),
      ...(isAdmin ? { sendingUserId: draft.sendingUserId } : {}), sourceCurrency: quote.sourceCurrency, destinationCurrency: quote.destinationCurrency,
      amount: quote.amount, commissionBps: quote.commissionBps, quote: quote.quote, note: draft.note.trim(), ...(quote.requestedReceiveAmount === undefined ? {} : { requestedReceiveAmount: quote.requestedReceiveAmount }),
    }, description: <><p><strong>{senderContact.contact.name}</strong> envía a <strong>{recipientContact.contact.name}</strong>.</p><h3>Remitente</h3><ContactDetails contact={senderContact.contact} label="Remitente" />{newRecordDetails("sender", "Remitente")}<h3>Destinatario</h3><ContactDetails contact={recipientContact.contact} label="Destinatario" />{newRecordDetails("recipient", "Destinatario")}{typedRecipientPhone && <p><strong>Teléfono para este envío: {typedRecipientPhone}.</strong>{isAdmin && !recipientContact.contact.phone && digitsOf(typedRecipientPhone) !== digitsOf(recipientContact.contact.cellular) ? " También quedará guardado en la ficha del cliente, que no tiene teléfono." : " Sale en el comprobante; la ficha del cliente no cambia."}</p>}<p className="remittance-help">Datos actuales de las fichas de clientes. El comprobante conserva la copia guardada al registrar el envío.</p><QuoteDetails quote={quote} /><p>Operador: {operatorName(draft.sendingUserId)}. Registrado por: {user.name}.</p><p>Confirma después de recibir el total del remitente. La tasa queda guardada para este envío.</p></> });
  }

  function prepareOpening(event: FormEvent) {
    event.preventDefault();
    try {
      if (!isDecimalDraft(opening.amount)) throw new Error("El efectivo inicial admite hasta dos decimales.");
      const openingAmount = decimalCents(opening.amount, true);
      confirm({ title: "Abrir caja de envíos", path: "/envios/cajas/abrir", kind: "open", body: { operatorId: openingOperator, currency: opening.currency, openingAmount }, description: <p>Operador: <strong>{operatorName(openingOperator)}</strong><br />Fecha: {snapshot?.businessDate}<br />Efectivo inicial: <strong>{money(openingAmount, opening.currency)}</strong></p> });
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
      const path = remittanceReportPath(reportFilters);
      if (reportFilters.type === "allocations") {
        const result = await api<ConsolidatedCommissionReport>(path);
        if (reportRequests.current.accepts(request)) { setAllocationReport(result); setReport(null); }
        return;
      }
      const result = await api<Report>(path);
      if (reportRequests.current.accepts(request)) { setReport(result); setAllocationReport(null); }
    } catch (failure) { if (reportRequests.current.accepts(request)) setError(failureMessage(failure)); }
    finally { if (reportRequests.current.accepts(request)) setReportBusy(false); }
  }

  const transferOutput = (transfer: Transfer, receipt = false): OutputSection[] => [{ title: `${transfer.envioReference} · ${transfer.reciboReference}`, columns: ["Dato", "Valor"], rows: [
    ["Estado", statusText[transfer.status]], ["Referencia operativa", transfer.operatingCode], [transfer.senderContact ? "Remitente" : "Remitente (nombre actual en catálogo)", transfer.senderContact?.name ?? clientName(transfer.senderClientId)], [transfer.recipientContact ? "Destinatario" : "Destinatario (nombre actual en catálogo)", transfer.recipientContact?.name ?? clientName(transfer.recipientClientId)],
    ...contactRows(transfer),
    ...(receipt ? [] : allocationRows(transfer.commissionAllocation, transfer.status)),
    ...(!receipt && transfer.managerCommission ? managerCommissionRows(transfer.managerCommission) : []),
    ...(transfer.amountDop === undefined ? [] : [["Equivalente del principal en DOP", money(transfer.amountDop, "DOP")]]),
    ...(transfer.requestedReceiveAmount === undefined ? [] : [["Destino solicitado", money(transfer.requestedReceiveAmount, transfer.destinationCurrency)]]),
    ["Operador del envío", operatorName(transfer.sendingUserId)], ["Registrado por", operatorName(transfer.registeredBy)], ["Creado", formatDate(transfer.createdAt)],
    ["Monto a enviar", money(transfer.amount, transfer.sourceCurrency)], ...(!receipt ? [["Comisión", money(transfer.commissionAmount, transfer.sourceCurrency)]] : []), ["Total recibido del remitente", money(transfer.totalAmount, transfer.sourceCurrency)],
    ["Importe para destinatario", money(transfer.receiveAmount, transfer.destinationCurrency)], ["Tasa origen DOP/unidad", transfer.quote.sourceRate], ["Tasa destino DOP/unidad", transfer.quote.destinationRate], ...quoteHistoryRows(transfer.quote, transfer.sourceCurrency, transfer.destinationCurrency),
    ["Pagado", formatDate(transfer.paidAt)], ["Pagado por", operatorName(transfer.paidBy)], ["Cancelado", formatDate(transfer.cancelledAt)], ["Motivo cancelación", transfer.cancelReason || "—"], ["Nota", transfer.note || "—"],
  ] }];
  const reportSections = remittanceReportSections(reportFilters.type, report, allocationReport, operatorName);
  const displayedReport = allocationReport ?? report;
  const reportTitle = displayedReport ? remittanceReportTitle(reportFilters.type, displayedReport) : "Envíos";
  const reportManagers = [...new Map((snapshot?.transfers ?? []).flatMap((transfer) => transfer.commissionAllocation?.managerId ? [[transfer.commissionAllocation.managerId, { id: transfer.commissionAllocation.managerId, name: transfer.commissionAllocation.managerName ?? transfer.commissionAllocation.managerId }] as const] : [])).values()].sort((a, b) => a.name.localeCompare(b.name));
  // Text matches anywhere, without accents. A search made only of digits (four or more)
  // is also compared with the digits of phone, mobile, code and identification, in both
  // directions: "+509 3456 7890" finds a client saved as "3456-7890".
  const searchDigits = /^[\d\s()+.-]+$/.test(search) ? digitsOf(search) : "";
  const matchesSearch = (transfer: Transfer) => {
    const contacts = [transfer.senderContact, transfer.recipientContact].flatMap((contact) => contact ? [contact] : []);
    const texts = [transfer.envioReference, transfer.reciboReference, transfer.operatingCode, transfer.note, clientName(transfer.senderClientId), clientName(transfer.recipientClientId),
      ...contacts.flatMap((contact) => [contact.code, contact.name, contact.phone, contact.cellular, contact.address, contact.identification ?? ""])];
    if (fold(texts.join(" ")).includes(fold(search))) return true;
    if (searchDigits.length < 4) return false;
    return contacts.flatMap((contact) => [contact.code, contact.phone, contact.cellular, contact.identification ?? ""]).some((value) => {
      const stored = digitsOf(value ?? "");
      return stored.length > 0 && (stored.includes(searchDigits) || (stored.length >= 7 && searchDigits.endsWith(stored)));
    });
  };
  const list = (view === "recibos" ? received : sent).filter((transfer) => (status === "all" || transfer.status === status) && matchesSearch(transfer)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.sequence - a.sequence);
  // The sending window of Administración has no "Nuevo envío": its form is always open and has "Limpiar formulario".
  const toolbar = <div className="remittance-toolbar"><label>Buscar<input data-receipt-search={view === "recibos" || undefined} type="search" maxLength={INPUT_LIMITS.name} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Serie, teléfono, nombre, identificación, dirección o nota" title="El teléfono se encuentra aunque lo escribas sin guiones ni espacios." /></label><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos</option><option value="pending">Pendientes</option><option value="paid">Pagados</option><option value="cancelled">Cancelados</option></select></label>{view === "envios" && !fixedForm && can("remittances.create") && <button type="button" className="remittance-primary" disabled={working || uncertain} onClick={resetForm}>Nuevo envío</button>}</div>;
  const transferList = <>
    <p className="remittance-help">{view === "recibos" ? "Recibos por destino. Abre un pendiente para registrar su entrega completa." : "Envíos registrados por tu operación. Abre una referencia para consultar su detalle."}</p>
    <div className="remittance-table-wrap"><table className="remittance-table remittance-transfer-table"><caption>{view === "recibos" ? "Recepción de dinero" : "Listado de envíos"} · {list.length}</caption><thead><tr><th>Referencia</th><th>Fecha</th><th>Remitente → destinatario · teléfono</th><th>Total recibido</th><th>A entregar</th><th>Estado</th></tr></thead><tbody>{list.map((transfer) => <tr key={transfer.id} onDoubleClick={() => { setDetailId(transfer.id); setCancelReason(""); }}><td data-label="Referencia"><button type="button" className="remittance-link" onClick={() => { setDetailId(transfer.id); setCancelReason(""); }}>{view === "recibos" ? transfer.reciboReference : transfer.envioReference}</button><small>{transfer.operatingCode}</small></td><td data-label="Fecha">{formatDate(transfer.createdAt)}</td><td data-label="Clientes"><span className="remittance-client-cell">{transfer.senderContact?.name ?? clientName(transfer.senderClientId)}{transfer.senderContact?.phone || transfer.senderContact?.cellular ? <span className="remittance-client-phone"> · {transfer.senderContact.phone || transfer.senderContact.cellular}</span> : null}<br />→ {transfer.recipientContact?.name ?? clientName(transfer.recipientClientId)}{transfer.recipientContact?.phone || transfer.recipientContact?.cellular ? <span className="remittance-client-phone"> · {transfer.recipientContact.phone || transfer.recipientContact.cellular}</span> : null}</span></td><td data-label="Total recibido">{money(transfer.totalAmount, transfer.sourceCurrency)}</td><td data-label="A entregar">{money(transfer.receiveAmount, transfer.destinationCurrency)}</td><td data-label="Estado"><span className={`remittance-status ${transfer.status}`}>{statusText[transfer.status]}</span></td></tr>)}{!list.length && <tr><td colSpan={6}>No hay {view === "envios" ? "envíos" : "recibos"} para estos filtros.</td></tr>}</tbody></table></div>
  </>;
  // Warnings only: without a box open today the server refuses the operation (CASH_NOT_OPEN, PREVIOUS_CASH_OPEN).
  // A window that shows the box itself (the collector terminal) does not repeat them.
  const cashWarnings = !cashShown && can("remittances.cash.view");
  const sendCash = snapshot && cashWarnings && view === "envios" && formOpen && can("remittances.create") ? remittanceCashNotice(snapshot, draft.sendingUserId, draft.sourceCurrency) : "ok";
  const sendCashNotice = snapshot && sendCash !== "ok" && <div className="remittance-cash-warning" role="status">
    <p>{sendCash === "missing"
      ? `No hay caja de envíos abierta hoy en ${draft.sourceCurrency} para ${operatorName(draft.sendingUserId)}. Sin caja abierta no se puede registrar el envío. ${canOpenCashOf(draft.sendingUserId) ? "Ábrela" : "Un administrador debe abrirla"} en ${cashPlace}. Si ya está abierta, pulsa Actualizar.`
      : `La caja de envíos en ${draft.sourceCurrency} del ${previousOpenCashDate(snapshot, draft.sendingUserId, draft.sourceCurrency)} de ${operatorName(draft.sendingUserId)} sigue abierta: hay que cerrarla y abrir la de hoy en ${cashPlace}.`}</p>
    {onOpenCash && <button type="button" onClick={onOpenCash}>Ir a Caja de envíos</button>}
  </div>;
  // Paying takes the money from the box of whoever pays, in the destination currency.
  const payCash = snapshot && cashWarnings && payoutsShown && detail?.status === "pending" && detail.canPay && can("remittances.pay") ? remittanceCashNotice(snapshot, user.id, detail.destinationCurrency) : "ok";
  const payCashNotice = snapshot && detail && payCash !== "ok" && <div className="remittance-cash-warning" role="status">
    <p>{payCash === "missing"
      ? `No tienes caja de envíos abierta hoy en ${detail.destinationCurrency}. Sin caja abierta no se puede registrar el pago. ${canOpenCashOf(user.id) ? "Ábrela" : "Un administrador debe abrirla"} en ${cashPlace}.`
      : `Tu caja de envíos en ${detail.destinationCurrency} del ${previousOpenCashDate(snapshot, user.id, detail.destinationCurrency)} sigue abierta: hay que cerrarla y abrir la de hoy en ${cashPlace}.`}</p>
    {onOpenCash && <button type="button" onClick={() => { setDetailId(null); onOpenCash(); }}>Ir a Caja de envíos</button>}
  </div>;
  const openingCash = snapshot && canOpenCash ? remittanceCashNotice(snapshot, openingOperator, opening.currency) : "ok";
  // A transfer is registered only for an operator who can send; the boxes still list every operator.
  const sendingOperators = snapshot?.sendingOperatorIds ? snapshot.operators.filter(({ id }) => snapshot.sendingOperatorIds!.includes(id)) : snapshot?.operators ?? [];
  // Classes that only the compact layout of the sending window uses to place a field.
  const fixedPlace = (name: string) => fixedForm ? ` ${name}` : "";

  return <section ref={root} className={"remittances" + (fixedForm ? " remittances-fixed" : "")} aria-label={heading}>
    <header className="remittance-heading"><div><h1>{heading}</h1><p>{snapshot ? `Fecha de operación: ${snapshot.businessDate}` : "Conexión con la API"} · {user.name}</p></div><button type="button" onClick={() => void refresh()} disabled={loading || working}>{loading ? "Cargando…" : "Actualizar"}</button></header>
    {permittedTabs.length > 1 && <nav className="remittance-tabs" aria-label="Secciones de Envíos">{permittedTabs.map((item) => <button key={item.id} type="button" aria-current={view === item.id ? "page" : undefined} onClick={() => changeTab(item.id)}>{item.label}</button>)}</nav>}
    {error && <div className="remittance-error" role="alert">{error}</div>}
    {outputError && <div className="remittance-error" role="alert">{outputError}</div>}
    {notice && <div className="remittance-notice" role="status">{notice}</div>}
    {!snapshot ? <div className="remittance-empty">{loading ? "Cargando clientes, tasas y cajas…" : "No hay datos conectados. Actualiza para volver a intentar."}</div> : <>
      {sendsShown && (snapshot.commissionPolicy?.managerCommissionBps ?? 0) > (snapshot.commissionPolicy?.transactionCommissionBps ?? 0) && <p className="remittance-error" role="alert">La comisión total configurada no cubre el porcentaje del gestor. Un administrador debe revisar Administración → Comisiones de envíos antes de registrar nuevos envíos. Los recibos anteriores conservan sus importes.</p>}
      {!view && <div className="remittance-empty" role="status">No tienes permiso para usar esta ventana. Pide a un administrador que revise tus permisos de Envíos de Dinero.</div>}
      {(view === "envios" || view === "recibos") && <>
        {!fixedForm && toolbar}
        {sendCashNotice}
        {view === "envios" && formOpen && can("remittances.create") && <form onKeyDown={advanceCaptureField} className={"remittance-panel" + fixedPlace("remittance-send-form")} onSubmit={(event) => void requestQuote(event)}>
          <h2>Nuevo envío</h2><fieldset disabled={working || uncertain} className="remittance-form-grid">
            <div className="remittance-party-fields" role="group" aria-label="Datos del remitente">
              {newClients.sender ? <div data-client-side="sender"><strong>Nuevo remitente: {newClients.sender.name}</strong><ContactDetails contact={senderContact.contact!} label="Remitente" /><button type="button" onClick={() => setClientEditor("sender")}>Modificar datos del nuevo remitente</button><button type="button" onClick={() => { setNewClients((current) => ({ ...current, sender: undefined })); retireQuote(); setFocusVersion((value) => value + 1); }}>Elegir remitente registrado</button></div> : <ClientPicker api={api} side="sender" senderId="" label="Remitente" clients={eligibleClients(snapshot.clients, "sender", draft.senderClientId)} value={draft.senderClientId} query={senderSearch} onQuery={(value) => { setSenderSearch(value); updateDraft("senderClientId", ""); }} onSelect={(client) => chooseClient("sender", client)} onCreate={can("remittances.clients.create") && snapshot.clientRoutes?.length ? () => setClientEditor("sender") : undefined} contactState={senderContact} />}
              <label>Moneda del remitente<select value={draft.sourceCurrency} onChange={(event) => updateDraft("sourceCurrency", event.target.value as Currency)}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
              <label>Ingresar importe de<select value={draft.amountMode} onChange={(event) => { updateDraft("amountMode", event.target.value as Draft["amountMode"]); setDraft((current) => ({ ...current, amount: "" })); }}><option value="source">Origen · Monto a enviar</option><option value="destination">Destino · Monto a recibir</option></select></label>
              <label>{draft.amountMode === "source" ? `Monto a enviar (${draft.sourceCurrency})` : `Monto a recibir (${draft.destinationCurrency})`}<input required inputMode="decimal" maxLength={moneyInputLength} value={draft.amount} onChange={(event) => updateDraft("amount", event.target.value)} placeholder="0.00" /></label>
              <label>Equivalente del principal en DOP<input readOnly value={quote?.amountDop === undefined ? (quote ? "Fuera de rango de visualización" : "Calcula la cotización") : money(quote.amountDop, "DOP")} /></label>
              <label>{draft.amountMode === "source" ? `Monto a recibir calculado (${draft.destinationCurrency})` : `Monto a enviar calculado (${draft.sourceCurrency})`}<input readOnly value={quote ? money(draft.amountMode === "source" ? quote.receiveAmount : quote.amount, draft.amountMode === "source" ? draft.destinationCurrency : draft.sourceCurrency) : "Calcula la cotización"} /></label>
              <label>Comisión (%)<input aria-label="Comisión (%)" readOnly value={String((quote?.commissionBps ?? snapshot.commissionPolicy?.transactionCommissionBps ?? 0) / 100)} /><small>Se aplica automáticamente desde la configuración de comisiones.</small></label>
            </div>
            <div className="remittance-party-fields" role="group" aria-label="Datos del destinatario">
              {newClients.recipient ? <div data-client-side="recipient"><strong>Nuevo destinatario: {newClients.recipient.name}</strong><ContactDetails contact={recipientContact.contact!} label="Destinatario" /><button type="button" onClick={() => setClientEditor("recipient")}>Modificar datos del nuevo destinatario</button><button type="button" onClick={() => { setNewClients((current) => ({ ...current, recipient: undefined })); retireQuote(); }}>Elegir destinatario registrado</button></div> : <ClientPicker api={api} side="recipient" senderId={draft.senderClientId} label="Destinatario" clients={eligibleClients(snapshot.clients, "recipient", draft.senderClientId)} value={draft.recipientClientId} query={recipientSearch} onQuery={(value) => { setRecipientSearch(value); updateDraft("recipientClientId", ""); }} onSelect={(client) => chooseClient("recipient", client)} onCreate={can("remittances.clients.create") && snapshot.clientRoutes?.length ? () => setClientEditor("recipient") : undefined} contactState={recipientContact} />}
              <label className="remittance-phone-field">Teléfono del destinatario<input type="tel" inputMode="tel" autoComplete="off" maxLength={INPUT_LIMITS.phone} value={recipientPhone} disabled={!draft.recipientClientId && !newClients.recipient} onChange={(event) => { recipientPhoneTyped.current = true; setRecipientPhone(event.target.value); setError(""); }} placeholder="Escríbelo si no aparece" /></label>
              {recipientContact.contact && !knownRecipientPhone && !recipientPhone.trim() && <p className="remittance-client-warning" role="status">Este destinatario no tiene teléfono registrado. Escríbelo en «Teléfono del destinatario» para poder ubicarlo.</p>}
              <label>Moneda del destinatario<select value={draft.destinationCurrency} onChange={(event) => updateDraft("destinationCurrency", event.target.value as Currency)}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            </div>
            {isAdmin && <label className={"remittance-wide" + fixedPlace("remittance-operator-field")}>Operador del envío<select required value={draft.sendingUserId} onChange={(event) => updateDraft("sendingUserId", event.target.value)}>{sendingOperators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label>}
            <p className={"remittance-help remittance-wide" + fixedPlace("remittance-manager-help")}>Gestor: {operatorName(draft.sendingUserId)}. Reparto automático: {snapshot.commissionPolicy?.managerCommissionBps ? snapshot.commissionPolicy.managerCommissionBps / 100 : 0}% del importe final de destino. La comisión se divide entre empresa y gestor; no se cobra un cargo adicional por el reparto.</p>
            <label className={"remittance-wide" + fixedPlace("remittance-note-field")}>Nota (opcional)<textarea maxLength={INPUT_LIMITS.freeNote} rows={fixedForm ? 1 : 2} value={draft.note} onChange={(event) => updateDraft("note", event.target.value)} /></label>
          </fieldset><p className="remittance-help">Selecciona cada cliente para cargar su moneda habitual; después puedes ajustar cada moneda por separado. La comisión se suma al principal. Se necesita una caja abierta del operador en la moneda de origen.</p>
          {fixedForm ? <div className="remittance-form-actions">
            <button disabled={working || uncertain} type="submit">{quoteBusy ? "Cotizando…" : "Calcular cotización"}</button>
            <button type="button" disabled={working || uncertain} onClick={resetForm}>Limpiar formulario</button>
          </div> : <button disabled={working || uncertain} type="submit">{quoteBusy ? "Cotizando…" : "Calcular cotización"}</button>}
          {quote && <div className="remittance-quote"><QuoteDetails quote={quote} /><button type="button" className="remittance-primary" disabled={working || uncertain} onClick={confirmCreate}>Revisar y confirmar envío</button></div>}
        </form>}
        {fixedForm ? <div className="remittance-list-area">{toolbar}{transferList}</div> : transferList}
      </>}
      {view === "caja" && <>
        <p className="remittance-help">Caja exclusiva de envíos. Saldo = apertura + ingresos de envíos − devoluciones − pagos. Cada moneda se cuenta por separado.</p>
        {canOpenCash && <form className="remittance-panel" onSubmit={prepareOpening}><h2>Abrir caja del {snapshot.businessDate}</h2><fieldset disabled={busy} className="remittance-form-grid">{isAdmin ? <label>Operador<select required value={opening.operatorId} onChange={(event) => setOpening((current) => ({ ...current, operatorId: event.target.value }))}>{snapshot.operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label> : <label>Operador<input readOnly value={operatorName(user.id)} /></label>}<label>Moneda<select value={opening.currency} onChange={(event) => setOpening((current) => ({ ...current, currency: event.target.value as Currency }))}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><label>Efectivo inicial<input required inputMode="decimal" maxLength={moneyInputLength} value={opening.amount} onChange={(event) => { if (isDecimalDraft(event.target.value)) setOpening((current) => ({ ...current, amount: event.target.value })); }} /></label></fieldset>{openingCash === "previousOpen" && <p className="remittance-cash-warning" role="status">La caja de envíos en {opening.currency} del {previousOpenCashDate(snapshot, openingOperator, opening.currency)} de {operatorName(openingOperator)} sigue abierta. Ciérrala con «Contar y cerrar» antes de abrir la de hoy.</p>}<button className="remittance-primary" disabled={busy}>Revisar apertura</button></form>}
        <div className="remittance-cash-grid">{snapshot.cashSessions.map((cash) => <article className="remittance-panel" key={cash.id}><h2>{cash.currency} · {operatorName(cash.operatorId)}</h2><p>{cash.date} · {cash.status === "open" ? "Abierta" : "Cerrada"}</p><dl className="remittance-summary"><div><dt>Apertura</dt><dd>{money(cash.openingAmount, cash.currency)}</dd></div><div><dt>Ingresos por envíos</dt><dd>{money(cash.sentTotal, cash.currency)}</dd></div><div><dt>Devoluciones</dt><dd>{money(cash.cancelRefund, cash.currency)}</dd></div><div><dt>Pagos</dt><dd>{money(cash.paid, cash.currency)}</dd></div><div className="remittance-total"><dt>Efectivo esperado</dt><dd>{money(cash.expected, cash.currency)}</dd></div>{cash.countedAmount !== undefined && <div><dt>Contado al cierre</dt><dd>{money(cash.countedAmount, cash.currency)}</dd></div>}</dl>{cash.canClose && can("remittances.cash.close") && <button type="button" onClick={() => { setClosing(cash); setCounted(""); clearErrors(); }}>Contar y cerrar</button>}</article>)}{!snapshot.cashSessions.length && <div className="remittance-empty">{!canOpenCash ? "No hay cajas de envíos. Un administrador debe abrir la caja antes de operar." : isAdmin ? "No hay cajas de envíos. Abre la caja del operador antes de operar." : "No hay cajas de envíos. Abre tu caja antes de operar."}</div>}</div>
      </>}
      {view === "reportes" && <>
        <form className="remittance-panel" onSubmit={(event) => void loadReport(event)}><h2>Reportes de envíos</h2><fieldset disabled={working} className="remittance-form-grid"><label>Desde<input type="date" required value={reportFilters.from} onChange={(event) => updateReportFilter({ from: event.target.value })} /></label><label>Hasta<input type="date" required value={reportFilters.to} onChange={(event) => updateReportFilter({ to: event.target.value })} /></label><label>Presentación<select value={reportFilters.grouping} onChange={(event) => updateReportFilter({ grouping: event.target.value as "range" | "day" })}><option value="range">Resumido del rango</option><option value="day">Diario</option></select></label><label>Reporte<select value={reportFilters.type} onChange={(event) => updateReportFilter({ type: event.target.value as RemittanceReportType })}>{remittanceReportDefinitions.map((definition) => <option key={definition.type} value={definition.type}>{definition.label}</option>)}</select></label>
          {reportFilters.type === "allocations" && <>
            <label>Agrupar por<select aria-label="Agrupar por" value={reportFilters.groupBy} onChange={(event) => updateReportFilter({ groupBy: event.target.value as CommissionReportGroupBy })}><option value="managerCurrency">Gestor y Moneda</option><option value="currency">Moneda</option></select></label>
            <label>Estado de la operación<select aria-label="Estado de la operación" value={reportFilters.operationStatus} onChange={(event) => updateReportFilter({ operationStatus: event.target.value as CommissionReportStatus })}>{Object.entries(commissionReportStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Gestor<select aria-label="Gestor" value={reportFilters.managerId} onChange={(event) => updateReportFilter({ managerId: event.target.value })}><option value="">Todos</option>{reportManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name} · {manager.id}</option>)}</select></label>
            <label>Moneda de destino<select aria-label="Moneda de destino" value={reportFilters.currency} onChange={(event) => updateReportFilter({ currency: event.target.value as Currency | "" })}><option value="">Todas</option>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          </>}
        </fieldset><button className="remittance-primary" disabled={working}>{reportBusy ? "Consultando…" : "Consultar"}</button></form>
        {displayedReport && <><div className="remittance-toolbar"><strong>{reportTitle}</strong><button type="button" onClick={() => runOutput(() => printSections(reportTitle, reportSections))}>Imprimir</button><button type="button" onClick={() => runOutput(() => exportSections(`envios-${reportFilters.type}-${displayedReport.from}-${displayedReport.to}`, reportSections))}>Exportar CSV</button></div><p className="remittance-help">{remittanceReportDefinition(reportFilters.type).scope}</p>{reportSections.map((section) => <DataTable key={section.title} section={section} wide={Boolean(allocationReport) && section.columns.length > 2} />)}</>}
      </>}
    </>}
    {clientEditor && snapshot && <QuickClientDialog key={clientEditor} side={clientEditor} initial={newClients[clientEditor]} currency={clientEditor === "sender" ? draft.sourceCurrency : draft.destinationCurrency} routes={snapshot.clientRoutes ?? []} onClose={() => setClientEditor(null)} onUse={(client) => {
      const side = clientEditor;
      setNewClients((current) => ({ ...current, [side]: client }));
      setDraft((current) => ({ ...current, [side === "sender" ? "senderClientId" : "recipientClientId"]: "", [side === "sender" ? "sourceCurrency" : "destinationCurrency"]: client.preferredCurrency }));
      if (side === "recipient") { recipientPhoneTyped.current = false; setRecipientPhone(client.phone); }
      retireQuote(); clearErrors(); setClientEditor(null);
      window.requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(side === "sender" ? '[data-client-side="sender"] + label select' : '.remittance-phone-field input')?.focus());
    }} />}
    {detail && <Dialog title={`${detail.envioReference} · ${detail.reciboReference}`} onClose={() => { setDetailId(null); if (view === "recibos") setFocusVersion((value) => value + 1); }}>
      <p><span className={`remittance-status ${detail.status}`}>{statusText[detail.status]}</span> · {detail.operatingCode}</p><p><strong>{detail.senderContact?.name ?? clientName(detail.senderClientId)}</strong> → <strong>{detail.recipientContact?.name ?? clientName(detail.recipientClientId)}</strong></p><QuoteDetails quote={detail} /><p>Creado: {formatDate(detail.createdAt)}<br />Operador: {operatorName(detail.sendingUserId)}<br />Registrado por: {operatorName(detail.registeredBy)}</p>{detail.note && <p>Nota: {detail.note}</p>}
      <DataTable section={{ title: "Contactos guardados en esta operación", columns: ["Dato", "Valor"], rows: contactRows(detail) }} />
      {detail.managerCommission && <DataTable section={{ title: "Anotación histórica manual del gestor", columns: ["Dato", "Valor"], rows: managerCommissionRows(detail.managerCommission) }} />}
      {detail.paidAt && <p>Pagado: {formatDate(detail.paidAt)} · {operatorName(detail.paidBy)}</p>}{detail.cancelReason && <p>Cancelado: {formatDate(detail.cancelledAt)}. Motivo: {detail.cancelReason}</p>}
      {payCashNotice}
      <div className="remittance-actions"><button type="button" onClick={() => runOutput(() => printSections(`Comprobante ${detail.envioReference}`, transferOutput(detail, true), "CyP · Envíos de Dinero", { footerNote: snapshot?.receiptFooterNote }))}>Imprimir comprobante</button>{payoutsShown && detail.status === "pending" && detail.canPay && can("remittances.pay") && <button type="button" className="remittance-primary" onClick={() => confirm({ title: "Confirmar entrega al destinatario", path: `/envios/${encodeURIComponent(detail.id)}/pagar`, body: {}, kind: "pay", description: <p>Registrar entrega única de <strong>{money(detail.receiveAmount, detail.destinationCurrency)}</strong> a <strong>{detail.recipientContact?.name ?? clientName(detail.recipientClientId)}</strong>. Se descuenta de tu caja abierta de hoy. Confirma después de entregar el dinero.</p> })}>Registrar pago completo</button>}</div>
      {sendsShown && detail.status === "pending" && detail.canCancel && can("remittances.cancel") && <form className="remittance-cancel" onSubmit={prepareCancellation}><label>Motivo de cancelación<textarea required maxLength={INPUT_LIMITS.freeNote} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label><button className="remittance-danger" type="submit" disabled={!cancelReason.trim()}>Revisar cancelación</button></form>}
    </Dialog>}
    {closing && <Dialog title={`Contar caja ${closing.currency}`} onClose={() => setClosing(null)}><form onSubmit={prepareClosing}><p>{operatorName(closing.operatorId)} · {closing.date}</p><p>Esperado: <strong>{money(closing.expected, closing.currency)}</strong></p><label>Efectivo contado<input data-autofocus required inputMode="decimal" maxLength={moneyInputLength} value={counted} onChange={(event) => { if (isDecimalDraft(event.target.value)) setCounted(event.target.value); }} /></label>{error && <p role="alert" className="remittance-error">{error}</p>}<button className="remittance-primary" type="submit">Revisar cierre</button></form></Dialog>}
    {confirmation && <Dialog title={confirmation.title} onClose={() => setConfirmation(null)} locked={busy || uncertain}>{confirmation.description}{confirmationError && <p className="remittance-error" role="alert">{confirmationError}</p>}{uncertain && <p>No cambies los datos ni cierres esta ventana. El reintento usa la misma referencia de operación.</p>}<div className="remittance-actions"><button type="button" disabled={busy || uncertain} onClick={() => setConfirmation(null)}>Volver</button><button type="button" className={confirmation.kind === "cancel" ? "remittance-danger" : "remittance-primary"} disabled={busy} onClick={() => void submitConfirmation()}>{busy ? "Registrando…" : uncertain ? "Reintentar misma operación" : "Confirmar"}</button></div></Dialog>}
    {printTransfer && <Dialog title="¿Quieres imprimir el recibo?" onClose={closePrintPrompt}>
      <p>El envío <strong>{printTransfer.envioReference}</strong> quedó registrado correctamente. Recibo: <strong>{printTransfer.reciboReference}</strong>.</p>
      <p>Puedes imprimirlo ahora o más tarde desde el detalle del envío.</p>
      {receiptPrintError && <p className="remittance-error" role="alert">{receiptPrintError}</p>}
      <div className="remittance-actions"><button type="button" onClick={closePrintPrompt}>No imprimir</button><button type="button" className="remittance-primary" onClick={printSavedReceipt}>Imprimir</button></div>
    </Dialog>}
  </section>;
}
