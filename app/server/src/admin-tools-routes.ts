import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assertAdmin, businessDate, DomainError, type State, type User } from "./domain.js";
import type { Store } from "./store.js";
import {
  createAuthorizationRequest, endOwnAuthSession, getAdminTools, requireAdminRow, resolveAuthorizationRequest,
  revokeAuthSession, sessionStatus, uniqueAdminValue,
} from "./admin-tools.js";
import { freeText, phone, singleLine } from "./input-validation.js";

type Mutate = <T, P = Record<string, string>>(path: string, summary: string, schema: z.ZodType<T>, fn: (state: State, actor: User, body: T, params: P) => unknown) => void;
type Describe = (method: string, path: string, summary: string, schema?: z.ZodType, isPublic?: boolean) => void;
// Keep the existing normalization of body references in administrative tools.
const id = singleLine(80, 1);
const name = singleLine(160, 1);
const short = singleLine(160).default("");
const stationBody = z.object({ name, number: singleLine(80, 1), deviceId: short, description: freeText(1000).default(""),
  group: short, type: short, license: short, version: short, active: z.boolean().default(true) }).strict();
const pcpBody = z.object({ name, number: singleLine(80, 1), groupId: id, address: singleLine(500).default(""), phone: phone.default(""), active: z.boolean().default(true) }).strict();
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

export function registerAdminToolsRoutes(app: FastifyInstance, store: Store, user: (req: FastifyRequest) => User, mutate: Mutate, describe: Describe) {
  app.get("/api/estaciones", async (req) => { assertAdmin(user(req)); return getAdminTools(await store.read()).stations; });
  app.get("/api/grupos-pcp", async (req) => { assertAdmin(user(req)); return getAdminTools(await store.read()).pcpGroups; });
  app.get("/api/pcps", async (req) => {
    assertAdmin(user(req)); const data = getAdminTools(await store.read());
    return data.pcps.map((row) => ({ ...row, stationIds: data.pcpStations.filter((link) => link.pcpId === row.id).map((link) => link.stationId) }));
  });
  describe("get", "/api/estaciones", "Estaciones registradas");
  describe("get", "/api/grupos-pcp", "Grupos de puntos de cobros y pagos");
  describe("get", "/api/pcps", "Puntos de cobros y pagos y sus estaciones");
  for (const editing of [false, true]) {
    const suffix = editing ? "/:id" : "";
    mutate(`/api/estaciones${suffix}`, "Guardar estación registrada", stationBody, (state, actor, body, params) => {
      assertAdmin(actor); const data = getAdminTools(state);
      const current = editing ? requireAdminRow(data.stations, params.id, "Estación") : undefined;
      for (const key of ["name", "number", "deviceId"] as const) uniqueAdminValue(data.stations, key, body[key], current?.id);
      if (current) { Object.assign(current, body); return current; }
      const row = { id: randomUUID(), ...body }; data.stations.push(row); return row;
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
  mutate("/api/pcps/:id/estaciones", "Guardar estaciones asociadas al PCP", z.object({ stationIds: z.array(id).max(500) }).strict(), (state, actor, body, params) => {
    assertAdmin(actor); const data = getAdminTools(state); const pcp = requireAdminRow(data.pcps, params.id, "PCP");
    if (!pcp.active) throw new DomainError("PCP_INACTIVE", "Activa el PCP antes de modificar sus estaciones.", 409);
    if (new Set(body.stationIds).size !== body.stationIds.length) throw new DomainError("DUPLICATE_STATION", "La lista contiene estaciones repetidas.");
    for (const stationId of body.stationIds) {
      const station = requireAdminRow(data.stations, stationId, "Estación");
      if (!station.active && !data.pcpStations.some((link) => link.pcpId === pcp.id && link.stationId === stationId))
        throw new DomainError("STATION_INACTIVE", "Solo puedes agregar estaciones activas.", 409);
    }
    data.pcpStations = [...data.pcpStations.filter((link) => link.pcpId !== pcp.id), ...body.stationIds.map((stationId) => ({ pcpId: pcp.id, stationId }))];
    return { id: pcp.id, stationIds: body.stationIds };
  });
  app.get("/api/sesiones", async (req) => {
    const actor = user(req) as User & { sid?: string }; assertAdmin(actor); const input = filters.parse(req.query);
    const items = getAdminTools(await store.read()).sessions.map((row) => ({ ...row, status: sessionStatus(row), current: row.id === actor.sid }))
      .filter((row) => inDateRange(row.startedAt, input.from, input.to) && (!input.status || row.status === input.status) && contains(`${row.userName} ${row.userId}`, input.q))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
    return { items: items.slice(input.offset, input.offset + input.limit), total: items.length, limit: input.limit, offset: input.offset };
  });
  describe("get", "/api/sesiones", "Sesiones reales de acceso, filtradas por usuario, fecha y estado");
  mutate("/api/sesiones/:id/cerrar", "Revocar una sesión activa", z.object({}).strict(), (state, actor, _body, params) => revokeAuthSession(state, actor, params.id));
  mutate("/api/auth/logout", "Cerrar la sesión propia", z.object({}).strict(), (state, actor) => endOwnAuthSession(state, actor));
  app.get("/api/trazas", async (req) => {
    assertAdmin(user(req)); const input = filters.parse(req.query);
    const items = getAdminTools(await store.read()).traces
      .filter((row) => inDateRange(row.createdAt, input.from, input.to) && contains(`${row.action} ${row.resource} ${row.actorId} ${row.resourceId ?? ""}`, input.q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return { items: items.slice(input.offset, input.offset + input.limit), total: items.length, limit: input.limit, offset: input.offset };
  });
  describe("get", "/api/trazas", "Auditoría de acciones registradas, sin cuerpos ni credenciales");
  app.get("/api/solicitudes-autorizacion", async (req) => {
    assertAdmin(user(req)); const input = filters.parse(req.query); const state = await store.read();
    const items = getAdminTools(state).authorizationRequests.filter((row) => {
      const client = state.clients.find((item) => item.id === row.clientId);
      return inDateRange(row.createdAt, input.from, input.to) && (!input.status || row.status === input.status) && contains(`${client?.name ?? ""} ${client?.code ?? ""}`, input.q);
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return { items: items.slice(input.offset, input.offset + input.limit), total: items.length, limit: input.limit, offset: input.offset };
  });
  describe("get", "/api/solicitudes-autorizacion", "Solicitudes administrativas y decisiones registradas");
  mutate("/api/solicitudes-autorizacion", "Registrar solicitud administrativa pendiente", requestBody, (state, actor, body) => createAuthorizationRequest(state, actor, body));
  mutate("/api/solicitudes-autorizacion/:id/resolver", "Registrar decisión de solicitud administrativa", resolutionBody, (state, actor, body, params) => resolveAuthorizationRequest(state, actor, params.id, body.status, body.note));
}
