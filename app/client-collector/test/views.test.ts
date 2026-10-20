import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveAccess } from "../../shared/access.mjs";
import { collectorViewAllowed, type CollectorView } from "../src/services/views.ts";

const views: CollectorView[] = ["route", "payouts", "receipts", "remittances", "reports", "pocket"];
const offered = (role: string, selection?: Parameters<typeof effectiveAccess>[1]) => {
  const user = { role, access: effectiveAccess(role, selection) };
  return views.filter((view) => collectorViewAllowed(user, view));
};

test("a collector with only the reports of envíos gets Reportes, not an Envíos view without sections", () => {
  assert.deepEqual(offered("ROLE_COBRADOR", { permissionMode: "custom", permissionIds: [1], remittancePermissions: ["remittances.reports"] }), ["reports", "pocket"]);
});

test("Envíos is offered for each of its sections: Envíos, Recibos or Caja", () => {
  for (const key of ["remittances.view", "remittances.receipts", "remittances.cash.view"] as const)
    assert.deepEqual(offered("ROLE_COBRADOR", { permissionMode: "custom", permissionIds: [1], remittancePermissions: [key] }), ["remittances", "pocket"], key);
});

test("the collector role keeps its whole bottom navigation", () => {
  assert.deepEqual(offered("ROLE_COBRADOR"), ["route", "payouts", "receipts", "remittances", "reports", "pocket"]);
});
