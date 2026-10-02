import type { Movement } from "../types";

export function pocketBalances(movements: Movement[], collectorId?: string) {
  const active = movements.filter((item) => item.collectorId === collectorId &&
    !item.cancelledAt && (item.currency ?? "DOP") === "DOP");
  const sum = (type: Movement["type"]) => active
    .filter((item) => item.type === type)
    .reduce((total, item) => total + item.amount, 0);
  return {
    collectionCash: sum("collection") - sum("deposit"),
    payoutCash: sum("office_delivery") - sum("payout"),
  };
}
