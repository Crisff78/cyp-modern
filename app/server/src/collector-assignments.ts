import { createHash } from "node:crypto";
import { collectorLimit, DomainError, type State, type User } from "./domain.js";
import { recordAdminTrace } from "./admin-tools.js";

export type AssignmentKind = "zonas" | "rutas" | "limites";
const currencyNames = { DOP: "Peso Dominicano", USD: "Dólar Americano", EUR: "Euro" } as const;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function collectorAssignments(state: State, id: string, kind: AssignmentKind) {
  const collector = state.collectors.find((row) => row.id === id);
  if (!collector) throw new DomainError("NOT_FOUND", "Cobrador no encontrado.", 404);
  const routes = state.routes.filter((row) => row.collectorId === id);
  const areas = kind === "rutas" ? routes : state.zones.filter((zone) => routes.some((route) => route.zoneId === zone.id || !route.zoneId && route.sector === zone.sector));
  const rows = kind === "limites" ? (Object.keys(currencyNames) as Array<keyof typeof currencyNames>)
    .filter((currency) => !collector.currencyLimits || collector.currencyLimits[currency])
    .map((currency) => ({ id: currency, number: currency, name: currencyNames[currency], from: "", to: "", ...collectorLimit(collector, currency) }))
    : areas.map((row) => ({ id: row.id, number: row.number ?? row.id, name: row.name, from: row.from ?? "", to: row.to ?? "" }));
  // Include the whole routing map, so concurrent reassignment cannot be overwritten.
  const revision = hash([kind, collector, state.routes, state.zones]);
  return { rows, revision };
}
export function saveCollectorAssignments(state: State, actor: User, id: string, kind: AssignmentKind,
  input: { revision: string; rows: { id: string; collectionLimit?: number; payoutLimit?: number }[]; confirmReassignment?: boolean }) {
  const previous = collectorAssignments(state, id, kind);
  if (previous.revision !== input.revision) throw new DomainError("ASSIGNMENTS_CHANGED", "Las asignaciones cambiaron. Refresca y revisa antes de guardar.", 409);
  const collector = state.collectors.find((row) => row.id === id)!;
  if (kind === "limites") {
    const limits: NonNullable<typeof collector.currencyLimits> = {};
    for (const row of input.rows) {
      if (!Object.hasOwn(currencyNames, row.id) || row.collectionLimit === undefined || row.payoutLimit === undefined)
        throw new DomainError("LIMIT_INVALID", "Selecciona una moneda y sus dos límites.", 422);
      limits[row.id as keyof typeof limits] = { collectionLimit: row.collectionLimit, payoutLimit: row.payoutLimit };
    }
    collector.currencyLimits = limits;
    collector.collectionLimit = limits.DOP?.collectionLimit ?? 0;
    collector.payoutLimit = limits.DOP?.payoutLimit ?? 0;
  } else {
    const selectedIds = new Set(input.rows.map((row) => row.id));
    const catalog = kind === "rutas" ? state.routes : state.zones;
    for (const selected of selectedIds) {
      const row = catalog.find((item) => item.id === selected);
      if (!row || row.active === false) throw new DomainError("ASSIGNMENT_INVALID", "Selecciona rutas y zonas activas del catálogo.", 422);
      if (kind === "zonas" && !state.routes.some((route) => route.active !== false && (route.zoneId === row.id || !route.zoneId && route.sector === row.sector)))
        throw new DomainError("ZONE_NO_ROUTES", `La zona ${row.name} no tiene rutas activas. Crea su ruta antes de asignarla.`, 422);
    }
    const chosen = state.routes.filter((route) => route.active !== false && (kind === "rutas" ? selectedIds.has(route.id) : selectedIds.has(route.zoneId ?? state.zones.find((zone) => zone.sector === route.sector)?.id ?? "")));
    if (chosen.some((route) => route.collectorId && route.collectorId !== id) && !input.confirmReassignment)
      throw new DomainError("REASSIGNMENT_CONFIRMATION_REQUIRED", "Hay rutas de otro cobrador. Confirma expresamente su reasignación.", 409);
    if (collector.active === false && chosen.length) throw new DomainError("COLLECTOR_INACTIVE", "Activa el cobrador antes de asignarle rutas.", 409);
    const selectedRoutes = new Set(chosen.map((route) => route.id));
    for (const route of state.routes) {
      if (selectedRoutes.has(route.id)) route.collectorId = id;
      else if (route.collectorId === id) route.collectorId = "";
    }
    for (const owner of state.collectors) {
      if (!state.routes.some((route) => route.id === owner.routeId && route.collectorId === owner.id))
        owner.routeId = state.routes.find((route) => route.collectorId === owner.id && route.active !== false)?.id ?? "";
    }
  }
  const result = collectorAssignments(state, id, kind);
  const trace = recordAdminTrace(state, actor, "collector.assignments.changed", `cobradores/${kind}`, id);
  trace.details = { version: 1, previous: previous.rows, current: result.rows, revision: result.revision, confirmedReassignment: input.confirmReassignment === true };
  return result;
}
