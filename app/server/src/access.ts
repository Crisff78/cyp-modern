import { canChangeOwnPassword, effectiveAccess, hasPermission, hasRemittancePermission, hasRemittanceAccess, type RemittancePermission } from "../../shared/access.mjs";
import { businessDate, DomainError, type State, type User } from "./domain.js";
import type { AdminToolsState } from "./admin-tools.js";

// The bootstrap administrator (configured or demo) is managed only by itself.
export function assertBootstrapManagedBySelf(actor: User, targetId: string) {
  if (targetId !== actor.id && (targetId === "configured-admin" || targetId === "demo-admin"))
    throw new DomainError("ACCOUNT_PROTECTED", "La cuenta principal de administración solo puede modificarla ella misma.", 403);
}
// Changing another account's password, sign-in data, role or status, or closing its sessions, needs
// every effective permission of that account: a limited administrator cannot take over or lock out
// a broader one. An administrator with full access keeps managing every other account.
export function assertManagesAccount(state: State, actor: User, targetId: string, targetRole?: string) {
  if (targetId === actor.id) return;
  assertBootstrapManagedBySelf(actor, targetId);
  const account = state.accounts.find(({ id }) => id === targetId);
  const target = effectiveAccess(account?.role ?? targetRole ?? "undefined", account), own = actor.access ?? effectiveAccess(actor.role);
  if (target.legacy.some((id) => !own.legacy.includes(id)) || target.remittances.some((key) => !own.remittances.includes(key)))
    throw new DomainError("ACCOUNT_MORE_PRIVILEGED", "Esa cuenta tiene permisos que la tuya no tiene. Solo puede gestionarla una cuenta que tenga todos sus permisos.", 403);
}

