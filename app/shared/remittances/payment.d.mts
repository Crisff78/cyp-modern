export declare const paymentMethods: readonly ["cash", "card", "transfer", "deposit"];
export type PaymentMethod = typeof paymentMethods[number];
export declare const paymentMethodLabels: Record<PaymentMethod, string>;
export declare const isPaymentTextDraft: (value: unknown) => value is string;
export type RemittancePaymentInput = {
    method: PaymentMethod;
    tenderedAmount?: number;
    reference?: string;
    bank?: string;
    verified?: boolean;
};
export type RemittancePayment = {
    version: 1;
    method: PaymentMethod;
    tenderedAmount: number;
    changeAmount: number;
    reference?: string;
    bank?: string;
    confirmedBy: string;
    confirmedAt: string;
};
export type RemittanceRefund = {
    method: Exclude<PaymentMethod, "cash">;
    reference: string;
    confirmedBy: string;
    confirmedAt: string;
};
export type RemittanceRefundInput = {
    reference: string;
    verified: boolean;
};
export type ReceiptIssuer = {
    name: string;
    address: string;
    phone: string;
    email: string;
    footerNote: string;
    logoDataUrl?: string;
};
export declare class PaymentValidationError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Exact cents; the server supplies the authoritative total again when saving. */
export declare function paymentAmounts(total: number, input?: RemittancePaymentInput): {
    method: PaymentMethod;
    tenderedAmount: number;
    changeAmount: number;
    reference?: string;
    bank?: string;
};
/** Card/bank receipts do not add physical bills to the remittance cash box. */
export declare const cashReceivedForTransfer: (total: number, payment?: Pick<RemittancePayment, "method">) => number;
