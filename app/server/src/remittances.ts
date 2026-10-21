import { randomBytes, randomUUID } from "node:crypto";
import { assertAdmin, businessDate, DomainError, type State, type User } from "./domain.js";
import { effectiveAccess, hasRemittancePermission, hasRemittanceAccess } from "../../shared/access.mjs";
import { cashReceivedForTransfer, paymentAmounts, PaymentValidationError, type ReceiptIssuer, type RemittancePayment, type RemittancePaymentInput, type RemittanceRefund, type RemittanceRefundInput } from "../../shared/remittances/payment.mjs";
import { appliedRate, type RateKind } from "../../shared/remittances/appliedRate.mjs";

export const currencies = ["DOP", "USD", "EUR"] as const;
export type Currency = (typeof currencies)[number];
export type Quote = {
  date: string; sourceRate: string; destinationRate: string; quotedAt?: string;
  sourceRateChangeId?: string; destinationRateChangeId?: string;
  sourceRateChangedAt?: string; destinationRateChangedAt?: string;
  sourceRateDate?: string; destinationRateDate?: string;
  sourceRateKind?: RateKind; destinationRateKind?: RateKind;
  commissionPolicyRevision?: string; managerCommissionBps?: number;
};
export type CommissionPolicy = { revision: string; transactionCommissionBps: number; managerCommissionBps: number; updatedAt?: string; updatedBy?: string };
export type CommissionAllocation = {
  version: 1; currency: Currency; policyRevision: string; managerCommissionBps: number;
  baseAmount: number; transactionAmount: number; companyAmount: number; managerAmount: number;
  managerId?: string; managerName?: string;
};
export type ExchangeRate = { id: string; currency: Currency; rate: string; purchaseRate?: string; saleRate?: string; date: string; changeId?: string; updatedAt?: string; updatedBy?: string };
export type RateChange = { id: string; currency: Currency; rate: string; purchaseRate?: string; saleRate?: string; date: string; createdAt: string; actorId: string };
export type RemittanceContact = { id: string; code: string; name: string; phone: string; cellular: string; address: string; identification?: string };
// An optional manual annotation, independent of the business commission/cash ledger.
export type ManagerCommission = { managerName: string; amount: number; currency: Currency };
export type Remittance = {
  id: string; sequence: number; envioReference: string; reciboReference: string;
  operatingCode: string; senderClientId: string; recipientClientId: string;
  sendingUserId: string; registeredBy: string; sourceCurrency: Currency;
  destinationCurrency: Currency; amount: number; commissionBps: number;
  commissionAmount: number; totalAmount: number; receiveAmount: number;
  quote: Quote; note: string; status: "pending" | "paid" | "cancelled";
  createdAt: string; paidAt?: string; paidBy?: string;
  cancelledAt?: string; cancelledBy?: string; cancelReason?: string;
  senderContact?: RemittanceContact; recipientContact?: RemittanceContact;
  managerCommission?: ManagerCommission;
  amountDop?: number; requestedReceiveAmount?: number; receiveRoundingDifference?: number;
  commissionAllocation?: CommissionAllocation;
  payment?: RemittancePayment; receiptIssuer?: ReceiptIssuer; refund?: RemittanceRefund;
};
export type CashSession = {
  id: string; operatorId: string; currency: Currency; date: string;
  openingAmount: number; openedBy: string; openedAt: string;
  status: "open" | "closed"; closedBy?: string; closedAt?: string; countedAmount?: number;
};
export type RemittanceEvent = {
  id: string; type: "opened" | "sent" | "paid" | "cancelled" | "closed";
  transferId?: string; cashSessionId: string; operatorId: string; currency: Currency;
  amount: number; actorId: string; createdAt: string; reason?: string;
  refund?: RemittanceRefund;
};
export type RemittanceState = {
  rates: ExchangeRate[]; transfers: Remittance[];
  cashSessions: CashSession[]; events: RemittanceEvent[]; rateHistory?: RateChange[];
  commissionPolicy?: CommissionPolicy;
};
export type QuoteInput = {
  sourceCurrency: Currency; destinationCurrency: Currency; amount: number;
  // Compatibility assertion only: the server always uses the central policy.
  commissionBps?: number;
  amountMode?: "source" | "destination";
};
export type CreateRemittanceInput = QuoteInput & {
  senderClientId: string; recipientClientId: string; sendingUserId?: string; quote: Quote; note?: string;
  // Phone typed in the form for the recipient: the number used to locate who receives the money.
  recipientPhone?: string;
  managerCommission?: ManagerCommission;
  requestedReceiveAmount?: number;
  payment?: RemittancePaymentInput;
};

export function remittanceReceiptIssuer(state: State): ReceiptIssuer {
  const field = (key: string) => typeof state.systemConfig?.[key] === "string" ? (state.systemConfig[key] as string).trim() : "";
  const logo = field("companyLogoDataUrl");
  return { name: field("general.empresa") || "Cobros y Pagos", address: field("general.direccion"), phone: field("general.telefono"), email: field("general.correo"),
    footerNote: field("receiptFooterNote") || "Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.",
    ...(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo) && logo.length <= 24576 ? { logoDataUrl: logo } : {}) };
}

const fail = (code: string, message: string, status = 422): never => {
  throw new DomainError(code, message, status);
};
export function safeMoney(value: bigint) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    return fail("MONEY_RANGE", "El importe excede el rango monetario permitido.");
  return Number(value);
}
const integerMoney = (value: number, positive = false) => {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0))
    fail("INVALID_AMOUNT", "El importe debe expresarse en centavos enteros válidos.");
  return BigInt(value);
};
const roundHalfUp = (numerator: bigint, denominator: bigint) =>
  (numerator * 2n + denominator) / (denominator * 2n);
