import { randomUUID } from "node:crypto";
import { DomainError, type State, type User } from "./domain.js";
import { claimClientIdentity } from "./client-identities.js";
import { requireRemittancePermission } from "./access.js";
import type { RemittanceClientDraft } from "./client-schema.js";

export function registerRemittanceClient(state: State, actor: User, draft: RemittanceClientDraft) {
  requireRemittancePermission(actor, "remittances.clients.create");
  const route = state.routes.find(({ id }) => id === draft.routeId);
  if (!route || (actor.role === "collector" && route.collectorId !== actor.collectorId))
    throw new DomainError("ROUTE_NOT_FOUND", "Selecciona una ruta autorizada para el nuevo cliente.", 422);
  const identification = draft.identification.normalize("NFKC").replace(/[\s-]/g, "").toLocaleUpperCase("es");
  if (state.clients.some((client) => client.identification && client.identification.normalize("NFKC").replace(/[\s-]/g, "").toLocaleUpperCase("es") === identification))
    throw new DomainError("CLIENT_ALREADY_EXISTS", "Ya existe una ficha con esa identificación. Busca y selecciona el cliente registrado antes de continuar.", 409);
  const id = randomUUID(), identity = claimClientIdentity(state, actor, id);
  if (!identity.code) throw new DomainError("CLIENT_RESERVATION_UNAVAILABLE", "No se pudo asignar el código del nuevo cliente.", 409);
  const client = { ...draft, ...identity, code: identity.code, id, active: true, preferredCurrency: draft.preferredCurrency ?? "DOP" as const };
  state.clients.push(client);
  return id;
}
