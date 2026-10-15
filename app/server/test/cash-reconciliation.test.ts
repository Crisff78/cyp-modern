import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { previousCashPreview, reconcilePreviousCash } from "../src/cash-reconciliation.js";
import { acceptDeposit, businessDate, cancelDeposit, closeDay, postMovement, preview, snapshot, type User } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { FileStore, MemoryStore } from "../src/store.js";

const admin: User = { id: "demo-admin", name: "Administración ficticia", role: "admin" };
const now = new Date();
const oldInstant = new Date(now.getTime() - 2 * 86400000).toISOString();
const date = businessDate(new Date(oldInstant));
function fixture() {
  const state = seed();
  state.movements = [
    { id: "old-collected", collectorId: "col-1", type: "collection", amount: 10000, currency: "DOP", createdAt: oldInstant, actorId: admin.id },
    { id: "old-delivered", collectorId: "col-1", type: "office_delivery", amount: 100000, currency: "DOP", createdAt: oldInstant, actorId: admin.id },
    { id: "old-usd", collectorId: "col-1", type: "office_delivery", amount: 2500, currency: "USD", createdAt: oldInstant, actorId: admin.id },
    { id: "other-collector", collectorId: "col-2", type: "office_delivery", amount: 70000, createdAt: oldInstant, actorId: admin.id },
  ];
  return state;
}
const inputFor = (state: ReturnType<typeof fixture>) => {
  const pending = previousCashPreview(state, "col-1", now);
  return { collectorId: "col-1", revision: pending.revision, amounts: pending.amounts, confirmReceived: true as const, note: "Recepción ficticia del efectivo de prueba anterior." };
};

test("previous cash blocks new deliveries; receipt preserves original ledger and permits later trials without mixing currencies", () => {
  const state = fixture(), movements = structuredClone(state.movements), remittances = structuredClone(state.remittances);
  assert.throws(() => postMovement(state, admin, "office_delivery", { collectorId: "col-1", amount: 50000 }, now), { code: "PREVIOUS_DAY_OPEN" });
  const pending = previousCashPreview(state, "col-1", now);
  assert.deepEqual(pending.amounts, { DOP: 110000, USD: 2500, EUR: 0 });
  assert.equal(pending.canReconcile, true); assert.equal(state.cashReconciliations?.length, 0);
  const result = reconcilePreviousCash(state, admin, inputFor(state), now);
  assert.equal(result.records.length, 2); assert.deepEqual(state.movements, movements); assert.deepEqual(state.remittances, remittances);
  assert.equal(preview(state, "col-1", date).difference, 0); assert.equal(preview(state, "col-1", undefined, "USD").difference, 0);
  assert.equal(preview(state, "col-2").difference, 70000);
  assert.equal(previousCashPreview(state, "col-1", now).rows.length, 0);
  const historical = snapshot(state, admin).settlements.find((row) => row.collectorId === "col-1" && row.date === date)!;
  assert.equal(historical.cashReconciled, true); assert.equal(historical.officeDelivered, 100000);
  assert.equal(historical.totalsByCurrency?.USD.officeDelivered, 2500); assert.equal(historical.difference, 0);
  assert.throws(() => closeDay(state, admin, "col-1", date, now), { code: "DAY_CLOSED" });
  postMovement(state, admin, "office_delivery", { collectorId: "col-1", amount: 50000 }, now);
  postMovement(state, admin, "office_delivery", { collectorId: "col-1", amount: 50000 }, now);
  assert.equal(preview(state, "col-1").officeDelivered, 200000); assert.equal(preview(state, "col-1").difference, 100000);
  assert.equal(previousCashPreview(state, "col-1", now).rows.length, 0, "today remains open for repeated trials");
  const tomorrow = new Date(now.getTime() + 86400000);
  assert.throws(() => postMovement(state, admin, "office_delivery", { collectorId: "col-1", amount: 50000 }, tomorrow), { code: "PREVIOUS_DAY_OPEN" });
  const next = previousCashPreview(state, "col-1", tomorrow);
  assert.deepEqual(next.amounts, { DOP: 100000, USD: 0, EUR: 0 });
  reconcilePreviousCash(state, admin, { ...inputFor(state), revision: next.revision, amounts: next.amounts }, tomorrow);
  postMovement(state, admin, "office_delivery", { collectorId: "col-1", amount: 50000 }, tomorrow);
  assert.equal(preview(state, "col-1").difference, 50000);
});

test("cash receipt rejects stale data, altered totals, missing confirmation and non-admin actors atomically", () => {
  const state = fixture(), input = inputFor(state), before = structuredClone(state);
  for (const payload of [{ ...input, revision: "0".repeat(64) }, { ...input, amounts: { ...input.amounts, USD: 0 } }, { ...input, note: " " }]) {
    assert.throws(() => reconcilePreviousCash(state, admin, payload, now)); assert.deepEqual(state, before);
  }
  assert.throws(() => reconcilePreviousCash(state, admin, { ...input, confirmReceived: false } as unknown as typeof input, now), { code: "CASH_RECEIPT_CONFIRMATION_REQUIRED" });
  for (const role of ["collector", "supervisor", "user"] as const) assert.throws(() => reconcilePreviousCash(state, { ...admin, role }, input, now), { code: "FORBIDDEN" });
  assert.deepEqual(state, before);
  state.movements.push({ ...state.movements[0], id: "additional-old", amount: 100 });
  assert.throws(() => reconcilePreviousCash(state, admin, input, now), { code: "CASH_RECONCILIATION_CHANGED" });
});

