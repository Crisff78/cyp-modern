export type Currency = "DOP" | "USD" | "EUR";
import type { EffectiveAccess } from "../access.mjs";
import type { ReceiptIssuer, RemittancePayment, RemittanceRefund } from "./payment.mjs";
import type { RateKind } from "./appliedRate.mjs";
export type NewRemittanceClient = { name: string; identification: string; phone: string; address: string; routeId: string; preferredCurrency: Currency };
// How what the person receives is rounded: the cents as before, the nearest whole unit, or always up to it.
export type ReceiveRounding = "none" | "normal" | "up";
// The box that was typed: what is sent, the total the sender pays, or what the person receives.
export type AmountMode = "source" | "total" | "destination";
export type Quote = {
  date: string; sourceRate: string; destinationRate: string; quotedAt?: string;
  sourceRateChangeId?: string; destinationRateChangeId?: string;
  sourceRateChangedAt?: string; destinationRateChangedAt?: string;
  sourceRateDate?: string; destinationRateDate?: string;
  sourceRateKind?: RateKind; destinationRateKind?: RateKind;
  commissionPolicyRevision?: string; managerCommissionBps?: number;
  managerShareBps?: number; deliveryConceptId?: string; deliveryCommissionBps?: number; receiveRounding?: ReceiveRounding;
};
export type CommissionPolicy = { revision: string; transactionCommissionBps: number; managerCommissionBps?: number; managerShareBps?: number; receiveRounding?: ReceiveRounding; updatedAt?: string; updatedBy?: string };
// Version 1: the manager's % of the received amount (sends before 29-10-2026). Version 2: his share of the commission.
export type CommissionAllocation = {
  version: 1 | 2; currency: Currency; policyRevision: string; managerCommissionBps: number;
  baseAmount: number; transactionAmount: number; companyAmount: number; managerAmount: number;
  managerId?: string; managerName?: string;
};
export type DeliveryConcept = { id: string; name: string; commissionBps: number; active: boolean; updatedAt?: string };
export type ExchangeGain = {
  currency: "DOP"; sourceAmount: number; destinationAmount: number; totalAmount: number;
  sourcePurchaseRate?: string; sourceSaleRate?: string; destinationPurchaseRate?: string; destinationSaleRate?: string;
};
// The whole calculation of a send (since 29-10-2026); exchangeGain only for those who see the commissions.
export type RemittanceCalculation = {
  version: 2; amountMode: AmountMode; requestedAmount: number; convertedAmount: number;
  deliveryConceptId: string; deliveryConceptName: string; deliveryCommissionBps: number; deliveryCommissionAmount: number;
  receiveRounding: ReceiveRounding; roundingAdjustment: number; payoutAmount: number;
  exchangeGain?: ExchangeGain;
};
export type Rate = { id: string; currency: Currency; rate: string; purchaseRate?: string; saleRate?: string; date: string; changeId?: string; updatedAt?: string; updatedBy?: string };
export type RateChange = { id: string; currency: Currency; rate: string; purchaseRate?: string; saleRate?: string; date: string; createdAt: string; actorId: string };
export type RemittanceContact = { id: string; code: string; name: string; phone: string; cellular: string; address: string; identification?: string };
export type ManagerCommission = { managerName: string; amount: number; currency: Currency };
export type Quotation = { sourceCurrency: Currency; destinationCurrency: Currency; amount: number; commissionBps: number; commissionAmount: number; totalAmount: number; receiveAmount: number; quote: Quote;
  amountDop?: number; requestedReceiveAmount?: number; receiveRoundingDifference?: number; commissionAllocation?: CommissionAllocation; calculation?: RemittanceCalculation };
/** What the person receives: after the commission at the destination and the rounding; a former send, its converted amount. */
export const payoutOf = (quotation: Pick<Quotation, "receiveAmount" | "calculation">) => quotation.calculation?.payoutAmount ?? quotation.receiveAmount;
export type Transfer = Quotation & {
  id: string; sequence: number; envioReference: string; reciboReference: string; operatingCode: string;
  senderClientId: string; recipientClientId: string; sendingUserId: string; registeredBy: string;
  note: string; status: "pending" | "paid" | "cancelled"; createdAt: string;
  paidAt?: string; paidBy?: string; cancelledAt?: string; cancelledBy?: string; cancelReason?: string;
  canPay: boolean; canCancel: boolean;
  senderContact?: RemittanceContact; recipientContact?: RemittanceContact;
  managerCommission?: ManagerCommission;
  payment?: RemittancePayment; receiptIssuer?: ReceiptIssuer; refund?: RemittanceRefund;
};
export type Cash = {
  id: string; operatorId: string; currency: Currency; date: string; openingAmount: number;
  openedBy: string; openedAt: string; status: "open" | "closed"; closedBy?: string; closedAt?: string;
  countedAmount?: number; sentTotal: number; cancelRefund: number; paid: number; expected: number; canClose: boolean;
};
export type RemittanceSnapshot = {
  access?: EffectiveAccess;
  clientRoutes?: { id: string; name: string }[];
  businessDate: string; currencies: Currency[];
  receiptFooterNote?: string;
  receiptIssuer?: ReceiptIssuer;
  commissionPolicy?: CommissionPolicy;
  /** «Sin comisión» first; the form offers only the active ones. */
  deliveryConcepts?: DeliveryConcept[];
  clients: { id: string; code: string; name: string; routeId: string; active: boolean; preferredCurrency?: Currency; canSendFrom: boolean; canReceive: boolean }[];
  operators: { id: string; name: string; role: "admin" | "collector" | "cashier"; collectorId?: string }[];
  /** The operators that can register a transfer (remittances.create); the boxes use all the operators. */
  sendingOperatorIds?: string[];
  /** Name of every operator that appears in the visible operations, boxes and reports, also of disabled accounts. */
  operatorNames?: Record<string, string>;
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
  exchangeGains?: {
    details: Array<Pick<Transfer, "id" | "envioReference" | "createdAt" | "sourceCurrency" | "destinationCurrency" | "amount" | "receiveAmount" | "status"> & Omit<ExchangeGain, "currency">>;
    totals: Array<{ date: string; sourceCurrency: Currency; destinationCurrency: Currency; count: number; sourceAmount: number; destinationAmount: number; totalAmount: number; cancelledCount: number; cancelledTotalAmount: number }>;
    legacyCount: number;
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
