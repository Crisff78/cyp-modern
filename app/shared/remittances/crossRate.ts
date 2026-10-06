export type CrossRateDisplay = { text: string; approximate: boolean };

const significantDigits = 12;
const powerOfTen = (exponent: number) => 10n ** BigInt(exponent);

function rateUnits(rate: string): bigint {
  // Match the server's positive rates: up to twelve whole and six decimal digits.
  if (typeof rate !== "string" || !/^\d{1,12}(?:\.\d{1,6})?$/.test(rate))
    throw new Error("La tasa cruzada requiere tasas positivas con hasta seis decimales.");
  const [whole, fraction = ""] = rate.split(".");
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (units === 0n) throw new Error("La tasa cruzada requiere tasas mayores que cero.");
  return units;
}

/** Display only: financial amounts continue to use the server's exact calculation. */
export function formatCrossRate(sourceRate: string, destinationRate: string): CrossRateDisplay {
  const source = rateUnits(sourceRate), destination = rateUnits(destinationRate);
  let exponent = source.toString().length - destination.toString().length;
  const belowPower = exponent >= 0
    ? source < destination * powerOfTen(exponent)
    : source * powerOfTen(-exponent) < destination;
  if (belowPower) exponent--;

  // Scale by significant figures, not fixed decimal places: tiny positive rates
  // remain visible, and large rates retain bounded display precision.
  const decimalPlaces = significantDigits - 1 - exponent;
  const numerator = decimalPlaces >= 0 ? source * powerOfTen(decimalPlaces) : source;
  const denominator = decimalPlaces >= 0 ? destination : destination * powerOfTen(-decimalPlaces);
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);
  const approximate = numerator % denominator !== 0n;
  const digits = rounded.toString();
  const padded = decimalPlaces > 0 ? digits.padStart(decimalPlaces + 1, "0") : digits;
  const text = decimalPlaces > 0
    ? `${padded.slice(0, -decimalPlaces)}.${padded.slice(-decimalPlaces)}`.replace(/0+$/, "").replace(/\.$/, "")
    : digits + "0".repeat(-decimalPlaces);
  return { text, approximate };
}
