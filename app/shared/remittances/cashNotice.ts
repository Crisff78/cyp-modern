import type { Cash, Currency, RemittanceSnapshot } from "./types";

export type RemittanceCashNotice = "ok" | "missing" | "previousOpen";
type CashView = Pick<RemittanceSnapshot, "businessDate"> & { cashSessions: readonly Pick<Cash, "operatorId" | "currency" | "date" | "status">[] };

// Only a warning: the server decides (CASH_NOT_OPEN, PREVIOUS_CASH_OPEN).
export function remittanceCashNotice(snapshot: CashView, operatorId: string, currency: Currency): RemittanceCashNotice {
  const open = snapshot.cashSessions.filter((cash) => cash.operatorId === operatorId && cash.currency === currency && cash.status === "open");
  if (open.some((cash) => cash.date === snapshot.businessDate)) return "ok";
  return open.some((cash) => cash.date < snapshot.businessDate) ? "previousOpen" : "missing";
}

/** Date of the oldest box of the operator in that currency that is still open from an earlier day. */
export function previousOpenCashDate(snapshot: CashView, operatorId: string, currency: Currency): string | undefined {
  return snapshot.cashSessions.filter((cash) => cash.operatorId === operatorId && cash.currency === currency && cash.status === "open" && cash.date < snapshot.businessDate)
    .map((cash) => cash.date).sort()[0];
}
