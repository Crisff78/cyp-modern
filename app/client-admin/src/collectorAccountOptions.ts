import { isCollectorAccountRole } from "../../shared/accountRoles";
import type { PublicAccount } from "./types";

export function collectorOptionsForAccount(collectors: readonly { id: string; name: string; active?: boolean }[], selectedId = "") {
  return collectors.filter((collector) => collector.active !== false || collector.id === selectedId)
    .map((collector) => ({ value: collector.id, label: collector.name + (collector.active === false ? " (Inactivo)" : ""), disabled: collector.active === false }));
}

export function canSelectCollectorAccount(account: PublicAccount, collectorId?: string) {
  return account.status === "active" && isCollectorAccountRole(account.role) &&
    (account.role !== "collector" || account.collectorId === collectorId);
}
