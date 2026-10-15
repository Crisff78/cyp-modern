import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../../server/src/seed.js";
import { businessDate, snapshot as readSnapshot, type User } from "../../server/src/domain.js";
import { previousCashPreview, reconcilePreviousCash } from "../../server/src/cash-reconciliation.js";
import { settlementWorkspaceRows } from "../src/settlementCurrencies.js";
import type { Snapshot } from "../src/types.js";

const actor: User = { id: "demo-admin", name: "Administración de prueba", role: "admin" };

test("settlement grid exposes open operating days in Santo Domingo and keeps canceled money and currencies separate", () => {
  const state = seed(); state.settlements = [];
  state.movements = [
    { id: "before-midnight", collectorId: "col-1", type: "office_delivery", amount: 10000, currency: "DOP", createdAt: "2026-10-15T03:59:00Z", actorId: actor.id },
    { id: "after-midnight", collectorId: "col-1", type: "collection", amount: 5000, currency: "DOP", createdAt: "2026-10-15T04:00:00Z", actorId: actor.id },
    { id: "usd", collectorId: "col-1", type: "office_delivery", amount: 2500, currency: "USD", createdAt: "2026-10-15T12:00:00Z", actorId: actor.id },
    { id: "canceled", collectorId: "col-1", type: "office_delivery", amount: 99900, currency: "DOP", createdAt: "2026-10-15T12:00:00Z", actorId: actor.id, cancelledAt: "2026-10-15T13:00:00Z" },
  ];
  const rows = settlementWorkspaceRows(readSnapshot(state, actor) as unknown as Snapshot);
  assert.equal(rows.length, 3); assert.ok(rows.every((row) => row.state === "Pendiente"));
  assert.equal(rows.find((row) => row.date === "2026-10-14")?.officeDelivered, 10000);
  assert.equal(rows.find((row) => row.date === "2026-10-15" && row.currency === "DOP")?.difference, 5000);
  assert.equal(rows.find((row) => row.currency === "USD")?.difference, 2500);
});

test("a saved cash close replaces the pending grid entry without double counting gross amounts or changing its row identity", () => {
  const state = seed(), now = new Date(); state.settlements = [];
  const old = new Date(now.getTime() - 2 * 86400000), date = businessDate(old);
  state.movements = [{ id: "delivery", collectorId: "col-1", type: "office_delivery", amount: 10000, currency: "DOP", createdAt: old.toISOString(), actorId: actor.id }];
  const before = settlementWorkspaceRows(readSnapshot(state, actor) as unknown as Snapshot);
  const pending = previousCashPreview(state, "col-1", now, false, date);
  reconcilePreviousCash(state, actor, { collectorId: "col-1", date, revision: pending.revision, amounts: pending.amounts, note: "Devolución de prueba", confirmReceived: true }, now);
  const after = settlementWorkspaceRows(readSnapshot(state, actor) as unknown as Snapshot);
  assert.equal(after.length, 1); assert.equal(after[0].id, before[0].id); assert.equal(after[0].state, "Conciliado");
  assert.equal(after[0].officeDelivered, 10000); assert.equal(after[0].returnedPayout, 10000); assert.equal(after[0].difference, 0);
});
