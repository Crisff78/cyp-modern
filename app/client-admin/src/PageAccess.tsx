import { createContext, useContext } from "react";
import { accessRole, hasPermission, hasRoleExceptions, type AccessActor } from "../../shared/access.mjs";

export const PageAccessContext = createContext<{ actor: AccessActor; page: string } | null>(null);
const actions: Record<string, readonly [number, number, number]> = {
  clients: [141, 142, 143], collectors: [151, 152, 153], users: [102, 103, 104], routes: [131, 132, 133],
  zones: [121, 122, 123], groups: [161, 162, 163], pcps: [171, 172, 173], stations: [112, 113, 114],
  servicesProducts: [181, 182, 183], charges: [301, 302, 303], recurringCharges: [351, 352, 353],
  collections: [321, 322, 323], deposits: [331, 332, 333], payouts: [361, 362, 363],
  recurringPayouts: [391, 392, 393], payments: [371, 372, 373], cashDeliveries: [381, 382, 383],
  dailySettlements: [402, 402, 403], exchangeRates: [201, 201, 201], generalConfig: [4, 4, 4],
  sessions: [116, 116, 116],
};
// Importing a file has its own code, as the server checks it.
const imports: Record<string, number> = { charges: 304, payouts: 364 };
export function usePageAccess() {
  const context = useContext(PageAccessContext);
  const actor = context?.actor ?? { role: "undefined" };
  const ids = actions[context?.page ?? ""] ?? [10, 10, 10];
  const manage = accessRole(actor.role) === "admin" || hasRoleExceptions(actor);
  return { actor, page: context?.page, canCreate: manage && hasPermission(actor, ids[0]),
    canEdit: manage && hasPermission(actor, ids[1]), canDelete: manage && hasPermission(actor, ids[2]),
    canAccept: manage && hasPermission(actor, 334), canImport: manage && context?.page !== undefined && hasPermission(actor, imports[context.page] ?? 0),
    has: (id: number) => hasPermission(actor, id) };
}
