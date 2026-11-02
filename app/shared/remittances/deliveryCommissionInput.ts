export const DELIVERY_COMMISSION_MESSAGE = "Usa un porcentaje de 0 a 99.99.";

/** A percentage, not a money box: no signs, grouping, exponents or more than two decimals. */
export function isDeliveryCommissionDraft(value: string) {
  return /^[0-9]{0,2}(?:\.[0-9]{0,2})?$/.test(value);
}

export function deliveryCommissionBps(value: string) {
  if (!isDeliveryCommissionDraft(value) || !/[0-9]/.test(value)) throw new Error(DELIVERY_COMMISSION_MESSAGE);
  const [whole, decimals = ""] = value.split(".");
  return Number(whole || "0") * 100 + Number(decimals.padEnd(2, "0"));
}
