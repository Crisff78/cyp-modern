import { INPUT_LIMITS, isPositiveRate } from "../inputRules";

// Let one excess character reach validation: native truncation at the valid
// limit could turn a seven-decimal entry into a different, valid rate.
export const RATE_INPUT_MAX_LENGTH = INPUT_LIMITS.rate + 1;
export const RATE_INPUT_MESSAGE = "Usa solo números y un punto o una coma decimal, con hasta doce dígitos enteros y seis decimales, sin separadores de miles.";

/** Incomplete decimals can be edited, but letters, grouping and excess precision cannot be entered. */
export function isRateDraft(value: string): boolean {
  return value.length <= INPUT_LIMITS.rate && value === value.trim() && /^[0-9]{0,12}(?:[.,][0-9]{0,6})?$/.test(value);
}

/** Normalize only an unambiguous decimal comma; never strip invalid characters. */
export function rateInputDraft(value: string): string {
  return /^\d*,\d*$/.test(value) ? value.replace(",", ".") : value;
}

/** Convert decimal shorthand without rounding or changing the rate's precision. */
export function confirmedRateInput(value: string): string {
  if (value.length > INPUT_LIMITS.rate)
    throw new Error(`La tasa admite un máximo de ${INPUT_LIMITS.rate} caracteres.`);
  let rate = rateInputDraft(value);
  if (/^\d+\.$/.test(rate)) rate = rate.slice(0, -1);
  else if (/^\.\d+$/.test(rate)) rate = `0${rate}`;
  if (!isPositiveRate(rate))
    throw new Error("Escribe una tasa positiva con hasta doce dígitos enteros y seis decimales. Usa un punto o una coma decimal, sin separadores de miles.");
  return rate;
}
