import type { State, User } from "./domain.js";
import { remittanceOperators } from "./remittances.js";

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
