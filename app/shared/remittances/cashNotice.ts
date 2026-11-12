import type { Cash, Currency, RemittanceSnapshot } from "./types";

// closedToday: una sola caja por operador, moneda y día. La excepción administrativa
// de la demo reabre esa misma caja; nunca crea otra apertura ni borra su historial.
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

function shiftIsoDate(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return Number.isNaN(shifted.getTime()) ? date : shifted.toISOString().slice(0, 10);
}

/** Oldest box of the operator in that currency that is still open from an earlier day. */
export function previousOpenCash<T extends Pick<Cash, "operatorId" | "currency" | "date" | "status">>(
  snapshot: Pick<RemittanceSnapshot, "businessDate"> & { cashSessions: readonly T[] },
  operatorId: string,
  currency: Currency,
): T | undefined {
  return snapshot.cashSessions
    .filter((cash) => cash.operatorId === operatorId && cash.currency === currency && cash.status === "open" && cash.date < snapshot.businessDate)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

/** Date of the oldest box of the operator in that currency that is still open from an earlier day. */
export function previousOpenCashDate(snapshot: CashView, operatorId: string, currency: Currency): string | undefined {
  return previousOpenCash(snapshot, operatorId, currency)?.date;
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

type AuditCash = Pick<Cash, "id" | "operatorId" | "currency" | "date" | "status" | "openedAt" | "openingAmount" | "countedAmount" | "discharged" | "carry" | "carriedFrom">;
/** Detects a historical box saved before automatic carry-over whose opening differs from the previous close without a recorded discharge. */
export function historicalUnlinkedCarry(sessions: readonly AuditCash[], cash: AuditCash): { date: string; carry: number; discharged: number } | undefined {
  if (cash.carriedFrom) return undefined;
  const previous = sessions
    .filter((row) => row.operatorId === cash.operatorId && row.currency === cash.currency && row.date < cash.date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.openedAt.localeCompare(a.openedAt) || b.id.localeCompare(a.id))[0];
  if (!previous || previous.status !== "closed") return undefined;
  const carry = previous.carry ?? previous.countedAmount;
  if (carry === undefined || carry === cash.openingAmount) return undefined;
  return { date: previous.date, carry, discharged: previous.discharged ?? 0 };
}

export type CashFilters = { from: string; to: string; operatorId: string; currency: Currency | "" };

/** Default comparative range (Mayo, 04-11-2026): brings at least the last two available dates up to businessDate. */
export function defaultCashRange(snapshot: CashView, operatorId = "", currency: Currency | "" = ""): { from: string; to: string } {
  const to = snapshot.businessDate;
  if (!to) return { from: "", to: "" };
  const yesterday = shiftIsoDate(to, -1);
  const dates = [...new Set(
    snapshot.cashSessions
      .filter((cash) => cash.date <= to && (!operatorId || cash.operatorId === operatorId) && (!currency || cash.currency === currency))
      .map((cash) => cash.date),
  )].sort((a, b) => b.localeCompare(a));
  const anchor = dates.length >= 2 ? dates[1] : dates[0] ?? yesterday;
  return { from: anchor < yesterday ? anchor : yesterday, to };
}

/** The boxes of Caja de remesas for the consulted date range, operator and currency. When `to` covers today, any box
 *  still open from an earlier day is shown too so it can be counted and closed before today's opens. */
export function filterCashSessions<T extends Pick<Cash, "operatorId" | "currency" | "date" | "status">>(sessions: readonly T[], filters: CashFilters, businessDate: string): T[] {
  const from = filters.from;
  const to = filters.to || businessDate;
  return sessions
    .filter((cash) => {
      const inRange = (!from || cash.date >= from) && (!to || cash.date <= to);
      const pendingEarlier = (!to || to >= businessDate) && cash.status === "open" && cash.date < (from || businessDate);
      return (inRange || pendingEarlier)
        && (!filters.operatorId || cash.operatorId === filters.operatorId)
        && (!filters.currency || cash.currency === filters.currency);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
