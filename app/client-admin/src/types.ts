export const ROLE_DEFINITIONS = {
  SUPERADMIN: {
    code: "ROLE_SUPERADMIN",
    id: "UUID-FFF",
    label: "Superadministrador",
  },
  ADMIN: { code: "ROLE_ADMIN", id: "UUID-AAA", label: "Administrador" },
  SUPERVISOR: { code: "ROLE_SUPERVISOR", id: "UUID-333", label: "Supervisor" },
  COLLECTOR: { code: "ROLE_COLLECTOR", id: "UUID-111", label: "Cobrador" },
  CLIENT: { code: "ROLE_CLIENT", id: "UUID-001", label: "Cliente" },
} as const;
export type RoleName = keyof typeof ROLE_DEFINITIONS;
export type RoleCode = (typeof ROLE_DEFINITIONS)[RoleName]["code"];
export type User = {
  id: string;
  name: string;
  role: RoleName | RoleCode | string;
  roleCode?: RoleCode;
  roleId?: string;
  collectorId?: string;
  isActive?: boolean;
  hasWorkPermission?: boolean;
};
export const normalizeRole = (role: User["role"]): RoleName => {
  const normalized = String(role).trim().toUpperCase();
  if (normalized === "SUPERADMIN" || normalized === "ROLE_SUPERADMIN")
    return "SUPERADMIN";
  if (normalized === "ADMIN" || normalized === "ROLE_ADMIN") return "ADMIN";
  if (normalized === "SUPERVISOR" || normalized === "ROLE_SUPERVISOR")
    return "SUPERVISOR";
  if (
    normalized === "COLLECTOR" ||
    normalized === "COBRADOR" ||
    normalized === "ROLE_COLLECTOR"
  )
    return "COLLECTOR";
  if (
    normalized === "CLIENT" ||
    normalized === "CLIENTE" ||
    normalized === "ROLE_CLIENT"
  )
    return "CLIENT";
  return normalized as RoleName;
};
export const enrichUserRole = <T extends User>(user: T): T => {
  const role = normalizeRole(user.role);
  const definition = ROLE_DEFINITIONS[role as keyof typeof ROLE_DEFINITIONS];
  return {
    ...user,
    role,
    roleCode: definition?.code ?? user.roleCode,
    roleId: definition?.id ?? user.roleId,
    isActive: user.isActive ?? true,
    hasWorkPermission: user.hasWorkPermission ?? true,
  };
};
export const canAccessAdmin = (user: User) =>
  ["SUPERADMIN", "ADMIN", "SUPERVISOR"].includes(normalizeRole(user.role));
export const canAccessCollector = (user: User) =>
  ["COLLECTOR", "SUPERADMIN"].includes(normalizeRole(user.role));
export const isSuspendedUser = (user: User) =>
  user.isActive === false || user.hasWorkPermission === false;

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
  ident?: string;
  cellular?: string;
  accountId?: string;
  zones?: { id: string; name: string; from: string; to: string }[];
  limits?: {
    currency: string;
    abbr: string;
    collectionLimit: number;
    payoutLimit: number;
  }[];
  assignedRoutes?: string[];
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
  acceptedAt?: string;
  acceptedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
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
  | "stations"
  | "groups"
  | "pcps"
  | "routes"
  | "zones"
  | "servicesProducts"
  | "delayReasons"
  | "exchangeRates"
  | "sessions"
  | "traces"
  | "users"
  | "generalConfig"
  | "authorizationRequests"
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
