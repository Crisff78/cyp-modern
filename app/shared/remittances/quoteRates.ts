import type { Currency, Quotation, Rate, RemittanceSnapshot } from "./types";
import { appliedRate } from "./appliedRate.mjs";

/** Match the server: the most recent registered date that is not in the future. */
export function effectiveRate(rates: Rate[], currency: Currency, date: string) {
  return rates.filter((rate) => rate.currency === currency && rate.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || b.id.localeCompare(a.id))[0];
}

const normalized = (rate: string) => {
  const [whole, fraction = ""] = rate.split(".");
  return `${BigInt(whole)}.${fraction.padEnd(6, "0")}`;
};

// Refreshing lists keeps the quote only while the exact rates and policy still apply.
// The API checks all of this again before recording the transfer.
export function quoteStillCurrent(quotation: Quotation, snapshot: RemittanceSnapshot) {
  const quote = quotation.quote;
  if (quote.date !== snapshot.businessDate || (quote.commissionPolicyRevision ?? "default") !== (snapshot.commissionPolicy?.revision ?? "default")) return false;
  return (["source", "destination"] as const).every((side) => {
    const currency = quotation[`${side}Currency`];
    const rate = effectiveRate(snapshot.rates, currency, snapshot.businessDate);
    if (currency !== "DOP" && !rate) return false;
    const applied = appliedRate(rate, currency, side, quotation.sourceCurrency === quotation.destinationCurrency);
    const value = applied.rate;
    return normalized(value) === normalized(quote[`${side}Rate`]) && rate?.changeId === quote[`${side}RateChangeId`] &&
      (!quote[`${side}RateKind`] || quote[`${side}RateKind`] === applied.kind) &&
      (currency === "DOP" || !quote[`${side}RateDate`] || rate?.date === quote[`${side}RateDate`]);
  });
}
