import { DomainError, type State, type User } from "./domain.js";
import { remittanceOperators, type RemittanceContact } from "./remittances.js";

export const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/·/g, " ").toLocaleLowerCase("es").trim();
export function phoneMatches(value: string | undefined, digits: string) {
  return (value?.match(/\+?\d[\d\t ().-]*\d|\d/g) ?? []).flatMap((run) => run.split(/(?<=\d{7})[\t ().-]+(?=\d{7})/))
    .some((run) => { const number = run.replace(/\D/g, ""); return number.length >= 7 && number.length <= 15 && number.includes(digits); });
}

/** A text without case, accents, spaces or hyphens: how an identification is compared. */
export const compact = (value: string) => normalized(value).replace(/[\s-]/g, "");
/** Whether a text has a letter: only then is it looked for by pieces in the text protocol (version 0.9). */
export const hasLetter = (value: string) => /\p{L}/u.test(value);
/** The digits of a text that may be a phone (digits and phone signs only), when there are 7 or more; else nothing. */
export const phoneDigits = (value: string) => {
  const text = value.trim(), digits = /^[+\d\s().-]+$/.test(text) ? text.replace(/\D/g, "") : "";
  return digits.length >= 7 ? digits : "";
};
/** A phone of the record whose number ends the other one: with or without the area or the country code in front. */
export function phoneEnds(value: string | undefined, digits: string) {
  return (value?.match(/\+?\d[\d\t ().-]*\d|\d/g) ?? []).flatMap((run) => run.split(/(?<=\d{7})[\t ().-]+(?=\d{7})/))
    .some((run) => { const number = run.replace(/\D/g, ""); return number.length >= 7 && number.length <= 15 && (number.endsWith(digits) || digits.endsWith(number)); });
}
type Client = State["clients"][number];
/** A client that may be chosen for that side of a send: active, and for a collector's sender, of his route. */
function choosable(state: State, actor: User, client: Client, side: "sender" | "recipient", senderId = "") {
  if (client.active === false || (side === "recipient" && client.id === senderId)) return false;
  return !(side === "sender" && actor.role === "collector" && !state.routes.some((route) => route.id === client.routeId && route.collectorId === actor.collectorId));
}
// Search existing client identities without publishing a global contact/notes index.
// Recipients may be in another route, as in the remittance creation workflow.
function matchingClients(state: State, actor: User, query: string, side: "sender" | "recipient", senderId = "") {
  remittanceOperators(state, actor);
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const digits = /^[+\d\s().-]+$/.test(query) ? query.replace(/\D/g, "") : "";
  return state.clients.filter((client) => {
    if (!choosable(state, actor, client, side, senderId)) return false;
    const text = normalized(`${client.code} ${client.name} ${client.identification ?? ""} ${client.internalIdentification ?? ""}`);
    const identity = normalized(client.identification ?? "").replace(/[\s-]/g, "");
    const identityQuery = normalized(query).replace(/[\s-]/g, "");
    return terms.every((term) => text.includes(term)) || (identityQuery.length >= 3 && identity.includes(identityQuery)) || (digits.length >= 3 && [client.code, client.phone, client.cellular, client.note].some((value) => phoneMatches(value, digits)));
  });
}
export function searchRemittanceClients(state: State, actor: User, query: string, side: "sender" | "recipient", senderId = "") {
  const matches = matchingClients(state, actor, query, side, senderId);
  return { ids: matches.slice(0, 100).map((client) => client.id), hasMore: matches.length > 100 };
}
/**
 * The search of the text protocol since its version 0.9. The mobile application searched 0000 and got every client,
 * because the search of the web looks inside every identifier and 0000 is inside every INT000000xx. Here an identifier
 * is matched whole: the client the text stands for as an idCliente (exactId, resolved by the protocol), or whose code or
 * identification (with or without hyphens) is that text, or a phone of the client ends in it (7 digits or more). Only a
 * text with a letter is also looked for by pieces: every word inside the code or the name.
 */
function protocolMatch(client: Client, query: string, exactId?: string) {
  const lower = normalized(query);
  if (!lower) return true;
  if (client.id === exactId || normalized(client.code) === lower) return true;
  if (client.identification && compact(client.identification) !== "" && compact(client.identification) === compact(query)) return true;
  const digits = phoneDigits(query);
  if (digits && [client.phone, client.cellular].some((value) => phoneEnds(value, digits))) return true;
  if (!hasLetter(query)) return false;
  const pieces = normalized(`${client.code} ${client.name}`);
  return lower.split(/\s+/).every((term) => pieces.includes(term));
}
const byName = new Intl.Collator("es", { sensitivity: "base" });
/**
 * The clients of the search of the text protocol (protocolMatch), or every active one when nothing is typed, in the
 * order of a list that is read by pages: name, then code, then id, so no page repeats or skips a client. What is needed
 * to choose one and, since version 0.6 of the text protocol, the phone the web shows and the address (and since 0.10,
 * the identification): the mobile
 * application asked for them. The search of the web, above, does not change and still gives ids only.
 */
export function listRemittanceClients(state: State, actor: User, query: string, side: "sender" | "recipient", exactId?: string) {
  remittanceOperators(state, actor);
  return state.clients.filter((client) => choosable(state, actor, client, side) && protocolMatch(client, query, exactId))
    .map(({ id, internalIdentification, code, name, identification, phone, cellular, address }) =>
      ({ id, ...(internalIdentification ? { internalIdentification } : {}), code, name, identification: identification ?? "", phone: phone || cellular || "", address: address ?? "" }))
    .sort((a, b) => byName.compare(a.name, b.name) || byName.compare(a.code, b.code) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Preview only the explicitly selected contact; saved transfers keep their own snapshot.
export function remittanceClientContact(state: State, actor: User, id: string, side: "sender" | "recipient", senderId = ""): RemittanceContact {
  remittanceOperators(state, actor);
  const client = state.clients.find((row) => row.id === id);
  if (!client) throw new DomainError("CLIENT_NOT_FOUND", "Cliente no encontrado.", 404);
  if (client.active === false) throw new DomainError("CLIENT_INACTIVE", "Selecciona un cliente activo.", 409);
  if (side === "recipient" && client.id === senderId)
    throw new DomainError("SAME_CLIENT", "Remitente y destinatario deben ser distintos.", 422);
  if (side === "sender" && actor.role === "collector" && !state.routes.some((route) => route.id === client.routeId && route.collectorId === actor.collectorId))
    throw new DomainError("FORBIDDEN", "El remitente no pertenece a tu ruta.", 403);
  return { id: client.id, code: client.code, name: client.name, phone: client.phone ?? "",
    cellular: client.cellular ?? "", address: client.address ?? "", ...(client.identification ? { identification: client.identification } : {}) };
}
