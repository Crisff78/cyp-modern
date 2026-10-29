import catalog from "./permission-catalog.json" with { type: "json" };

// New modules use namespaced keys; the sparse legacy codes and names stay intact.
export const REMITTANCE_PERMISSIONS = [
  { key: "remittances.view", name: "Ver envíos de dinero" },
  { key: "remittances.create", name: "Registrar envíos de dinero" },
  { key: "remittances.receipts", name: "Ver remesas por entregar" },
  { key: "remittances.pay", name: "Entregar dinero al destinatario" },
  { key: "remittances.cancel", name: "Cancelar envíos pendientes" },
  { key: "remittances.clients.create", name: "Registrar clientes durante un envío" },
  { key: "remittances.cash.view", name: "Ver caja de remesas" },
  { key: "remittances.cash.open", name: "Abrir cajas de remesas" },
  { key: "remittances.cash.close", name: "Cerrar su propia caja de remesas" },
  { key: "remittances.reports", name: "Ver e imprimir reportes de remesas" },
  { key: "remittances.rates.view", name: "Ver tasas de remesas" },
  { key: "remittances.rates.manage", name: "Cambiar tasas de remesas" },
  { key: "remittances.commissions.view", name: "Ver comisiones de remesas" },
  { key: "remittances.commissions.manage", name: "Cambiar comisiones de remesas" },
];
export const REMITTANCE_PERMISSION_KEYS = REMITTANCE_PERMISSIONS.map(({ key }) => key);
export const REMITTANCE_PERMISSION_DEPENDENCIES = {
  "remittances.create": ["remittances.view"], "remittances.clients.create": ["remittances.view", "remittances.create"],
  "remittances.pay": ["remittances.receipts"], "remittances.cancel": ["remittances.view"],
  "remittances.cash.open": ["remittances.cash.view"], "remittances.cash.close": ["remittances.cash.view"],
  "remittances.rates.manage": ["remittances.rates.view"], "remittances.commissions.manage": ["remittances.commissions.view"],
};

const legacyIds = catalog.permissions.map(({ id }) => id);
// An action needs entry to the system and visibility of its own screen.
export function legacyPermissionDependencies(id) {
  const families = [[101, 102, 103, 104, 106, 107], [111, 112, 113, 114], [115, 116], [120, 121, 122, 123],
    [130, 131, 132, 133, 134], [140, 141, 142, 143, 144, 145], [150, 151, 152, 153, 154, 155, 156],
    [160, 161, 162, 163], [170, 171, 172, 173, 174], [180, 181, 182, 183], [190, 191, 192, 193],
    [200, 201], [300, 301, 302, 303, 304], [320, 321, 322, 323], [330, 331, 332, 333, 334],
    [350, 351, 352, 353], [360, 361, 362, 363, 364], [370, 371, 372, 373], [380, 381, 382, 383],
    [390, 391, 392, 393], [401, 402, 403]];
  const parent = families.find((family) => family.includes(id))?.[0];
  return [...new Set([...(id === 1 ? [] : [1]), ...(parent && parent !== id ? [parent] : []), ...(id === 4 ? [3] : [])])];
}
const readIds = [1, 2, 3, 5, 10, 101, 111, 115, 120, 130, 140, 144, 150, 160, 170, 174, 180, 190, 200,
  300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 401, 410, 411, 412, 413, 414, 415, 500, 501];
const collectorIds = [1, 2, 130, 140, 144, 300, 320, 321, 323, 370, 371, 373, 400, 500, 501];
const maintenance = new Set(["remittances.rates.manage", "remittances.commissions.manage", "remittances.cash.open"]);
const readKeys = new Set(["remittances.view", "remittances.receipts", "remittances.cash.view", "remittances.reports", "remittances.rates.view", "remittances.commissions.view"]);
// The cashier opens only his own cash box (enforced by the server); rates and commissions stay administrative.
const cashierKeys = ["remittances.view", "remittances.create", "remittances.receipts", "remittances.pay", "remittances.cancel",
  "remittances.clients.create", "remittances.cash.view", "remittances.cash.open", "remittances.cash.close"];
