import { randomUUID } from "node:crypto";
import { DomainError, type State, type User } from "./domain.js";
import { claimClientIdentity } from "./client-identities.js";
import { requireRemittancePermission } from "./access.js";
import type { RemittanceClientDraft } from "./client-schema.js";

const documentKey = (value: string) => value.normalize("NFKC").replace(/[\s-]/g, "").toLocaleUpperCase("es");

// `otherClientId` is the other participant of the same remittance (already chosen or just registered).
export function registerRemittanceClient(state: State, actor: User, draft: RemittanceClientDraft, side: "sender" | "recipient" = "recipient", otherClientId?: string) {
  requireRemittancePermission(actor, "remittances.clients.create");
  const route = state.routes.find(({ id }) => id === draft.routeId);
  if (!route || (actor.role === "collector" && route.collectorId !== actor.collectorId))
    throw new DomainError("ROUTE_NOT_FOUND", "Selecciona una ruta autorizada para el nuevo cliente.", 422);
  const identification = documentKey(draft.identification);
  const existing = state.clients.find((client) => client.identification && documentKey(client.identification) === identification);
  // Each duplicate says how to continue: the operator is never sent to search for a record the search cannot show.
  if (existing && existing.id === otherClientId)
    throw new DomainError("SAME_CLIENT", "El remitente y el destinatario tienen la misma cédula o pasaporte. Revisa el documento: una misma persona no puede enviarse dinero a sí misma.", 422);
  if (existing?.active === false)
    throw new DomainError("CLIENT_INACTIVE_EXISTS", "Ya existe una ficha inactiva con esa cédula o pasaporte. Pide a Administración que la reactive y luego selecciónala en la búsqueda.", 409);
  if (existing && side === "sender" && actor.role === "collector" && !state.routes.some((row) => row.id === existing.routeId && row.collectorId === actor.collectorId))
    throw new DomainError("CLIENT_OTHER_ROUTE", "Ese cliente ya está registrado en otra ruta. Solo puedes enviar con clientes de tu ruta: pide a Administración que revise su ruta o que otro operador registre el envío.", 409);
  if (existing)
    throw new DomainError("CLIENT_ALREADY_EXISTS", "Ya existe una ficha con esa identificación. Busca y selecciona el cliente registrado antes de continuar.", 409);
  const id = randomUUID(), identity = claimClientIdentity(state, actor, id);
  if (!identity.code) throw new DomainError("CLIENT_RESERVATION_UNAVAILABLE", "No se pudo asignar el código del nuevo cliente.", 409);
  const client = { ...draft, ...identity, code: identity.code, id, active: true, preferredCurrency: draft.preferredCurrency ?? "DOP" as const };
  state.clients.push(client);
  return id;
}
