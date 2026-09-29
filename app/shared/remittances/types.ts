export type Currency = "DOP" | "USD" | "EUR";
export type Quote = { date: string; sourceRate: string; destinationRate: string };
export type Rate = { id: string; currency: Currency; rate: string; date: string };
export type Quotation = { sourceCurrency: Currency; destinationCurrency: Currency; amount: number; commissionBps: number; commissionAmount: number; totalAmount: number; receiveAmount: number; quote: Quote };
export type Transfer = Quotation & {
  id: string; sequence: number; envioReference: string; reciboReference: string; operatingCode: string;
  senderClientId: string; recipientClientId: string; sendingUserId: string; registeredBy: string;
  note: string; status: "pending" | "paid" | "cancelled"; createdAt: string;
  paidAt?: string; paidBy?: string; cancelledAt?: string; cancelledBy?: string; cancelReason?: string;
  canPay: boolean; canCancel: boolean;
};
export type Cash = {
  id: string; operatorId: string; currency: Currency; date: string; openingAmount: number;
  openedBy: string; openedAt: string; status: "open" | "closed"; closedBy?: string; closedAt?: string;
  countedAmount?: number; sentTotal: number; cancelRefund: number; paid: number; expected: number; canClose: boolean;
};
export type RemittanceSnapshot = {
  businessDate: string; currencies: Currency[];
  clients: { id: string; code: string; name: string; routeId: string; active: boolean; canSendFrom: boolean; canReceive: boolean }[];
  operators: { id: string; name: string; role: "admin" | "collector"; collectorId?: string }[];
  rates: Rate[]; transfers: Transfer[]; cashSessions: Cash[];
};
export type Report = {
  from: string; to: string; grouping: "range" | "day";
  amounts: { date: string; sourceCurrency: Currency; destinationCurrency: Currency; count: number; pendingCount: number; paidCount: number; cancelledCount: number; amount: number; commissionAmount: number; totalAmount: number; receiveAmount: number }[];
  deliveryTimes: { id: string; envioReference: string; createdAt: string; paidAt: string; elapsedSeconds: number }[];
  deliveryTimeSummary: { date: string; count: number; minSeconds: number; maxSeconds: number; averageSeconds: number }[];
  delivered: { date: string; currency: Currency; count: number; amount: number }[];
  cash: Cash[];
  cashSummary: { operatorId: string; currency: Currency; date: string; sessionCount: number; sentTotal: number; cancelRefund: number; paid: number; firstOpening: number; lastExpected: number }[];
};
