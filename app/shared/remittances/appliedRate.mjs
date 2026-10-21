export const rateKindLabel = { base: "Moneda base", purchase: "Compra", sale: "Venta", operative: "Tasa única registrada" };
/** Buy the source currency; sell the destination currency. Same-currency sends do not exchange twice. */
export function appliedRate(rate, currency, side, sameCurrency = false) {
    if (currency === "DOP")
        return { rate: "1.000000", kind: "base" };
    if (!rate)
        throw new Error("No hay tasa registrada para la moneda.");
    const kind = side === "source" || sameCurrency ? "purchase" : "sale";
    const value = kind === "purchase" ? rate.purchaseRate : rate.saleRate;
    // Explicit compatibility for old single-rate records. Never manufacture a buy/sell spread.
    return value === undefined ? { rate: rate.rate, kind: "operative" } : { rate: value, kind };
}
