import { INPUT_LIMITS, isPositiveRate } from "../inputRules";

// Leave one excess character visible: truncating at the valid limit can turn
// an invalid seven-decimal value into a different, valid six-decimal rate.
export const RATE_INPUT_MAX_LENGTH = INPUT_LIMITS.rate + 1;

/** Keep invalid input visible so confirmation can reject the entire value. */
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
