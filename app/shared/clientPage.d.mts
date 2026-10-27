export const CLIENT_PAGE_SIZE: 50;
export const CLIENT_PAGE_MAX: 200;
export const NOT_DEFINED: "No Definida";
export const NOT_DEFINED_ROUTE: "__no_definida__";
export type ClientPageMode = "all" | "search" | "identification" | "name" | "zone" | "route";
export type ClientPageStatus = "Activo" | "Inactivo" | "Todos";
export const CLIENT_PAGE_MODES: readonly ClientPageMode[];
export const CLIENT_PAGE_STATUSES: readonly ClientPageStatus[];

export type SearchableClient = {
  id?: string; code?: string; name?: string; alias?: string; identification?: string;
  phone?: string; cellular?: string; note?: string;
};
export type PageableClient = SearchableClient & { id: string; routeId?: string; sector?: string; active?: boolean };
export type ClientPageQuery = { mode?: ClientPageMode; q?: string; status?: ClientPageStatus; offset?: number; limit?: number; focus?: string };
export type ClientPage<T> = { items: T[]; total: number; limit: number; offset: number; zones: string[] };

export function matchesClientSearch(client: SearchableClient, query: string): boolean;
export function clientZone(client: { sector?: string }): string;
export function matchesClientPageFilter(client: PageableClient, routeIds: ReadonlySet<string>, query?: ClientPageQuery): boolean;
export function pageClients<T extends PageableClient>(clients: readonly T[], routes: readonly { id: string; sector?: string }[], query?: ClientPageQuery): ClientPage<T>;