test("negative balances and previously closed inconsistencies cannot be regularized; reconciled deposits are protected", () => {
  const state = fixture();
  state.movements.push({ id: "old-deposit", type: "deposit", collectorId: "col-1", amount: 20000, createdAt: oldInstant, actorId: admin.id });
  const before = structuredClone(state), pending = previousCashPreview(state, "col-1", now);
  assert.equal(pending.canReconcile, false); assert.match(pending.issues.join(" "), /negativa/);
  assert.throws(() => reconcilePreviousCash(state, admin, inputFor(state), now), { code: "CASH_RECONCILIATION_REVIEW_REQUIRED" });
  assert.deepEqual(state, before);
  state.movements.find((row) => row.id === "old-deposit")!.amount = 5000;
  reconcilePreviousCash(state, admin, inputFor(state), now);
  assert.throws(() => cancelDeposit(state, admin, "old-deposit"), { code: "DAY_CLOSED" });
  const balanceBeforeAcceptance = preview(state, "col-1");
  assert.ok(acceptDeposit(state, admin, "old-deposit").acceptedAt, "A pending deposit can still be acknowledged without changing its amount or the reconciled cash.");
  assert.deepEqual(preview(state, "col-1"), balanceBeforeAcceptance);
  const closed = fixture();
  closed.settlements.push({ id: "inconsistent-close", collectorId: "col-1", date, ...preview(closed, "col-1", date), status: "closed", closedAt: oldInstant, actorId: admin.id });
  assert.equal(previousCashPreview(closed, "col-1", now).canReconcile, false);
});

test("cash reconciliation API validates strict inputs and replays committed responses without duplicate receipts", async () => {
  const store = new MemoryStore(fixture());
  const app = await buildApp({ store, demo: true, secret: "fictional-cash-reconciliation-secret-at-least-32", origins: [], collectorUrl: "http://localhost:5174" });
  try {
    const login = async (email: string) => {
      const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } });
      assert.equal(response.statusCode, 200, response.body);
      return response.json().token;
    };
    const token = await login("admin"), collectorToken = await login("collector@cyp.local");
    const headers = { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() };
    const pending = (await app.inject({ method: "GET", url: "/api/cuadres/pendientes?collectorId=col-1", headers })).json();
    assert.deepEqual(pending.amounts, { DOP: 110000, USD: 2500, EUR: 0 }); assert.equal(pending.demo, true);
    const payload = { collectorId: "col-1", revision: pending.revision, amounts: pending.amounts, note: "Recepción de prueba", confirmReceived: true };
    for (const invalid of [{ ...payload, confirmReceived: false }, { ...payload, amounts: { ...payload.amounts, DOP: "110000" } }, { ...payload, amounts: { ...payload.amounts, DOP: 1.5 } }, { ...payload, extra: "forbidden" }]) {
      assert.equal((await app.inject({ method: "POST", url: "/api/cuadres/regularizar", headers: { ...headers, "idempotency-key": randomUUID() }, payload: invalid })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: "GET", url: "/api/cuadres/pendientes?collectorId=col-2", headers: { authorization: `Bearer ${collectorToken}` } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/cuadres/regularizar", headers: { authorization: `Bearer ${collectorToken}`, "idempotency-key": randomUUID() }, payload })).statusCode, 403);
    const first = await app.inject({ method: "POST", url: "/api/cuadres/regularizar", headers, payload }); assert.equal(first.statusCode, 200, first.body);
    const replay = await app.inject({ method: "POST", url: "/api/cuadres/regularizar", headers, payload }); assert.equal(replay.statusCode, 200); assert.deepEqual(replay.json(), first.json());
    assert.equal((await store.read()).cashReconciliations?.length, 2);
    const received = await app.inject({ method: "POST", url: "/api/entregas", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { collectorId: "col-1", amount: 50000, currency: "DOP" } });
    assert.equal(received.statusCode, 200, received.body);
  } finally { await app.close(); }
});

test("reconciliation survives FileStore reopening; serialized competing confirmations create one journal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-cash-reconciliation-"));
  try {
    const file = join(directory, "fictional.json"), store = await FileStore.open(file, fixture());
    const input = inputFor(await store.read());
    const results = await Promise.allSettled([store.transaction((state) => reconcilePreviousCash(state, admin, input, now)), store.transaction((state) => reconcilePreviousCash(state, admin, input, now))]);
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
    const reopened = await FileStore.open(file, fixture());
    assert.equal((await reopened.read()).cashReconciliations?.length, 2);
    assert.equal(preview(await reopened.read(), "col-1").difference, 0);
    await assert.rejects(reopened.transaction((state) => { state.cashReconciliations!.pop(); }), { code: "CASH_RECONCILIATION_IMMUTABLE" });
    assert.equal((await reopened.read()).cashReconciliations?.length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
