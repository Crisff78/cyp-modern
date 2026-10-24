import { ungroupDecimal } from "../decimalText";
export const MONEY_INPUT_MAX_LENGTH = 24;
export const MONEY_INPUT_PATTERN = "([0-9]+|[0-9]{1,3}(,[0-9]{3})+)([.][0-9]{1,2})?";
export const MONEY_INPUT_MESSAGE = "Usa números, comas para separar los miles y un punto para los decimales (hasta dos decimales). El máximo es 90071992547409.91.";

/** Check the whole draft, including its exact cent limit, before a browser can truncate or coerce it. */
export function isMoneyDraft(value: string): boolean {
  if (value.length > MONEY_INPUT_MAX_LENGTH || value !== value.trim()) return false;
  const clean = ungroupDecimal(value, true);
  if (clean === undefined) return false;
  if (!/^[0-9]{0,14}(?:\.[0-9]{0,2})?$/.test(clean)) return false;
  const [whole, fraction = ""] = clean.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER);
}
