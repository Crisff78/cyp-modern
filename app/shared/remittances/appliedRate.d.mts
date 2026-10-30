export type RateKind = "base" | "purchase" | "sale" | "operative";
export declare const rateKindLabel: Record<RateKind, string>;
/** Buy the source currency; sell the destination currency. Only pesos are one to one (Rardiel, 30-10-2026). */
export declare function appliedRate(rate: {
    rate: string;
    purchaseRate?: string;
    saleRate?: string;
} | undefined, currency: string, side: "source" | "destination"): {
    rate: string;
    kind: RateKind;
};
