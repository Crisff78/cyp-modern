import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { phoneOrEmpty } from "./contact-schemas.js";
import { assertAdmin, assertAdminRead, businessDate, DomainError, type State, type User } from "./domain.js";
import type { Store } from "./store.js";
import {
  createAuthorizationRequest, endOwnAuthSession, getAdminTools, requireAdminRow, resolveAuthorizationRequest,
  revokeAuthSession, sessionStatus, uniqueAdminValue,
} from "./admin-tools.js";
import { applyRraaValidation, resolveRraaStation, stationRraaValidated, type RraaValidator } from "./rraa.js";
import { freeText, phone, singleLine } from "./input-validation.js";

type Mutate = <T, P = Record<string, string>>(path: string, summary: string, schema: z.ZodType<T>, fn: (state: State, actor: User, body: T, params: P) => unknown) => void;
type Describe = (method: string, path: string, summary: string, schema?: z.ZodType, isPublic?: boolean, requiresIdempotency?: boolean) => void;
// Keep the existing normalization of body references in administrative tools.
const id = singleLine(80, 1);
const name = singleLine(160, 1);
const short = singleLine(160).default("");
const stationBody = z.object({ name, number: singleLine(80, 1).optional(), deviceId: short, description: freeText(1000).default(""),
  group: short, type: short, active: z.boolean().default(false) }).strict();
const stationValidationBody = z.object({ stationCode: name, deviceId: name }).strict();
const stationLookupBody = z.object({ stationCode: name }).strict();
const pcpBody = z.object({ name, number: singleLine(80, 1), groupId: id, address: singleLine(500).default(""), phone: phone.pipe(phoneOrEmpty).default(""), active: z.boolean().default(true) }).strict();
const groupBody = z.object({ name }).strict();
const requestBody = z.object({ clientId: id, collectorId: id, delayReasonId: id.optional(), forCollection: z.boolean(), note: freeText(2000, 1) }).strict();
const resolutionBody = z.object({ status: z.enum(["approved", "rejected", "cancelled"]), note: freeText(2000, 1) }).strict();
const filters = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), q: singleLine(160).default(""),
  status: singleLine(20).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) }).strict()
  .refine((input) => !input.from || !input.to || input.from <= input.to, { message: "La fecha final debe ser igual o posterior a la inicial." });
function inDateRange(value: string, from?: string, to?: string) {
  const day = businessDate(new Date(value));
  return (!from || day >= from) && (!to || day <= to);
}
function contains(value: string, query: string) { return value.toLocaleLowerCase().includes(query.toLocaleLowerCase()); }
// Built-in accounts that are not stored in the accounts catalog.
const SYSTEM_ACCOUNT_NAMES: Record<string, string> = { "demo-admin": "Administración", "configured-admin": "Administración", "demo-collector": "Cobrador" };

