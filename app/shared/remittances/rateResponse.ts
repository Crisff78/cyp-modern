import { INPUT_LIMITS, isPositiveRate } from "../inputRules";
import { StrictApiError } from "./strictApi";
import type { Rate } from "./types";

type ExpectedRate = Pick<Rate, "currency" | "date" | "rate">;

const rateUnits = (rate: string): bigint => {
  const [whole, fraction = ""] = rate.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
};

/** Confirm the submitted rate before releasing its pending operation key. */
export function confirmedRateResponse(result: unknown, expected: ExpectedRate): Rate {
  const response = result && typeof result === "object" && !Array.isArray(result) ? result as Partial<Rate> : null;
  if (!response || typeof response.id !== "string" || !response.id || response.id !== response.id.trim()
    || response.id.length > INPUT_LIMITS.id || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(response.id)
    || response.currency !== expected.currency || response.date !== expected.date
    || typeof response.rate !== "string" || !isPositiveRate(response.rate) || !isPositiveRate(expected.rate)
    || rateUnits(response.rate) !== rateUnits(expected.rate))
    throw new StrictApiError("La respuesta no confirmó la tasa guardada. Conservamos los datos: reintenta esta misma operación sin cambiarlos.", 200, true, "RATE_CONFIRMATION_INVALID");
  // Cached legacy responses may lack changeId/updatedAt; do not invent metadata.
  return response as Rate;
}