export function normalizeRate(rate: string) {
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(rate))
    return fail("INVALID_RATE", "La tasa debe ser positiva y tener hasta seis decimales.");
  const [whole, decimals = ""] = rate.split(".");
  const scaled = BigInt(whole) * 1_000_000n + BigInt(decimals.padEnd(6, "0"));
  if (scaled <= 0n) return fail("INVALID_RATE", "La tasa debe ser mayor que cero.");
  return `${scaled / 1_000_000n}.${(scaled % 1_000_000n).toString().padStart(6, "0")}`;
}
const scaledRate = (rate: string) => BigInt(normalizeRate(rate).replace(".", ""));
const assertCurrency = (currency: Currency) => {
  if (!currencies.includes(currency)) fail("INVALID_CURRENCY", "Moneda no admitida.");
};
export function getCommissionPolicy(state: State): CommissionPolicy {
  const policy = state.remittances.commissionPolicy;
  return policy ? { ...policy, transactionCommissionBps: policy.transactionCommissionBps ?? 0 }
    : { revision: "default", transactionCommissionBps: 0, managerCommissionBps: 0 };
}
export function setCommissionPolicy(state: State, user: User,
  input: Pick<CommissionPolicy, "managerCommissionBps"> & Partial<Pick<CommissionPolicy, "transactionCommissionBps">>, now = new Date()) {
  remittanceOperators(state, user); assertAdmin(user);
  const current = getCommissionPolicy(state);
  const transactionCommissionBps = input.transactionCommissionBps ?? current.transactionCommissionBps;
  const managerCommissionBps = input.managerCommissionBps;
  if ([transactionCommissionBps, managerCommissionBps].some((value) => !Number.isInteger(value) || value < 0 || value > 10000))
    fail("INVALID_COMMISSION", "Los porcentajes de comisión deben estar entre 0 y 10000 BPS.");
  if (managerCommissionBps > transactionCommissionBps)
    fail("COMMISSION_EXCEEDS_TOTAL", "La comisión del gestor no puede superar la comisión total de la transacción.");
  if (current.managerCommissionBps === managerCommissionBps && current.transactionCommissionBps === transactionCommissionBps) return current;
  return state.remittances.commissionPolicy = { revision: randomUUID(), transactionCommissionBps, managerCommissionBps, updatedAt: now.toISOString(), updatedBy: user.id };
}
function manualManagerCommission(value: ManagerCommission | undefined): ManagerCommission | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3 ||
      Object.keys(value).some((key) => !["managerName", "amount", "currency"].includes(key)) ||
      typeof value.managerName !== "string" || !value.managerName.trim() || value.managerName.trim().length > 160 ||
      !Number.isSafeInteger(value.amount) || value.amount < 0 || !currencies.includes(value.currency))
    return fail("INVALID_MANAGER_COMMISSION", "Indica el gestor (hasta 160 caracteres), la moneda y una comisión manual en centavos enteros seguros.");
  return { managerName: value.managerName.trim(), amount: value.amount, currency: value.currency };
}
function latestRate(state: State, currency: Currency, date: string) {
  return state.remittances.rates.filter((rate) => rate.currency === currency && rate.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || b.id.localeCompare(a.id))[0];
}
function effectiveRate(state: State, currency: Currency, date: string, side: "source" | "destination", sameCurrency: boolean) {
  assertCurrency(currency);
  // DOP is the accounting bridge, not a foreign currency with a fallback price.
  const rate = latestRate(state, currency, date);
  if (currency === "DOP") return { ...appliedRate(rate, currency, side), date: rate?.date ?? date, changeId: rate?.changeId, changedAt: rate?.updatedAt };
  if (!rate) return fail("RATE_MISSING", `No hay una tasa registrada de ${currency} vigente al ${date}. Registra una tasa antes de cotizar.`, 409);
  const applied = appliedRate(rate, currency, side, sameCurrency);
  return { rate: normalizeRate(applied.rate), kind: applied.kind, date: rate.date, changeId: rate.changeId, changedAt: rate.updatedAt };
}
export function quoteRemittance(state: State, input: QuoteInput, now = new Date()) {
  const requested = integerMoney(input.amount, true);
  if (input.amountMode !== undefined && input.amountMode !== "source" && input.amountMode !== "destination")
    fail("INVALID_AMOUNT_MODE", "Selecciona importe de origen o destino.");
  if (input.commissionBps !== undefined && (!Number.isInteger(input.commissionBps) || input.commissionBps < 0 || input.commissionBps > 10000))
    fail("INVALID_COMMISSION", "La comisión debe estar entre 0 y 10000 BPS.");
  const date = businessDate(now);
  const source = effectiveRate(state, input.sourceCurrency, date, "source", input.sourceCurrency === input.destinationCurrency);
  const destination = effectiveRate(state, input.destinationCurrency, date, "destination", input.sourceCurrency === input.destinationCurrency);
  const sourceRate = source.rate, destinationRate = destination.rate;
  const amount = input.amountMode === "destination" ? roundHalfUp(requested * scaledRate(destinationRate), scaledRate(sourceRate)) : requested;
  integerMoney(safeMoney(amount), true);
  const policy = getCommissionPolicy(state);
  if (policy.managerCommissionBps > policy.transactionCommissionBps)
    fail("COMMISSION_EXCEEDS_TOTAL", "Un administrador debe revisar la configuración: la comisión del gestor supera la comisión total de la transacción.");
  if (input.commissionBps !== undefined && input.commissionBps !== policy.transactionCommissionBps)
    fail("COMMISSION_POLICY_MISMATCH", "La comisión se toma de la configuración guardada. Actualiza y vuelve a cotizar.", 409);
  const commissionBps = policy.transactionCommissionBps;
  const commissionAmount = safeMoney(roundHalfUp(amount * BigInt(commissionBps), 10000n));
  const receiveAmount = safeMoney(roundHalfUp(amount * scaledRate(sourceRate), scaledRate(destinationRate)));
  if (receiveAmount === 0) fail("AMOUNT_TOO_SMALL", "El importe recibido se redondea a cero.");
  const transactionAmount = safeMoney(roundHalfUp(BigInt(commissionAmount) * scaledRate(sourceRate), scaledRate(destinationRate)));
  const managerAmount = safeMoney(roundHalfUp(BigInt(receiveAmount) * BigInt(policy.managerCommissionBps), 10000n));
  if (managerAmount > transactionAmount)
    fail("COMMISSION_EXCEEDS_TOTAL", "La comisión del gestor supera la comisión de la transacción. Revisa los porcentajes antes de cotizar.");
  const commissionAllocation: CommissionAllocation = { version: 1, currency: input.destinationCurrency, policyRevision: policy.revision,
    managerCommissionBps: policy.managerCommissionBps, baseAmount: receiveAmount, transactionAmount, managerAmount, companyAmount: transactionAmount - managerAmount };
  // Very large legacy quotes may be representable in the currency pair but not DOP.
  // Leave that indicative equivalent unavailable rather than corrupting a valid quote.
  const dop = roundHalfUp(amount * scaledRate(sourceRate), 1_000_000n);
  return {
    sourceCurrency: input.sourceCurrency, destinationCurrency: input.destinationCurrency, amount: safeMoney(amount), commissionBps,
    ...(dop <= BigInt(Number.MAX_SAFE_INTEGER) ? { amountDop: safeMoney(dop) } : {}), commissionAllocation,
    ...(input.amountMode === "destination" ? { requestedReceiveAmount: input.amount, receiveRoundingDifference: receiveAmount - input.amount } : {}),
    commissionAmount, totalAmount: safeMoney(amount + BigInt(commissionAmount)),
    receiveAmount, quote: { date, sourceRate, destinationRate, quotedAt: now.toISOString(),
      sourceRateDate: source.date, destinationRateDate: destination.date,
      sourceRateKind: source.kind, destinationRateKind: destination.kind,
      commissionPolicyRevision: policy.revision, managerCommissionBps: policy.managerCommissionBps,
      ...(source.changeId ? { sourceRateChangeId: source.changeId } : {}),
      ...(destination.changeId ? { destinationRateChangeId: destination.changeId } : {}),
      ...(source.changedAt ? { sourceRateChangedAt: source.changedAt } : {}),
      ...(destination.changedAt ? { destinationRateChangedAt: destination.changedAt } : {}),
    },
  };
}
export function setDailyRate(state: State, user: User, input: Pick<ExchangeRate, "currency" | "rate" | "date" | "purchaseRate" | "saleRate">, now = new Date()) {
  remittanceOperators(state, user);
  assertAdmin(user);
  assertCurrency(input.currency);
  if (input.date !== businessDate(now)) fail("RATE_DATE", "Solo puedes registrar tasas de la fecha de negocio actual.");
  const rate = normalizeRate(input.rate);
  if (input.currency === "DOP" && rate !== "1.000000") fail("DOP_RATE", "La tasa DOP debe ser uno.");
  const existing = state.remittances.rates.find((r) => r.currency === input.currency && r.date === input.date);
  if ((input.purchaseRate === undefined) !== (input.saleRate === undefined)) fail("RATE_PAIR_REQUIRED", "Registra compra y venta juntas.");
  const purchaseRate = input.purchaseRate === undefined ? existing?.purchaseRate : normalizeRate(input.purchaseRate);
  const saleRate = input.saleRate === undefined ? existing?.saleRate : normalizeRate(input.saleRate);
  if (input.currency === "DOP" && ((purchaseRate !== undefined && purchaseRate !== "1.000000") || (saleRate !== undefined && saleRate !== "1.000000")))
    fail("DOP_RATE", "Las tasas de compra y venta de DOP deben ser uno.");
  const commercial = purchaseRate !== undefined && saleRate !== undefined ? { purchaseRate, saleRate } : {};
  // A retry/no-op does not manufacture a change. A legacy rate obtains its first
  // known timestamp only when explicitly confirmed; its earlier time stays unknown.
  if (existing?.changeId && existing.rate === rate && existing.purchaseRate === purchaseRate && existing.saleRate === saleRate) return existing;
  const change: RateChange = { id: randomUUID(), currency: input.currency, date: input.date, rate, ...commercial, createdAt: now.toISOString(), actorId: user.id };
  (state.remittances.rateHistory ??= []).push(change);
  const metadata = { changeId: change.id, updatedAt: change.createdAt, updatedBy: change.actorId };
  if (existing) { Object.assign(existing, { rate, ...commercial, ...metadata }); return existing; }
  const row = { currency: input.currency, date: input.date, rate, ...commercial, id: randomUUID(), ...metadata };
  state.remittances.rates.push(row);
  return row;
}
// Office desks (Usuario, Cajero) serve any client and see only their own business.
const isRemittanceDesk = (role: string) => role === "cashier";
export function remittanceOperators(state: State, user: User, systemOperators: User[] = []) {
  const account = state.accounts.find((a) => a.id === user.id);
  if (account && (account.status !== "active" || account.role !== user.role || account.collectorId !== user.collectorId))
    fail("SESSION_EXPIRED", "La cuenta cambió. Inicia sesión de nuevo.", 401);
  // Only the business identity: the token payload also carries session fields.
  const self: User = { id: user.id, name: user.name, role: user.role, ...(user.collectorId ? { collectorId: user.collectorId } : {}) };
  if (user.access) self.access = user.access;
  if (user.role !== "admin") return user.role === "collector" || (isRemittanceDesk(user.role) && hasRemittanceAccess(user)) ? [self] : [];
  const accounts: User[] = state.accounts.filter((a) => a.status === "active" && (a.role === "admin" || a.role === "collector" || (isRemittanceDesk(a.role) && hasRemittanceAccess({ role: a.role, access: effectiveAccess(a.role, a) })))).map((a) => ({
    id: a.id, name: a.name, role: a.role, ...(a.collectorId ? { collectorId: a.collectorId } : {}),
    access: effectiveAccess(a.role, a),
  }));
  return [...new Map([...systemOperators, ...accounts, self].map((operator) => [operator.id, operator])).values()];
}
function operator(state: State, user: User, id: string, systemOperators: User[]) {
  const result = remittanceOperators(state, user, systemOperators).find((o) => o.id === id);
  if (!result) return fail("OPERATOR_FORBIDDEN", "Selecciona un operador activo autorizado.", 403);
  if (result.role === "collector" && !state.collectors.some((collector) => collector.id === result.collectorId && collector.active !== false))
    return fail("OPERATOR_INACTIVE", "El cobrador de este operador está inactivo o no existe.", 409);
  return result;
}
function clientInRoute(state: State, user: User, clientId: string) {
  if (user.role === "admin") return true;
  if (isRemittanceDesk(user.role) && hasRemittanceAccess(user)) return true;
  const client = state.clients.find((c) => c.id === clientId);
  return !!client && state.routes.some((r) => r.id === client.routeId && r.collectorId === user.collectorId);
}
// Supervision reads every operation, like administration; its permissions never include
// paying, cancelling or closing, and the API keeps it read-only.
const readsAllOperations = (user: User) => user.role === "admin" || user.role === "supervisor";
export function canSeeOutgoing(state: State, user: User, transfer: Remittance) {
  if (!hasRemittancePermission(user, "remittances.view")) return false;
  if (isRemittanceDesk(user.role)) return transfer.sendingUserId === user.id;
  return readsAllOperations(user) || transfer.sendingUserId === user.id || clientInRoute(state, user, transfer.senderClientId);
}
export function canSeeReceipt(state: State, user: User, transfer: Remittance) {
  if (!hasRemittancePermission(user, "remittances.receipts")) return false;
  if (isRemittanceDesk(user.role)) return transfer.status === "pending" || transfer.paidBy === user.id;
  return readsAllOperations(user) || clientInRoute(state, user, transfer.recipientClientId);
}
export function canReportTransfer(state: State, user: User, transfer: Remittance) {
  if (isRemittanceDesk(user.role)) return transfer.sendingUserId === user.id || transfer.paidBy === user.id;
  return readsAllOperations(user) || transfer.sendingUserId === user.id || clientInRoute(state, user, transfer.senderClientId) || clientInRoute(state, user, transfer.recipientClientId);
}
export function transferView(state: State, user: User, transfer: Remittance) {
  return {
    ...transfer,
    canPay: hasRemittancePermission(user, "remittances.pay") && transfer.status === "pending" && canSeeReceipt(state, user, transfer),
    canCancel: hasRemittancePermission(user, "remittances.cancel") && transfer.status === "pending" && (user.role === "admin" || transfer.sendingUserId === user.id),
  };
}
export function cashBalance(state: State, cash: CashSession) {
  const sums = { sent: 0n, cancelled: 0n, paid: 0n };
  for (const event of state.remittances.events) {
    if (event.cashSessionId === cash.id && event.type in sums)
      sums[event.type as keyof typeof sums] += BigInt(event.amount);
  }
  return {
    sentTotal: safeMoney(sums.sent), cancelRefund: safeMoney(sums.cancelled), paid: safeMoney(sums.paid),
    expected: safeMoney(BigInt(cash.openingAmount) + sums.sent - sums.cancelled - sums.paid),
  };
}
export const cashView = (state: State, user: User, cash: CashSession) => ({
  ...cash, ...cashBalance(state, cash), canClose: hasRemittancePermission(user, "remittances.cash.close") && cash.status === "open" && (user.role === "admin" || cash.operatorId === user.id),
});
function assertCashMovement(state: State, cash: CashSession, type: "sent" | "paid" | "cancelled", amount: number) {
  const balance = cashBalance(state, cash);
  const total = type === "sent" ? balance.sentTotal : type === "paid" ? balance.paid : balance.cancelRefund;
  safeMoney(BigInt(total) + BigInt(amount));
  safeMoney(BigInt(balance.expected) + (type === "sent" ? BigInt(amount) : -BigInt(amount)));
}
function addEvent(state: State, user: User, cash: CashSession, type: RemittanceEvent["type"], amount: number, now: Date, transferId?: string, reason?: string, refund?: RemittanceRefund) {
  state.remittances.events.push({
    id: randomUUID(), type, cashSessionId: cash.id, operatorId: cash.operatorId, currency: cash.currency,
    amount, actorId: user.id, createdAt: now.toISOString(), ...(transferId ? { transferId } : {}), ...(reason ? { reason } : {}), ...(refund ? { refund } : {}),
  });
}
function currentCash(state: State, operatorId: string, currency: Currency, now: Date) {
  const cash = state.remittances.cashSessions.find((c) => c.operatorId === operatorId && c.currency === currency && c.date === businessDate(now));
  if (!cash || cash.status !== "open") return fail("CASH_NOT_OPEN", "Abre la caja del operador y moneda para la fecha actual.", 409);
  return cash;
}
export function openRemittanceCash(state: State, user: User, input: { operatorId: string; currency: Currency; openingAmount: number }, systemOperators: User[] = [], now = new Date()) {
  // Administration opens any cash box; a cashier with the permission opens only his own.
  if (user.role === "cashier") {
    if (input.operatorId !== user.id || !hasRemittancePermission(user, "remittances.cash.open"))
      fail("FORBIDDEN", "Solo puedes abrir tu propia caja de remesas.", 403);
  } else assertAdmin(user);
  operator(state, user, input.operatorId, systemOperators);
  assertCurrency(input.currency);
  integerMoney(input.openingAmount);
  const date = businessDate(now);
  const previous = state.remittances.cashSessions.filter((c) => c.operatorId === input.operatorId && c.currency === input.currency);
  if (previous.some((c) => c.date === date)) fail("CASH_EXISTS", "Ya existe una caja para ese operador, moneda y fecha.", 409);
  if (previous.some((c) => c.status === "open")) fail("PREVIOUS_CASH_OPEN", "Cierra la caja anterior antes de abrir otra.", 409);
  const cash: CashSession = { id: randomUUID(), ...input, date, openedBy: user.id, openedAt: now.toISOString(), status: "open" };
  state.remittances.cashSessions.push(cash);
  addEvent(state, user, cash, "opened", cash.openingAmount, now);
  return cashView(state, user, cash);
}
export function closeRemittanceCash(state: State, user: User, id: string, countedAmount: number, now = new Date()) {
  remittanceOperators(state, user);
  const cash = state.remittances.cashSessions.find((c) => c.id === id);
  if (!cash) return fail("CASH_NOT_FOUND", "Caja no encontrada.", 404);
  if (user.role !== "admin" && cash.operatorId !== user.id) fail("FORBIDDEN", "No puedes cerrar la caja de otro operador.", 403);
  if (cash.status !== "open") fail("CASH_CLOSED", "La caja ya está cerrada.", 409);
  integerMoney(countedAmount);
  if (countedAmount !== cashBalance(state, cash).expected) fail("CASH_UNBALANCED", "El contado debe coincidir exactamente con el saldo esperado.", 409);
  cash.status = "closed"; cash.closedBy = user.id; cash.closedAt = now.toISOString(); cash.countedAmount = countedAmount;
  addEvent(state, user, cash, "closed", countedAmount, now);
  return cashView(state, user, cash);
}
export function createRemittance(state: State, user: User, input: CreateRemittanceInput, systemOperators: User[] = [], now = new Date()) {
  const managerCommission = manualManagerCommission(input.managerCommission);
  const sendingUser = operator(state, user, input.sendingUserId ?? user.id, systemOperators);
  if (!hasRemittancePermission(sendingUser, "remittances.create")) fail("OPERATOR_FORBIDDEN", "El operador seleccionado no tiene permiso para registrar envíos.", 403);
  if (input.senderClientId === input.recipientClientId) fail("SAME_CLIENT", "Remitente y destinatario deben ser distintos.");
  for (const id of [input.senderClientId, input.recipientClientId]) {
    const client = state.clients.find((c) => c.id === id);
    if (!client) fail("CLIENT_NOT_FOUND", "Cliente no encontrado.", 404);
    if (client!.active === false) fail("CLIENT_INACTIVE", "No puedes registrar envíos con clientes inactivos.", 409);
  }
  if (!clientInRoute(state, sendingUser, input.senderClientId)) fail("FORBIDDEN", "El remitente no pertenece a la ruta del operador.", 403);
  if (input.quote.date !== businessDate(now)) fail("QUOTE_CHANGED", "La fecha cambió. Vuelve a cotizar antes de guardar.", 409);
  const policy = getCommissionPolicy(state);
  if ((input.quote.commissionPolicyRevision !== undefined && input.quote.commissionPolicyRevision !== policy.revision) ||
      (input.quote.managerCommissionBps !== undefined && input.quote.managerCommissionBps !== policy.managerCommissionBps) ||
      (input.quote.commissionPolicyRevision === undefined && policy.revision !== "default"))
    fail("QUOTE_CHANGED", "La política de comisiones cambió. Vuelve a cotizar antes de guardar.", 409);
  const calculated = quoteRemittance(state, {
    amount: input.requestedReceiveAmount ?? input.amount, amountMode: input.requestedReceiveAmount === undefined ? "source" : "destination", commissionBps: input.commissionBps,
    sourceCurrency: input.sourceCurrency, destinationCurrency: input.destinationCurrency,
  }, now);
  if (input.quote.date !== calculated.quote.date || input.quote.sourceRate !== calculated.quote.sourceRate || input.quote.destinationRate !== calculated.quote.destinationRate ||
      input.quote.sourceRateChangeId !== calculated.quote.sourceRateChangeId || input.quote.destinationRateChangeId !== calculated.quote.destinationRateChangeId ||
      (input.quote.sourceRateDate !== undefined && input.quote.sourceRateDate !== calculated.quote.sourceRateDate) ||
      (input.quote.sourceRateKind !== undefined && input.quote.sourceRateKind !== calculated.quote.sourceRateKind) ||
      (input.quote.destinationRateKind !== undefined && input.quote.destinationRateKind !== calculated.quote.destinationRateKind) ||
      (input.quote.destinationRateDate !== undefined && input.quote.destinationRateDate !== calculated.quote.destinationRateDate))
    fail("QUOTE_CHANGED", "La fecha o la tasa cambió. Vuelve a cotizar antes de guardar.", 409);
  if (calculated.amount !== input.amount) fail("QUOTE_CHANGED", "El principal no coincide con el cálculo del importe de destino. Vuelve a cotizar.", 409);
  let received;
  try { received = paymentAmounts(calculated.totalAmount, input.payment); }
  catch (error) { if (error instanceof PaymentValidationError) return fail(error.code, error.message); throw error; }
  const payment: RemittancePayment = { ...received, version: 1, confirmedBy: user.id, confirmedAt: now.toISOString() };
  const cash = currentCash(state, sendingUser.id, input.sourceCurrency, now);
  assertCashMovement(state, cash, "sent", cashReceivedForTransfer(calculated.totalAmount, payment));
  const recipientContact = contactSnapshot(state, input.recipientClientId);
  const recipientPhone = (input.recipientPhone ?? "").trim();
  // Numbers are compared by their digits: the same phone written with other separators is not a new one.
  const phoneDigits = (value: string) => value.replace(/\D/g, "");
  if (recipientPhone && phoneDigits(recipientPhone) !== phoneDigits(recipientContact.phone)) {
    if (phoneDigits(recipientPhone) === phoneDigits(recipientContact.cellular)) {
      // It is the cellular of the record: it goes first in the copy and the other number stays second.
      recipientContact.cellular = recipientContact.phone;
    } else {
      // A new number: the previous phone moves to the cellular slot of the copy when that one is free.
      if (recipientContact.phone && !recipientContact.cellular) recipientContact.cellular = recipientContact.phone;
      // Only administration maintains client records: it completes an empty phone, never replaces one.
      const recipient = state.clients.find((row) => row.id === input.recipientClientId);
      if (user.role === "admin" && recipient && !recipient.phone) recipient.phone = recipientPhone;
    }
    recipientContact.phone = recipientPhone;
  }
  const sequence = state.remittances.transfers.reduce((max, t) => Math.max(max, t.sequence), 0) + 1;
  if (sequence > 99999999) fail("SEQUENCE_EXHAUSTED", "Se agotó la numeración de envíos.", 409);
  const transfer: Remittance = {
    id: randomUUID(), sequence, envioReference: `ENV${String(sequence).padStart(8, "0")}`,
    reciboReference: `REC${String(sequence).padStart(8, "0")}`, operatingCode: randomBytes(8).toString("hex").toUpperCase(),
    senderClientId: input.senderClientId, recipientClientId: input.recipientClientId,
    sendingUserId: sendingUser.id, registeredBy: user.id, ...calculated,
    commissionAllocation: { ...calculated.commissionAllocation, managerId: sendingUser.id, managerName: sendingUser.name },
    note: (input.note ?? "").trim(), status: "pending", createdAt: now.toISOString(),
    senderContact: contactSnapshot(state, input.senderClientId), recipientContact,
    payment, receiptIssuer: remittanceReceiptIssuer(state),
    ...(managerCommission === undefined ? {} : { managerCommission }),
  };
  state.remittances.transfers.push(transfer);
  addEvent(state, user, cash, "sent", cashReceivedForTransfer(transfer.totalAmount, payment), now, transfer.id);
  return transferView(state, user, transfer);
}
function contactSnapshot(state: State, id: string): RemittanceContact {
  const client = state.clients.find((row) => row.id === id)!;
  return { id: client.id, code: client.code, name: client.name, phone: client.phone ?? "",
    cellular: client.cellular ?? "", address: client.address ?? "", ...(client.identification ? { identification: client.identification } : {}) };
}
function pendingTransfer(state: State, user: User, id: string) {
  const transfer = state.remittances.transfers.find((t) => t.id === id);
  if (!transfer || (!canSeeOutgoing(state, user, transfer) && !canSeeReceipt(state, user, transfer)))
    return fail("TRANSFER_NOT_FOUND", "Envío no encontrado.", 404);
  if (transfer.status !== "pending") fail("TRANSFER_NOT_PENDING", "El envío ya está pagado o cancelado.", 409);
  return transfer;
}
export function payRemittance(state: State, user: User, id: string, now = new Date()) {
  remittanceOperators(state, user);
  const transfer = pendingTransfer(state, user, id);
  if (!canSeeReceipt(state, user, transfer)) fail("FORBIDDEN", "El destinatario no pertenece a tu ruta.", 403);
  const cash = currentCash(state, user.id, transfer.destinationCurrency, now);
  if (cashBalance(state, cash).expected < transfer.receiveAmount) fail("INSUFFICIENT_CASH", "La caja no tiene fondos suficientes para pagar el recibo.", 409);
  assertCashMovement(state, cash, "paid", transfer.receiveAmount);
  transfer.status = "paid"; transfer.paidAt = now.toISOString(); transfer.paidBy = user.id;
  addEvent(state, user, cash, "paid", transfer.receiveAmount, now, transfer.id);
  return transferView(state, user, transfer);
}
export function cancelRemittance(state: State, user: User, id: string, reason: string, now = new Date(), refundInput?: RemittanceRefundInput) {
  remittanceOperators(state, user);
  const transfer = pendingTransfer(state, user, id);
  if (user.role !== "admin" && transfer.sendingUserId !== user.id) fail("FORBIDDEN", "Solo el operador del envío o administración puede cancelarlo.", 403);
  if (!reason.trim() || reason.trim().length > 500) fail("REASON_REQUIRED", "Indica un motivo de cancelación de hasta 500 caracteres.");
  let refund: RemittanceRefund | undefined;
  if (transfer.payment && transfer.payment.method !== "cash") {
    if (!refundInput || refundInput.verified !== true || typeof refundInput.reference !== "string" || !refundInput.reference.trim() || refundInput.reference.length > 160 || /[\p{Cc}\p{Cf}]/u.test(refundInput.reference))
      fail("REFUND_NOT_VERIFIED", "Confirma la devolución por el banco o la terminal y escribe su referencia antes de anular este envío.");
    refund = { method: transfer.payment.method, reference: refundInput!.reference.trim(), confirmedBy: user.id, confirmedAt: now.toISOString() };
  } else if (refundInput !== undefined) fail("INVALID_PAYMENT", "La devolución de efectivo no requiere comprobante bancario.");
  const cash = currentCash(state, transfer.sendingUserId, transfer.sourceCurrency, now);
  const cashRefund = cashReceivedForTransfer(transfer.totalAmount, transfer.payment);
  if (cashBalance(state, cash).expected < cashRefund) fail("INSUFFICIENT_CASH", "La caja de origen no tiene fondos para devolver principal y comisión.", 409);
  assertCashMovement(state, cash, "cancelled", cashRefund);
  transfer.status = "cancelled"; transfer.cancelledAt = now.toISOString(); transfer.cancelledBy = user.id; transfer.cancelReason = reason.trim();
  if (refund) transfer.refund = refund;
  addEvent(state, user, cash, "cancelled", cashRefund, now, transfer.id, reason.trim(), refund);
  return transferView(state, user, transfer);
}
// Names of the operators that appear in what the account sees: its operations, its boxes and the rows of its
// reports, also of disabled accounts. A receipt, a box or a report shows a name, never an internal id. Only id
// and name: no role, access or route, and no operator the account does not already see.
function visibleOperatorNames(state: State, user: User, systemOperators: User[], transfers: Remittance[], cashSessions: CashSession[]) {
  const reports = hasRemittancePermission(user, "remittances.reports");
  const ids = new Set([
    ...[...transfers, ...(reports ? state.remittances.transfers.filter((t) => canReportTransfer(state, user, t)) : [])]
      .flatMap((t) => [t.sendingUserId, t.registeredBy, t.paidBy, t.cancelledBy]),
    ...[...cashSessions, ...(reports ? state.remittances.cashSessions.filter((c) => readsAllOperations(user) || c.operatorId === user.id) : [])]
      .map((c) => c.operatorId),
  ]);
  const names = new Map<string, string>([...systemOperators, ...state.accounts, user].map((row) => [row.id, row.name]));
  return Object.fromEntries([...ids].flatMap((id) => id && names.has(id) ? [[id, names.get(id)!]] : []));
}
export function remittanceSnapshot(state: State, user: User, systemOperators: User[] = [], now = new Date()) {
  const date = businessDate(now);
  const canViewRates = hasRemittancePermission(user, "remittances.rates.view");
  const effectiveRateIds = canViewRates ? undefined : new Set(currencies.map((currency) => latestRate(state, currency, date)?.id));
  const transfers = state.remittances.transfers.filter((t) => canSeeOutgoing(state, user, t) || canSeeReceipt(state, user, t));
  const cashSessions = hasRemittancePermission(user, "remittances.cash.view") ? state.remittances.cashSessions.filter((c) => readsAllOperations(user) || c.operatorId === user.id) : [];
  const operators = remittanceOperators(state, user, systemOperators);
  // Consultation only: just the clients of the visible operations, so rows saved before the frozen
  // contacts existed still show their names. Saved contacts are never rebuilt from the catalog.
  const referenced = new Set(transfers.flatMap((t) => [t.senderClientId, t.recipientClientId]));
  const catalog = hasRemittancePermission(user, "remittances.create") || hasRemittancePermission(user, "remittances.receipts") ? state.clients
    : hasRemittancePermission(user, "remittances.view") ? state.clients.filter((c) => referenced.has(c.id)) : [];
  return {
    businessDate: date, currencies, access: user.access ?? effectiveAccess(user.role),
    commissionPolicy: getCommissionPolicy(state),
    receiptFooterNote: typeof state.systemConfig?.receiptFooterNote === "string" ? state.systemConfig.receiptFooterNote : "",
    receiptIssuer: remittanceReceiptIssuer(state),
    clients: catalog.map((c) => ({ id: c.id, code: c.code, name: c.name, routeId: c.routeId, active: c.active !== false, preferredCurrency: c.preferredCurrency ?? "DOP",
      canSendFrom: clientInRoute(state, user, c.id), canReceive: clientInRoute(state, user, c.id) })),
    clientRoutes: hasRemittancePermission(user, "remittances.clients.create") ? state.routes.filter((route) => user.role !== "collector" || route.collectorId === user.collectorId).map(({ id, name }) => ({ id, name })) : [],
    operators: operators.map(({ access: _access, ...row }) => row),
    // Only these operators can register remittances, so only they are valid for «Operador del envío».
    // The others stay in `operators` because administration may still open their cash box to pay receipts.
    sendingOperatorIds: operators.filter((operator) => hasRemittancePermission(operator, "remittances.create")).map(({ id }) => id),
    operatorNames: visibleOperatorNames(state, user, systemOperators, transfers, cashSessions),
    rates: [latestRate(state, "DOP", date) ?? { id: `DOP-${date}`, currency: "DOP" as Currency, rate: "1.000000", date },
      ...state.remittances.rates.filter((r) => r.currency !== "DOP" && (canViewRates || effectiveRateIds?.has(r.id)))]
      .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.currency.localeCompare(b.currency))
      .map(({ updatedBy, ...row }) => ({ ...row, ...(user.role === "admin" && updatedBy ? { updatedBy } : {}) })),
    rateHistory: user.role === "admin" && hasRemittancePermission(user, "remittances.rates.view") ? [...(state.remittances.rateHistory ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date) || b.id.localeCompare(a.id)) : [],
    transfers: transfers.map((t) => transferView(state, user, t)),
    cashSessions: cashSessions.map((c) => cashView(state, user, c)),
  };
}
export function remittanceReports(state: State, user: User, input: { from: string; to: string; grouping: "range" | "day" }) {
  if (input.from > input.to) fail("INVALID_DATE_RANGE", "La fecha inicial no puede superar la final.", 400);
  const within = (timestamp: string) => { const date = businessDate(new Date(timestamp)); return date >= input.from && date <= input.to; };
  const groupDate = (timestamp: string) => input.grouping === "day" ? businessDate(new Date(timestamp)) : `${input.from}/${input.to}`;
  const visible = state.remittances.transfers.filter((t) => canReportTransfer(state, user, t));
  type AmountRow = { date: string; sourceCurrency: Currency; destinationCurrency: Currency; count: number; pendingCount: number; paidCount: number; cancelledCount: number; amount: number; commissionAmount: number; totalAmount: number; receiveAmount: number };
  const amounts = new Map<string, AmountRow>();
  type CommissionTotal = { date: string; currency: Currency; count: number; commissionAmount: number; cancelledCount: number; cancelledCommissionAmount: number };
  const commissionTotals = new Map<string, CommissionTotal>();
  const commissionDetails: Array<Pick<Remittance, "id" | "envioReference" | "createdAt" | "sendingUserId" | "senderClientId" | "recipientClientId" | "sourceCurrency" | "destinationCurrency" | "amount" | "commissionBps" | "commissionAmount" | "status">> = [];
  type ManagerCommissionTotal = ManagerCommission & { date: string; count: number; cancelledCount: number; cancelledAmount: number };
  const managerCommissionTotals = new Map<string, ManagerCommissionTotal>();
  const managerCommissionDetails: Array<ManagerCommission & Pick<Remittance, "id" | "envioReference" | "createdAt" | "status">> = [];
  type AllocationTotal = { date: string; currency: Currency; managerId: string; managerName: string; count: number; cancelledCount: number;
    transactionAmount: number; companyAmount: number; managerAmount: number; cancelledTransactionAmount: number; cancelledCompanyAmount: number; cancelledManagerAmount: number };
  const allocationTotals = new Map<string, AllocationTotal>();
  const allocationDetails: Array<CommissionAllocation & Pick<Remittance, "id" | "envioReference" | "createdAt" | "status">> = [];
  const delivered = new Map<string, { date: string; currency: Currency; count: number; amount: number }>();
  const deliveryTimes: { id: string; envioReference: string; createdAt: string; paidAt: string; elapsedSeconds: number }[] = [];
  for (const transfer of visible) {
    if (within(transfer.createdAt)) {
      const date = groupDate(transfer.createdAt), key = `${date}:${transfer.sourceCurrency}:${transfer.destinationCurrency}`;
      const row = amounts.get(key) ?? { date, sourceCurrency: transfer.sourceCurrency, destinationCurrency: transfer.destinationCurrency, count: 0, pendingCount: 0, paidCount: 0, cancelledCount: 0, amount: 0, commissionAmount: 0, totalAmount: 0, receiveAmount: 0 };
      row.count++; row[`${transfer.status}Count`]++;
      if (transfer.status !== "cancelled") for (const field of ["amount", "commissionAmount", "totalAmount", "receiveAmount"] as const)
        row[field] = safeMoney(BigInt(row[field]) + BigInt(transfer[field]));
      amounts.set(key, row);
      commissionDetails.push({ id: transfer.id, envioReference: transfer.envioReference, createdAt: transfer.createdAt,
        sendingUserId: transfer.sendingUserId, senderClientId: transfer.senderClientId, recipientClientId: transfer.recipientClientId,
        sourceCurrency: transfer.sourceCurrency, destinationCurrency: transfer.destinationCurrency, amount: transfer.amount,
        commissionBps: transfer.commissionBps, commissionAmount: transfer.commissionAmount, status: transfer.status });
      const commissionKey = `${date}:${transfer.sourceCurrency}`;
      const commission = commissionTotals.get(commissionKey) ?? { date, currency: transfer.sourceCurrency, count: 0, commissionAmount: 0, cancelledCount: 0, cancelledCommissionAmount: 0 };
      if (transfer.status === "cancelled") {
        commission.cancelledCount++;
        commission.cancelledCommissionAmount = safeMoney(BigInt(commission.cancelledCommissionAmount) + BigInt(transfer.commissionAmount));
      } else {
        commission.count++;
        commission.commissionAmount = safeMoney(BigInt(commission.commissionAmount) + BigInt(transfer.commissionAmount));
      }
      commissionTotals.set(commissionKey, commission);
      const allocation = transfer.commissionAllocation;
      if (allocation?.managerId && allocation.managerName) {
        allocationDetails.push({ ...allocation, id: transfer.id, envioReference: transfer.envioReference, createdAt: transfer.createdAt, status: transfer.status });
        const key = JSON.stringify([date, allocation.currency, allocation.managerId]);
        const total = allocationTotals.get(key) ?? { date, currency: allocation.currency, managerId: allocation.managerId, managerName: allocation.managerName,
          count: 0, cancelledCount: 0, transactionAmount: 0, companyAmount: 0, managerAmount: 0, cancelledTransactionAmount: 0, cancelledCompanyAmount: 0, cancelledManagerAmount: 0 };
        if (transfer.status === "cancelled") {
          total.cancelledCount++;
          total.cancelledTransactionAmount = safeMoney(BigInt(total.cancelledTransactionAmount) + BigInt(allocation.transactionAmount));
          total.cancelledCompanyAmount = safeMoney(BigInt(total.cancelledCompanyAmount) + BigInt(allocation.companyAmount));
          total.cancelledManagerAmount = safeMoney(BigInt(total.cancelledManagerAmount) + BigInt(allocation.managerAmount));
        } else {
          total.count++;
          for (const field of ["transactionAmount", "companyAmount", "managerAmount"] as const) total[field] = safeMoney(BigInt(total[field]) + BigInt(allocation[field]));
        }
        allocationTotals.set(key, total);
      }
      if (transfer.managerCommission) {
        const manual = transfer.managerCommission;
        managerCommissionDetails.push({ id: transfer.id, envioReference: transfer.envioReference,
          createdAt: transfer.createdAt, status: transfer.status, ...manual });
        // A literal manually entered name is a reporting label, never a user/role lookup.
        const managerKey = JSON.stringify([date, manual.managerName, manual.currency]);
        const manager = managerCommissionTotals.get(managerKey) ?? { date, managerName: manual.managerName,
          currency: manual.currency, count: 0, amount: 0, cancelledCount: 0, cancelledAmount: 0 };
        if (transfer.status === "cancelled") {
          manager.cancelledCount++;
          manager.cancelledAmount = safeMoney(BigInt(manager.cancelledAmount) + BigInt(manual.amount));
        } else {
          manager.count++;
          manager.amount = safeMoney(BigInt(manager.amount) + BigInt(manual.amount));
        }
        managerCommissionTotals.set(managerKey, manager);
      }
    }
    if (transfer.status === "paid" && transfer.paidAt && within(transfer.paidAt)) {
      deliveryTimes.push({ id: transfer.id, envioReference: transfer.envioReference, createdAt: transfer.createdAt, paidAt: transfer.paidAt, elapsedSeconds: Math.max(0, Math.floor((Date.parse(transfer.paidAt) - Date.parse(transfer.createdAt)) / 1000)) });
      const date = groupDate(transfer.paidAt), key = `${date}:${transfer.destinationCurrency}`;
      const row = delivered.get(key) ?? { date, currency: transfer.destinationCurrency, count: 0, amount: 0 };
      row.count++; row.amount = safeMoney(BigInt(row.amount) + BigInt(transfer.receiveAmount)); delivered.set(key, row);
    }
  }
  const timeGroups = new Map<string, { date: string; count: number; minSeconds: number; maxSeconds: number; totalSeconds: bigint }>();
  for (const row of deliveryTimes) {
    const date = groupDate(row.paidAt);
    const group = timeGroups.get(date) ?? { date, count: 0, minSeconds: row.elapsedSeconds, maxSeconds: row.elapsedSeconds, totalSeconds: 0n };
    group.count++; group.minSeconds = Math.min(group.minSeconds, row.elapsedSeconds); group.maxSeconds = Math.max(group.maxSeconds, row.elapsedSeconds);
    group.totalSeconds += BigInt(row.elapsedSeconds); timeGroups.set(date, group);
  }
  const deliveryTimeSummary = [...timeGroups.values()].map(({ totalSeconds, ...row }) => ({ ...row, averageSeconds: safeMoney(totalSeconds) / row.count }));
  const cash = state.remittances.cashSessions.filter((c) => c.date >= input.from && c.date <= input.to && (readsAllOperations(user) || c.operatorId === user.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.openedAt.localeCompare(b.openedAt)).map((c) => cashView(state, user, c));
  type CashSummary = { operatorId: string; currency: Currency; date: string; sessionCount: number; sentTotal: number; cancelRefund: number; paid: number; firstOpening: number; lastExpected: number };
  const cashGroups = new Map<string, CashSummary>();
  for (const row of cash) {
    const date = input.grouping === "day" ? row.date : `${input.from}/${input.to}`;
    const key = `${row.operatorId}:${row.currency}:${date}`;
    const group = cashGroups.get(key) ?? { operatorId: row.operatorId, currency: row.currency, date, sessionCount: 0, sentTotal: 0, cancelRefund: 0, paid: 0, firstOpening: row.openingAmount, lastExpected: row.expected };
    group.sessionCount++; group.lastExpected = row.expected;
    for (const field of ["sentTotal", "cancelRefund", "paid"] as const) group[field] = safeMoney(BigInt(group[field]) + BigInt(row[field]));
    cashGroups.set(key, group);
  }
  return { ...input, amounts: [...amounts.values()], commissions: { details: commissionDetails, totals: [...commissionTotals.values()] },
    commissionAllocations: { details: allocationDetails, totals: [...allocationTotals.values()] },
    managerCommissions: { details: managerCommissionDetails, totals: [...managerCommissionTotals.values()] },
    deliveryTimes, deliveryTimeSummary, delivered: [...delivered.values()], cash, cashSummary: [...cashGroups.values()] };
}
