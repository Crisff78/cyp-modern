export type CashActivityKind = "addition" | "withdrawal" | "sent" | "refund" | "paid" | "discharge";
export declare const cashActivityLabels: Readonly<Record<CashActivityKind, string>>;
export type CashActivity = {
  cash: { id: string; date: string; currency: "DOP" | "USD" | "EUR"; operatorName: string; status: "open" | "closed";
    openingAmount: number; openedAt: string; openedBy: string; closedAt?: string; closedBy?: string; countedAmount?: number };
  totals: { sentTotal: number; cancelRefund: number; paid: number; added: number; withdrawn: number; discharged: number; expected: number; carry?: number };
  groups: Record<CashActivityKind, { count: number; amount: number }>;
  entries: { id: string; kind: CashActivityKind; direction: "in" | "out"; amount: number; createdAt: string; recordedBy: string; note: string;
    reference?: string; receiptReference?: string; payment?: string; operationAmount?: number }[];
};
