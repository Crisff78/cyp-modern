import { DomainError, type State, type User } from "./domain.js";
import { remittanceOperators, type RemittanceContact } from "./remittances.js";

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/·/g, " ").toLocaleLowerCase("es").trim();
function phoneMatches(value: string | undefined, digits: string) {
  return (value?.match(/\+?\d[\d\t ().-]*\d|\d/g) ?? []).flatMap((run) => run.split(/(?<=\d{7})[\t ().-]+(?=\d{7})/))
    .some((run) => { const number = run.replace(/\D/g, ""); return number.length >= 7 && number.length <= 15 && number.includes(digits); });
}

// Search existing client identities without publishing a global contact/notes index.
// Recipients may be in another route, as in the remittance creation workflow.
export function searchRemittanceClients(state: State, actor: User, query: string, side: "sender" | "recipient", senderId = "") {
  remittanceOperators(state, actor);
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const digits = /^[+\d\s().-]+$/.test(query) ? query.replace(/\D/g, "") : "";
  const matches = state.clients.filter((client) => {
    if (client.active === false || (side === "recipient" && client.id === senderId)) return false;
    if (side === "sender" && actor.role !== "admin" && !state.routes.some((route) => route.id === client.routeId && route.collectorId === actor.collectorId)) return false;
    const text = normalized(`${client.code} ${client.name}`);
    return terms.every((term) => text.includes(term)) || (digits.length >= 3 && [client.code, client.phone, client.cellular, client.note].some((value) => phoneMatches(value, digits)));
  });
  return { ids: matches.slice(0, 100).map((client) => client.id), hasMore: matches.length > 100 };
}

// Preview only the explicitly selected contact; saved transfers keep their own snapshot.
export function remittanceClientContact(state: State, actor: User, id: string, side: "sender" | "recipient", senderId = ""): RemittanceContact {
  remittanceOperators(state, actor);
  const client = state.clients.find((row) => row.id === id);
  if (!client) throw new DomainError("CLIENT_NOT_FOUND", "Cliente no encontrado.", 404);
  if (client.active === false) throw new DomainError("CLIENT_INACTIVE", "Selecciona un cliente activo.", 409);
  if (side === "recipient" && client.id === senderId)
    throw new DomainError("SAME_CLIENT", "Remitente y destinatario deben ser distintos.", 422);
  if (side === "sender" && actor.role !== "admin" && !state.routes.some((route) => route.id === client.routeId && route.collectorId === actor.collectorId))
    throw new DomainError("FORBIDDEN", "El remitente no pertenece a tu ruta.", 403);
  return { id: client.id, code: client.code, name: client.name, phone: client.phone ?? "",
    cellular: client.cellular ?? "", address: client.address ?? "" };
}