export function accessRole(value) {
  const role = value.trim().toLowerCase().replace(/^role_/, "");
  return role === "superadmin" || role === "administrador" ? "admin" : role === "cobrador" ? "collector" : role === "cajero" ? "cashier" : role;
}
export function rolePermissionIds(role) {
  switch (accessRole(role)) {
    case "admin": return [...legacyIds];
    case "supervisor": return [...readIds];
    case "collector": return [...collectorIds];
    case "cashier": return [1, 2];
    default: return [];
  }
}
export function roleRemittancePermissions(role) {
  switch (accessRole(role)) {
    case "admin": return [...REMITTANCE_PERMISSION_KEYS];
    case "supervisor": return [...readKeys];
    // Intentional since PR 36: the collector keeps the quick client sign-up during a remittance
    // (`remittances.clients.create`), always limited to his own route by the server.
    case "collector": return REMITTANCE_PERMISSION_KEYS.filter((key) => !maintenance.has(key) && key !== "remittances.commissions.view");
    case "cashier": return [...cashierKeys];
    default: return [];
  }
}
export function effectiveAccess(role, selection) {
  const normalized = accessRole(role), mode = selection?.permissionMode ?? "role";
  const ceiling = rolePermissionIds(role);
  const extended = mode === "custom" && selection?.roleExceptions === true;
  const legacy = mode === "role" ? rolePermissionIds(role) : [...new Set(selection?.permissionIds ?? [])].filter((id) => (extended ? legacyIds : ceiling).includes(id));
  // A cashier may additionally be granted the reports of his own operations.
  const allowed = normalized === "cashier" ? [...cashierKeys, "remittances.reports"] : roleRemittancePermissions(role);
  const remittances = mode === "role" ? roleRemittancePermissions(role)
    : [...new Set(selection?.remittancePermissions ?? [])].filter((key) => (extended ? REMITTANCE_PERMISSION_KEYS : allowed).includes(key));
  return { mode, revision: selection?.permissionRevision ?? 0,
    ...(extended && (legacy.some((id) => !ceiling.includes(id)) || remittances.some((key) => !allowed.includes(key))) ? { roleExceptions: true } : {}),
    legacy: legacy.includes(1) ? legacy : [], remittances: legacy.includes(1) ? remittances : [] };
}
export const actorAccess = (actor) => actor.access ?? effectiveAccess(actor.role);
export const hasPermission = (actor, id) => actorAccess(actor).legacy.includes(id);
export const hasRoleExceptions = (actor) => actorAccess(actor).mode === "custom" && actorAccess(actor).roleExceptions === true && hasPermission(actor, 1);
export const hasRemittancePermission = (actor, key) => {
  const keys = actorAccess(actor).remittances;
  return keys.includes(key) && (REMITTANCE_PERMISSION_DEPENDENCIES[key] ?? []).every((dependency) => keys.includes(dependency));
};
export const hasRemittanceAccess = (actor) => actorAccess(actor).remittances.some((key) =>
  ["remittances.view", "remittances.receipts", "remittances.cash.view", "remittances.reports"].includes(key));
// On its role profile every account changes its own password, as before PR 36; only
// personalized permissions can withdraw it through code 2.
export const canChangeOwnPassword = (actor) => actorAccess(actor).mode !== "custom" || hasPermission(actor, 2);

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
  if (page === "remittances") return hasRemittancePermission(actor, "remittances.view");
  if (page === "remittancePayouts") return hasRemittancePermission(actor, "remittances.receipts");
  // Collector settlements need 401; the remittance cash section only its own permission.
  if (page === "dailySettlements") return hasPermission(actor, 401) || hasRemittancePermission(actor, "remittances.cash.view");
  if (page === "remittanceCommissions") return (accessRole(actor.role) === "admin" || hasRoleExceptions(actor)) && hasRemittancePermission(actor, "remittances.commissions.view");
  if (page === "exchangeRates") return hasPermission(actor, 200) && hasRemittancePermission(actor, "remittances.rates.view");
  if (page === "reports") return hasPermission(actor, 400) || hasRemittancePermission(actor, "remittances.reports");
  if (["reportRemittanceAllocations", "reportRemittanceManagerCommissions", "reportRemittanceExchangeGain"].includes(page)) return hasRemittancePermission(actor, "remittances.reports") && hasRemittancePermission(actor, "remittances.commissions.view");
  if (page.startsWith("reportRemittance")) return hasRemittancePermission(actor, "remittances.reports");
  if (page.startsWith("report")) return hasPermission(actor, 400);
  if (["client", "undefined", "cashier"].includes(accessRole(actor.role)) && !hasRoleExceptions(actor)) return false;
  return hasPermission(actor, PAGE_PERMISSIONS[page] ?? 10);
}