export function registerAdminToolsRoutes(app: FastifyInstance, store: Store, user: (req: FastifyRequest) => User, mutate: Mutate, describe: Describe, rraa?: RraaValidator) {
  const validator = () => {
    if (!rraa) throw new DomainError("STATION_RRAA_REQUIRED", "Deshabilitado temporalmente hasta conexión RRAA. No se permite crear, editar ni activar estaciones manualmente.", 409);
    return rraa;
  };
  const stationView = (station: ReturnType<typeof getAdminTools>["stations"][number]) =>
    ({ ...station, rraaValidated: stationRraaValidated(station, rraa?.clientId) });
  app.get("/api/estaciones", async (req) => { assertAdminRead(user(req)); return getAdminTools(await store.read()).stations.map(stationView); });
  app.get("/api/estaciones/rraa", async (req) => {
    assertAdminRead(user(req));
    const capabilities = rraa?.lookup ? { canObtainData: true } : {};
    if (!rraa?.simulated) return { configured: Boolean(rraa), clientId: rraa?.clientId, ...capabilities };
    // Practice control: names and devices are unique in the catalogue and the demo is shared, so offer pairs that are still free.
    const rows = getAdminTools(await store.read()).stations, lower = (text: unknown) => String(text ?? "").toLocaleLowerCase();
    const names = new Set(rows.map((row) => lower(row.name))), devices = new Set(rows.map((row) => lower(row.deviceId)));
    const all = rraa.examples ?? [];
    const examples = all.filter((item) => !names.has(lower(item.stationCode)) && !devices.has(lower(item.deviceId))).slice(0, 3);
    return { configured: true, clientId: rraa.clientId, ...capabilities, simulated: true, examples,
      ...(all.length ? { exampleRange: [all[0].stationCode, all[all.length - 1].stationCode] } : {}) };
  });
  app.post("/api/estaciones/validar", async (req) => {
    assertAdmin(user(req)); const body = stationValidationBody.parse(req.body);
    return resolveRraaStation(validator(), body.stationCode, body.deviceId);
  });
  app.post("/api/estaciones/obtener-datos", async (req) => {
    assertAdmin(user(req)); const body = stationLookupBody.parse(req.body), service = validator();
    if (!service.lookup) throw new DomainError("RRAA_LOOKUP_UNAVAILABLE", "La consulta de datos de estaciones no está configurada en RRAA.", 409);
    return resolveRraaStation(service, body.stationCode);
  });
  describe("get", "/api/estaciones/rraa", "Disponibilidad de validación RRAA para esta instalación");
  describe("post", "/api/estaciones/validar", "Consultar VALSTAT sin guardar ni activar la estación", stationValidationBody, false, false);
  describe("post", "/api/estaciones/obtener-datos", "Obtener ID, licencia y SO por empresa y estación desde STATDAT y comprobar VALSTAT, sin guardar ni activar", stationLookupBody, false, false);
  mutate("/api/estaciones/:id/actividad", "Activar con RRAA o desactivar estación", z.object({ active: z.boolean() }).strict(), async (state, actor, body, params) => {
    assertAdmin(actor); const station = requireAdminRow(getAdminTools(state).stations, params.id, "Estación");
    if (body.active) {
      const service = validator();
      // Practice control only: a station without device can never be found, so say what is missing. The provider keeps its own answer.
      if (service.simulated && !service.lookup && !String(station.deviceId ?? "").trim()) throw new DomainError("RRAA_INPUT_INVALID", "Esta estación no tiene ID dispositivo. Obtén los datos de una Estación registrada en el control de prueba antes de activarla.", 422);
      const validation = await resolveRraaStation(service, station.name, station.deviceId);
      uniqueAdminValue(getAdminTools(state).stations, "deviceId", validation.deviceId, station.id);
      applyRraaValidation(station, validation, actor.id);
    }
    station.active = body.active; return stationView(station);
  });
  app.get("/api/grupos-pcp", async (req) => { assertAdminRead(user(req)); return getAdminTools(await store.read()).pcpGroups; });
  app.get("/api/pcps", async (req) => {
    assertAdminRead(user(req)); const data = getAdminTools(await store.read());
    return data.pcps.map((row) => ({ ...row, stationIds: data.pcpStations.filter((link) => link.pcpId === row.id).map((link) => link.stationId) }));
  });
  describe("get", "/api/estaciones", "Estaciones registradas");
  describe("get", "/api/grupos-pcp", "Grupos de puntos de cobros y pagos");
  describe("get", "/api/pcps", "Puntos de cobros y pagos y sus estaciones");
  for (const editing of [false, true]) {
    const suffix = editing ? "/:id" : "";
    mutate(`/api/estaciones${suffix}`, "Guardar estación validada por RRAA", stationBody, async (state, actor, body, params) => {
      assertAdmin(actor); const service = validator(), data = getAdminTools(state);
      const current = editing ? requireAdminRow(data.stations, params.id, "Estación") : undefined;
      uniqueAdminValue(data.stations, "name", body.name, current?.id);
      // The operator only needs the provider's station code. Allocate the local
      // sequence inside the transaction so simultaneous creates cannot collide.
      const maximum = data.stations.reduce((max, row) => /^\d+$/.test(row.number) && BigInt(row.number) > max ? BigInt(row.number) : max, 0n);
      const number = body.number ?? current?.number ?? String(maximum + 1n);
      if (number.length > 80) throw new DomainError("STATION_NUMBER_INVALID", "No se pudo asignar el próximo número de estación.", 422);
      uniqueAdminValue(data.stations, "number", number, current?.id);
      if (body.deviceId) uniqueAdminValue(data.stations, "deviceId", body.deviceId, current?.id);
      const validation = await resolveRraaStation(service, body.name, body.deviceId);
      uniqueAdminValue(data.stations, "deviceId", validation.deviceId, current?.id);
      const station = current ?? { id: randomUUID(), ...body, number, license: "", version: "" };
      Object.assign(station, body, { number }); applyRraaValidation(station, validation, actor.id);
      if (!current) data.stations.push(station);
      return stationView(station);
    });
    mutate(`/api/grupos-pcp${suffix}`, "Guardar grupo de PCPs", groupBody, (state, actor, body, params) => {
      assertAdmin(actor); const data = getAdminTools(state);
      const current = editing ? requireAdminRow(data.pcpGroups, params.id, "Grupo") : undefined;
      uniqueAdminValue(data.pcpGroups, "name", body.name, current?.id);
      if (current) { current.name = body.name; return current; }
      const row = { id: randomUUID(), name: body.name }; data.pcpGroups.push(row); return row;
    });
    mutate(`/api/pcps${suffix}`, "Guardar punto de cobros y pagos", pcpBody, (state, actor, body, params) => {
      assertAdmin(actor); const data = getAdminTools(state);
      const current = editing ? requireAdminRow(data.pcps, params.id, "PCP") : undefined;
      requireAdminRow(data.pcpGroups, body.groupId, "Grupo");
      uniqueAdminValue(data.pcps, "number", body.number, current?.id);
      if (current) { Object.assign(current, body); return current; }
      const row = { id: randomUUID(), ...body }; data.pcps.push(row); return row;
    });
  }
  mutate("/api/grupos-pcp/:id/eliminar", "Eliminar grupo sin PCPs asociados", z.object({}).strict(), (state, actor, _body, params) => {
    assertAdmin(actor); const data = getAdminTools(state); const row = requireAdminRow(data.pcpGroups, params.id, "Grupo");
    if (data.pcps.some((pcp) => pcp.groupId === row.id)) throw new DomainError("GROUP_IN_USE", "El grupo tiene PCPs asociados. Reasígnalos antes de eliminarlo.", 409);
    data.pcpGroups = data.pcpGroups.filter((item) => item.id !== row.id); return { id: row.id, deleted: true };
  });
  mutate("/api/pcps/:id/estaciones", "Guardar estaciones asociadas al PCP con validación RRAA vigente", z.object({ stationIds: z.array(id).max(500) }).strict(), async (state, actor, body, params) => {
    assertAdmin(actor); const data = getAdminTools(state); const pcp = requireAdminRow(data.pcps, params.id, "PCP");
    if (!pcp.active) throw new DomainError("PCP_INACTIVE", "Activa el PCP antes de modificar sus estaciones.", 409);
    if (new Set(body.stationIds).size !== body.stationIds.length) throw new DomainError("DUPLICATE_STATION", "La lista contiene estaciones repetidas.");
    for (const stationId of body.stationIds) {
      const station = requireAdminRow(data.stations, stationId, "Estación");
      const existing = data.pcpStations.some((link) => link.pcpId === pcp.id && link.stationId === stationId);
      if (!existing && !stationRraaValidated(station, rraa?.clientId))
        throw new DomainError("STATION_RRAA_REQUIRED", rraa?.simulated ? "Solo puedes agregar estaciones validadas por el control de prueba de la demo." : "Solo puedes agregar estaciones validadas por RRAA para esta instalación.", 409);
      if (!existing && !station.active) throw new DomainError("STATION_INACTIVE", "Solo puedes agregar estaciones activas.", 409);
      if (!existing) {
        const validation = await resolveRraaStation(validator(), station.name, station.deviceId);
        uniqueAdminValue(data.stations, "deviceId", validation.deviceId, station.id);
        applyRraaValidation(station, validation, actor.id);
      }
    }
    data.pcpStations = [...data.pcpStations.filter((link) => link.pcpId !== pcp.id), ...body.stationIds.map((stationId) => ({ pcpId: pcp.id, stationId }))];
    return { id: pcp.id, stationIds: body.stationIds };
  });
  app.get("/api/sesiones", async (req) => {
    const actor = user(req) as User & { sid?: string }; assertAdminRead(actor); const input = filters.parse(req.query);
    const items = getAdminTools(await store.read()).sessions.map((row) => ({ ...row, status: sessionStatus(row), current: row.id === actor.sid }))
      .filter((row) => inDateRange(row.startedAt, input.from, input.to) && (!input.status || row.status === input.status) && contains(`${row.userName} ${row.userId}`, input.q))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
    return { items: items.slice(input.offset, input.offset + input.limit), total: items.length, limit: input.limit, offset: input.offset };
  });
  describe("get", "/api/sesiones", "Sesiones reales de acceso, filtradas por usuario, fecha y estado");
  mutate("/api/sesiones/:id/cerrar", "Revocar una sesión activa", z.object({}).strict(), (state, actor, _body, params) => revokeAuthSession(state, actor, params.id));
  mutate("/api/auth/logout", "Cerrar la sesión propia", z.object({}).strict(), (state, actor) => endOwnAuthSession(state, actor));
  app.get("/api/trazas", async (req) => {
    assertAdminRead(user(req)); const input = filters.parse(req.query);
    const items = getAdminTools(await store.read()).traces
      .filter((row) => inDateRange(row.createdAt, input.from, input.to) && contains(`${row.action} ${row.resource} ${row.actorId} ${row.resourceId ?? ""}`, input.q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return { items: items.slice(input.offset, input.offset + input.limit), total: items.length, limit: input.limit, offset: input.offset };
  });
  describe("get", "/api/trazas", "Auditoría de acciones registradas, sin cuerpos ni credenciales");
  app.get("/api/solicitudes-autorizacion", async (req) => {
    assertAdminRead(user(req)); const input = filters.parse(req.query); const state = await store.read();
    const items = getAdminTools(state).authorizationRequests.filter((row) => {
      const client = state.clients.find((item) => item.id === row.clientId);
      return inDateRange(row.createdAt, input.from, input.to) && (!input.status || row.status === input.status) && contains(`${client?.name ?? ""} ${client?.code ?? ""}`, input.q);
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    // The author is stored by account id; the screen needs the person's name.
    const reader = user(req);
    const personName = (accountId?: string) => !accountId ? undefined
      : state.accounts.find((account) => account.id === accountId)?.name
        ?? (accountId === reader.id ? reader.name : Object.hasOwn(SYSTEM_ACCOUNT_NAMES, accountId) ? SYSTEM_ACCOUNT_NAMES[accountId] : undefined);
    return { items: items.slice(input.offset, input.offset + input.limit).map((row) => ({ ...row,
      createdByName: personName(row.createdBy), resolvedByName: personName(row.resolvedBy) })), total: items.length, limit: input.limit, offset: input.offset };
  });
  describe("get", "/api/solicitudes-autorizacion", "Solicitudes administrativas y decisiones registradas");
  mutate("/api/solicitudes-autorizacion", "Registrar solicitud administrativa pendiente", requestBody, (state, actor, body) => createAuthorizationRequest(state, actor, body));
  mutate("/api/solicitudes-autorizacion/:id/resolver", "Registrar decisión de solicitud administrativa", resolutionBody, (state, actor, body, params) => resolveAuthorizationRequest(state, actor, params.id, body.status, body.note));
}
