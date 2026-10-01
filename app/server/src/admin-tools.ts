import { randomUUID } from "node:crypto";
import { assertAdmin, DomainError, type State, type User } from "./domain.js";

export type PcpStation = {
  id: string; number: string; name: string; deviceId: string; description: string;
  group: string; type: string; license: string; version: string; active: boolean;
};
export type PcpGroup = { id: string; name: string };
export type Pcp = { id: string; number: string; name: string; groupId: string; address: string; phone: string; active: boolean };
export type PcpStationLink = { pcpId: string; stationId: string };
export type AuthSession = {
  id: string; userId: string; userName: string; role: User["role"]; collectorId?: string;
  startedAt: string; expiresAt: string; revokedAt?: string; revokedBy?: string;
};
export type AuthorizationRequest = {
  id: string; clientId: string; collectorId: string; delayReasonId?: string;
  forCollection: boolean; note: string; status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: string; createdBy: string; resolvedAt?: string; resolvedBy?: string; resolutionNote?: string;
};
export type AdminTrace = { id: string; actorId: string; action: string; resource: string; resourceId?: string; createdAt: string };
export type AdminToolsState = {
  stations: PcpStation[]; pcpGroups: PcpGroup[]; pcps: Pcp[]; pcpStations: PcpStationLink[];
  sessions: AuthSession[]; authorizationRequests: AuthorizationRequest[]; traces: AdminTrace[];
};
export const emptyAdminToolsState = (): AdminToolsState => ({
  stations: [], pcpGroups: [], pcps: [], pcpStations: [], sessions: [], authorizationRequests: [], traces: [],
});
export function getAdminTools(state: State): AdminToolsState {
  const holder = state as State & { adminTools?: AdminToolsState };
  holder.adminTools ??= emptyAdminToolsState();
  return holder.adminTools;
}
export function requireAdminRow<T extends { id: string }>(rows: T[], id: string, label: string): T {
  const row = rows.find((item) => item.id === id);
  if (!row) throw new DomainError("NOT_FOUND", `${label} no encontrado.`, 404);
  return row;
}
export function uniqueAdminValue<T extends { id: string }>(rows: T[], key: keyof T, value: string, id?: string) {
  if (value && rows.some((row) => row.id !== id && String(row[key]).toLocaleLowerCase() === value.toLocaleLowerCase()))
    throw new DomainError("DUPLICATE_VALUE", "Ya existe un registro con ese nombre, número o dispositivo.", 409);
}
export function recordAdminTrace(state: State, actor: User, action: string, resource: string, resourceId?: string, now = new Date()) {
  // Only developer-defined action/resource labels and opaque identifiers enter the audit log.
  if (!/^[a-z0-9_.:-]{1,80}$/i.test(action) || !/^[a-z0-9_/:.-]{1,160}$/i.test(resource))
    throw new Error("Invalid audit action or resource");
  const safeId = resourceId && /^[a-z0-9_.:-]{1,80}$/i.test(resourceId) ? resourceId : undefined;
  const trace: AdminTrace = { id: randomUUID(), actorId: actor.id, action, resource,
    ...(safeId ? { resourceId: safeId } : {}), createdAt: now.toISOString() };
  getAdminTools(state).traces.push(trace);
  return trace;
}
export function recordMutationTrace(state: State, actor: User, routeTemplate: string, params: unknown, response: unknown, now = new Date()) {
  const parameterId = params && typeof params === "object" && "id" in params ? (params as { id?: unknown }).id : undefined;
  const resultId = response && typeof response === "object" && "id" in response ? (response as { id?: unknown }).id : undefined;
  const resourceId = typeof parameterId === "string" ? parameterId : typeof resultId === "string" ? resultId : undefined;
  return recordAdminTrace(state, actor, "mutation.completed", routeTemplate, resourceId, now);
}
export function createAuthSession(state: State, actor: User, now = new Date()): AuthSession {
  const session: AuthSession = {
    id: randomUUID(), userId: actor.id, userName: actor.name, role: actor.role,
    ...(actor.collectorId ? { collectorId: actor.collectorId } : {}),
    startedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
  };
  getAdminTools(state).sessions.push(session);
  recordAdminTrace(state, actor, "session.started", "auth/sessions", session.id, now);
  return session;
}
export function assertAuthSession(state: State, actor: User, sid: unknown, now = new Date()): AuthSession {
  const session = typeof sid === "string" ? getAdminTools(state).sessions.find((row) => row.id === sid) : undefined;
  if (!session || session.userId !== actor.id || session.role !== actor.role || session.collectorId !== actor.collectorId ||
      session.revokedAt || Date.parse(session.expiresAt) <= now.getTime())
    throw new DomainError("SESSION_EXPIRED", "La sesión terminó. Inicia sesión de nuevo.", 401);
  return session;
}
export function sessionStatus(session: AuthSession, now = new Date()): "active" | "closed" | "expired" {
  return session.revokedAt ? "closed" : Date.parse(session.expiresAt) <= now.getTime() ? "expired" : "active";
}
export function revokeAuthSession(state: State, actor: User, id: string, now = new Date()) {
  assertAdmin(actor);
  const session = requireAdminRow(getAdminTools(state).sessions, id, "Sesión");
  if (sessionStatus(session, now) !== "active") throw new DomainError("SESSION_CLOSED", "La sesión ya está cerrada o vencida.", 409);
  session.revokedAt = now.toISOString(); session.revokedBy = actor.id;
  return session;
}
export function revokeUserSessions(state: State, userId: string, actorId: string, now = new Date()) {
  for (const session of getAdminTools(state).sessions) {
    if (session.userId === userId && sessionStatus(session, now) === "active") {
      session.revokedAt = now.toISOString(); session.revokedBy = actorId;
    }
  }
}
export function endOwnAuthSession(state: State, actor: User & { sid?: string }, now = new Date()) {
  const session = assertAuthSession(state, actor, actor.sid, now);
  session.revokedAt = now.toISOString(); session.revokedBy = actor.id;
  return { id: session.id, closed: true };
}
export function createAuthorizationRequest(state: State, actor: User, input: {
  clientId: string; collectorId: string; delayReasonId?: string; forCollection: boolean; note: string;
}, now = new Date()) {
  assertAdmin(actor);
  const client = requireAdminRow(state.clients, input.clientId, "Cliente");
  const collector = requireAdminRow(state.collectors, input.collectorId, "Cobrador");
  if (client.active === false || collector.active === false)
    throw new DomainError("INACTIVE_ENTITY", "Selecciona un cliente y un cobrador activos.", 409);
  if (!state.routes.some((route) => route.id === client.routeId && route.collectorId === collector.id))
    throw new DomainError("ROUTE_OWNER", "El cliente no pertenece a una ruta del cobrador seleccionado.", 422);
  if (input.delayReasonId && !requireAdminRow(state.delayReasons, input.delayReasonId, "Motivo").active)
    throw new DomainError("REASON_INACTIVE", "Selecciona un motivo activo.", 409);
  const request: AuthorizationRequest = { id: randomUUID(), ...input, status: "pending", createdAt: now.toISOString(), createdBy: actor.id };
  getAdminTools(state).authorizationRequests.push(request);
  return request;
}
export function resolveAuthorizationRequest(state: State, actor: User, id: string,
  status: "approved" | "rejected" | "cancelled", note: string, now = new Date()) {
  assertAdmin(actor);
  const request = requireAdminRow(getAdminTools(state).authorizationRequests, id, "Solicitud");
  if (request.status !== "pending") throw new DomainError("REQUEST_RESOLVED", "La solicitud ya tiene una decisión registrada.", 409);
  if (!note.trim()) throw new DomainError("REASON_REQUIRED", "Escribe el motivo de la decisión.");
  request.status = status; request.resolutionNote = note.trim(); request.resolvedAt = now.toISOString(); request.resolvedBy = actor.id;
  // This records an administrative decision. It never creates a payout or changes cash limits.
  return request;
}
export function seedAdminTools(state: State) {
  const data = getAdminTools(state);
  if (data.pcpGroups.length || data.pcps.length || data.stations.length) return;
  data.pcpGroups.push({ id: "demo-pcp-group", name: "Grupo de demostración" });
  data.pcps.push({ id: "demo-pcp", number: "DEMO-001", name: "Punto de demostración", groupId: "demo-pcp-group", address: "Dirección ficticia de demostración", phone: "", active: true });
  data.stations.push({ id: "demo-station", number: "DEMO-001", name: "Estación de demostración", deviceId: "", description: "Registro ficticio para revisar el catálogo", group: "", type: "", license: "", version: "", active: true });
  data.pcpStations.push({ pcpId: "demo-pcp", stationId: "demo-station" });
}
