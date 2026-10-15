export type CashReconciliationCurrency = "DOP" | "USD" | "EUR";
export type CashReconciliationAmounts = Record<CashReconciliationCurrency, number>;
export type CashReconciliationRecord = {
  id: string;
  collectorId: string;
  date: string;
  currency: CashReconciliationCurrency;
  collected: number;
  deposited: number;
  officeDelivered: number;
  paidToClients: number;
  returnedCollection: number;
  returnedPayout: number;
  note: string;
  actorId: string;
  createdAt: string;
};
export type PreviousCashRow = Pick<CashReconciliationRecord, "date" | "currency" | "collected" | "deposited" | "officeDelivered" | "paidToClients" | "returnedCollection" | "returnedPayout"> & { amount: number };
export type PreviousCashPreview = {
  collectorId: string;
  collectorName: string;
  businessDate: string;
  revision: string;
  rows: PreviousCashRow[];
  amounts: CashReconciliationAmounts;
  canReconcile: boolean;
  issues: string[];
  history: CashReconciliationRecord[];
  demo: boolean;
};
export type PreviousCashInput = {
  collectorId: string;
  revision: string;
  amounts: CashReconciliationAmounts;
  note: string;
  confirmReceived: true;
};
