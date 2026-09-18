export type Client = {
  id: string;
  name: string;
  code: string;
  phone: string;
  address: string;
  routeId: string;
};
export type Collector = {
  id: string;
  name: string;
  initials: string;
  routeId: string;
  status: "active" | "offline" | "limit";
  cashInHand: number;
  collectionLimit: number;
  payoutLimit: number;
  lat: number;
  lng: number;
  lastSeen: string;
};
export type Charge = {
  id: string;
  clientId: string;
  service: string;
  amount: number;
  collected: number;
  dueDate: string;
  required: boolean;
  status: "pending" | "partial" | "paid" | "cancelled";
};
export type Payout = {
  id: string;
  clientId: string;
  collectorId: string;
  concept: string;
  amount: number;
  paid: number;
  status: "pending" | "partial" | "paid" | "cancelled";
};
export type Movement = {
  id: string;
  collectorId: string;
  clientId?: string;
  chargeId?: string;
  payoutId?: string;
  type: "collection" | "deposit" | "office_delivery" | "payout";
  amount: number;
  createdAt: string;
  receiptToken?: string;
};
export type Balance = {
  collected: number;
  deposited: number;
  officeDelivered: number;
  paidToClients: number;
  difference: number;
};
export type PublicAccount = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "collector";
  collectorId?: string;
  credentialVersion: number;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};
export type Snapshot = {
  businessDate: string;
  clients: Client[];
  collectors: Collector[];
  accounts: PublicAccount[];
  charges: Charge[];
  payouts: Payout[];
  movements: Movement[];
  routes: { id: string; name: string; sector: string; collectorId: string }[];
  settlements: (Balance & {
    id: string;
    collectorId: string;
    date: string;
    status: "closed";
    closedAt: string;
  })[];
  totals: {
    collected: number;
    paid: number;
    deposited: number;
    officeDelivered: number;
    difference: number;
    activeCollectors: number;
  };
  history: { label: string; collected: number; paid: number }[];
};
export type Page =
  | "collectors"
  | "clients"
  | "routesZones"
  | "servicesProducts"
  | "delayReasons"
  | "exchangeRates"
  | "users"
  | "charges"
  | "recurringCharges"
  | "collections"
  | "deposits"
  | "payouts"
  | "payments"
  | "cashDeliveries"
  | "monitorCollectors"
  | "monitorZones"
  | "monitorRoutes"
  | "dailySettlements"
  | "reports";
