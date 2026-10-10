import type { Balance, Snapshot } from "./types";

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
