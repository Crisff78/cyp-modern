import { MoneyInput } from "../MoneyInput";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { operationKey, StrictApiError, type StrictApi } from "./strictApi";
import type { Cash, CommissionReportGroupBy, CommissionReportStatus, ConsolidatedCommissionReport, Currency, NewRemittanceClient, Quotation, RemittanceContact, RemittanceSnapshot, Report, Transfer } from "./types";
import { decimalCents, exportSections, formatDate, formatMoney, printSections, type OutputSection } from "./output";
import { clientCurrency, clientLabel, eligibleClients, LatestRequestGate, matchingClients, selectRemittanceClient, type ClientSide, type RemittanceClient } from "./suggestions";
import "./remittances.css";
import { QuoteDetails } from "./QuoteDetails";
import { formatCrossRate } from "./crossRate";
import { quoteStillCurrent } from "./quoteRates";
import { INPUT_LIMITS, isPhoneDraft, isTextDraft, PHONE_INPUT_MESSAGE, validatePhone, validateText } from "../inputRules";
import { useClientContact } from "./useClientContact";
import { FiltersToggle } from "../FiltersToggle";
import { changedRecipientPhone, confirmedCreatedTransfer, recipientPhoneRecord } from "./createdTransferResponse";
import { commissionReportStatusLabels } from "./commissionOutput";
import { accessRole, hasRoleExceptions, hasRemittancePermission, type EffectiveAccess, type RemittancePermission } from "../access.mjs";
import { RemittanceDialog as Dialog } from "./RemittanceDialog";
import { RemittanceWindow } from "./RemittanceWindow";
import { QuickClientDialog } from "./QuickClientDialog";
import { restrictPaste } from "./fieldInput";
import { advanceCaptureField } from "./formKeyboard";
import { focusNextField } from "../keyboard";
import { currentOperationalWeek } from "../operationalWeek";
import { remittanceReportDefinitions, remittanceReportDefinition, remittanceReportPath, remittanceReportSections, remittanceReportTitle, type RemittanceReportFilters, type RemittanceReportType } from "./reporting";
import { previousOpenCashDate, remittanceCashNotice } from "./cashNotice";
import { remittanceOperatorName } from "./operatorNames";
import { PaymentFields, paymentDraftFor, paymentInput, type PaymentDraft } from "./PaymentFields";
import { isPaymentTextDraft, paymentMethodLabels, type RemittancePaymentInput } from "./payment.mjs";
import { isMoneyDraft, MONEY_INPUT_MESSAGE as moneyInputMessage } from "./moneyInput";
import { printRemittanceReceipt, remittanceReceipt } from "./receipt";
import { RemittanceReceipt } from "./RemittanceReceipt";

export type RemittanceSection = "envios" | "recibos" | "caja" | "reportes";
type Tab = RemittanceSection;
// The capture keeps its reports out: Administración opens them from Reportes & Monitoreo, the collector from its Reportes view.
const captureSections: readonly RemittanceSection[] = ["envios", "recibos", "caja"];
const reportsOnlySections: readonly RemittanceSection[] = ["reportes"];
// Every window of the workspace announces a saved operation; the others reload what they show.
export const REMITTANCES_CHANGED_EVENT = "cyp-remittances-changed";
const cashPlace = "Cuadres y reportes → Cuadres Diarios → Caja de remesas";
const tabPermission: Record<Tab, RemittancePermission> = { envios: "remittances.view", recibos: "remittances.receipts", caja: "remittances.cash.view", reportes: "remittances.reports" };
// A phone matches however it was typed: with spaces, dashes, parentheses or country code.
const digitsOf = (value: string) => value.replace(/\D/g, "");
// Text matches without regard to case or accents: "maria" finds "María".
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
/** A rate without the zeros at its end, to fit its box (display only: «58.500000» shows «58.5»). */
const shortRate = (rate: string) => rate.includes(".") ? rate.replace(/\.?0+$/, "") : rate;
/** The rate from the currency sent to the currency received, as the quote shows it (display only). */
const crossRateText = (quote: Quotation) => { try { const cross = formatCrossRate(quote.quote.sourceRate, quote.quote.destinationRate); return `1 ${quote.sourceCurrency} ${cross.approximate ? "≈" : "="} ${cross.text} ${quote.destinationCurrency}`; } catch { return "No disponible"; } };
type Actor = { id: string; name: string; role?: string; access?: EffectiveAccess };
type Confirmation = { title: string; path: string; body: Record<string, unknown>; description: ReactNode; kind: "create" | "pay" | "cancel" | "open" | "close"; idempotencyKey?: string; expectedQuotation?: Quotation };
// Only in-memory: retain an uncertain action across route changes and same-actor login.
// Keyed by actor and sections, so one window does not show the uncertain action of another.
const pendingByActor = new Map<string, Confirmation>();
// These domain errors are produced only after the server's idempotency lookup.
// VALIDATION comes before it, for a body that could never have been saved: the same body cannot succeed on a retry.
const definitiveDomainErrors = new Set(["QUOTE_CHANGED", "COMMISSION_POLICY_MISMATCH", "CASH_NOT_OPEN", "RATE_MISSING", "RATE_DATE", "DOP_RATE", "CASH_EXISTS", "PREVIOUS_CASH_OPEN", "CASH_CLOSED", "CASH_UNBALANCED", "CASH_NOT_FOUND", "CLIENT_INACTIVE", "CLIENT_NOT_FOUND", "CLIENT_ALREADY_EXISTS", "CLIENT_INACTIVE_EXISTS", "CLIENT_OTHER_ROUTE", "ROUTE_NOT_FOUND", "SAME_CLIENT", "TRANSFER_NOT_PENDING", "TRANSFER_NOT_FOUND", "INSUFFICIENT_CASH", "SEQUENCE_EXHAUSTED", "MONEY_RANGE", "INVALID_AMOUNT", "INVALID_RATE", "INVALID_CURRENCY", "INVALID_COMMISSION", "INVALID_AMOUNT_MODE", "COMMISSION_EXCEEDS_TOTAL", "AMOUNT_TOO_SMALL", "REASON_REQUIRED", "VALIDATION"]);
type Draft = { senderClientId: string; recipientClientId: string; sendingUserId: string; sourceCurrency: Currency; destinationCurrency: Currency; amount: string; amountMode: "source" | "destination"; note: string };
for (const code of ["INVALID_PAYMENT", "INSUFFICIENT_TENDERED", "PAYMENT_NOT_VERIFIED", "REFUND_NOT_VERIFIED"]) definitiveDomainErrors.add(code);
const statusText = { pending: "Pendiente de entrega", paid: "Pagado", cancelled: "Cancelado" };
const phoneRecordText = {
  newRecord: " También quedará guardado en la ficha nueva del destinatario, que no tiene teléfono.",
  existingRecord: " También quedará guardado en la ficha del cliente, que no tiene teléfono.",
  transferOnly: " Sale en el comprobante; la ficha del cliente no cambia.",
};
const tabs: { id: Tab; label: string }[] = [{ id: "envios", label: "Envíos" }, { id: "recibos", label: "Entregas" }, { id: "caja", label: "Caja" }, { id: "reportes", label: "Reportes" }];
const money = formatMoney;
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

