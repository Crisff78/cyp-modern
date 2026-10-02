import assert from "node:assert/strict";
import { test } from "node:test";
import { PaymentIntents, confirmedPaymentReceipt, intentStorageKey, type IntentScope, type IntentLock, type PaymentIntent } from "../src/services/paymentIntents.ts";
import { pocketBalances } from "../src/services/pocket.ts";
import type { Movement } from "../src/types.ts";

class FakeStorage {
  values = new Map<string, string>();
  failure = "";
  getItem(key: string) { if (this.failure === "get") throw Error("security"); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failure === "set") throw Error("quota"); this.values.set(key, value); }
  removeItem(key: string) { if (this.failure === "remove") throw Error("security"); this.values.delete(key); }
}
function fixture() {
  const storage = new FakeStorage(), queues = new Map<string, Promise<unknown>>();
  const lock: IntentLock = async (name, action) => {
    const prior = queues.get(name) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(action);
    queues.set(name, next);
    return next;
  };
  let serial = 0, effects = 0, pendingCalls = 0, maximumConcurrentCalls = 0;
  const receipts = new Map<string, { receipt: { token: string } }>();
  const send = async (intent: PaymentIntent) => {
    pendingCalls++; maximumConcurrentCalls = Math.max(maximumConcurrentCalls, pendingCalls);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const id = `${intent.actorId}:${intent.key}`;
    if (!receipts.has(id)) receipts.set(id, { receipt: { token: `receipt-${++effects}` } });
    pendingCalls--;
    return receipts.get(id)!;
  };
  const make = () => new PaymentIntents(storage, lock, () => `synthetic-key-${++serial}`);
  return { storage, make, send, effects: () => effects, maximumConcurrentCalls: () => maximumConcurrentCalls };
}
const scope: IntentScope = { actorId: "actor-A", kind: "collection", entityId: "charge-1" };
const validReceipt = (result: { receipt: { token: string } }) => !!result?.receipt?.token;
const definitive = (error: unknown) => typeof error === "object" && error !== null && "status" in error && [400, 403, 409, 422].includes(Number(error.status));

