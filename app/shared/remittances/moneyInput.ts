export const MONEY_INPUT_MAX_LENGTH = 17;
export const MONEY_INPUT_MESSAGE = "Usa solo números y un punto decimal, con hasta dos decimales y sin separadores de miles. El máximo es 90071992547409.91.";

/** Check the whole draft, including its exact cent limit, before a browser can truncate or coerce it. */
export function isMoneyDraft(value: string): boolean {
  if (value.length > MONEY_INPUT_MAX_LENGTH || value !== value.trim() || !/^[0-9]{0,14}(?:\.[0-9]{0,2})?$/.test(value)) return false;
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER);
}
