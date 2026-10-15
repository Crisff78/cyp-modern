import type { Balance, Snapshot } from "./types";
import { businessDate } from "./adminFinance";

export const settlementCurrencyCodes = ["DOP", "USD", "EUR"] as const;
export type SettlementCurrency = typeof settlementCurrencyCodes[number];
export type SettlementBalance = Balance & { totalsByCurrency?: Partial<Record<SettlementCurrency, Balance>> };
export function settlementBalances(record: SettlementBalance): { currency: SettlementCurrency; balance: Balance }[] {
  if (!record.totalsByCurrency) return [{ currency: "DOP", balance: record }];
  const entries = settlementCurrencyCodes.flatMap((currency) => {
    const balance = record.totalsByCurrency![currency];
    return balance && Object.values(balance).some((amount) => amount !== 0) ? [{ currency, balance }] : [];
  });
  return entries.length ? entries : [{ currency: "DOP", balance: record.totalsByCurrency.DOP ?? record }];
}
export function settlementRows(records: Snapshot["settlements"]) {
  return records.flatMap((record) => settlementBalances(record).map(({ currency, balance }) => ({ ...record, ...balance, id: `${record.id}.${currency}`, currency })));
}

export type SettlementWorkspaceRow = Balance & {
  id: string;
  collectorId: string;
  date: string;
  currency: SettlementCurrency;
  state: "Pendiente" | "Cerrado" | "Conciliado";
  closedAt?: string;
};

export function settlementWorkspaceRows(snapshot: Snapshot): SettlementWorkspaceRow[] {
  const key = (collectorId: string, date: string, currency: string) => `${collectorId}:${date}:${currency}`;
  const closedPeriods = new Set(snapshot.settlements.map((row) => `${row.collectorId}:${row.date}`));
  const rows = new Map<string, SettlementWorkspaceRow>();
  for (const row of settlementRows(snapshot.settlements)) {
    const id = key(row.collectorId, row.date, row.currency);
    rows.set(id, { ...row, id, state: row.cashReconciled ? "Conciliado" : "Cerrado" });
  }
  for (const movement of snapshot.movements) {
    const date = businessDate(movement.createdAt), currency = movement.currency ?? "DOP";
    if (closedPeriods.has(`${movement.collectorId}:${date}`)) continue;
    const id = key(movement.collectorId, date, currency);
    const row = rows.get(id) ?? { id, collectorId: movement.collectorId, date, currency,
      collected: 0, deposited: 0, officeDelivered: 0, paidToClients: 0, difference: 0, state: "Pendiente" as const };
    if (!movement.cancelledAt) {
      if (movement.type === "collection") row.collected += movement.amount;
      if (movement.type === "deposit") row.deposited += movement.amount;
      if (movement.type === "office_delivery") row.officeDelivered += movement.amount;
      if (movement.type === "payout") row.paidToClients += movement.amount;
    }
    row.difference = row.collected - row.deposited + row.officeDelivered - row.paidToClients;
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || a.collectorId.localeCompare(b.collectorId) || a.currency.localeCompare(b.currency));
}
