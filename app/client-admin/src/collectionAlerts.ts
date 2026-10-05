import type { Movement } from "./types";
// Collection funds are independent of advances/payments. Pending deposits
// do not confirm administrative receipt of funds.
export function unconfirmedCollectionBalances(movements: readonly Movement[]) {
  const balances = new Map<string, { collectorId: string; currency: "DOP" | "USD" | "EUR"; amount: bigint }>();
  for (const row of movements) {
    if (row.cancelledAt || (row.type !== "collection" && row.type !== "deposit")) continue;
    if (row.type === "deposit" && !row.acceptedAt) continue;
    if (!Number.isSafeInteger(row.amount) || row.amount < 0) throw new Error("Importe de movimiento inválido.");
    const currency = row.currency ?? "DOP";
    const key = JSON.stringify([row.collectorId, currency]);
    const balance = balances.get(key) ?? { collectorId: row.collectorId, currency, amount: 0n };
    balance.amount += BigInt(row.amount) * (row.type === "collection" ? 1n : -1n);
    balances.set(key, balance);
  }
  return [...balances.values()].filter((row) => row.amount > 0n);
}
export function recentMovementReceipts(movements: readonly Movement[], limit = 8) {
  return movements.filter((row) => (row.type === "collection" || row.type === "payout") && row.receiptToken &&
      !row.receiptRevoked && Number.isFinite(Date.parse(row.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
}
