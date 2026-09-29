import { randomBytes, randomUUID } from "node:crypto";
import { assertAdmin, businessDate, DomainError, type State, type User } from "./domain.js";

export const currencies = ["DOP", "USD", "EUR"] as const;
export type Currency = (typeof currencies)[number];
export type Quote = { date: string; sourceRate: string; destinationRate: string };
export type ExchangeRate = { id: string; currency: Currency; rate: string; date: string };
export type Remittance = {
  id: string; sequence: number; envioReference: string; reciboReference: string;
  operatingCode: string; senderClientId: string; recipientClientId: string;
  sendingUserId: string; registeredBy: string; sourceCurrency: Currency;
  destinationCurrency: Currency; amount: number; commissionBps: number;
  commissionAmount: number; totalAmount: number; receiveAmount: number;
  quote: Quote; note: string; status: "pending" | "paid" | "cancelled";
  createdAt: string; paidAt?: string; paidBy?: string;
  cancelledAt?: string; cancelledBy?: string; cancelReason?: string;
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
};
export type RemittanceState = {
  rates: ExchangeRate[]; transfers: Remittance[];
  cashSessions: CashSession[]; events: RemittanceEvent[];
};
export type QuoteInput = {
  sourceCurrency: Currency; destinationCurrency: Currency; amount: number; commissionBps: number;
};
export type CreateRemittanceInput = QuoteInput & {
  senderClientId: string; recipientClientId: string; sendingUserId?: string; quote: Quote; note?: string;
};

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
function dailyRate(state: State, currency: Currency, date: string) {
  assertCurrency(currency);
  if (currency === "DOP") return "1.000000";
  const rate = state.remittances.rates.find((r) => r.currency === currency && r.date === date);
  if (!rate) return fail("RATE_MISSING", `Falta la tasa de ${currency} para ${date}.`, 409);
  return normalizeRate(rate.rate);
}
export function quoteRemittance(state: State, input: QuoteInput, now = new Date()) {
  const amount = integerMoney(input.amount, true);
  if (!Number.isInteger(input.commissionBps) || input.commissionBps < 0 || input.commissionBps > 10000)
    fail("INVALID_COMMISSION", "La comisión debe estar entre 0 y 10000 BPS.");
  const date = businessDate(now);
  const sourceRate = dailyRate(state, input.sourceCurrency, date);
  const destinationRate = dailyRate(state, input.destinationCurrency, date);
  const commissionAmount = safeMoney(roundHalfUp(amount * BigInt(input.commissionBps), 10000n));
  const receiveAmount = safeMoney(roundHalfUp(amount * scaledRate(sourceRate), scaledRate(destinationRate)));
  if (receiveAmount === 0) fail("AMOUNT_TOO_SMALL", "El importe recibido se redondea a cero.");
  return {
    ...input, commissionAmount, totalAmount: safeMoney(amount + BigInt(commissionAmount)),
    receiveAmount, quote: { date, sourceRate, destinationRate },
  };
}
export function setDailyRate(state: State, user: User, input: Omit<ExchangeRate, "id">, now = new Date()) {
  remittanceOperators(state, user);
  assertAdmin(user);
  assertCurrency(input.currency);
  if (input.date !== businessDate(now)) fail("RATE_DATE", "Solo puedes registrar tasas de la fecha de negocio actual.");
  const rate = normalizeRate(input.rate);
  if (input.currency === "DOP" && rate !== "1.000000") fail("DOP_RATE", "La tasa DOP debe ser uno.");
  const existing = state.remittances.rates.find((r) => r.currency === input.currency && r.date === input.date);
  if (existing) { existing.rate = rate; return existing; }
  const row = { ...input, rate, id: randomUUID() };
  state.remittances.rates.push(row);
  return row;
}
export function remittanceOperators(state: State, user: User, systemOperators: User[] = []) {
  const account = state.accounts.find((a) => a.id === user.id);
  if (account && (account.status !== "active" || account.role !== user.role || account.collectorId !== user.collectorId))
    fail("SESSION_EXPIRED", "La cuenta cambió. Inicia sesión de nuevo.", 401);
  if (user.role !== "admin") return [user];
  const accounts: User[] = state.accounts.filter((a) => a.status === "active").map((a) => ({
    id: a.id, name: a.name, role: a.role, ...(a.collectorId ? { collectorId: a.collectorId } : {}),
  }));
  return [...new Map([...systemOperators, ...accounts, user].map((operator) => [operator.id, operator])).values()];
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
  const client = state.clients.find((c) => c.id === clientId);
  return !!client && state.routes.some((r) => r.id === client.routeId && r.collectorId === user.collectorId);
}
export function canSeeOutgoing(state: State, user: User, transfer: Remittance) {
  return user.role === "admin" || transfer.sendingUserId === user.id || clientInRoute(state, user, transfer.senderClientId);
}
export function canSeeReceipt(state: State, user: User, transfer: Remittance) {
  return clientInRoute(state, user, transfer.recipientClientId);
}
export function transferView(state: State, user: User, transfer: Remittance) {
  return {
    ...transfer,
    canPay: transfer.status === "pending" && canSeeReceipt(state, user, transfer),
    canCancel: transfer.status === "pending" && (user.role === "admin" || transfer.sendingUserId === user.id),
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
  ...cash, ...cashBalance(state, cash), canClose: cash.status === "open" && (user.role === "admin" || cash.operatorId === user.id),
});
function assertCashMovement(state: State, cash: CashSession, type: "sent" | "paid" | "cancelled", amount: number) {
  const balance = cashBalance(state, cash);
  const total = type === "sent" ? balance.sentTotal : type === "paid" ? balance.paid : balance.cancelRefund;
  safeMoney(BigInt(total) + BigInt(amount));
  safeMoney(BigInt(balance.expected) + (type === "sent" ? BigInt(amount) : -BigInt(amount)));
}
function addEvent(state: State, user: User, cash: CashSession, type: RemittanceEvent["type"], amount: number, now: Date, transferId?: string, reason?: string) {
  state.remittances.events.push({
    id: randomUUID(), type, cashSessionId: cash.id, operatorId: cash.operatorId, currency: cash.currency,
    amount, actorId: user.id, createdAt: now.toISOString(), ...(transferId ? { transferId } : {}), ...(reason ? { reason } : {}),
  });
}
function currentCash(state: State, operatorId: string, currency: Currency, now: Date) {
  const cash = state.remittances.cashSessions.find((c) => c.operatorId === operatorId && c.currency === currency && c.date === businessDate(now));
  if (!cash || cash.status !== "open") return fail("CASH_NOT_OPEN", "Abre la caja del operador y moneda para la fecha actual.", 409);
  return cash;
}
export function openRemittanceCash(state: State, user: User, input: { operatorId: string; currency: Currency; openingAmount: number }, systemOperators: User[] = [], now = new Date()) {
  assertAdmin(user);
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
  const sendingUser = operator(state, user, input.sendingUserId ?? user.id, systemOperators);
  if (input.senderClientId === input.recipientClientId) fail("SAME_CLIENT", "Remitente y destinatario deben ser distintos.");
  for (const id of [input.senderClientId, input.recipientClientId]) {
    const client = state.clients.find((c) => c.id === id);
    if (!client) fail("CLIENT_NOT_FOUND", "Cliente no encontrado.", 404);
    if (client!.active === false) fail("CLIENT_INACTIVE", "No puedes registrar envíos con clientes inactivos.", 409);
  }
  if (!clientInRoute(state, sendingUser, input.senderClientId)) fail("FORBIDDEN", "El remitente no pertenece a la ruta del operador.", 403);
  if (input.quote.date !== businessDate(now)) fail("QUOTE_CHANGED", "La fecha cambió. Vuelve a cotizar antes de guardar.", 409);
  const calculated = quoteRemittance(state, {
    amount: input.amount, commissionBps: input.commissionBps,
    sourceCurrency: input.sourceCurrency, destinationCurrency: input.destinationCurrency,
  }, now);
  if (input.quote.date !== calculated.quote.date || input.quote.sourceRate !== calculated.quote.sourceRate || input.quote.destinationRate !== calculated.quote.destinationRate)
    fail("QUOTE_CHANGED", "La fecha o la tasa cambió. Vuelve a cotizar antes de guardar.", 409);
  const cash = currentCash(state, sendingUser.id, input.sourceCurrency, now);
  assertCashMovement(state, cash, "sent", calculated.totalAmount);
  const sequence = state.remittances.transfers.reduce((max, t) => Math.max(max, t.sequence), 0) + 1;
  if (sequence > 99999999) fail("SEQUENCE_EXHAUSTED", "Se agotó la numeración de envíos.", 409);
  const transfer: Remittance = {
    id: randomUUID(), sequence, envioReference: `ENV${String(sequence).padStart(8, "0")}`,
    reciboReference: `REC${String(sequence).padStart(8, "0")}`, operatingCode: randomBytes(8).toString("hex").toUpperCase(),
    senderClientId: input.senderClientId, recipientClientId: input.recipientClientId,
    sendingUserId: sendingUser.id, registeredBy: user.id, ...calculated,
    note: (input.note ?? "").trim(), status: "pending", createdAt: now.toISOString(),
  };
  state.remittances.transfers.push(transfer);
  addEvent(state, user, cash, "sent", transfer.totalAmount, now, transfer.id);
  return transferView(state, user, transfer);
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
export function cancelRemittance(state: State, user: User, id: string, reason: string, now = new Date()) {
  remittanceOperators(state, user);
  const transfer = pendingTransfer(state, user, id);
  if (user.role !== "admin" && transfer.sendingUserId !== user.id) fail("FORBIDDEN", "Solo el operador del envío o administración puede cancelarlo.", 403);
  if (!reason.trim() || reason.trim().length > 500) fail("REASON_REQUIRED", "Indica un motivo de cancelación de hasta 500 caracteres.");
  const cash = currentCash(state, transfer.sendingUserId, transfer.sourceCurrency, now);
  if (cashBalance(state, cash).expected < transfer.totalAmount) fail("INSUFFICIENT_CASH", "La caja de origen no tiene fondos para devolver principal y comisión.", 409);
  assertCashMovement(state, cash, "cancelled", transfer.totalAmount);
  transfer.status = "cancelled"; transfer.cancelledAt = now.toISOString(); transfer.cancelledBy = user.id; transfer.cancelReason = reason.trim();
  addEvent(state, user, cash, "cancelled", transfer.totalAmount, now, transfer.id, reason.trim());
  return transferView(state, user, transfer);
}
export function remittanceSnapshot(state: State, user: User, systemOperators: User[] = [], now = new Date()) {
  const date = businessDate(now);
  return {
    businessDate: date, currencies,
    clients: state.clients.map((c) => ({ id: c.id, code: c.code, name: c.name, routeId: c.routeId, active: c.active !== false,
      canSendFrom: clientInRoute(state, user, c.id), canReceive: clientInRoute(state, user, c.id) })),
    operators: remittanceOperators(state, user, systemOperators),
    rates: [{ id: `DOP-${date}`, currency: "DOP" as Currency, rate: "1.000000", date }, ...state.remittances.rates.filter((r) => r.currency !== "DOP")],
    transfers: state.remittances.transfers.filter((t) => canSeeOutgoing(state, user, t) || canSeeReceipt(state, user, t)).map((t) => transferView(state, user, t)),
    cashSessions: state.remittances.cashSessions.filter((c) => user.role === "admin" || c.operatorId === user.id).map((c) => cashView(state, user, c)),
  };
}
export function remittanceReports(state: State, user: User, input: { from: string; to: string; grouping: "range" | "day" }) {
  if (input.from > input.to) fail("INVALID_DATE_RANGE", "La fecha inicial no puede superar la final.", 400);
  const within = (timestamp: string) => { const date = businessDate(new Date(timestamp)); return date >= input.from && date <= input.to; };
  const groupDate = (timestamp: string) => input.grouping === "day" ? businessDate(new Date(timestamp)) : `${input.from}/${input.to}`;
  const visible = state.remittances.transfers.filter((t) => canSeeOutgoing(state, user, t) || canSeeReceipt(state, user, t));
  type AmountRow = { date: string; sourceCurrency: Currency; destinationCurrency: Currency; count: number; pendingCount: number; paidCount: number; cancelledCount: number; amount: number; commissionAmount: number; totalAmount: number; receiveAmount: number };
  const amounts = new Map<string, AmountRow>();
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
  const cash = state.remittances.cashSessions.filter((c) => c.date >= input.from && c.date <= input.to && (user.role === "admin" || c.operatorId === user.id))
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
  return { ...input, amounts: [...amounts.values()], deliveryTimes, deliveryTimeSummary, delivered: [...delivered.values()], cash, cashSummary: [...cashGroups.values()] };
}
