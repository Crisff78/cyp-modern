import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assertAdmin, DomainError, ledgerCurrency, MAX_MONEY_AMOUNT, supportedLedgerCurrency, type State, type User, type Zone } from "./domain.js";
import type { Store } from "./store.js";
import { frequencyCodes } from "./catalog-store.js";

type Mutate = <T, P = Record<string, string>>(
  path: string, summary: string, schema: z.ZodType<T>,
  fn: (state: State, user: User, body: T, params: P) => unknown,
) => void;
type Describe = (method: string, path: string, summary: string, schema?: z.ZodType, isPublic?: boolean) => void;
const id = z.string().min(1).max(80);
const name = z.string().trim().min(1).max(160);
const short = z.string().trim().max(160);
const amount = z.number().int().positive().max(1_000_000_000);
const zoneBody = z.object({ name, sector: short.optional(), number: short.optional(), from: short.optional(), to: short.optional(), active: z.boolean().optional() }).strict();
const routeBody = z.object({ name, sector: short, collectorId: id, zoneId: id.optional(), number: short.optional(), from: short.optional(), to: short.optional(), active: z.boolean().optional() }).strict();
const collectorBody = z.object({
  name, ident: short.optional(), cellular: z.string().trim().max(40).optional(), accountId: short.optional(),
  routeId: id.optional(), collectionLimit: amount.optional(), payoutLimit: amount.optional(), active: z.boolean().optional(),
}).strict();
const collectorLimitsBody = z.object({ collectionLimit: amount, payoutLimit: amount }).strict();
const serviceBody = z.object({
  service: name, abbr: short.default(""), caption: short.default(""), obligated: z.boolean(), active: z.boolean(), fixedAmount: z.boolean().optional(),
  referencePriceCents: z.number().int().min(0).max(MAX_MONEY_AMOUNT).nullable().optional(),
  referenceCurrency: z.enum(["DOP", "USD", "EUR"]).nullable().optional(),
  taxReference: z.string().trim().min(1).max(160).nullable().optional(),
  benefitReference: z.string().trim().min(1).max(160).nullable().optional(),
  referenceQuantity: z.string().trim().min(1).max(64).nullable().optional(),
}).strict();
const reasonBody = z.object({ reason: name, active: z.boolean() }).strict();
const recurringBody = z.object({
  clientId: id, routeId: id.optional(), serviceId: id.optional(), startDate: z.iso.date(),
  endDate: z.union([z.iso.date(), z.literal("")]).default(""), frequency: name,
  day1: z.union([z.string().max(40), z.number().int().min(0).max(31)]).default(""),
  day2: z.union([z.string().max(40), z.number().int().min(0).max(31)]).default(""),
  currency: z.string().trim().min(1).max(40).refine((value) => supportedLedgerCurrency(value) !== undefined, "Selecciona DOP, USD o EUR.").transform(ledgerCurrency).default("DOP"), service: name, concept: short.default(""),
  useConceptAmount: z.boolean().default(false), amount, note: z.string().trim().max(2000).default(""), active: z.boolean(),
}).strict();
function requireRow<T extends { id: string }>(rows: T[], rowId: string, label: string): T {
  const row = rows.find((item) => item.id === rowId);
  if (!row) throw new DomainError("NOT_FOUND", `${label} no encontrado.`, 404);
  return row;
}
function uniqueName(rows: { id: string; name: string }[], value: string, rowId?: string) {
  if (rows.some((row) => row.id !== rowId && row.name.toLocaleLowerCase() === value.toLocaleLowerCase()))
    throw new DomainError("DUPLICATE_NAME", "Ya existe un registro con ese nombre.", 409);
}
function resolveZone(state: State, sector: string, zoneId?: string): Zone {
  if (zoneId) return requireRow(state.zones, zoneId, "Zona");
  const label = sector || "Sin asignar";
  const found = state.zones.find((zone) => zone.name === label || zone.sector === label);
  if (found) return found;
  const zone = { id: randomUUID(), name: label, sector: label, active: true };
  state.zones.push(zone);
  return zone;
}
export function registerCatalogRoutes(app: FastifyInstance, store: Store, user: (req: FastifyRequest) => User, mutate: Mutate, describe: Describe) {
  for (const [path, key] of [
    ["/api/cobradores", "collectors"], ["/api/zonas", "zones"], ["/api/servicios", "services"],
    ["/api/motivos-atraso", "delayReasons"], ["/api/cargos-recurrentes", "recurringCharges"],
  ] as const) {
    app.get(path, async (req) => { assertAdmin(user(req)); return (await store.read())[key]; });
    describe("get", path, `Consultar ${key}`);
  }
  for (const editing of [false, true]) {
    const suffix = editing ? "/:id" : "";
    mutate(`/api/zonas${suffix}`, "Guardar zona", zoneBody, (state, actor, input, params) => {
      assertAdmin(actor);
      const current = editing ? requireRow(state.zones, params.id, "Zona") : undefined;
      uniqueName(state.zones, input.name, current?.id);
      const values = { ...input, sector: input.sector ?? current?.sector ?? input.name };
      if (current) {
        Object.assign(current, values);
        for (const route of state.routes) if (route.zoneId === current.id) route.sector = current.sector;
        return current;
      }
      const zone = { id: randomUUID(), ...values, active: input.active ?? true };
      state.zones.push(zone); return zone;
    });
    mutate(`/api/rutas${suffix}`, "Guardar ruta y cobrador responsable", routeBody, (state, actor, input, params) => {
      assertAdmin(actor);
      const owner = requireRow(state.collectors, input.collectorId, "Cobrador");
      if (owner.active === false) throw new DomainError("COLLECTOR_INACTIVE", "Selecciona un cobrador activo.", 409);
      const current = editing ? requireRow(state.routes, params.id, "Ruta") : undefined;
      if (current && current.collectorId !== owner.id) {
        const previousOwner = requireRow(state.collectors, current.collectorId, "Cobrador anterior");
        if (previousOwner.routeId === current.id) {
          const replacement = state.routes.find((route) => route.id !== current.id && route.collectorId === previousOwner.id && route.active !== false);
          if (!replacement) throw new DomainError("PRIMARY_ROUTE", "El cobrador anterior necesita otra ruta activa antes de reasignar esta.", 409);
          previousOwner.routeId = replacement.id;
        }
      }
      const zone = resolveZone(state, input.sector, input.zoneId ?? (current?.sector === input.sector ? current.zoneId : undefined));
      if (zone.active === false && (!current || current.zoneId !== zone.id)) throw new DomainError("ZONE_INACTIVE", "Selecciona una zona activa.", 409);
      const values = { ...input, zoneId: zone.id, sector: zone.sector };
      if (current) { Object.assign(current, values); return current; }
      const route = { id: randomUUID(), ...values, active: input.active ?? true };
      state.routes.push(route); return route;
    });
    mutate(`/api/cobradores${suffix}`, "Guardar cobrador", collectorBody, (state, actor, input, params) => {
      assertAdmin(actor);
      if (editing) {
        const current = requireRow(state.collectors, params.id, "Cobrador");
        if (input.routeId) {
          const route = requireRow(state.routes, input.routeId, "Ruta");
          if (route.collectorId !== current.id) throw new DomainError("ROUTE_OWNER", "La ruta principal debe pertenecer a este cobrador.", 409);
        }
        Object.assign(current, input, { initials: input.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() });
        return current;
      }
      if (input.routeId) throw new DomainError("ROUTE_OWNER", "Crea el cobrador sin ruta y luego asigna sus rutas.", 409);
      const collectorId = randomUUID(), routeId = randomUUID(), zone = resolveZone(state, "Sin asignar");
      state.routes.push({ id: routeId, name: `Ruta ${input.name}`, sector: zone.sector, zoneId: zone.id, collectorId, active: true });
      const collector = {
        ...input, id: collectorId, routeId, active: input.active ?? true, status: "offline" as const,
        initials: input.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
        collectionLimit: input.collectionLimit ?? 1_000_000, payoutLimit: input.payoutLimit ?? 1_000_000,
        lat: null, lng: null, lastSeen: new Date().toISOString(),
      };
      state.collectors.push(collector); return collector;
    });
    mutate(`/api/servicios${suffix}`, "Guardar servicio", serviceBody, (state, actor, input, params) => {
      assertAdmin(actor);
      const current = editing ? requireRow(state.services, params.id, "Servicio") : undefined;
      uniqueName(state.services.map((row) => ({ id: row.id, name: row.service })), input.service, current?.id);
      const referencePrice = input.referencePriceCents === undefined ? current?.referencePriceCents : input.referencePriceCents;
      const referenceCurrency = input.referenceCurrency === undefined ? current?.referenceCurrency : input.referenceCurrency;
      if ((referencePrice != null) !== (referenceCurrency != null))
        throw new DomainError("SERVICE_REFERENCE_PAIR", "El precio de referencia requiere su moneda; borra ambos para dejarlo vacío.", 422);
      if (current) {
        const previousName = current.service;
        Object.assign(current, input);
        for (const item of previousName === current.service ? [] : [...state.charges, ...state.recurringCharges]) {
          if (item.serviceId === current.id || (!item.serviceId && item.service === previousName)) {
            item.serviceId = current.id; item.service = current.service;
          }
        }
        return current;
      }
      const service = { id: randomUUID(), ...input, fixedAmount: input.fixedAmount ?? false };
      state.services.push(service); return service;
    });
    mutate(`/api/motivos-atraso${suffix}`, "Guardar motivo de atraso", reasonBody, (state, actor, input, params) => {
      assertAdmin(actor);
      const current = editing ? requireRow(state.delayReasons, params.id, "Motivo") : undefined;
      uniqueName(state.delayReasons.map((row) => ({ id: row.id, name: row.reason })), input.reason, current?.id);
      if (current) { Object.assign(current, input); return current; }
      const reason = { id: randomUUID(), ...input }; state.delayReasons.push(reason); return reason;
    });
    mutate(`/api/cargos-recurrentes${suffix}`, "Guardar plantilla de cargo recurrente", recurringBody, (state, actor, input, params) => {
      assertAdmin(actor);
      const current = editing ? requireRow(state.recurringCharges, params.id, "Cargo recurrente") : undefined;
      const client = requireRow(state.clients, input.clientId, "Cliente");
      if (client.active === false && (!current || current.clientId !== client.id)) throw new DomainError("CLIENT_INACTIVE", "Selecciona un cliente activo.", 409);
      const service = input.serviceId ? requireRow(state.services, input.serviceId, "Servicio") : state.services.find((item) => item.service === input.service);
      if (!service || service.service !== input.service) throw new DomainError("SERVICE_REQUIRED", "Selecciona un servicio del catálogo.", 422);
      if (!service.active && (!current || current.serviceId !== service.id)) throw new DomainError("SERVICE_INACTIVE", "Selecciona un servicio activo.", 409);
      if (!Object.hasOwn(frequencyCodes, input.frequency)) throw new DomainError("FREQUENCY_INVALID", "Selecciona una frecuencia válida.", 422);
      if (input.endDate && input.endDate < input.startDate) throw new DomainError("DATE_RANGE", "La fecha final debe ser igual o posterior a la inicial.", 422);
      const values = { ...input, serviceId: service.id, routeId: client.routeId, day1: String(input.day1), day2: String(input.day2) };
      if (current) { Object.assign(current, values); return current; }
      const recurring = { id: randomUUID(), registeredAt: new Date().toISOString(), ...values };
      state.recurringCharges.push(recurring); return recurring;
    });
  }
  mutate("/api/cobradores/:id/actividad", "Activar o inactivar cobrador", z.object({ active: z.boolean() }).strict(), (state, actor, input, params) => {
    assertAdmin(actor); const collector = requireRow(state.collectors, params.id, "Cobrador");
    collector.active = input.active; return collector;
  });
  mutate("/api/cobradores/:id/limites", "Modificar solo los límites del cobrador", collectorLimitsBody, (state, actor, input, params) => {
    assertAdmin(actor);
    const collector = requireRow(state.collectors, params.id, "Cobrador");
    collector.collectionLimit = input.collectionLimit;
    collector.payoutLimit = input.payoutLimit;
    return collector;
  });
}