for (const kind of ["collection", "payout"] as const) {
  test(`${kind}: lost commit survives fresh instance/restart, 401 and 400; one original effect`, async () => {
    const f = fixture(), original = { ...scope, kind };
    await assert.rejects(f.make().confirm(original, 10000, async (intent) => { await f.send(intent); throw Error("lost reply"); }, validReceipt, definitive));
    const retained = f.make().read(original)!;
    for (const status of [401, 400, 403, 409, 422]) {
      await assert.rejects(f.make().confirm(original, 20000, async () => { throw Object.assign(Error("retry rejected"), { status }); }, validReceipt, definitive));
      assert.equal(f.make().read(original)?.key, retained.key);
      assert.equal(f.make().read(original)?.amount, 10000);
    }
    const result = await f.make().confirm(original, 99999, f.send, validReceipt, definitive);
    assert.equal(result.receipt.token, "receipt-1");
    assert.equal(f.effects(), 1);
    assert.equal(f.make().read(original)?.status, "confirmed");
    const raw = f.storage.getItem(intentStorageKey(original))!;
    assert.equal(raw.includes("receipt-1"), false, "No receipt capability persisted");
  });
}
test("two independent instances serialize original confirmation and return the same receipt", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([
    f.make().confirm(scope, 10000, f.send, validReceipt, definitive),
    f.make().confirm(scope, 20000, f.send, validReceipt, definitive),
  ]);
  assert.equal(a.receipt.token, b.receipt.token);
  assert.equal(f.effects(), 1);
  assert.equal(f.maximumConcurrentCalls(), 1);
  assert.equal(f.make().read(scope)?.amount, 10000);
});
test("actor A → B → A does not inherit another actor's reference", async () => {
  const f = fixture(), b = { ...scope, actorId: "actor-B" };
  await assert.rejects(f.make().confirm(scope, 10000, async (intent) => { await f.send(intent); throw Error("lost reply"); }, validReceipt, definitive));
  const aKey = f.make().read(scope)!.key;
  assert.equal(f.make().read(b), null);
  await f.make().confirm(b, 5000, f.send, validReceipt, definitive);
  assert.notEqual(f.make().read(b)!.key, aKey);
  const original = await f.make().confirm(scope, 20000, f.send, validReceipt, definitive);
  assert.equal(original.receipt.token, "receipt-1");
  assert.equal(f.effects(), 2, "Only A original and legitimate B intention exist");
});
test("storage exceptions and missing lock fail before transport and allow retry after recovery", async () => {
  const f = fixture();
  for (const failure of ["get", "set"]) {
    f.storage.failure = failure;
    await assert.rejects(f.make().confirm(scope, 10000, f.send, validReceipt, definitive), /referencia/);
    assert.equal(f.effects(), 0);
  }
  f.storage.failure = "";
  const unavailableLock: IntentLock = async () => { throw Error("Locks unavailable"); };
  await assert.rejects(new PaymentIntents(f.storage, unavailableLock, () => "synthetic-key-1").confirm(scope, 10000, f.send, validReceipt, definitive), /Locks/);
  assert.equal(f.effects(), 0);
  await f.make().confirm(scope, 10000, f.send, validReceipt, definitive);
  assert.equal(f.effects(), 1);
});
test("initial definitive rejection frees editable intent; malformed successful response retains it", async () => {
  const f = fixture();
  await assert.rejects(f.make().confirm(scope, 10000, async () => { throw Object.assign(Error("funds"), { status: 422 }); }, validReceipt, definitive));
  assert.equal(f.make().read(scope), null);
  await assert.rejects(f.make().confirm(scope, 10000, async (intent) => { await f.send(intent); return { receipt: { token: "" } }; }, validReceipt, definitive), /verificar el recibo/);
  assert.equal(f.make().read(scope)?.status, "pending");
  assert.equal((await f.make().confirm(scope, 10000, f.send, validReceipt, definitive)).receipt.token, "receipt-1");
  assert.equal(f.effects(), 1);
});
test("new money requires reconciling confirmed generation then explicit replacement; stale tab fails closed", async () => {
  const f = fixture();
  await f.make().confirm(scope, 10000, f.send, validReceipt, definitive);
  const original = f.make().read(scope)!;
  await f.make().confirm(scope, 10000, f.send, validReceipt, definitive, true);
  assert.equal(f.make().read(scope)?.key, original.key, "Preparation retains shared tombstone");
  assert.equal(f.effects(), 1);
  await f.make().confirm(scope, 5000, f.send, validReceipt, definitive, false, original.key);
  assert.equal(f.effects(), 2);
  await assert.rejects(f.make().confirm(scope, 5000, f.send, validReceipt, definitive, false, original.key), /cambió/);
  assert.equal(f.effects(), 2);
});
test("invalid persisted reference is never overwritten and causes no transport", async () => {
  const f = fixture(); f.storage.setItem(intentStorageKey(scope), '{"key":"bad"}');
  await assert.rejects(f.make().confirm(scope, 10000, f.send, validReceipt, definitive), /guardada no es válida/);
  assert.equal(f.effects(), 0);
  assert.equal(f.storage.getItem(intentStorageKey(scope)), '{"key":"bad"}');
});
test("still-mounted pending intent retains its reference if storage disappears", async () => {
  const f = fixture();
  await assert.rejects(f.make().confirm(scope, 10000, async (intent) => { await f.send(intent); throw Error("lost reply"); }, validReceipt, definitive));
  const known = f.make().read(scope)!;
  f.storage.removeItem(intentStorageKey(scope));
  const result = await f.make().confirm(scope, 10000, f.send, validReceipt, definitive, false, undefined, known);
  assert.equal(result.receipt.token, "receipt-1");
  assert.equal(f.make().read(scope)!.key, known.key);
  assert.equal(f.effects(), 1);
});
test("confirmed server response must match actor, operation, kind and exact cents", () => {
  const intent: PaymentIntent = { ...scope, version: 1, key: "synthetic-key-1", amount: 12345, status: "pending" };
  const result = { receipt: { token: "synthetic-receipt" }, movement: { id: "m1", actorId: "actor-A", type: "collection", amount: 12345, chargeId: "charge-1" } };
  assert.equal(confirmedPaymentReceipt(result, intent), true);
  for (const movement of [undefined, { ...result.movement, actorId: "actor-B" }, { ...result.movement, amount: 12346 }, { ...result.movement, chargeId: "charge-2" }, { ...result.movement, type: "payout" }, { ...result.movement, id: "" }])
    assert.equal(confirmedPaymentReceipt({ ...result, movement }, intent), false);
  assert.equal(confirmedPaymentReceipt({ receipt: { token: "offline-receipt" } }, intent, true), true);
  assert.equal(confirmedPaymentReceipt({ receipt: { token: "" } }, intent, true), false);
});
test("Mi bolsillo excludes cancelled collections, deposits, payouts and office cash; excludes foreign cash", () => {
  const movements: Movement[] = [];
  let index = 0;
  for (const [type, amount] of [["collection", 12345], ["deposit", 2345], ["office_delivery", 15000], ["payout", 2500]] as const) {
    movements.push({ id: `m${++index}`, collectorId: "col-1", type, amount, createdAt: "2026-10-02T12:00:00Z" });
    movements.push({ id: `m${++index}`, collectorId: "col-1", type, amount: 100000, createdAt: "2026-10-02T12:00:00Z", cancelledAt: "2026-10-02T13:00:00Z" });
    movements.push({ id: `m${++index}`, collectorId: "col-1", type, amount: 100000, createdAt: "2026-10-02T12:00:00Z", currency: "USD" });
    movements.push({ id: `m${++index}`, collectorId: "other", type, amount: 100000, createdAt: "2026-10-02T12:00:00Z" });
  }
  assert.deepEqual(pocketBalances(movements, "col-1"), { collectionCash: 10000, payoutCash: 12500 });
});