export function currentAccessUser(state: State, actor: User): User {
  const account = state.accounts.find(({ id }) => id === actor.id);
  if (account && (account.status !== "active" || account.role !== actor.role || account.collectorId !== actor.collectorId || (actor as User & { authVersion?: string }).authVersion !== undefined && (actor as User & { authVersion?: string }).authVersion !== String(account.credentialVersion)))
    throw new DomainError("SESSION_EXPIRED", "La configuración de acceso cambió. Inicia sesión de nuevo.", 401);
  return { ...actor, access: effectiveAccess(actor.role, account) };
}
export function requirePermission(actor: User, permission: number) {
  if (!hasPermission(actor, permission)) throw new DomainError("PERMISSION_REQUIRED", "Tu cuenta no tiene permiso para realizar esta acción.", 403);
}
export function requireRemittancePermission(actor: User, permission: RemittancePermission) {
  if (!hasRemittancePermission(actor, permission)) throw new DomainError(actor.access?.mode === "custom" ? "PERMISSION_REQUIRED" : "FORBIDDEN", "Tu cuenta no tiene permiso para esta acción de envíos de dinero.", 403);
}
const resourcePermissions: Record<string, readonly [number, number, number, number]> = {
  usuarios: [101, 102, 103, 104], cobradores: [150, 151, 152, 153], clientes: [140, 141, 142, 143],
  zonas: [120, 121, 122, 123], rutas: [130, 131, 132, 133], "grupos-pcp": [160, 161, 162, 163],
  pcps: [170, 171, 172, 173], estaciones: [111, 112, 113, 114], servicios: [180, 181, 182, 183],
  conceptos: [190, 191, 192, 193], cargos: [300, 301, 302, 303], "cargos-recurrentes": [350, 351, 352, 353],
  descargos: [360, 361, 362, 363], "descargos-recurrentes": [390, 391, 392, 393],
  cobros: [320, 321, 322, 323], pagos: [370, 371, 372, 373], depositos: [330, 331, 332, 333], entregas: [380, 381, 382, 383],
};
export function authorizeRequest(actor: User, method: string, route: string) {
  const path = decodeURIComponent(route.replace(/^\/api\//, "")), parts = path.split("/");
  if (path === "auth/me" || path === "auth/logout") return;
  // Same rule as the interface: the role profile keeps the own password change; code 2 withdraws it only in custom mode.
  if (path === `usuarios/${actor.id}/clave`) { if (!canChangeOwnPassword(actor)) requirePermission(actor, 2); return; }
  // Own-session endpoints remain available so a revoked user can log out.
  if (!hasPermission(actor, 1) && actor.access?.mode === "custom")
    throw new DomainError("ACCESS_REVOKED", "Tu acceso cambió. Solicita a Administración que revise tus permisos.", 403);
  if (path === "snapshot") return;
  if (/^recibos\/[^/]+\/revocar$/.test(path)) {
    if (![323, 373, 333, 383].some((id) => hasPermission(actor, id))) requirePermission(actor, 323);
    return;
  }
  if (parts[0] === "envios") {
    let permission: RemittancePermission | undefined;
    if (path === "envios/snapshot") {
      if (!hasRemittanceAccess(actor) && !hasRemittancePermission(actor, "remittances.commissions.view") && !hasRemittancePermission(actor, "remittances.rates.view"))
        throw new DomainError("PERMISSION_REQUIRED", "Tu cuenta no tiene acceso a Remesas.", 403);
      return;
    }
    if (path.startsWith("envios/clientes")) {
      if (!hasRemittancePermission(actor, "remittances.create") && !hasRemittancePermission(actor, "remittances.receipts"))
        throw new DomainError("PERMISSION_REQUIRED", "Tu cuenta no tiene permiso para consultar estos clientes.", 403);
      return;
    }
    if (path === "envios/cotizacion") permission = "remittances.create";
    else if (path === "envios/politica-comisiones") permission = "remittances.commissions.manage";
    else if (path === "envios/tasas") permission = "remittances.rates.manage";
    else if (path.startsWith("envios/reportes")) permission = "remittances.reports";
    else if (path === "envios/recibos") permission = "remittances.receipts";
    else if (path.endsWith("/pagar")) permission = "remittances.pay";
    else if (path.endsWith("/cancelar")) permission = "remittances.cancel";
    else if (path.endsWith("/cajas/abrir")) permission = "remittances.cash.open";
    else if (/^envios\/cajas\/[^/]+\/cerrar$/.test(path)) permission = "remittances.cash.close";
    else if (path === "envios") permission = method === "GET" ? "remittances.view" : "remittances.create";
    if (permission) {
      requireRemittancePermission(actor, permission);
      const read: Partial<Record<RemittancePermission, RemittancePermission>> = { "remittances.create": "remittances.view", "remittances.pay": "remittances.receipts", "remittances.cancel": "remittances.view", "remittances.cash.open": "remittances.cash.view", "remittances.cash.close": "remittances.cash.view", "remittances.rates.manage": "remittances.rates.view", "remittances.commissions.manage": "remittances.commissions.view" };
      if (read[permission]) requireRemittancePermission(actor, read[permission]!);
      if (permission === "remittances.rates.manage") requirePermission(actor, 201);
    }
    return;
  }
  if (path === "permisos") { requirePermission(actor, 101); return; }
  if (["estaciones/validar", "estaciones/obtener-datos"].includes(path)) {
    requirePermission(actor, 111);
    if (!hasPermission(actor, 112) && !hasPermission(actor, 113)) throw new DomainError("PERMISSION_REQUIRED", "No tienes permiso para registrar ni editar estaciones.", 403);
    return;
  }
  if (parts[0] === "usuarios" && parts[2] === "permisos") { requirePermission(actor, method === "GET" ? 101 : 106); return; }
  if (parts[0] === "usuarios" && parts[2] === "clave") { requirePermission(actor, 107); return; }
  if (parts[0] === "cobradores" && ["zonas", "rutas", "limites"].includes(parts[2])) {
    requirePermission(actor, method === "GET" ? 150 : ({ zonas: 154, rutas: 155, limites: 156 } as const)[parts[2] as "zonas" | "rutas" | "limites"]); return;
  }
  // Added/removed station permissions are checked against the actual set inside the transaction.
  if (parts[0] === "pcps" && parts[2] === "estaciones") { requirePermission(actor, 174); return; }
  if (parts[0] === "rutas" && parts[2] === "clientes") { requirePermission(actor, method === "GET" ? 130 : 134); return; }
  if (parts[0] === "configuracion") { requirePermission(actor, method === "GET" ? 3 : 4); return; }
  if (parts[0] === "sesiones") { requirePermission(actor, method === "GET" ? 115 : 116); return; }
  if (parts[0] === "trazas") { requirePermission(actor, 5); return; }
  // POST /cuadres closes the collector's day: «Hacer cuadre» (402) and «Cerrar Día» (403), as in the interface.
  if (parts[0] === "cuadres") { requirePermission(actor, method === "GET" ? 401 : /cerrar|regularizar/.test(path) ? 403 : 402); if (method !== "GET" && path === "cuadres") requirePermission(actor, 403); return; }
  if (parts[0] === "reportes") { requirePermission(actor, 400); return; }
  // The collector monitor is its own page (501); zones and routes keep the general monitors (500).
  if (parts[0] === "monitoring" && parts[1] === "collector") { requirePermission(actor, 501); return; }
  if (/^monito/.test(parts[0]) || parts[0] === "tracking" && method === "GET") { requirePermission(actor, 500); return; }
  if (parts[0] === "tracking" && method === "POST") return; // Authenticated collector scope is enforced by the tracking route.
  if (parts[0] === "clientes" && parts[2] === "estado" && method === "GET") { requirePermission(actor, 144); return; }
  // Generating from templates creates real charges: it also needs to see and add charges.
  if (parts[0] === "cargos" && parts[1] === "recurrentes") { for (const id of [350, 351, 300, 301]) requirePermission(actor, id); return; }
  if (["bancos", "motivos-atraso", "solicitudes-autorizacion"].includes(parts[0])) { requirePermission(actor, 10); return; }
  const resource = resourcePermissions[parts[0]];
  if (resource) { requirePermission(actor, resource[0]); requirePermission(actor, method === "GET" ? resource[0]
    : /cancelar|inactivar|actividad|estado|eliminar/.test(path) ? resource[3]
    : path === "depositos/aceptar" || /depositos\/[^/]+\/aceptar/.test(path) ? 334
    : /importar|subir/.test(path) ? parts[0] === "cargos" ? 304 : 364
    : parts.length > 1 && !["sugerencias", "registrar", "central"].includes(parts[1]) ? resource[2] : resource[1]); }
}

export function guardCatalogChanges(state: State, actor: User, route: string): () => void {
  const parts = decodeURIComponent(route.replace(/^\/api\//, "")).split("/");
  const collections = { usuarios: "accounts", cobradores: "collectors", clientes: "clients", zonas: "zones", rutas: "routes", servicios: "services", "cargos-recurrentes": "recurringCharges", "descargos-recurrentes": "payoutRecurring" } as const;
  // PCPs and stations live in the administrative tools namespace.
  const adminCollections = { pcps: "pcps", estaciones: "stations" } as const;
  const key = collections[parts[0] as keyof typeof collections], adminKey = adminCollections[parts[0] as keyof typeof adminCollections];
  if (actor.access?.mode !== "custom" || parts.length !== 2 || (!key && !adminKey)) return () => {};
  type Row = { id: string; active?: boolean; status?: string; lat?: number | null; lng?: number | null; collectionLimit?: number; payoutLimit?: number };
  const rows = () => (key ? state[key] : (state as State & { adminTools?: AdminToolsState }).adminTools?.[adminKey] ?? []) as Row[];
  const original = rows().find(({ id }) => id === parts[1]);
  const before = original && structuredClone(original);
  return () => {
    const updated = rows().find(({ id }) => id === parts[1]);
    if (!before || !updated) return;
    // Older rows omit `active` and are active by default. Saving that same
    // effective value explicitly must not be mistaken for an activation change.
    if ((before.active !== false) !== (updated.active !== false) || parts[0] === "usuarios" && before.status !== updated.status) requirePermission(actor, resourcePermissions[parts[0]][3]);
    if (parts[0] === "clientes" && (before.lat !== updated.lat || before.lng !== updated.lng)) requirePermission(actor, 145);
    // The full edit cannot change what has its own permission: collector limits (156) and archiving a recurring payout (393).
    if (parts[0] === "cobradores" && (before.collectionLimit !== updated.collectionLimit || before.payoutLimit !== updated.payoutLimit)) requirePermission(actor, 156);
    if (parts[0] === "descargos-recurrentes" && (before.status === "archived") !== (updated.status === "archived")) requirePermission(actor, 393);
  };
}

export function filterOperationalSnapshot<T extends ReturnType<typeof import("./domain.js").snapshot>>(data: T, actor: User): T {
  // Remittance desks never receive the operational catalogs, whatever their permission mode.
  const desk = actor.role === "user" || actor.role === "cashier";
  if (actor.access?.mode !== "custom" && !desk) return data;
  const result = structuredClone(data);
  if (desk) result.banks = [];
  // A collector always keeps his own record, routes, movements and closed days (the snapshot already
  // limits them to him): his terminal computes cash in hand, pocket balances and limits from them.
  const ownCollector = actor.role === "collector";
  const clientWork = [140, 300, 350, 360, 320, 370].some((id) => hasPermission(actor, id));
  if (!hasPermission(actor, 140)) result.clients = clientWork ? result.clients.map(({ id, code, name, routeId, preferredCurrency, active }) => ({ id, code, name, routeId, preferredCurrency, active, phone: "", address: "" })) : [];
  if (!ownCollector && !hasPermission(actor, 130) && !clientWork) result.routes = [];
  if (!ownCollector && !hasPermission(actor, 120) && !clientWork) result.zones = [];
  if (!ownCollector && !hasPermission(actor, 150)) result.collectors = [];
  if (!hasPermission(actor, 101)) result.accounts = result.accounts.filter(({ id }) => id === actor.id);
  if (!hasPermission(actor, 300)) result.charges = [];
  if (!hasPermission(actor, 350)) result.recurringCharges = [];
  if (!hasPermission(actor, 360) && !hasPermission(actor, 370)) result.payouts = [];
  if (!hasPermission(actor, 390)) result.payoutRecurring = [];
  if (!ownCollector) result.movements = result.movements.filter((row) => hasPermission(actor, ({ collection: 320, payout: 370, deposit: 330, office_delivery: 380 } as const)[row.type]));
  if (!ownCollector && !hasPermission(actor, 401)) { result.settlements = []; result.cashReconciliations = []; }
  if (![180, 300, 350, 360].some((id) => hasPermission(actor, id))) result.services = [];
  if (!hasPermission(actor, 10)) result.delayReasons = [];
  // Totals and history cannot leak the financial data removed above.
  const totals = (currency: string) => {
    const rows = result.movements.filter((row) => !row.cancelledAt && row.currency === currency && businessDate(new Date(row.createdAt)) === result.businessDate);
    const sum = (type: string) => rows.filter((row) => row.type === type).reduce((sum, row) => sum + row.amount, 0);
    const collected = sum("collection"), paid = sum("payout"), deposited = sum("deposit"), officeDelivered = sum("office_delivery");
    return { collected, paid, deposited, officeDelivered, difference: collected - deposited + officeDelivered - paid };
  };
  result.totals = { ...totals("DOP"), activeCollectors: result.collectors.filter((row) => row.status === "active").length };
  result.totalsByCurrency = { DOP: totals("DOP"), USD: totals("USD"), EUR: totals("EUR") };
  if (!ownCollector) result.history = [];
  return result;
}
