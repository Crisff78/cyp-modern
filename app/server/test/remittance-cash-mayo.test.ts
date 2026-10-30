import { test } from "node:test";
import assert from "node:assert/strict";
import { businessDate, type State, type User } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore, PostgresStore } from "../src/store.js";
import {
  addRemittanceCash, cashBalance, closeRemittanceCash, openRemittanceCash, remittanceOpeningCarry, remittanceReports, remittanceSnapshot,
} from "../src/remittances.js";
import { effectiveAccess } from "../../shared/access.mjs";

// Caja de remesas as the review of Mayo asks (26-10-2026): entregas adicionales, descargo at the close and the opening
// that comes fixed from the close before.
const day1 = new Date("2026-10-26T16:00:00.000Z"), day2 = new Date("2026-10-27T16:00:00.000Z"), day3 = new Date("2026-10-28T16:00:00.000Z");
const admin: User = { id: "admin-mayo", name: "Admin", role: "admin" };
const cashier: User = { id: "cashier-mayo", name: "Cajero", role: "cashier" };
const other: User = { id: "cashier-otro", name: "Otro cajero", role: "cashier" };
const operators = [admin, cashier, other];
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code: string }).code, expected); return true; };

test("the opening is the close before less the discharge; only the permission apart changes it", () => {
  const state = seed();
  // A first box: there is nothing to carry, the cashier writes it.
  assert.equal(remittanceOpeningCarry(state, cashier.id, "DOP", businessDate(day1)), undefined);
  const first = openRemittanceCash(state, cashier, { operatorId: cashier.id, currency: "DOP", openingAmount: 150000 }, operators, day1);
  assert.equal(first.carriedFrom, undefined);
  // The office gives 250.00 more during the day: it is added to what is expected and accumulated apart.
  const added = addRemittanceCash(state, cashier, first.id, { amount: 25000, note: "Refuerzo de la tarde" }, day1);
  assert.equal(added.added, 25000); assert.equal(added.expected, 175000);
  addRemittanceCash(state, admin, first.id, { amount: 5000 }, day1);
  assert.equal(cashBalance(state, state.remittances.cashSessions[0]).added, 30000);
  // Closing: the count must be the expected; 500.00 are taken from the cashier (descargo).
  assert.throws(() => closeRemittanceCash(state, cashier, first.id, 180000, day1, 180001), code("DISCHARGE_TOO_HIGH"));
  const closed = closeRemittanceCash(state, cashier, first.id, 180000, day1, 50000);
  assert.equal(closed.discharged, 50000); assert.equal(closed.carry, 130000);
  assert.deepEqual(remittanceOpeningCarry(state, cashier.id, "DOP", businessDate(day2)), { cashId: first.id, date: businessDate(day1), amount: 130000 });
  // The next day the cashier cannot open with another amount; with the carried one he can.
  assert.throws(() => openRemittanceCash(state, cashier, { operatorId: cashier.id, currency: "DOP", openingAmount: 0 }, operators, day2), (error: unknown) => {
    assert.equal((error as { code: string }).code, "OPENING_FIXED");
    assert.match((error as Error).message, /cierre del 2026-10-26/);
    return true;
  });
  const second = openRemittanceCash(state, cashier, { operatorId: cashier.id, currency: "DOP", openingAmount: 130000 }, operators, day2);
  assert.equal(second.carriedFrom, first.id); assert.equal(second.openingAmount, 130000);
  closeRemittanceCash(state, cashier, second.id, 130000, day2);
  // Administration has the permission by its role; a cashier only as an additional permission.
  const third = openRemittanceCash(state, admin, { operatorId: cashier.id, currency: "DOP", openingAmount: 99900 }, operators, day3);
  assert.equal(third.carriedFrom, second.id); assert.equal(third.openingAmount, 99900);
  const granted: User = { ...other, access: effectiveAccess("cashier", { permissionMode: "custom", roleExceptions: true, permissionIds: [1, 2],
    remittancePermissions: ["remittances.view", "remittances.cash.view", "remittances.cash.open", "remittances.cash.close", "remittances.cash.opening.edit"] }) };
  const own = openRemittanceCash(state, granted, { operatorId: other.id, currency: "USD", openingAmount: 1000 }, operators, day1);
  closeRemittanceCash(state, granted, own.id, 1000, day1);
  assert.equal(openRemittanceCash(state, granted, { operatorId: other.id, currency: "USD", openingAmount: 400 }, operators, day2).openingAmount, 400);
});

