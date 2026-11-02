/** Informational equivalent, using the commission and immutable source rate from the server's quote. */
export function commissionDopAmount(quote: { commissionAmount: number; quote: { sourceRate: string } }): number | undefined {
  if (!Number.isSafeInteger(quote.commissionAmount) || quote.commissionAmount < 0 ||
      !/^[0-9]{1,12}(?:\.[0-9]{1,6})?$/.test(quote.quote.sourceRate)) return undefined;
  const [whole, decimals = ""] = quote.quote.sourceRate.split(".");
  const rate = BigInt(whole) * 1_000_000n + BigInt(decimals.padEnd(6, "0"));
  if (rate <= 0n) return undefined;
  const cents = (BigInt(quote.commissionAmount) * rate + 500_000n) / 1_000_000n;
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : undefined;
}
