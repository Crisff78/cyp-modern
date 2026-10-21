export type RateKind = "base" | "purchase" | "sale" | "operative";
export declare const rateKindLabel: Record<RateKind, string>;
/** Buy the source currency; sell the destination currency. Same-currency sends do not exchange twice. */
export declare function appliedRate(rate: {
    rate: string;
    purchaseRate?: string;
    saleRate?: string;
} | undefined, currency: string, side: "source" | "destination", sameCurrency?: boolean): {
    rate: string;
    kind: RateKind;
};
