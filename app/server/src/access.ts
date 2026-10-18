import { effectiveAccess, hasPermission, hasRemittancePermission, hasRemittanceAccess, type RemittancePermission } from "../../shared/access.mjs";
import { businessDate, DomainError, type State, type User } from "./domain.js";

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
  if (!hasRemittancePermission(actor, permission)) throw new DomainError(actor.access?.mode === "custom" ? "PERMISSION_REQUIRED" : "FORBIDDEN", "Tu cuenta no tiene permiso para esta acción de remesas.", 403);
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
  if (path === `usuarios/${actor.id}/clave`) { requirePermission(actor, 2); return; }
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
        throw new DomainError("PERMISSION_REQUIRED", "Tu cuenta no tiene acceso a Envíos de Dinero.", 403);
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
  if (parts[0] === "cuadres") { requirePermission(actor, method === "GET" ? 401 : /cerrar|regularizar/.test(path) ? 403 : 402); return; }
  if (parts[0] === "reportes") { requirePermission(actor, 400); return; }
  if (/^monito/.test(parts[0]) || parts[0] === "tracking" && method === "GET") { requirePermission(actor, 500); return; }
  if (parts[0] === "tracking" && method === "POST") return; // Authenticated collector scope is enforced by the tracking route.
  if (parts[0] === "clientes" && parts[2] === "estado" && method === "GET") { requirePermission(actor, 144); return; }
  if (parts[0] === "cargos" && parts[1] === "recurrentes") { requirePermission(actor, 350); requirePermission(actor, 351); return; }
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
  const collections = { usuarios: "accounts", cobradores: "collectors", clientes: "clients", zonas: "zones", rutas: "routes", servicios: "services", "cargos-recurrentes": "recurringCharges" } as const;
  const key = collections[parts[0] as keyof typeof collections];
  if (actor.access?.mode !== "custom" || parts.length !== 2 || !key) return () => {};
  type Row = { id: string; active?: boolean; status?: string; lat?: number | null; lng?: number | null };
  const original = (state[key] as Row[]).find(({ id }) => id === parts[1]);
  const before = original && structuredClone(original);
  return () => {
    const updated = (state[key] as Row[]).find(({ id }) => id === parts[1]);
    if (!before || !updated) return;
    // Older rows omit `active` and are active by default. Saving that same
    // effective value explicitly must not be mistaken for an activation change.
    if ((before.active !== false) !== (updated.active !== false) || parts[0] === "usuarios" && before.status !== updated.status) requirePermission(actor, resourcePermissions[parts[0]][3]);
    if (parts[0] === "clientes" && (before.lat !== updated.lat || before.lng !== updated.lng)) requirePermission(actor, 145);
  };
}

export function filterOperationalSnapshot<T extends ReturnType<typeof import("./domain.js").snapshot>>(data: T, actor: User): T {
  if (actor.access?.mode !== "custom") return data;
  const result = structuredClone(data);
  const clientWork = [140, 300, 350, 360, 320, 370].some((id) => hasPermission(actor, id));
  if (!hasPermission(actor, 140)) result.clients = clientWork ? result.clients.map(({ id, code, name, routeId, preferredCurrency, active }) => ({ id, code, name, routeId, preferredCurrency, active, phone: "", address: "" })) : [];
  if (!hasPermission(actor, 130) && !clientWork) result.routes = [];
  if (!hasPermission(actor, 120) && !clientWork) result.zones = [];
  if (!hasPermission(actor, 150)) result.collectors = [];
  if (!hasPermission(actor, 101)) result.accounts = result.accounts.filter(({ id }) => id === actor.id);
  if (!hasPermission(actor, 300)) result.charges = [];
  if (!hasPermission(actor, 350)) result.recurringCharges = [];
  if (!hasPermission(actor, 360) && !hasPermission(actor, 370)) result.payouts = [];
  if (!hasPermission(actor, 390)) result.payoutRecurring = [];
  result.movements = result.movements.filter((row) => hasPermission(actor, ({ collection: 320, payout: 370, deposit: 330, office_delivery: 380 } as const)[row.type]));
  if (!hasPermission(actor, 401)) { result.settlements = []; result.cashReconciliations = []; }
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
  result.history = [];
  return result;
}