test("an entrega adicional goes only to the open box of today, by whoever may open it", () => {
  const state = seed();
  const box = openRemittanceCash(state, cashier, { operatorId: cashier.id, currency: "EUR", openingAmount: 0 }, operators, day1);
  assert.throws(() => addRemittanceCash(state, other, box.id, { amount: 100 }, day1), code("FORBIDDEN"));
  const withoutOpening: User = { ...cashier, access: effectiveAccess("cashier", { permissionMode: "custom", permissionIds: [1, 2], remittancePermissions: ["remittances.view", "remittances.cash.view", "remittances.cash.close"] }) };
  assert.throws(() => addRemittanceCash(state, withoutOpening, box.id, { amount: 100 }, day1), code("FORBIDDEN"));
  assert.throws(() => addRemittanceCash(state, cashier, box.id, { amount: 0 }, day1), code("INVALID_AMOUNT"));
  assert.throws(() => addRemittanceCash(state, cashier, box.id, { amount: 100 }, day2), code("CASH_NOT_OPEN"));
  assert.throws(() => addRemittanceCash(state, cashier, "missing", { amount: 100 }, day1), code("CASH_NOT_FOUND"));
  closeRemittanceCash(state, cashier, box.id, 0, day1);
  assert.throws(() => addRemittanceCash(state, cashier, box.id, { amount: 100 }, day1), code("CASH_CLOSED"));
});

test("the snapshot and the cash report show the entregas adicionales, the discharge and what passes", () => {
  const state = seed();
  const box = openRemittanceCash(state, admin, { operatorId: cashier.id, currency: "DOP", openingAmount: 10000 }, operators, day1);
  addRemittanceCash(state, admin, box.id, { amount: 2500 }, day1);
  closeRemittanceCash(state, admin, box.id, 12500, day1, 2500);
  const view = remittanceSnapshot(state, admin, operators, day1).cashSessions.find((cash) => cash.id === box.id)!;
  assert.equal(view.added, 2500); assert.equal(view.discharged, 2500); assert.equal(view.carry, 10000); assert.equal(view.canAdd, false);
  const report = remittanceReports(state, admin, { from: businessDate(day1), to: businessDate(day1), grouping: "day" });
  assert.equal(report.cashSummary[0].added, 2500); assert.equal(report.cashSummary[0].lastExpected, 12500);
});

test("PostgreSQL keeps the entregas adicionales, the discharge and the box an opening came from", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const store = new PostgresStore(url), parallel = new PostgresStore(url);
  try {
    const now = new Date(), today = businessDate(now);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const actor: User = { id: "demo-admin", name: "Administración", role: "admin" };
    await store.transaction((state: State) => { if (!state.clients.length) Object.assign(state, { ...seed(), remittances: state.remittances }); });
    const before = await store.transaction((state: State) => {
      const box = openRemittanceCash(state, actor, { operatorId: actor.id, currency: "EUR", openingAmount: 70000 }, [], yesterday);
      addRemittanceCash(state, actor, box.id, { amount: 3000, note: "Entrega de prueba" }, yesterday);
      return closeRemittanceCash(state, actor, box.id, 73000, yesterday, 3000);
    });
    const next = await store.transaction((state: State) => openRemittanceCash(state, actor, { operatorId: actor.id, currency: "EUR", openingAmount: 70000 }, [], now));
    const read = await parallel.read();
    const old = read.remittances.cashSessions.find((cash) => cash.id === before.id)!, fresh = read.remittances.cashSessions.find((cash) => cash.id === next.id)!;
    assert.equal(cashBalance(read, old).added, 3000); assert.equal(cashBalance(read, old).discharged, 3000);
    assert.equal(fresh.carriedFrom, before.id); assert.equal(fresh.date, today);
    assert.deepEqual(read.remittances.cashMovements?.filter((movement) => movement.cashSessionId === before.id).map(({ type, amount, note }) => ({ type, amount, note })).sort((a, b) => a.type.localeCompare(b.type)),
      [{ type: "addition", amount: 3000, note: "Entrega de prueba" }, { type: "discharge", amount: 3000, note: undefined }]);
    // The movements are append-only, like the rest of the remittance ledger.
    const memory = new MemoryStore(read);
    assert.equal((await memory.read()).remittances.cashMovements?.length, read.remittances.cashMovements?.length);
  } finally {
    await store.close?.(); await parallel.close?.();
  }
});