// floating: the list of clients is drawn over the window instead of inside the form, which keeps its own scroll.
export function ClientPicker({ api, side, senderId, label, clients, value, query, onQuery, onSelect, onCreate, contactState, floating = false }: { api: StrictApi; side: ClientSide; senderId: string; label: string; clients: RemittanceClient[]; value: string; query: string; onQuery: (value: string) => void; onSelect: (client: RemittanceClient) => void; onCreate?: () => void; contactState?: ReturnType<typeof useClientContact>; floating?: boolean }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Under the field (above it when the window has more room there), as wide as the field and inside the window.
  // A fixed list may be placed by the window and not by the page, so the origin it really gets is measured first.
  const placeList = useCallback(() => {
    const anchor = anchorRef.current, list = listRef.current;
    if (!anchor || !list) return;
    for (const property of ["position", "top", "left", "right", "width", "max-height", "visibility"]) list.style.removeProperty(property);
    if (!floating || !window.matchMedia("(min-width: 701px)").matches) return;
    const field = anchor.getBoundingClientRect();
    Object.assign(list.style, { position: "fixed", top: "0px", left: "0px", right: "auto", width: `${field.width}px` });
    const origin = list.getBoundingClientRect();
    const frame = anchor.closest(".remittances")?.getBoundingClientRect(), form = anchor.closest("form")?.getBoundingClientRect();
    const below = (frame?.bottom ?? window.innerHeight) - field.bottom - 8, above = field.top - (frame?.top ?? 0) - 8;
    const wanted = Math.min(list.scrollHeight + 2, 220), down = below >= wanted || below >= above;
    const height = Math.max(Math.min(wanted, down ? below : above), 60);
    Object.assign(list.style, { maxHeight: `${height}px`, left: `${field.left - origin.left}px`,
      top: `${(down ? field.bottom + 4 : field.top - 4 - height) - origin.top}px`,
      // A field scrolled out of the form takes its list with it.
      visibility: form && (field.bottom < form.top || field.top > form.bottom) ? "hidden" : "" });
  }, [floating]);
  useLayoutEffect(() => { if (expanded) placeList(); });
  useEffect(() => {
    if (!floating || !expanded) return;
    window.addEventListener("resize", placeList); document.addEventListener("scroll", placeList, true);
    return () => { window.removeEventListener("resize", placeList); document.removeEventListener("scroll", placeList, true); };
  }, [floating, expanded, placeList]);
  const [highlight, setHighlight] = useState(-1);
  const [lookup, setLookup] = useState<{ query: string; ids: string[]; hasMore: boolean } | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [entryError, setEntryError] = useState("");
  const queryMessage = "La búsqueda admite hasta 160 caracteres en una sola línea, sin caracteres de control.";
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
    {/* While the search runs, fails or finds clients missing from this view, registering waits. The button keeps its
        place, hidden while a client is chosen, so the field never moves when the choice is made or edited. */}
    {onCreate && <button type="button" className={"remittance-client-create" + (selected ? " is-reserved" : "")} aria-hidden={selected ? true : undefined} tabIndex={selected ? -1 : undefined} disabled={Boolean(selected) || lookupBusy || Boolean(lookupError) || missingSnapshotClients} onClick={() => { setExpanded(false); onCreate(); }}>Registrar cliente nuevo</button>}
    <div className="remittance-client-anchor" ref={anchorRef}>
    <label htmlFor={id}>{label}<input id={id} type="search" inputMode="text" autoComplete="off" value={query} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-options`} aria-activedescendant={expanded && visible[highlight] ? `${id}-${highlight}` : undefined} onFocus={(event) => { if (event.currentTarget.dataset.quietFocus) { delete event.currentTarget.dataset.quietFocus; return; } setExpanded(true); setHighlight(-1); }} onClick={() => setExpanded(true)} onBlur={() => setExpanded(false)} title={queryMessage} aria-invalid={Boolean(entryError) || undefined} onPaste={(event) => restrictPaste(event, (value) => isTextDraft(value, 160), () => setEntryError(queryMessage))} onChange={(event) => { if (!isTextDraft(event.target.value, 160)) { setEntryError(queryMessage); return; } setEntryError(""); onQuery(event.target.value); setExpanded(true); setHighlight(-1); }} onKeyDown={(event) => {
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
    {expanded && <div ref={listRef} className="remittance-client-options" id={`${id}-options`} role="listbox" aria-label={`Clientes para ${label.toLocaleLowerCase()}`}>{missingNotice}{visible.map((client, index) => <button type="button" key={client.id} id={`${id}-${index}`} role="option" tabIndex={-1} aria-selected={client.id === value} className={index === highlight ? "highlighted" : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(client)}>{clientLabel(client)}<small>Moneda habitual: {clientCurrency(client)}</small></button>)}{!visible.length && <p role="status">No hay clientes disponibles que coincidan.</p>}{matches.length > visible.length && <p>Escribe más caracteres para acotar los {matches.length} resultados.</p>}</div>}
    </div>
    {expanded && lookupBusy && <p role="status">Buscando contactos…</p>}
    {expanded && lookupError && <p role="alert">{lookupError}</p>}
    {entryError && <p role="alert">{entryError}</p>}
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
// Same for the box asked from a notice: the operator and currency it named are prepared only once.
let appliedCashRequest = 0;
/** The box a notice asks for: the opening form starts with this operator and currency. */
export type RemittanceCashOpening = { operatorId: string; currency: Currency };

// sections: the parts this window shows; the collector terminal keeps Envíos, Recibos and Caja and opens its reports apart.
// reportsOnly: only the reports of envíos (the collector terminal's Reportes view).
// fixedForm: the sending window of Administración, with the form always open above its list.
// onOpenCash: opens the window where the box of envíos is opened and closed, for the box the notice names.
// cashRequest: in that window, the box asked from a notice of another one.
// desktopId and nextWindowZIndex: where the modeless receipt windows open and how they stack on the desktop.
export default function RemittancesWorkspace({ api, user, isAdmin, initialTab = "envios", sections: requestedSections = captureSections, reportsOnly = false, heading: requestedHeading, fixedForm = false, onOpenCash, desktopId, nextWindowZIndex, payoutRequest, cashRequest }: {
  api: StrictApi; user: Actor; isAdmin: boolean; initialTab?: Tab; sections?: readonly RemittanceSection[]; reportsOnly?: boolean; heading?: string; fixedForm?: boolean; onOpenCash?: (opening: RemittanceCashOpening) => void;
  desktopId?: string; nextWindowZIndex?: () => number;
  payoutRequest?: { id: number; search: string };
  cashRequest?: RemittanceCashOpening & { id: number };
}) {
  const sections = reportsOnly ? reportsOnlySections : requestedSections;
  const heading = requestedHeading ?? (reportsOnly ? "Reportes de remesas" : "Envíos de dinero");
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
  // «Entregas de dinero» opens on the receipts still to pay.
  const [status, setStatus] = useState(pendingPayout || (sections.length === 1 && sections[0] === "recibos") ? "pending" : "all");
  // The funnel shows and hides Buscar and Estado of the list, like the filters of every window (Rardiel, 28-10-2026).
  const [listFiltersShown, setListFiltersShown] = useState(true);
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
  // The quote arrives: the keyboard goes on to «Revisar y confirmar envío», the next step, when it was on the form.
  const reviewButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = reviewButton.current, active = document.activeElement;
    if (quote && button && (!active || active === document.body || active.closest("form") === button.closest("form"))) button.focus();
  }, [quote]);
  const [reportBusy, setReportBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Raised each time a reference is chosen: the receipt already open for it is restored and raised.
  const [detailReveal, setDetailReveal] = useState(0);
  // Cleared by «Ir a Caja de remesas»: the receipt it closes leaves the keyboard in Caja.
  const detailFocusReturn = useRef(true);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [refundReference, setRefundReference] = useState("");
  const [refundVerified, setRefundVerified] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>(() => {
    const pending = pendingByActor.get(pendingKey);
    return paymentDraftFor(pending?.expectedQuotation?.totalAmount ?? 0, pending?.body.payment as RemittancePaymentInput | undefined);
  });
  const [confirmation, setConfirmation] = useState<Confirmation | null>(() => pendingByActor.get(pendingKey) ?? null);
  const [uncertain, setUncertain] = useState(() => pendingByActor.has(pendingKey));
  const [confirmationError, setConfirmationError] = useState("");
  const [printTransfer, setPrintTransfer] = useState<Transfer | null>(null);
  const [receiptPrintError, setReceiptPrintError] = useState("");
  const pendingCash = cashShown && cashRequest && cashRequest.id > appliedCashRequest ? cashRequest : undefined;
  const [opening, setOpening] = useState({ operatorId: pendingCash?.operatorId ?? user.id, currency: pendingCash?.currency ?? "DOP" as Currency, amount: "0" });
  // The keyboard goes to the box asked from a notice (the receipt closed by «Ir a Caja de remesas» does not take it back).
  const cashFocus = useRef(false);
  const [closing, setClosing] = useState<Cash | null>(null);
  const [counted, setCounted] = useState("");
  const [moneyEntryErrors, setMoneyEntryErrors] = useState<Partial<Record<"amount" | "opening" | "counted", string>>>({});
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
  // Set by «Volver a la captura»: the cursor goes back to the sender without unfolding its catalog over the draft.
  const quietCapture = useRef(false);
  const actor = { role: user.role ?? (isAdmin ? "admin" : "collector"), access: user.access && user.access.revision > (snapshot?.access?.revision ?? -1) ? user.access : snapshot?.access ?? user.access };
  const can = (permission: RemittancePermission) => hasRemittancePermission(actor, permission);
  const permittedTabs = tabs.filter(({ id }) => sections.includes(id) && can(tabPermission[id]));
  // What is drawn: the chosen section while it is allowed, otherwise the first allowed one (none: a notice).
  const view = permittedTabs.some(({ id }) => id === tab) ? tab : permittedTabs[0]?.id;
  // Administración opens the box of a cashier only to that cashier; an administrator opens any.
  const canOpenCash = can("remittances.cash.open") && (isAdmin || accessRole(actor.role) === "cashier" || hasRoleExceptions(actor));
  const canOpenCashOf = (operatorId: string) => canOpenCash && (isAdmin || operatorId === user.id);
  useEffect(() => {
    if (snapshot && !permittedTabs.some(({ id }) => id === tab) && permittedTabs[0]) setTab(permittedTabs[0].id);
  }, [snapshot, tab, permittedTabs.map(({ id }) => id).join(",")]);
  useEffect(() => {
    const marker = `${tab}:${focusVersion}`;
    // A modeless receipt keeps the form usable: only a keyboard working inside a receipt is left there. Closing the
    // receipt (detailId) runs this again, so a cursor asked for meanwhile is given then.
    const receipt = document.activeElement?.closest<HTMLElement>(".remittance-receipt-window");
    const inReceipt = Boolean(receipt && receipt.style.display !== "none");
    if (!snapshot || loading || busy || confirmation || printTransfer || clientEditor || inReceipt || marker === lastFocus.current) return;
    // A new sender of the draft has no search field: its first button takes the cursor.
    const field = tab === "envios" ? root.current?.querySelector<HTMLElement>('[data-client-side="sender"] input') ?? root.current?.querySelector<HTMLElement>('[data-client-side="sender"] > button')
      : tab === "recibos" ? root.current?.querySelector<HTMLInputElement>('[data-receipt-search]') : null;
    if (field) {
      lastFocus.current = marker;
      // In the fixed window (and back to a draft) the cursor waits in the sender without unfolding the catalog over the
      // form; a click or typing opens it.
      if ((fixedForm || quietCapture.current) && tab === "envios" && document.activeElement !== field) { field.dataset.quietFocus = "1"; window.requestAnimationFrame(() => { delete field.dataset.quietFocus; }); }
      quietCapture.current = false;
      field.focus();
    }
  }, [tab, focusVersion, snapshot, loading, busy, confirmation, printTransfer, clientEditor, detailId, fixedForm]);
  // The fixed form scrolls inside its window: a new quote brings its confirm button into view.
  useEffect(() => {
    if (fixedForm && quote) root.current?.querySelector<HTMLElement>(".remittance-quote .remittance-primary")?.scrollIntoView({ block: "nearest" });
  }, [fixedForm, quote]);

  const retireQuote = useCallback(() => { quoteRequests.current.invalidate(); quoteLock.current = false; setQuoteBusy(false); setQuote(null); }, []);
  const changeTab = useCallback((next: Tab) => { retireQuote(); reportRequests.current.invalidate(); setReportBusy(false); setTab(next); setError(""); setOutputError(""); }, [retireQuote]);
  // Coming from "Ir a Caja de remesas": the opening form names the box of the notice, and takes the keyboard.
  useEffect(() => {
    if (!cashShown || !cashRequest || cashRequest.id <= appliedCashRequest) return;
    appliedCashRequest = cashRequest.id;
    setOpening((current) => ({ ...current, operatorId: cashRequest.operatorId, currency: cashRequest.currency }));
    cashFocus.current = true;
  }, [cashRequest, cashShown]);
  useEffect(() => {
    if (!cashFocus.current || !snapshot || loading || confirmation || closing) return;
    cashFocus.current = false;
    (root.current?.querySelector<HTMLElement>("[data-cash-opening-amount]") ?? root.current?.querySelector<HTMLElement>(".remittance-heading button"))?.focus();
  });
  // Coming from "Entregas de Dinero": show the transfers to deliver, already filtered.
  // Only a window with Recibos takes the request; another one leaves it for that window.
  useEffect(() => {
    if (!payoutsShown || !payoutRequest || payoutRequest.id <= appliedPayoutRequest) return;
    appliedPayoutRequest = payoutRequest.id;
    changeTab("recibos"); setSearch(payoutRequest.search); setStatus("pending"); setListFiltersShown(true);
  }, [payoutRequest, payoutsShown, changeTab]);

  // background: an operation saved in another window. This one reloads what it shows and keeps the errors on
  // view and a quote whose date, rates and commission policy did not change (the server checks it again).
  const refresh = useCallback(async ({ background = false } = {}) => {
    const request = refreshRequests.current.begin();
    setLoading(true); if (!background) { setError(""); setOutputError(""); }
    try {
      const data = await api<RemittanceSnapshot>("/envios/snapshot");
      const accessActor = { role: user.role ?? (isAdmin ? "admin" : "collector"), access: data.access ?? user.access };
      // Only the lists this window shows.
      const [outgoing, incoming] = await Promise.all([
        sendsShown && hasRemittancePermission(accessActor, "remittances.view") ? api<Transfer[]>("/envios") : Promise.resolve([]),
        payoutsShown && hasRemittancePermission(accessActor, "remittances.receipts") ? api<Transfer[]>("/envios/recibos") : Promise.resolve([]),
      ]);
      if (!refreshRequests.current.accepts(request)) return;
      if (!background) retireQuote();
      else setQuote((current) => current && quoteStillCurrent(current, data) ? current : null);
      setSnapshot(data); setSent(outgoing); setReceived(incoming);
    } catch (failure) { if (refreshRequests.current.accepts(request)) setError(failure instanceof Error ? failure.message : "No pudimos cargar los envíos."); }
    finally { if (refreshRequests.current.accepts(request)) setLoading(false); }
  }, [api, retireQuote, user.id, user.role, user.access?.revision, isAdmin, sendsShown, payoutsShown]);
  useEffect(() => { void refresh(); return () => { refreshRequests.current.invalidate(); quoteRequests.current.invalidate(); reportRequests.current.invalidate(); }; }, [refresh]);
  // Preserve the lists; a new effective rate retires the previous quotation.
  const refreshRates = useCallback(async () => {
    try {
      const data = await api<RemittanceSnapshot>("/envios/snapshot");
      setQuote((current) => current && quoteStillCurrent(current, data) ? current : null);
      setSnapshot((current) => current ? { ...current, rates: data.rates, rateHistory: data.rateHistory } : current);
    } catch { /* The "Actualizar" button reports a failed read. */ }
  }, [api]);
  // Administración announces a saved rate; the view shows it without leaving the tab.
  // A transfer, payment or box saved in another window (Envíos, Pagos, Caja) reloads this one.
  const instanceId = useId();
  useEffect(() => {
    const onRates = () => { void refreshRates(); };
    const onPolicy = () => { void refresh(); };
    const onChanged = (event: Event) => { if ((event as CustomEvent<{ source?: string }>).detail?.source !== instanceId) void refresh({ background: true }); };
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
  const operatorName = (id?: string) => remittanceOperatorName(snapshot, id) ?? (id === user.id ? user.name : id || "—");
  // A printed receipt never carries an internal id: the manager saved with the transfer, or a plain "—".
  const receiptOperatorName = (id: string | undefined, saved?: string) => remittanceOperatorName(snapshot, id) ?? (id && id === user.id ? user.name : saved || "—");
  const customerReceipt = (transfer: Transfer) => remittanceReceipt(transfer, snapshot?.receiptIssuer,
    receiptOperatorName(transfer.sendingUserId, transfer.commissionAllocation?.managerName),
    receiptOperatorName(transfer.registeredBy, transfer.registeredBy === transfer.sendingUserId ? transfer.commissionAllocation?.managerName : undefined));
  const detail = snapshot?.transfers.find((transfer) => transfer.id === detailId);
  // Only an administrator chooses the operator of a box; anyone else opens their own.
  const openingOperator = isAdmin ? opening.operatorId : user.id;
  const clearErrors = () => { setError(""); setOutputError(""); };
  const rejectEntry = (message: string) => { retireQuote(); setError(message); };
  const rejectMoney = (field: "amount" | "opening" | "counted") => { setMoneyEntryErrors((current) => ({ ...current, [field]: moneyInputMessage })); rejectEntry(moneyInputMessage); };
  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (typeof value === "string") {
      if (key === "amount" && !isMoneyDraft(value)) { rejectMoney("amount"); return; }
      if (key === "note" && !isTextDraft(value, INPUT_LIMITS.freeNote, true)) { rejectEntry("La nota admite hasta 500 caracteres, sin caracteres de control."); return; }
    }
    if (key === "amount" || key === "amountMode") setMoneyEntryErrors((current) => ({ ...current, amount: undefined }));
    setDraft((current) => ({ ...current, [key]: value })); retireQuote(); clearErrors();
  };
  const chooseClient = (side: ClientSide, client: RemittanceClient) => {
    setNewClients((current) => ({ ...current, [side]: undefined }));
    setDraft((current) => selectRemittanceClient(current, side, client));
    if (side === "sender") { setSenderSearch(clientLabel(client)); if (draft.recipientClientId === client.id) setRecipientSearch(""); }
    else setRecipientSearch(clientLabel(client));
    retireQuote(); clearErrors();
    // The client chosen, the keyboard goes on to the next field, as Enter does: the recipient after the sender, the phone
    // after the recipient.
    window.requestAnimationFrame(() => { const picker = root.current?.querySelector<HTMLInputElement>(`[data-client-side="${side}"] input[role="combobox"]`); if (picker) focusNextField(picker); });
  };
  // Empties the capture. The filters of the list are not part of it: in the fixed window Buscar and Estado only filter
  // the list below, and in Entregas de dinero they keep the receipts asked for.
  const resetForm = () => {
    setPaymentDraft(paymentDraftFor(0));
    setMoneyEntryErrors({});
    retireQuote(); setFormOpen(true); clearErrors(); setNewClients({}); setSenderSearch(""); setRecipientSearch("");
    quietCapture.current = false;
    setDraft({ senderClientId: "", recipientClientId: "", sendingUserId: user.id, sourceCurrency: "DOP", destinationCurrency: "DOP", amount: "", amountMode: "source", note: "" });
    recipientPhoneTyped.current = false; setRecipientPhone(""); setFocusVersion((value) => value + 1);
  };
  const clearListFilters = () => { setSearch(""); setStatus("all"); };
  // «Nuevo envío» of the collector terminal: the filters that hid the capture go too, so the list shows every send.
  const startNewSend = () => { resetForm(); clearListFilters(); };
  // A capture hidden by Buscar comes back as it was left.
  const returnToCapture = () => { setFormOpen(true); quietCapture.current = true; setFocusVersion((value) => value + 1); };
  const openDetail = (id: string) => {
    if (id !== detailId) { setCancelReason(""); setRefundReference(""); setRefundVerified(false); setCancelError(""); }
    detailFocusReturn.current = true; setDetailId(id); setDetailReveal((value) => value + 1);
  };
  const updateReportFilter = (values: Partial<typeof reportFilters>) => { reportRequests.current.invalidate(); setReportBusy(false); setReportFilters((current) => ({ ...current, ...values })); setReport(null); setAllocationReport(null); setOutputError(""); };
  const confirm = (action: Confirmation) => { setConfirmation({ ...action, idempotencyKey: operationKey() }); setConfirmationError(""); setUncertain(false); setNotice(""); };
  const failureMessage = (failure: unknown) => failure instanceof Error ? failure.message : "No pudimos completar la operación.";
  const runOutput = (action: () => void) => { try { action(); setOutputError(""); } catch (failure) { setOutputError(failureMessage(failure)); } };
  const closePrintPrompt = () => { setPrintTransfer(null); setReceiptPrintError(""); setFocusVersion((value) => value + 1); };
  const printSavedReceipt = () => {
    if (!printTransfer) return;
    try { printRemittanceReceipt(customerReceipt(printTransfer)); closePrintPrompt(); }
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
    let action = confirmation;
    if (action.kind === "create" && !uncertain) {
      try {
        const payment = paymentInput(action.expectedQuotation!.totalAmount, paymentDraft);
        action = { ...action, body: { ...action.body, payment } };
        setConfirmation(action);
      } catch (failure) { setConfirmationError(failureMessage(failure)); return; }
    }
    mutationLock.current = true; setBusy(true); setConfirmationError("");
    pendingByActor.set(pendingKey, action);
    try {
      const result = await api<Transfer>(action.path, { method: "POST", headers: { "Idempotency-Key": action.idempotencyKey! }, body: JSON.stringify(action.body) });
      const savedTransfer = action.kind === "create" ? confirmedCreatedTransfer(result, action.body, user.id, action.expectedQuotation) : null;
      pendingByActor.delete(pendingKey);
      window.dispatchEvent(new CustomEvent(REMITTANCES_CHANGED_EVENT, { detail: { source: instanceId, kind: confirmation.kind } }));
      setNotice("Operación registrada correctamente.");
      // The phone typed for this transfer is not carried to the next one. The collector terminal also clears the
      // filters, so the new send is on its list; the fixed window keeps the filters of the list below its form.
      if (confirmation.kind === "create") { resetForm(); if (!fixedForm) clearListFilters(); }
      if (confirmation.kind === "close") { setClosing(null); setCounted(""); }
      if (confirmation.kind === "cancel") { setCancelReason(""); setRefundReference(""); setRefundVerified(false); }
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
      if (moneyEntryErrors.amount) throw new Error("Corrige el monto señalado antes de calcular la cotización.");
      if (!isMoneyDraft(draft.amount)) throw new Error(moneyInputMessage);
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
    setPaymentDraft(paymentDraftFor(quote.totalAmount));
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
    }, description: <><p><strong>{senderContact.contact.name}</strong> envía a <strong>{recipientContact.contact.name}</strong>.</p><h3>Remitente</h3><ContactDetails contact={senderContact.contact} label="Remitente" />{newRecordDetails("sender", "Remitente")}<h3>Destinatario</h3><ContactDetails contact={recipientContact.contact} label="Destinatario" />{newRecordDetails("recipient", "Destinatario")}{typedRecipientPhone && <p><strong>Teléfono para este envío: {typedRecipientPhone}.</strong>{phoneRecordText[recipientPhoneRecord(typedRecipientPhone, recipientContact.contact, newClients.recipient, isAdmin)]}</p>}<p className="remittance-help">Datos actuales de las fichas de clientes. El comprobante conserva la copia guardada al registrar el envío.</p><QuoteDetails quote={quote} /><p>Operador: {operatorName(draft.sendingUserId)}. Registrado por: {user.name}.</p><p>Confirma después de recibir el total del remitente. La tasa queda guardada para este envío.</p></> });
  }

  function prepareOpening(event: FormEvent) {
    event.preventDefault();
    // The box of today was already closed: the server keeps one per operator, currency and day (CASH_EXISTS).
    if (snapshot && remittanceCashNotice(snapshot, openingOperator, opening.currency) === "closedToday") return;
    try {
      if (moneyEntryErrors.opening) throw new Error("Corrige el efectivo inicial señalado antes de revisar la apertura.");
      if (!isMoneyDraft(opening.amount)) throw new Error(moneyInputMessage);
      const openingAmount = decimalCents(opening.amount, true);
      confirm({ title: "Abrir caja de remesas", path: "/envios/cajas/abrir", kind: "open", body: { operatorId: openingOperator, currency: opening.currency, openingAmount }, description: <p>Operador: <strong>{operatorName(openingOperator)}</strong><br />Fecha: {snapshot?.businessDate}<br />Efectivo inicial: <strong>{money(openingAmount, opening.currency)}</strong></p> });
    } catch (failure) { setError(failureMessage(failure)); }
  }

  function prepareClosing(event: FormEvent) {
    event.preventDefault(); if (!closing) return;
    try {
      if (moneyEntryErrors.counted) throw new Error("Corrige el efectivo contado señalado antes de revisar el cierre.");
      if (!isMoneyDraft(counted)) throw new Error(moneyInputMessage);
      const countedAmount = decimalCents(counted, true);
      if (countedAmount !== closing.expected) throw new Error(`El efectivo contado debe coincidir con ${money(closing.expected, closing.currency)}. Revisa el conteo y actualiza la caja.`);
      confirm({ title: "Confirmar cierre de caja", path: `/envios/cajas/${encodeURIComponent(closing.id)}/cerrar`, kind: "close", body: { countedAmount }, description: <p>Cerrar caja de {operatorName(closing.operatorId)} · {closing.date}, con <strong>{money(countedAmount, closing.currency)}</strong>. Después del cierre esta caja no admite movimientos.</p> });
    } catch (failure) { setError(failureMessage(failure)); }
  }

  function prepareCancellation(event: FormEvent) {
    event.preventDefault(); if (!detail) return;
    setCancelError("");
    try {
      validateText(cancelReason, "El motivo de cancelación", INPUT_LIMITS.freeNote, { required: true, multiline: true });
      const reason = cancelReason.trim();
      const external = detail.payment && detail.payment.method !== "cash";
      if (external) {
        validateText(refundReference, "La referencia de devolución", 160, { required: true });
        if (!isPaymentTextDraft(refundReference)) throw new Error("La referencia de devolución admite hasta 160 caracteres en una sola línea, sin caracteres de control ni marcas invisibles.");
        if (!refundVerified) throw new Error("Comprueba la devolución bancaria antes de cancelar este envío.");
      }
      confirm({ title: "Cancelar envío pendiente", path: `/envios/${encodeURIComponent(detail.id)}/cancelar`, body: { reason, ...(external ? { refund: { reference: refundReference.trim(), verified: true } } : {}) }, kind: "cancel", description: <><p>Devolver <strong>{money(detail.totalAmount, detail.sourceCurrency)}</strong> (principal y comisión) al remitente{external ? ` mediante ${paymentMethodLabels[detail.payment!.method]}. Devolución comprobada: ${refundReference.trim()}. CyP registra el comprobante; no ejecuta la devolución bancaria` : `, desde la caja del operador ${operatorName(detail.sendingUserId)}`}.</p><p>Motivo: {reason}</p></> });
    } catch (failure) { setCancelError(failureMessage(failure)); }
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
  // Outside the fixed window, searching hands the space to the list without touching the draft: «Volver a la captura»
  // shows it again as it was, and «Nuevo envío» clears the filters and the draft for another send.
  const hideCaptureForSearch = () => { if (view === "envios" && !fixedForm && !working && !uncertain) setFormOpen(false); };
  const draftInProgress = Boolean(draft.senderClientId || draft.recipientClientId || draft.amount || draft.note.trim() || newClients.sender || newClients.recipient || senderSearch.trim() || recipientSearch.trim() || recipientPhone.trim());
  const captureButtons = view === "envios" && !fixedForm && can("remittances.create") && <>
    {!formOpen && draftInProgress && <button type="button" disabled={working || uncertain} onClick={returnToCapture}>Volver a la captura</button>}
    <button type="button" className="remittance-primary" disabled={working || uncertain} onClick={startNewSend}>Nuevo envío</button>
  </>;
  const toolbar = <div className="remittance-toolbar"><FiltersToggle visible={listFiltersShown} className="remittance-filters-toggle" onClick={() => setListFiltersShown((shown) => !shown)} />{listFiltersShown && <><label>Buscar<input data-receipt-search={view === "recibos" || undefined} type="search" inputMode="text" maxLength={INPUT_LIMITS.name} value={search} onFocus={hideCaptureForSearch} onPaste={(event) => restrictPaste(event, (value) => isTextDraft(value, INPUT_LIMITS.name), () => setError("La búsqueda admite hasta 160 caracteres en una sola línea."))} onChange={(event) => { if (!isTextDraft(event.target.value, INPUT_LIMITS.name)) { setError("La búsqueda admite hasta 160 caracteres en una sola línea."); return; } setSearch(event.target.value); hideCaptureForSearch(); }} placeholder="Serie, teléfono, nombre, identificación, dirección o nota" title="El teléfono se encuentra aunque lo escribas sin guiones ni espacios." /></label><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos</option><option value="pending">Pendientes</option><option value="paid">Pagados</option><option value="cancelled">Cancelados</option></select></label></>}{captureButtons}</div>;
  const transferList = <>
    <div className="remittance-table-wrap"><table className="remittance-table remittance-transfer-table"><caption title={view === "recibos" ? "Remesas por entregar. Abre una para entregarle el dinero a la persona que lo recibe." : "Envíos registrados por tu operación. Abre una referencia para consultar su detalle."}>{view === "recibos" ? "Entregas de dinero" : "Listado de envíos"} · {list.length}</caption><thead><tr><th>Referencia</th><th>Fecha</th><th>Remitente → destinatario · teléfono</th><th>Total recibido</th><th>A entregar</th><th>Estado</th></tr></thead><tbody>{list.map((transfer) => <tr key={transfer.id} onDoubleClick={() => openDetail(transfer.id)}><td data-label="Referencia"><button type="button" className="remittance-link" onClick={() => openDetail(transfer.id)}>{view === "recibos" ? transfer.reciboReference : transfer.envioReference}</button><small>{transfer.operatingCode}</small></td><td data-label="Fecha">{formatDate(transfer.createdAt)}</td><td data-label="Clientes"><span className="remittance-client-cell">{transfer.senderContact?.name ?? clientName(transfer.senderClientId)}{transfer.senderContact?.phone || transfer.senderContact?.cellular ? <span className="remittance-client-phone"> · {transfer.senderContact.phone || transfer.senderContact.cellular}</span> : null}<br />→ {transfer.recipientContact?.name ?? clientName(transfer.recipientClientId)}{transfer.recipientContact?.phone || transfer.recipientContact?.cellular ? <span className="remittance-client-phone"> · {transfer.recipientContact.phone || transfer.recipientContact.cellular}</span> : null}</span></td><td data-label="Total recibido">{money(transfer.totalAmount, transfer.sourceCurrency)}</td><td data-label="A entregar">{money(transfer.receiveAmount, transfer.destinationCurrency)}</td><td data-label="Estado"><span className={`remittance-status ${transfer.status}`}>{statusText[transfer.status]}</span></td></tr>)}{!list.length && <tr><td colSpan={6}>No hay {view === "envios" ? "envíos" : "recibos"} para estos filtros.</td></tr>}</tbody></table></div>
  </>;
  // Warnings only: without a box open today the server refuses the operation (CASH_NOT_OPEN, PREVIOUS_CASH_OPEN).
  // A window that shows the box itself (the collector terminal) does not repeat them.
  const cashWarnings = !cashShown && can("remittances.cash.view");
  const sendCash = snapshot && cashWarnings && view === "envios" && formOpen && can("remittances.create") ? remittanceCashNotice(snapshot, draft.sendingUserId, draft.sourceCurrency) : "ok";
  // A box closed today cannot be opened again (one per operator, currency and day): no "Ábrela" and no way to the box.
  const sendCashText = !snapshot || sendCash === "ok" ? ""
    : sendCash === "missing" ? `No hay caja de remesas abierta hoy en ${draft.sourceCurrency} para ${operatorName(draft.sendingUserId)}. Sin caja abierta no se puede registrar el envío. ${canOpenCashOf(draft.sendingUserId) ? "Ábrela" : "Un administrador debe abrirla"} en ${cashPlace}. Si ya está abierta, pulsa Actualizar.`
    : sendCash === "closedToday" ? `La caja de remesas de hoy en ${draft.sourceCurrency} de ${operatorName(draft.sendingUserId)} ya se cerró y no admite más movimientos: no se pueden registrar más envíos en ${draft.sourceCurrency} hasta la jornada siguiente.`
    : `La caja de remesas en ${draft.sourceCurrency} del ${previousOpenCashDate(snapshot, draft.sendingUserId, draft.sourceCurrency)} de ${operatorName(draft.sendingUserId)} sigue abierta: hay que cerrarla y abrir la de hoy en ${cashPlace}.`;
  // The sending window keeps the notice on one line under its heading, so the list keeps its rows; the whole text
  // stays readable and in its title.
  const sendCashNotice = sendCashText && <div className="remittance-cash-warning" role="status">
    <p title={fixedForm ? sendCashText : undefined}>{sendCashText}</p>
    {onOpenCash && sendCash !== "closedToday" && <button type="button" onClick={() => onOpenCash({ operatorId: draft.sendingUserId, currency: draft.sourceCurrency })}>Ir a Caja de remesas</button>}
  </div>;
  // Paying takes the money from the box of whoever pays, in the destination currency.
  const payCash = snapshot && cashWarnings && payoutsShown && detail?.status === "pending" && detail.canPay && can("remittances.pay") ? remittanceCashNotice(snapshot, user.id, detail.destinationCurrency) : "ok";
  const payCashNotice = snapshot && detail && payCash !== "ok" && <div className="remittance-cash-warning" role="status">
    <p>{payCash === "missing"
      ? `No tienes caja de remesas abierta hoy en ${detail.destinationCurrency}. Sin caja abierta no se puede registrar la entrega. ${canOpenCashOf(user.id) ? "Ábrela" : "Un administrador debe abrirla"} en ${cashPlace}.`
      : payCash === "closedToday" ? `Tu caja de remesas de hoy en ${detail.destinationCurrency} ya se cerró y no admite más movimientos: no se pueden registrar más entregas en ${detail.destinationCurrency} hasta la jornada siguiente.`
      : `Tu caja de remesas en ${detail.destinationCurrency} del ${previousOpenCashDate(snapshot, user.id, detail.destinationCurrency)} sigue abierta: hay que cerrarla y abrir la de hoy en ${cashPlace}.`}</p>
    {/* Going to the box moves the keyboard there: the receipt it closes does not give the focus back behind it. */}
    {onOpenCash && payCash !== "closedToday" && <button type="button" onClick={() => { detailFocusReturn.current = false; setDetailId(null); onOpenCash({ operatorId: user.id, currency: detail.destinationCurrency }); }}>Ir a Caja de remesas</button>}
  </div>;
  const openingCash = snapshot && canOpenCash ? remittanceCashNotice(snapshot, openingOperator, opening.currency) : "ok";
  // A transfer is registered only for an operator who can send; the boxes still list every operator.
  const sendingOperators = snapshot?.sendingOperatorIds ? snapshot.operators.filter(({ id }) => snapshot.sendingOperatorIds!.includes(id)) : snapshot?.operators ?? [];
  // Classes that only the compact layout of the sending window uses to place a field.
  const fixedPlace = (name: string) => fixedForm ? ` ${name}` : "";
  // Dionel (26-10): no fixed help texts in the form; what matters is the hint of its field.
  const managerShare = snapshot?.commissionPolicy?.managerCommissionBps ? snapshot.commissionPolicy.managerCommissionBps / 100 : 0;
  // The amount typed: in «Dinero a enviar» or in «Dinero que se recibe», as «Ingresar importe de» says.
  const amountInput = <MoneyInput required title={moneyInputMessage} value={draft.amount} aria-invalid={Boolean(moneyEntryErrors.amount) || undefined} onValueChange={(nextValue) => updateDraft("amount", nextValue)} placeholder="0.00" onInvalidEntry={() => rejectMoney("amount")} />;
  const commissionHint = "Se aplica sola, según la configuración de comisiones." + (can("remittances.commissions.view") ? ` Parte del gestor (${operatorName(draft.sendingUserId)}): ${managerShare}% del importe final de destino, dentro de la misma comisión y sin cargo adicional.` : "");

  // Envíos and Entregas place the keyboard themselves (the sender without unfolding its list, the search of receipts):
  // data-own-focus keeps the desktop window from placing it first.
  return <section ref={root} className={"remittances" + (fixedForm ? " remittances-fixed" : "")} aria-label={heading} data-own-focus={view === "envios" || view === "recibos" ? "" : undefined}>
    <header className="remittance-heading"><div><h1>{heading}</h1><p>{snapshot ? `Fecha de operación: ${snapshot.businessDate}` : "Conexión con la API"} · {user.name}</p>{fixedForm && sendCashNotice}</div><button type="button" onClick={() => void refresh()} disabled={loading || working}>{loading ? "Cargando…" : "Actualizar"}</button></header>
    {permittedTabs.length > 1 && <nav className="remittance-tabs" aria-label="Secciones de remesas">{permittedTabs.map((item) => <button key={item.id} type="button" aria-current={view === item.id ? "page" : undefined} onClick={() => changeTab(item.id)}>{item.label}</button>)}</nav>}
    {error && <div className="remittance-error" role="alert">{error}</div>}
    {outputError && <div className="remittance-error" role="alert">{outputError}</div>}
    {notice && <div className="remittance-notice" role="status">{notice}</div>}
    {!snapshot ? <div className="remittance-empty">{loading ? "Cargando clientes, tasas y cajas…" : "No hay datos conectados. Actualiza para volver a intentar."}</div> : <>
      {sendsShown && (snapshot.commissionPolicy?.managerCommissionBps ?? 0) > (snapshot.commissionPolicy?.transactionCommissionBps ?? 0) && <p className="remittance-error" role="alert">La comisión total configurada no cubre el porcentaje del gestor. Un administrador debe revisar Configuración de administración → Comisiones de remesas antes de registrar nuevos envíos. Los recibos anteriores conservan sus importes.</p>}
      {!view && <div className="remittance-empty" role="status">No tienes permiso para usar esta ventana. Pide a un administrador que revise tus permisos de remesas.</div>}
      {(view === "envios" || view === "recibos") && <>
        {!fixedForm && toolbar}
        {!fixedForm && sendCashNotice}
        {view === "envios" && formOpen && can("remittances.create") && <form aria-label="Nuevo envío" onKeyDown={advanceCaptureField} className={"remittance-panel" + fixedPlace("remittance-send-form")} onSubmit={(event) => void requestQuote(event)}>
          <h2>Nuevo envío</h2><fieldset disabled={working || uncertain} className="remittance-form-grid">
            <div className="remittance-party-fields" role="group" aria-label="Datos del remitente">
              {newClients.sender ? <div data-client-side="sender"><strong>Nuevo remitente: {newClients.sender.name}</strong><ContactDetails contact={senderContact.contact!} label="Remitente" /><button type="button" onClick={() => setClientEditor("sender")}>Modificar datos del nuevo remitente</button><button type="button" onClick={() => { setNewClients((current) => ({ ...current, sender: undefined })); retireQuote(); setFocusVersion((value) => value + 1); }}>Elegir remitente registrado</button></div> : <ClientPicker api={api} side="sender" senderId="" label="Remitente" clients={eligibleClients(snapshot.clients, "sender", draft.senderClientId)} value={draft.senderClientId} query={senderSearch} onQuery={(value) => { setSenderSearch(value); updateDraft("senderClientId", ""); }} onSelect={(client) => chooseClient("sender", client)} onCreate={can("remittances.clients.create") && snapshot.clientRoutes?.length ? () => setClientEditor("sender") : undefined} contactState={senderContact} floating={fixedForm} />}
            </div>
            <div className="remittance-party-fields" role="group" aria-label="Datos del destinatario">
              {newClients.recipient ? <div data-client-side="recipient"><strong>Nuevo destinatario: {newClients.recipient.name}</strong><ContactDetails contact={recipientContact.contact!} label="Destinatario" /><button type="button" onClick={() => setClientEditor("recipient")}>Modificar datos del nuevo destinatario</button><button type="button" onClick={() => { setNewClients((current) => ({ ...current, recipient: undefined })); retireQuote(); }}>Elegir destinatario registrado</button></div> : <ClientPicker api={api} side="recipient" senderId={draft.senderClientId} label="Destinatario" clients={eligibleClients(snapshot.clients, "recipient", draft.senderClientId)} value={draft.recipientClientId} query={recipientSearch} onQuery={(value) => { setRecipientSearch(value); updateDraft("recipientClientId", ""); }} onSelect={(client) => chooseClient("recipient", client)} onCreate={can("remittances.clients.create") && snapshot.clientRoutes?.length ? () => setClientEditor("recipient") : undefined} contactState={recipientContact} floating={fixedForm} />}
              <label className="remittance-phone-field">Teléfono del destinatario<input type="tel" inputMode="tel" autoComplete="off" maxLength={INPUT_LIMITS.phone} value={recipientPhone} title={PHONE_INPUT_MESSAGE} disabled={!draft.recipientClientId && !newClients.recipient} onPaste={(event) => restrictPaste(event, isPhoneDraft, () => rejectEntry(PHONE_INPUT_MESSAGE))} onChange={(event) => { if (!isPhoneDraft(event.target.value)) { rejectEntry(PHONE_INPUT_MESSAGE); return; } recipientPhoneTyped.current = true; setRecipientPhone(event.target.value); setError(""); }} placeholder="Escríbelo si no aparece" /></label>
              {recipientContact.contact && !knownRecipientPhone && !recipientPhone.trim() && <p className="remittance-client-warning" role="status">Este destinatario no tiene teléfono registrado. Escríbelo en «Teléfono del destinatario» para poder ubicarlo.</p>}
            </div>
            <label className="remittance-amount-mode">Ingresar importe de<select value={draft.amountMode} onChange={(event) => { updateDraft("amountMode", event.target.value as Draft["amountMode"]); setDraft((current) => ({ ...current, amount: "" })); }}><option value="source">Origen · Monto a enviar</option><option value="destination">Destino · Monto a recibir</option></select></label>
            {isAdmin && <label className="remittance-operator-field">Operador del envío<select required value={draft.sendingUserId} onChange={(event) => updateDraft("sendingUserId", event.target.value)}>{sendingOperators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label>}
            <label className="remittance-note-field">Nota (opcional)<textarea aria-label="Nota (opcional)" maxLength={INPUT_LIMITS.freeNote} rows={fixedForm ? 1 : 2} value={draft.note} onPaste={(event) => restrictPaste(event, (value) => isTextDraft(value, INPUT_LIMITS.freeNote, true), () => rejectEntry("La nota admite hasta 500 caracteres, sin caracteres de control."))} onChange={(event) => updateDraft("note", event.target.value)} /></label>
            {/* The money in the order of the whiteboard (Rardiel, 28-10-2026), for the eyes and for Enter and Tab: the money sent
                (DF), then the money received (DR), then the money at the rate (DT). Every rate comes from the server's quote. */}
            <fieldset className="remittance-money remittance-money-send"><legend>Dinero a enviar</legend>
              <label title="Sale la moneda habitual del remitente; puedes cambiarla. Hace falta una caja de remesas abierta hoy en esta moneda.">Moneda del remitente<select value={draft.sourceCurrency} onChange={(event) => updateDraft("sourceCurrency", event.target.value as Currency)}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
              {draft.amountMode === "source" ? <label title="La comisión se suma aparte: el total a pagar aparece al calcular la cotización.">{`Monto a enviar (${draft.sourceCurrency})`}{amountInput}</label> : <label>{`Monto a enviar calculado (${draft.sourceCurrency})`}<input readOnly value={quote ? money(quote.amount, draft.sourceCurrency) : "Calcula la cotización"} /></label>}
              <label>Tasa<input aria-label="Tasa del dinero a enviar" readOnly title={quote ? `1 ${quote.sourceCurrency} = ${quote.quote.sourceRate} DOP` : undefined} value={quote ? `${shortRate(quote.quote.sourceRate)} DOP` : ""} placeholder="Al cotizar" /></label>
              <label title={commissionHint}>Comisión (%)<input aria-label="Comisión (%)" readOnly title={commissionHint} value={String((quote?.commissionBps ?? snapshot.commissionPolicy?.transactionCommissionBps ?? 0) / 100)} /></label>
            </fieldset>
            <fieldset className="remittance-money remittance-money-receive"><legend>Dinero que se recibe</legend>
              <label title="Sale la moneda habitual del destinatario; puedes cambiarla.">Moneda del destinatario<select value={draft.destinationCurrency} onChange={(event) => updateDraft("destinationCurrency", event.target.value as Currency)}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
              {draft.amountMode === "destination" ? <label>{`Monto a recibir (${draft.destinationCurrency})`}{amountInput}</label> : <label>{`Monto a recibir calculado (${draft.destinationCurrency})`}<input readOnly value={quote ? money(quote.receiveAmount, draft.destinationCurrency) : "Calcula la cotización"} /></label>}
              <label>Tasa<input aria-label="Tasa del dinero que se recibe" readOnly title={quote ? `1 ${quote.destinationCurrency} = ${quote.quote.destinationRate} DOP` : undefined} value={quote ? `${shortRate(quote.quote.destinationRate)} DOP` : ""} placeholder="Al cotizar" /></label>
            </fieldset>
            <fieldset className="remittance-money remittance-money-rate"><legend>Tasa</legend>
              <label>Equivalente del principal en DOP<input readOnly value={quote?.amountDop === undefined ? (quote ? "Fuera de rango de visualización" : "Calcula la cotización") : money(quote.amountDop, "DOP")} /></label>
              <label>Tasa de origen a destino<input readOnly value={quote ? crossRateText(quote) : "Calcula la cotización"} /></label>
            </fieldset>
          </fieldset>
          {fixedForm ? <div className="remittance-form-actions">
            <button disabled={working || uncertain} type="submit">{quoteBusy ? "Cotizando…" : "Calcular cotización"}</button>
            <button type="button" disabled={working || uncertain} onClick={resetForm}>Limpiar formulario</button>
          </div> : <button disabled={working || uncertain} type="submit">{quoteBusy ? "Cotizando…" : "Calcular cotización"}</button>}
          {quote && <div className="remittance-quote"><QuoteDetails quote={quote} /><button ref={reviewButton} type="button" className="remittance-primary" disabled={working || uncertain} onClick={confirmCreate}>Revisar y confirmar envío</button></div>}
        </form>}
        {fixedForm ? <div className="remittance-list-area">{toolbar}{transferList}</div> : transferList}
      </>}
      {view === "caja" && <>
        <p className="remittance-help">Caja solo para remesas. Saldo = lo que había al abrir + lo cobrado por envíos − devoluciones − entregas. Cada moneda se cuenta aparte.</p>
        {canOpenCash && <form className="remittance-panel" onSubmit={prepareOpening}><h2>Abrir caja del {snapshot.businessDate}</h2><fieldset disabled={busy} className="remittance-form-grid">{isAdmin ? <label>Operador<select required value={opening.operatorId} onChange={(event) => setOpening((current) => ({ ...current, operatorId: event.target.value }))}>{snapshot.operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label> : <label>Operador<input readOnly value={operatorName(user.id)} /></label>}<label>Moneda<select value={opening.currency} onChange={(event) => setOpening((current) => ({ ...current, currency: event.target.value as Currency }))}>{snapshot.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><label>Efectivo inicial<MoneyInput data-cash-opening-amount required title={moneyInputMessage} value={opening.amount} aria-invalid={Boolean(moneyEntryErrors.opening) || undefined} onValueChange={(nextValue) => { if (!isMoneyDraft(nextValue)) { rejectMoney("opening"); return; } setMoneyEntryErrors((current) => ({ ...current, opening: undefined })); setOpening((current) => ({ ...current, amount: nextValue })); setError(""); }} onInvalidEntry={() => rejectMoney("opening")} /></label></fieldset>{openingCash === "previousOpen" && <p className="remittance-cash-warning" role="status">La caja de remesas en {opening.currency} del {previousOpenCashDate(snapshot, openingOperator, opening.currency)} de {operatorName(openingOperator)} sigue abierta. Ciérrala con «Contar y cerrar» antes de abrir la de hoy.</p>}{openingCash === "closedToday" && <p className="remittance-cash-warning" role="status">La caja de remesas de hoy en {opening.currency} de {operatorName(openingOperator)} ya se cerró. Hay una sola caja por operador, moneda y día: no se puede abrir otra hasta la jornada siguiente.</p>}<button className="remittance-primary" disabled={busy || openingCash === "closedToday"}>Revisar apertura</button></form>}
        <div className="remittance-cash-grid">{snapshot.cashSessions.map((cash) => <article className="remittance-panel" key={cash.id}><h2>{cash.currency} · {operatorName(cash.operatorId)}</h2><p>{cash.date} · {cash.status === "open" ? "Abierta" : "Cerrada"}</p><dl className="remittance-summary"><div><dt>Apertura</dt><dd>{money(cash.openingAmount, cash.currency)}</dd></div><div><dt>Ingresos por envíos</dt><dd>{money(cash.sentTotal, cash.currency)}</dd></div><div><dt>Devoluciones</dt><dd>{money(cash.cancelRefund, cash.currency)}</dd></div><div><dt>Pagos</dt><dd>{money(cash.paid, cash.currency)}</dd></div><div className="remittance-total"><dt>Efectivo esperado</dt><dd>{money(cash.expected, cash.currency)}</dd></div>{cash.countedAmount !== undefined && <div><dt>Contado al cierre</dt><dd>{money(cash.countedAmount, cash.currency)}</dd></div>}</dl>{cash.canClose && can("remittances.cash.close") && <button type="button" onClick={() => { setClosing(cash); setCounted(""); clearErrors(); }}>Contar y cerrar</button>}</article>)}{!snapshot.cashSessions.length && <div className="remittance-empty">{!canOpenCash ? "No hay cajas de envíos. Un administrador debe abrir la caja antes de operar." : isAdmin ? "No hay cajas de envíos. Abre la caja del operador antes de operar." : "No hay cajas de envíos. Abre tu caja antes de operar."}</div>}</div>
      </>}
      {view === "reportes" && <>
        <form className="remittance-panel" onSubmit={(event) => void loadReport(event)}><h2>Reportes de remesas</h2><fieldset disabled={working} className="remittance-form-grid"><label>Desde<input type="date" required value={reportFilters.from} onChange={(event) => updateReportFilter({ from: event.target.value })} /></label><label>Hasta<input type="date" required value={reportFilters.to} onChange={(event) => updateReportFilter({ to: event.target.value })} /></label><label>Presentación<select value={reportFilters.grouping} onChange={(event) => updateReportFilter({ grouping: event.target.value as "range" | "day" })}><option value="range">Resumido del rango</option><option value="day">Diario</option></select></label><label>Reporte<select value={reportFilters.type} onChange={(event) => updateReportFilter({ type: event.target.value as RemittanceReportType })}>{remittanceReportDefinitions.filter((definition) => !["allocations", "managerCommissions"].includes(definition.type) || can("remittances.commissions.view")).map((definition) => <option key={definition.type} value={definition.type}>{definition.label}</option>)}</select></label>
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
    {/* Closing gives the keyboard back to the reference that opened the receipt; in Recibos it then goes to Buscar. */}
    {detail && <RemittanceWindow key={detail.id} title={`${detail.envioReference} · ${detail.reciboReference}`} desktopId={desktopId} nextZIndex={nextWindowZIndex} returnFocus={detailFocusReturn} revealVersion={detailReveal} onClose={() => { setDetailId(null); if (view === "recibos") setFocusVersion((value) => value + 1); }}>
      <RemittanceReceipt receipt={customerReceipt(detail)} />
      {payCashNotice}
      <div className="remittance-actions"><button type="button" onClick={() => runOutput(() => printRemittanceReceipt(customerReceipt(detail)))}>Imprimir comprobante</button>{payoutsShown && detail.status === "pending" && detail.canPay && can("remittances.pay") && <button type="button" className="remittance-primary" onClick={() => confirm({ title: "Confirmar entrega al destinatario", path: `/envios/${encodeURIComponent(detail.id)}/pagar`, body: {}, kind: "pay", description: <p>Registrar entrega única de <strong>{money(detail.receiveAmount, detail.destinationCurrency)}</strong> a <strong>{detail.recipientContact?.name ?? clientName(detail.recipientClientId)}</strong>. Se descuenta de tu caja abierta de hoy. Confirma después de entregar el dinero.</p> })}>Registrar entrega</button>}</div>
      {sendsShown && detail.status === "pending" && detail.canCancel && can("remittances.cancel") && <form className="remittance-cancel" onSubmit={prepareCancellation}><label>Motivo de cancelación<textarea aria-label="Motivo de cancelación" required maxLength={INPUT_LIMITS.freeNote} value={cancelReason} onPaste={(event) => restrictPaste(event, (value) => isTextDraft(value, INPUT_LIMITS.freeNote, true), () => setError("El motivo admite hasta 500 caracteres, sin caracteres de control."))} onChange={(event) => { if (!isTextDraft(event.target.value, INPUT_LIMITS.freeNote, true)) { setError("El motivo admite hasta 500 caracteres, sin caracteres de control."); return; } setCancelReason(event.target.value); setError(""); }} /></label>{detail.payment && detail.payment.method !== "cash" && <div className="remittance-refund">
        <p>Este envío se pagó por {paymentMethodLabels[detail.payment.method]}. Comprueba la devolución al remitente por ese medio antes de cancelarlo; no se retirará efectivo de caja.</p>
        <label>Referencia de devolución<input inputMode="text" title="Hasta 160 caracteres en una sola línea, sin caracteres de control ni marcas invisibles." maxLength={160} value={refundReference} onPaste={(event) => restrictPaste(event, isPaymentTextDraft, () => setCancelError("La referencia de devolución admite hasta 160 caracteres en una sola línea, sin caracteres de control ni marcas invisibles."))} onChange={(event) => { if (!isPaymentTextDraft(event.target.value)) { setCancelError("La referencia de devolución admite hasta 160 caracteres en una sola línea, sin caracteres de control ni marcas invisibles."); return; } setRefundReference(event.target.value); setCancelError(""); }} /></label>
        <label className="remittance-payment-check"><input type="checkbox" checked={refundVerified} onChange={(event) => setRefundVerified(event.target.checked)} />Comprobé la devolución al remitente</label>
      </div>}{cancelError && <p className="remittance-error" role="alert">{cancelError}</p>}<button className="remittance-danger" type="submit" disabled={!cancelReason.trim()}>Revisar cancelación</button></form>}
    </RemittanceWindow>}
    {closing && <Dialog title={`Contar caja ${closing.currency}`} onClose={() => setClosing(null)}><form onSubmit={prepareClosing}><p>{operatorName(closing.operatorId)} · {closing.date}</p><p>Esperado: <strong>{money(closing.expected, closing.currency)}</strong></p><label>Efectivo contado<MoneyInput data-autofocus required title={moneyInputMessage} value={counted} aria-invalid={Boolean(moneyEntryErrors.counted) || undefined} onValueChange={(nextValue) => { if (!isMoneyDraft(nextValue)) { rejectMoney("counted"); return; } setMoneyEntryErrors((current) => ({ ...current, counted: undefined })); setCounted(nextValue); setError(""); }} onInvalidEntry={() => rejectMoney("counted")} /></label>{error && <p role="alert" className="remittance-error">{error}</p>}<button className="remittance-primary" type="submit">Revisar cierre</button></form></Dialog>}
    {confirmation && <Dialog title={confirmation.title} onClose={() => { setConfirmation(null); setPaymentDraft(paymentDraftFor(0)); }} locked={busy || uncertain}>
      {confirmation.description}
      {confirmation.kind === "create" && confirmation.expectedQuotation && <PaymentFields total={confirmation.expectedQuotation.totalAmount} currency={confirmation.expectedQuotation.sourceCurrency} value={paymentDraft} locked={busy || uncertain} onChange={(next) => { setPaymentDraft(next); setConfirmationError(""); }} />}
      {confirmationError && <p className="remittance-error" role="alert">{confirmationError}</p>}
      {uncertain && <p>No cambies los datos ni cierres esta ventana. El reintento usa la misma referencia de operación.</p>}
      <div className="remittance-actions"><button type="button" disabled={busy || uncertain} onClick={() => { setConfirmation(null); setPaymentDraft(paymentDraftFor(0)); }}>{confirmation.kind === "create" ? "Cancelar" : "Volver"}</button><button type="button" className={confirmation.kind === "cancel" ? "remittance-danger" : "remittance-primary"} disabled={busy} onClick={() => void submitConfirmation()}>{busy ? "Registrando…" : uncertain ? "Reintentar misma operación" : confirmation.kind === "create" ? "Aceptar" : "Confirmar"}</button></div>
    </Dialog>}
    {printTransfer && <Dialog title="¿Quieres imprimir el recibo?" onClose={closePrintPrompt}>
      <p>El envío <strong>{printTransfer.envioReference}</strong> quedó registrado correctamente. Recibo: <strong>{printTransfer.reciboReference}</strong>.</p>
      <p>Puedes imprimirlo ahora o más tarde desde el detalle del envío.</p>
      {receiptPrintError && <p className="remittance-error" role="alert">{receiptPrintError}</p>}
      <div className="remittance-actions"><button type="button" onClick={closePrintPrompt}>No imprimir</button><button type="button" className="remittance-primary" onClick={printSavedReceipt}>Imprimir</button></div>
    </Dialog>}
  </section>;
}
