import type { Movement } from "../types";

export function pocketBalances(movements: Movement[], collectorId?: string, reconciliations: readonly { collectorId: string; currency: string; returnedCollection: number; returnedPayout: number }[] = []) {
  const active = movements.filter((item) => item.collectorId === collectorId &&
    !item.cancelledAt && (item.currency ?? "DOP") === "DOP");
  const sum = (type: Movement["type"]) => active
    .filter((item) => item.type === type)
    .reduce((total, item) => total + item.amount, 0);
  const returned = reconciliations.filter((row) => row.collectorId === collectorId && row.currency === "DOP");
  return {
    collectionCash: sum("collection") - sum("deposit") - returned.reduce((sum, row) => sum + row.returnedCollection, 0),
    payoutCash: sum("office_delivery") - sum("payout") - returned.reduce((sum, row) => sum + row.returnedPayout, 0),
  };
}
