import { businessDate, DomainError, type State, type User } from "./domain.js";
import { canSeeOutgoing, canSeeReceipt, safeMoney, type CommissionAllocation, type Currency, type Remittance } from "./remittances.js";

export type CommissionReportInput = {
  from: string; to: string; grouping: "range" | "day"; groupBy: "managerCurrency" | "currency";
  status: "all" | "active" | "pending" | "paid" | "cancelled"; managerId?: string; currency?: Currency;
};
type Totals = { count: number; cancelledCount: number; transactionAmount: number; companyAmount: number; managerAmount: number;
  cancelledTransactionAmount: number; cancelledCompanyAmount: number; cancelledManagerAmount: number };
type Group = Totals & { date: string; currency: Currency; managerId?: string; managerName?: string };
const emptyTotals = (): Totals => ({ count: 0, cancelledCount: 0, transactionAmount: 0, companyAmount: 0, managerAmount: 0,
  cancelledTransactionAmount: 0, cancelledCompanyAmount: 0, cancelledManagerAmount: 0 });
function accumulate(total: Totals, allocation: CommissionAllocation, cancelled: boolean) {
  if (cancelled) {
    total.cancelledCount++;
    total.cancelledTransactionAmount = safeMoney(BigInt(total.cancelledTransactionAmount) + BigInt(allocation.transactionAmount));
    total.cancelledCompanyAmount = safeMoney(BigInt(total.cancelledCompanyAmount) + BigInt(allocation.companyAmount));
    total.cancelledManagerAmount = safeMoney(BigInt(total.cancelledManagerAmount) + BigInt(allocation.managerAmount));
    return;
  }
  total.count++;
  for (const field of ["transactionAmount", "companyAmount", "managerAmount"] as const)
    total[field] = safeMoney(BigInt(total[field]) + BigInt(allocation[field]));
}
export function consolidatedCommissionReport(state: State, user: User, input: CommissionReportInput) {
  if (input.from > input.to) throw new DomainError("INVALID_DATE_RANGE", "La fecha inicial no puede superar la final.", 400);
  const groups = new Map<string, Group>(), currencyTotals = new Map<Currency, Totals & { currency: Currency }>();
  const details: Array<CommissionAllocation & Pick<Remittance, "id" | "envioReference" | "createdAt" | "status">> = [];
  let excludedLegacyCount = 0;
  for (const transfer of state.remittances.transfers) {
    if (!canSeeOutgoing(state, user, transfer) && !canSeeReceipt(state, user, transfer)) continue;
    const date = businessDate(new Date(transfer.createdAt));
    if (date < input.from || date > input.to) continue;
    if (input.status === "active" && transfer.status === "cancelled") continue;
    if (input.status !== "all" && input.status !== "active" && input.status !== transfer.status) continue;
    const allocation = transfer.commissionAllocation;
    if (input.managerId && (allocation?.managerId ?? transfer.sendingUserId) !== input.managerId) continue;
    if (input.currency && transfer.destinationCurrency !== input.currency) continue;
    if (!allocation?.managerId || !allocation.managerName) { excludedLegacyCount++; continue; }
    details.push({ ...allocation, id: transfer.id, envioReference: transfer.envioReference, createdAt: transfer.createdAt, status: transfer.status });
    const period = input.grouping === "day" ? date : `${input.from}/${input.to}`;
    const key = JSON.stringify([period, allocation.currency, input.groupBy === "managerCurrency" ? allocation.managerId : null]);
    const group = groups.get(key) ?? { ...emptyTotals(), date: period, currency: allocation.currency,
      ...(input.groupBy === "managerCurrency" ? { managerId: allocation.managerId, managerName: allocation.managerName } : {}) };
    const currency = currencyTotals.get(allocation.currency) ?? { ...emptyTotals(), currency: allocation.currency };
    accumulate(group, allocation, transfer.status === "cancelled"); accumulate(currency, allocation, transfer.status === "cancelled");
    groups.set(key, group); currencyTotals.set(allocation.currency, currency);
  }
  details.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.envioReference.localeCompare(b.envioReference));
  return { ...input, excludedLegacyCount, details,
    groups: [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency) || (a.managerName ?? "").localeCompare(b.managerName ?? "") || (a.managerId ?? "").localeCompare(b.managerId ?? "")),
    currencyTotals: [...currencyTotals.values()].sort((a, b) => a.currency.localeCompare(b.currency)) };
}
