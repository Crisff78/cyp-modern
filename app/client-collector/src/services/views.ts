import { hasPermission, hasRemittancePermission, type AccessActor, type RemittancePermission } from "../../../shared/access.mjs";

export type CollectorView = "route" | "payouts" | "receipts" | "pocket" | "remittances" | "reports";

// The Envíos view shows the sections Envíos, Recibos and Caja; the reports of envíos open in their own Reportes view.
// An account with only those reports gets Reportes, not an Envíos view without any section to show.
const remittanceSectionPermissions: readonly RemittancePermission[] = ["remittances.view", "remittances.receipts", "remittances.cash.view"];
const legacyViewPermissions = { route: 300, payouts: 370, receipts: 320 } as const;

/** Whether the bottom navigation of the collector terminal offers this view to the account. "Mi bolsillo" is always there. */
export function collectorViewAllowed(user: AccessActor, view: CollectorView): boolean {
  if (view === "pocket") return true;
  if (view === "reports") return hasRemittancePermission(user, "remittances.reports");
  if (view === "remittances") return remittanceSectionPermissions.some((key) => hasRemittancePermission(user, key));
  return hasPermission(user, legacyViewPermissions[view]);
}
