export declare const paymentMethods: readonly ["cash", "card", "transfer", "deposit"];
export type PaymentMethod = typeof paymentMethods[number];
export declare const paymentMethodLabels: Record<PaymentMethod, string>;
export declare const cardTypes: readonly ["credit", "debit"];
export type CardType = typeof cardTypes[number];
export declare const cardTypeLabels: Record<CardType, string>;
export declare const isCardLast4Draft: (value: unknown) => value is string;
export declare const isCardholderNameDraft: (value: unknown) => value is string;
export declare const paymentLabel: (payment: Pick<RemittancePayment, "method" | "cardType">) => string;
export declare const isPaymentTextDraft: (value: unknown) => value is string;
export type RemittancePaymentInput = {
    method: PaymentMethod;
    tenderedAmount?: number;
    reference?: string;
    bank?: string;
    verified?: boolean;
    cardType?: CardType;
    cardholderName?: string;
    last4?: string;
    cardChargeAmount?: number;
};
export type RemittancePayment = {
    version: 1 | 2 | 3;
    method: PaymentMethod;
    tenderedAmount: number;
    changeAmount: number;
    reference?: string;
    bank?: string;
    confirmedBy: string;
    confirmedAt: string;
    cardType?: CardType;
    cardholderName?: string;
    last4?: string;
    cardSurchargeBps?: number;
    cardSurchargeAmount?: number;
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
export declare function cardPaymentCharge(total: number, cardType?: CardType, creditCardCommissionBps?: number, cardChargeAmount?: number): {
    cardSurchargeBps?: number; cardSurchargeAmount: number; totalAmount: number;
};
export declare const paymentRecordVersion: (input?: RemittancePaymentInput) => 1 | 2 | 3;
export declare const totalPaidForTransfer: (transfer: {totalAmount: number; payment?: Pick<RemittancePayment, "cardSurchargeAmount">}) => number;
export declare function paymentAmounts(total: number, input?: RemittancePaymentInput, creditCardCommissionBps?: number): {
    method: PaymentMethod;
    tenderedAmount: number;
    changeAmount: number;
    reference?: string;
    bank?: string;
    cardType?: CardType;
    cardholderName?: string;
    last4?: string;
    cardSurchargeBps?: number;
    cardSurchargeAmount?: number;
};
/** Card/bank receipts do not add physical bills to the remittance cash box. */
export declare const cashReceivedForTransfer: (total: number, payment?: Pick<RemittancePayment, "method">) => number;
