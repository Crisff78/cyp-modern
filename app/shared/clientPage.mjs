// One page of the Clientes window (Dionel, 26-10): the server filters and pages, so the window never
// receives every client at once. The browser's own search uses the same matcher.

export const CLIENT_PAGE_SIZE = 50;
export const CLIENT_PAGE_MAX = 200;
// «No Definida» means «sin asignar»: a client without a zone, or without a route the account can see.
export const NOT_DEFINED = "No Definida";
export const NOT_DEFINED_ROUTE = "__no_definida__";
export const CLIENT_PAGE_MODES = ["all", "search", "identification", "name", "zone", "route"];
export const CLIENT_PAGE_STATUSES = ["Activo", "Inactivo", "Todos"];

const normalized = (value) => String(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().trim();
function notePhoneDigits(note) {
  // Words, punctuation and newlines separate numbers. Two long number blocks
  // are separate phones, even when separated only by phone formatting marks.
  return (note.match(/\+?\d[\d\t ().-]*\d|\d/g) ?? [])
    .flatMap((run) => run.split(/(?<=\d{7})[\t ().-]+(?=\d{7})/))
    .map((run) => run.replace(/\D/g, ""))
    .filter((digits) => digits.length >= 7 && digits.length <= 15);
}
export function matchesClientSearch(client, query) {
  const search = normalized(query ?? "");
  if (!search) return true;
  const text = [client.id, client.code, client.name, client.alias, client.identification, client.phone, client.cellular, client.note]
    .filter(Boolean).map((value) => normalized(value)).join(" ");
  if (text.includes(search)) return true;
  if (/^[+\d\s().-]+$/.test(search)) {
    const digits = search.replace(/\D/g, "");
    return Boolean(digits) && ([client.phone, client.cellular].some((value) => (value ?? "").replace(/\D/g, "").includes(digits))
      || notePhoneDigits(client.note ?? "").some((phone) => phone.includes(digits)));
  }
  return false;
}

export const clientZone = (client) => client.sector || NOT_DEFINED;

export function matchesClientPageFilter(client, routeIds, { mode = "all", q = "", status = "Activo" } = {}) {
  const active = client.active !== false;
  if (status === "Activo" && !active || status === "Inactivo" && active) return false;
  if (mode === "search") return matchesClientSearch(client, q);
  if (mode === "identification") return normalized(client.identification ?? "").includes(normalized(q));
  if (mode === "name") return normalized(client.name ?? "").includes(normalized(q));
  if (mode === "zone") return clientZone(client) === (q || NOT_DEFINED);
  if (mode === "route") return q === NOT_DEFINED_ROUTE ? !client.routeId || !routeIds.has(client.routeId) : client.routeId === q;
  return true;
}

// `focus` asks for the page that holds that client (after saving it), when it matches the filters.
export function pageClients(clients, routes, query = {}) {
  const routeIds = new Set(routes.map((route) => route.id));
  const limit = Math.min(CLIENT_PAGE_MAX, Math.max(1, Math.trunc(Number(query.limit) || CLIENT_PAGE_SIZE)));
  const matches = clients.filter((client) => matchesClientPageFilter(client, routeIds, query));
  const lastOffset = matches.length ? Math.floor((matches.length - 1) / limit) * limit : 0;
  const focused = query.focus ? matches.findIndex((client) => client.id === query.focus) : -1;
  const requested = Math.max(0, Math.trunc(Number(query.offset) || 0));
  const offset = focused >= 0 ? Math.floor(focused / limit) * limit : Math.min(Math.floor(requested / limit) * limit, lastOffset);
  const zones = Array.from(new Set([NOT_DEFINED, ...clients.map(clientZone), ...routes.map((route) => route.sector).filter(Boolean)]));
  return { items: matches.slice(offset, offset + limit), total: matches.length, limit, offset, zones };
}
