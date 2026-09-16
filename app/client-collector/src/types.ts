export type User = {
  id: string;
  name: string;
  role: string;
  collectorId?: string;
};
export type Client = {
  id: string;
  name: string;
  code: string;
  phone: string;
  address: string;
  routeId: string;
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
export type Snapshot = {
  businessDate: string;
  clients: Client[];
  routes: { id: string; name: string; sector: string; collectorId: string }[];
  collectors: Collector[];
  charges: Charge[];
  payouts: Payout[];
  movements: Movement[];
  settlements: {
    id: string;
    collectorId: string;
    date: string;
    collected: number;
    deposited: number;
    officeDelivered: number;
    paidToClients: number;
    difference: number;
    status: "closed";
    closedAt: string;
  }[];
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
export type Receipt = {
  id: string;
  clientName: string;
  collectorName: string;
  concept: string;
  amount: number;
  createdAt: string;
  type: string;
};
export type Operation = {
  id: string;
  clientName: string;
  concept: string;
  outstanding: number;
  kind: "collection" | "payout";
};
