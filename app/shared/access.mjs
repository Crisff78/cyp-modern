import catalog from "./permission-catalog.json" with { type: "json" };

// New modules use namespaced keys; the sparse legacy codes and names stay intact.
export const REMITTANCE_PERMISSIONS = [
  { key: "remittances.view", name: "Consultar envíos" },
  { key: "remittances.create", name: "Registrar envíos" },
  { key: "remittances.receipts", name: "Consultar recibos pendientes" },
  { key: "remittances.pay", name: "Entregar dinero al destinatario" },
  { key: "remittances.cancel", name: "Cancelar envíos pendientes" },
  { key: "remittances.clients.create", name: "Registrar clientes durante un envío" },
  { key: "remittances.cash.view", name: "Consultar caja de envíos" },
  { key: "remittances.cash.open", name: "Abrir cajas de envíos" },
  { key: "remittances.cash.close", name: "Cerrar la caja propia de envíos" },
  { key: "remittances.reports", name: "Consultar e imprimir reportes de remesas" },
  { key: "remittances.rates.view", name: "Consultar tasas de remesas" },
  { key: "remittances.rates.manage", name: "Administrar tasas de remesas" },
  { key: "remittances.commissions.view", name: "Consultar la configuración de comisiones" },
  { key: "remittances.commissions.manage", name: "Administrar comisiones de remesas" },
];
export const REMITTANCE_PERMISSION_KEYS = REMITTANCE_PERMISSIONS.map(({ key }) => key);
export const REMITTANCE_PERMISSION_DEPENDENCIES = {
  "remittances.create": ["remittances.view"], "remittances.clients.create": ["remittances.view", "remittances.create"],
  "remittances.pay": ["remittances.receipts"], "remittances.cancel": ["remittances.view"],
  "remittances.cash.open": ["remittances.cash.view"], "remittances.cash.close": ["remittances.cash.view"],
  "remittances.rates.manage": ["remittances.rates.view"], "remittances.commissions.manage": ["remittances.commissions.view"],
};

const legacyIds = catalog.permissions.map(({ id }) => id);
const readIds = [1, 2, 3, 5, 10, 101, 111, 115, 120, 130, 140, 144, 150, 160, 170, 174, 180, 190, 200,
  300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 401, 410, 411, 412, 413, 414, 415, 500, 501];
const collectorIds = [1, 2, 130, 140, 144, 300, 320, 321, 323, 370, 371, 373, 400, 500, 501];
const maintenance = new Set(["remittances.rates.manage", "remittances.commissions.manage", "remittances.cash.open"]);
const readKeys = new Set(["remittances.view", "remittances.receipts", "remittances.cash.view", "remittances.reports", "remittances.rates.view", "remittances.commissions.view"]);
export function accessRole(value) {
  const role = value.trim().toLowerCase().replace(/^role_/, "");
  return role === "superadmin" || role === "administrador" ? "admin" : role === "cobrador" ? "collector" : role;
}
export function rolePermissionIds(role) {
  switch (accessRole(role)) {
    case "admin": return [...legacyIds];
    case "supervisor": return [...readIds];
    case "collector": return [...collectorIds];
    default: return [];
  }
}
export function roleRemittancePermissions(role) {
  switch (accessRole(role)) {
    case "admin": return [...REMITTANCE_PERMISSION_KEYS];
    case "supervisor": return [...readKeys];
    case "collector": return REMITTANCE_PERMISSION_KEYS.filter((key) => !maintenance.has(key) && key !== "remittances.commissions.view");
    default: return [];
  }
}
export function effectiveAccess(role, selection) {
  const normalized = accessRole(role), mode = selection?.permissionMode ?? "role";
  const ceiling = normalized === "user" ? [1, 2] : rolePermissionIds(role);
  const legacy = mode === "role" ? rolePermissionIds(role) : [...new Set(selection?.permissionIds ?? [])].filter((id) => ceiling.includes(id));
  const allowed = normalized === "user" ? REMITTANCE_PERMISSION_KEYS.filter((key) => !maintenance.has(key)) : roleRemittancePermissions(role);
  const remittances = mode === "role" ? roleRemittancePermissions(role)
    : [...new Set(selection?.remittancePermissions ?? [])].filter((key) => allowed.includes(key));
  return { mode, revision: selection?.permissionRevision ?? 0,
    legacy: legacy.includes(1) ? legacy : [], remittances: legacy.includes(1) ? remittances : [] };
}
export const actorAccess = (actor) => actor.access ?? effectiveAccess(actor.role);
export const hasPermission = (actor, id) => actorAccess(actor).legacy.includes(id);
export const hasRemittancePermission = (actor, key) => {
  const keys = actorAccess(actor).remittances;
  return keys.includes(key) && (REMITTANCE_PERMISSION_DEPENDENCIES[key] ?? []).every((dependency) => keys.includes(dependency));
};
export const hasRemittanceAccess = (actor) => actorAccess(actor).remittances.some((key) =>
  ["remittances.view", "remittances.receipts", "remittances.cash.view", "remittances.reports"].includes(key));

// Every UI entry point uses the same page requirement, including direct hashes.
export const PAGE_PERMISSIONS = {
  controlPanel: 10, clients: 140, collectors: 150, users: 101, sessions: 115, traces: 5,
  zones: 120, routes: 130, collectionPointGroups: 160, collectionPoints: 170, stations: 111,
  services: 180, servicesProducts: 180, concepts: 190, groups: 160, pcps: 170, routesZones: 130, charges: 300, recurringCharges: 350, collections: 320,
  deposits: 330, payouts: 360, recurringPayouts: 390, payments: 370, cashDeliveries: 380,
  dailySettlements: 401, reports: 400, monitorCollectors: 501, monitorZones: 500, monitorRoutes: 500,
  systemConfig: 3, generalConfig: 3, exchangeRates: 200,
};
export function canOpenPage(actor, page) {
  if (page === "remittances") return hasRemittanceAccess(actor);
  if (page === "remittanceCommissions") return accessRole(actor.role) === "admin" && hasRemittancePermission(actor, "remittances.commissions.view");
  if (page === "exchangeRates") return hasPermission(actor, 200) && hasRemittancePermission(actor, "remittances.rates.view");
  if (page === "reports") return hasPermission(actor, 400) || hasRemittancePermission(actor, "remittances.reports");
  if (page.startsWith("reportRemittance")) return hasRemittancePermission(actor, "remittances.reports");
  if (page.startsWith("report")) return hasPermission(actor, 400);
  if (accessRole(actor.role) === "user" || accessRole(actor.role) === "undefined") return false;
  return hasPermission(actor, PAGE_PERMISSIONS[page] ?? 10);
}
