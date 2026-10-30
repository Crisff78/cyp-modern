export const rateKindLabel = { base: "Moneda base", purchase: "Compra", sale: "Venta", operative: "Tasa única registrada" };
/**
 * Buy the source currency; sell the destination currency. Only pesos are one to one: dollars to dollars or euros to euros
 * also go through pesos, bought at the purchase rate and sold at the sale rate (Rardiel, 30-10-2026).
 */
export function appliedRate(rate, currency, side) {
    if (currency === "DOP")
        return { rate: "1.000000", kind: "base" };
    if (!rate)
        throw new Error("No hay tasa registrada para la moneda.");
    const kind = side === "source" ? "purchase" : "sale";
    const value = kind === "purchase" ? rate.purchaseRate : rate.saleRate;
    // Explicit compatibility for old single-rate records. Never manufacture a buy/sell spread.
    return value === undefined ? { rate: rate.rate, kind: "operative" } : { rate: value, kind };
}
