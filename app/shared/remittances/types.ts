export type Currency = "DOP" | "USD" | "EUR";
export type Quote = {
  date: string; sourceRate: string; destinationRate: string; quotedAt?: string;
  sourceRateChangeId?: string; destinationRateChangeId?: string;
  sourceRateChangedAt?: string; destinationRateChangedAt?: string;
  commissionPolicyRevision?: string; managerCommissionBps?: number;
};
export type CommissionPolicy = { revision: string; managerCommissionBps: number; updatedAt?: string; updatedBy?: string };
export type CommissionAllocation = {
  version: 1; currency: Currency; policyRevision: string; managerCommissionBps: number;
  baseAmount: number; transactionAmount: number; companyAmount: number; managerAmount: number;
  managerId?: string; managerName?: string;
};
export type Rate = { id: string; currency: Currency; rate: string; date: string; changeId?: string; updatedAt?: string; updatedBy?: string };
export type RateChange = { id: string; currency: Currency; rate: string; date: string; createdAt: string; actorId: string };
export type RemittanceContact = { id: string; code: string; name: string; phone: string; cellular: string; address: string };
export type ManagerCommission = { managerName: string; amount: number; currency: Currency };
export type Quotation = { sourceCurrency: Currency; destinationCurrency: Currency; amount: number; commissionBps: number; commissionAmount: number; totalAmount: number; receiveAmount: number; quote: Quote;
  amountDop?: number; requestedReceiveAmount?: number; receiveRoundingDifference?: number; commissionAllocation?: CommissionAllocation };
export type Transfer = Quotation & {
  id: string; sequence: number; envioReference: string; reciboReference: string; operatingCode: string;
  senderClientId: string; recipientClientId: string; sendingUserId: string; registeredBy: string;
  note: string; status: "pending" | "paid" | "cancelled"; createdAt: string;
  paidAt?: string; paidBy?: string; cancelledAt?: string; cancelledBy?: string; cancelReason?: string;
  canPay: boolean; canCancel: boolean;
  senderContact?: RemittanceContact; recipientContact?: RemittanceContact;
  managerCommission?: ManagerCommission;
};
export type Cash = {
  id: string; operatorId: string; currency: Currency; date: string; openingAmount: number;
  openedBy: string; openedAt: string; status: "open" | "closed"; closedBy?: string; closedAt?: string;
  countedAmount?: number; sentTotal: number; cancelRefund: number; paid: number; expected: number; canClose: boolean;
};
export type RemittanceSnapshot = {
  businessDate: string; currencies: Currency[];
  commissionPolicy?: CommissionPolicy;
  clients: { id: string; code: string; name: string; routeId: string; active: boolean; preferredCurrency?: Currency; canSendFrom: boolean; canReceive: boolean }[];
  operators: { id: string; name: string; role: "admin" | "collector"; collectorId?: string }[];
  rates: Rate[]; rateHistory?: RateChange[]; transfers: Transfer[]; cashSessions: Cash[];
};
export type Report = {
  commissionAllocations?: {
    details: Array<CommissionAllocation & Pick<Transfer, "id" | "envioReference" | "createdAt" | "status">>;
    totals: Array<{ date: string; currency: Currency; managerId: string; managerName: string; count: number; cancelledCount: number;
      transactionAmount: number; companyAmount: number; managerAmount: number; cancelledTransactionAmount: number; cancelledCompanyAmount: number; cancelledManagerAmount: number }>;
  };
  from: string; to: string; grouping: "range" | "day";
  amounts: { date: string; sourceCurrency: Currency; destinationCurrency: Currency; count: number; pendingCount: number; paidCount: number; cancelledCount: number; amount: number; commissionAmount: number; totalAmount: number; receiveAmount: number }[];
  deliveryTimes: { id: string; envioReference: string; createdAt: string; paidAt: string; elapsedSeconds: number }[];
  deliveryTimeSummary: { date: string; count: number; minSeconds: number; maxSeconds: number; averageSeconds: number }[];
  delivered: { date: string; currency: Currency; count: number; amount: number }[];
  cash: Cash[];
  cashSummary: { operatorId: string; currency: Currency; date: string; sessionCount: number; sentTotal: number; cancelRefund: number; paid: number; firstOpening: number; lastExpected: number }[];
  commissions?: {
    details: Array<Pick<Transfer, "id" | "envioReference" | "createdAt" | "sendingUserId" | "senderClientId" | "recipientClientId" | "sourceCurrency" | "destinationCurrency" | "amount" | "commissionBps" | "commissionAmount" | "status">>;
    totals: { date: string; currency: Currency; count: number; commissionAmount: number; cancelledCount: number; cancelledCommissionAmount: number }[];
  };
  managerCommissions?: {
    details: Array<ManagerCommission & Pick<Transfer, "id" | "envioReference" | "createdAt" | "status">>;
    totals: Array<ManagerCommission & { date: string; count: number; cancelledCount: number; cancelledAmount: number }>;
  };
};
export type CommissionReportStatus = "all" | "active" | "pending" | "paid" | "cancelled";
export type CommissionReportGroupBy = "managerCurrency" | "currency";
export type CommissionReportTotals = { count: number; cancelledCount: number; transactionAmount: number; companyAmount: number; managerAmount: number;
  cancelledTransactionAmount: number; cancelledCompanyAmount: number; cancelledManagerAmount: number };
export type ConsolidatedCommissionReport = {
  from: string; to: string; grouping: "range" | "day"; groupBy: CommissionReportGroupBy; status: CommissionReportStatus;
  managerId?: string; currency?: Currency; excludedLegacyCount: number;
  details: Array<CommissionAllocation & Pick<Transfer, "id" | "envioReference" | "createdAt" | "status">>;
  groups: Array<CommissionReportTotals & { date: string; currency: Currency; managerId?: string; managerName?: string }>;
  currencyTotals: Array<CommissionReportTotals & { currency: Currency }>;
};
