import type { Cash, Currency, RemittanceSnapshot } from "./types";

// closedToday: the box of today was already closed. The server keeps one box per operator, currency and day
// (CASH_EXISTS), so it cannot be opened again until the next business day.
export type RemittanceCashNotice = "ok" | "missing" | "previousOpen" | "closedToday";
type CashView = Pick<RemittanceSnapshot, "businessDate"> & { cashSessions: readonly Pick<Cash, "operatorId" | "currency" | "date" | "status">[] };

// Only a warning: the server decides (CASH_NOT_OPEN, PREVIOUS_CASH_OPEN, CASH_EXISTS).
export function remittanceCashNotice(snapshot: CashView, operatorId: string, currency: Currency): RemittanceCashNotice {
  const own = snapshot.cashSessions.filter((cash) => cash.operatorId === operatorId && cash.currency === currency);
  const open = own.filter((cash) => cash.status === "open");
  if (open.some((cash) => cash.date === snapshot.businessDate)) return "ok";
  if (own.some((cash) => cash.date === snapshot.businessDate)) return "closedToday";
  return open.some((cash) => cash.date < snapshot.businessDate) ? "previousOpen" : "missing";
}

/** Date of the oldest box of the operator in that currency that is still open from an earlier day. */
export function previousOpenCashDate(snapshot: CashView, operatorId: string, currency: Currency): string | undefined {
  return snapshot.cashSessions.filter((cash) => cash.operatorId === operatorId && cash.currency === currency && cash.status === "open" && cash.date < snapshot.businessDate)
    .map((cash) => cash.date).sort()[0];
}

type CarryView = Pick<RemittanceSnapshot, "businessDate"> & { cashSessions: readonly Pick<Cash, "id" | "operatorId" | "currency" | "date" | "status" | "openedAt" | "countedAmount" | "carry">[] };
/** What the next opening of the operator in that currency brings (Mayo, 26-10-2026): the close of his last box before
 *  today less what was discharged. Undefined for a first box, or while the box before is still open (the server
 *  decides: OPENING_FIXED, PREVIOUS_CASH_OPEN). */
export function remittanceOpeningCarry(snapshot: CarryView, operatorId: string, currency: Currency): { date: string; amount: number } | undefined {
  const previous = snapshot.cashSessions.filter((cash) => cash.operatorId === operatorId && cash.currency === currency && cash.date < snapshot.businessDate)
    .sort((a, b) => b.date.localeCompare(a.date) || b.openedAt.localeCompare(a.openedAt) || b.id.localeCompare(a.id))[0];
  if (!previous || previous.status !== "closed") return undefined;
  const amount = previous.carry ?? previous.countedAmount;
  return amount === undefined ? undefined : { date: previous.date, amount };
}

export type CashFilters = { date: string; operatorId: string; currency: Currency | "" };
/** The boxes of Caja de remesas for the consulted date, operator and currency. On today's date a box still open from
 *  an earlier day is shown too: it has to be counted and closed before today's opens. */
export function filterCashSessions<T extends Pick<Cash, "operatorId" | "currency" | "date" | "status">>(sessions: readonly T[], filters: CashFilters, businessDate: string) {
  const date = filters.date || businessDate;
  return sessions.filter((cash) => (cash.date === date || (date === businessDate && cash.status === "open" && cash.date < date))
    && (!filters.operatorId || cash.operatorId === filters.operatorId) && (!filters.currency || cash.currency === filters.currency));
}
