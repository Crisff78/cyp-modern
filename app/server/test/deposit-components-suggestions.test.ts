import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test, { type TestContext } from "node:test";
import { buildApp } from "../src/app.js";
import { MAX_MONEY_AMOUNT, postMovement, preview, type DepositComponent, type LedgerCurrency, type State } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { FileStore, MemoryStore, type Store } from "../src/store.js";

const actor = { id: "demo-admin", name: "Prueba", role: "admin" as const };
const components: DepositComponent[] = [
  { method: "cash", amount: 4000 },
  { method: "cheque", amount: 3000, bank: "Banco sintético A", reference: "SYN-CHEQUE-01" },
  { method: "bank_deposit", amount: 3000, bank: "Banco sintético B", reference: "SYN-BANK-01" },
];
const denominations = [{ denominacion: 1000, cantidad: 4 }];
function fixture(currency: LedgerCurrency = "DOP") {
  const state = seed();
  state.movements = [];
  state.settlements = [];
  state.charges[0].amount = 20000;
  state.charges[0].collected = 0;
  state.charges[0].currency = currency;
  state.charges[0].status = "pending";
  postMovement(state, actor, "collection", { chargeId: state.charges[0].id, amount: 20000 });
  return state;
}
async function setup(t: TestContext, store: Store = new MemoryStore(fixture())) {
  const app = await buildApp({ store, secret: "synthetic-deposit-components-tests-secret32", demo: true,
    origins: [], collectorUrl: "http://127.0.0.1:5174" });
  t.after(async () => { await app.close(); await store.close(); });
  const login = async (email: string) => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().token as string;
  };
  const token = await login("admin@cyp.local");
  const collectorToken = await login("collector@cyp.local");
  const post = (url: string, payload: object, key = randomUUID(), bearer = token) =>
    app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${bearer}`, "idempotency-key": key } });
  const get = (url: string) => app.inject({ url, headers: { authorization: `Bearer ${token}` } });
  return { app, store, post, get, collectorToken };
}

test("5.1 mixed deposit reduces collection funds once across double-click and response-loss replay", async (t) => {
  const { store, post, get } = await setup(t);
  const body = { collectorId: "col-1", amount: 10000, depositComponents: components, denominations };
  const key = randomUUID();
  const [created, duplicate] = await Promise.all([post("/api/depositos", body, key), post("/api/depositos", body, key)]);
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  assert.deepEqual(created.json(), duplicate.json());
  // The client may lose both returned responses; retrying the frozen key is safe.
  const replay = await post("/api/depositos", body, key);
  assert.deepEqual(replay.json(), created.json());
  assert.deepEqual(created.json().movement.depositComponents, components);
  assert.deepEqual(created.json().movement.denominations, denominations);
  const state = await store.read();
  assert.equal(state.movements.filter((row) => row.type === "deposit").length, 1);
  assert.equal(preview(state, "col-1").collected, 20000);
  assert.equal(preview(state, "col-1").deposited, 10000);
  assert.equal(preview(state, "col-1").difference, 10000);
  const listed = (await get("/api/snapshot")).json().movements.find((row: { id: string }) => row.id === created.json().movement.id);
  assert.deepEqual(listed.depositComponents, components);
  const changed = await post("/api/depositos", { ...body, depositComponents: [
    { method: "cash", amount: 4000 }, { method: "cheque", amount: 6000, bank: "Otro", reference: "Otra" },
  ] }, key);
  assert.equal(changed.statusCode, 409, changed.body);
  assert.equal(changed.json().error.code, "IDEMPOTENCY_CONFLICT");
  assert.deepEqual(await store.read(), state);
});

test("5.1 component sums, methods, bank/reference, counts and unsafe amounts reject atomically", async (t) => {
  const { store, post } = await setup(t);
  const invalid: unknown[] = [
    [], [{ method: "cash", amount: 9999 }], [{ method: "cash", amount: 0 }],
    [{ method: "cash", amount: -1 }], [{ method: "cash", amount: 10000.5 }],
    [{ method: "cash", amount: Number.MAX_SAFE_INTEGER + 1 }], [{ method: "cash", amount: MAX_MONEY_AMOUNT + 1 }],
    [{ method: "cash", amount: 10000, bank: "" }], [{ method: "cash", amount: 10000, reference: "SYN" }],
    [{ method: "card", amount: 10000 }], [{ method: "bank_deposit", amount: 10000 }],
    [{ method: "cheque", amount: 10000, bank: "  ", reference: "SYN" }],
    [{ method: "cheque", amount: 10000, bank: "Banco", reference: "  " }],
    [{ method: "bank_deposit", amount: 10000, bank: "x".repeat(161), reference: "SYN" }],
    [{ method: "bank_deposit", amount: 10000, bank: "Banco", reference: "x".repeat(161) }],
    [{ method: "cash", amount: 10000, currency: "USD" }],
    Array.from({ length: 21 }, () => ({ method: "cash", amount: 1 })), null,
  ];
  for (const depositComponents of invalid) {
    const before = await store.read();
    const response = await post("/api/depositos", { collectorId: "col-1", amount: 10000, depositComponents });
    assert.ok([400, 422].includes(response.statusCode), response.body);
    assert.deepEqual(await store.read(), before);
  }
});

test("5.1 denominations sum only cash on create and accept; accepting preserves the original components", async (t) => {
  const { store, post } = await setup(t);
  const before = await store.read();
  const wrongCreate = await post("/api/depositos", { collectorId: "col-1", amount: 10000, depositComponents: components,
    denominations: [{ denominacion: 1000, cantidad: 10 }] });
  assert.equal(wrongCreate.statusCode, 422, wrongCreate.body);
  assert.equal(wrongCreate.json().error.code, "DEPOSIT_BREAKDOWN_MISMATCH");
  assert.deepEqual(await store.read(), before);
  const emptyCash = await post("/api/depositos", { collectorId: "col-1", amount: 10000, depositComponents: components, denominations: [] });
  assert.equal(emptyCash.statusCode, 422, emptyCash.body);
  const created = await post("/api/depositos", { collectorId: "col-1", amount: 10000, depositComponents: components });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().movement.id;
  const beforeAccept = await store.read();
  const wrongAccept = await post(`/api/depositos/${id}/aceptar`, { desglose: [{ denominacion: 1000, cantidad: 10 }] });
  assert.equal(wrongAccept.statusCode, 422, wrongAccept.body);
  assert.deepEqual(await store.read(), beforeAccept);
  const key = randomUUID();
  const accepted = await post(`/api/depositos/${id}/aceptar`, { desglose: denominations }, key);
  assert.equal(accepted.statusCode, 200, accepted.body);
  const replay = await post(`/api/depositos/${id}/aceptar`, { desglose: denominations }, key);
  assert.deepEqual(replay.json(), accepted.json());
  const final = await store.read();
  assert.equal(final.depositEvents.filter((event) => event.movementId === id && event.action === "accepted").length, 1);
  assert.deepEqual(final.movements.find((row) => row.id === id)?.depositComponents, components);
  assert.equal(preview(final, "col-1").deposited, 10000);
  const cancel = await post(`/api/depositos/${id}/cancelar`, {});
  assert.equal(cancel.statusCode, 422, cancel.body);
  assert.deepEqual(await store.read(), final);
});

test("5.1 cancellation restores funds once, retains components and forbids later acceptance", async (t) => {
  const { store, post } = await setup(t);
  const created = await post("/api/depositos", { collectorId: "col-1", amount: 10000, depositComponents: components });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().movement.id;
  const key = randomUUID();
  const cancelled = await post(`/api/depositos/${id}/cancelar`, {}, key);
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  const retry = await post(`/api/depositos/${id}/cancelar`, {}, key);
  assert.deepEqual(retry.json(), cancelled.json());
  const state = await store.read();
  assert.equal(preview(state, "col-1").deposited, 0);
  assert.equal(preview(state, "col-1").difference, 20000);
  assert.equal(state.depositEvents.filter((event) => event.movementId === id && event.action === "cancelled").length, 1);
  assert.deepEqual(state.movements.find((row) => row.id === id)?.depositComponents, components);
  const accept = await post(`/api/depositos/${id}/aceptar`, { desglose: denominations });
  assert.equal(accept.statusCode, 422, accept.body);
  assert.deepEqual(await store.read(), state);
});

test("5.1 pure non-cash deposit accepts zero cash breakdown; bank metadata trims and legacy deposits remain compatible", async (t) => {
  const { store, post } = await setup(t);
  const created = await post("/api/depositos", { collectorId: "col-1", amount: 10000,
    depositComponents: [{ method: "bank_deposit", amount: 10000, bank: " Banco sintético ", reference: " REF-SYN " }], denominations: [] });
  assert.equal(created.statusCode, 200, created.body);
  assert.deepEqual(created.json().movement.depositComponents, [{ method: "bank_deposit", amount: 10000, bank: "Banco sintético", reference: "REF-SYN" }]);
  const id = created.json().movement.id;
  assert.equal((await post(`/api/depositos/${id}/aceptar`, { desglose: [] })).statusCode, 200);
  const legacy = await post("/api/depositos", { collectorId: "col-1", amount: 10000, denominations: [{ denominacion: 1000, cantidad: 10 }] });
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.equal(Object.hasOwn(legacy.json().movement, "depositComponents"), false);
  const reload = new MemoryStore(await store.read());
  t.after(() => reload.close());
  assert.equal(Object.hasOwn((await reload.read()).movements.find((row) => row.id === legacy.json().movement.id)!, "depositComponents"), false);
});

test("5.1 mixed deposits stay in their native currency and do not change DOP balances or permissions", async (t) => {
  for (const currency of ["USD", "EUR"] as const) {
    const { store, post, collectorToken } = await setup(t, new MemoryStore(fixture(currency)));
    const created = await post("/api/depositos", { collectorId: "col-1", amount: 10000, currency, depositComponents: components });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().movement.currency, currency);
    const state = await store.read();
    assert.equal(preview(state, "col-1", undefined, currency).difference, 10000);
    assert.equal(preview(state, "col-1").difference, 0);
    const before = await store.read();
    const forbidden = await post("/api/depositos", { collectorId: "col-1", amount: 10000, currency, depositComponents: components }, randomUUID(), collectorToken);
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    const delivery = await post("/api/entregas", { collectorId: "col-1", amount: 10000, currency, depositComponents: components });
    assert.equal(delivery.statusCode, 400, delivery.body);
    assert.deepEqual(await store.read(), before);
  }
});

test("5.1 FileStore persists mixed components and acceptance after closing and reopening an isolated synthetic store", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-synthetic-deposit-components-"));
  const path = join(directory, "state.json");
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  t.after(async () => { await unlink(path); await rmdir(directory); });
  const store = await FileStore.open(path, fixture());
  const env = await setup(t, store);
  const created = await env.post("/api/depositos", { collectorId: "col-1", amount: 10000, depositComponents: components });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().movement.id;
  const accepted = await env.post(`/api/depositos/${id}/aceptar`, { desglose: denominations });
  assert.equal(accepted.statusCode, 200, accepted.body);
  await env.app.close();
  await store.close();
  const reopened = await FileStore.open(path, seed());
  try {
    const state = await reopened.read();
    const movement = state.movements.find((row) => row.id === id)!;
    assert.deepEqual(movement.depositComponents, components);
    assert.deepEqual(movement.denominations, denominations);
    assert.ok(movement.acceptedAt);
    assert.equal(preview(state, "col-1").difference, 10000);
    assert.equal(state.depositEvents.filter((event) => event.movementId === id).length, 1);
    const json = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(json.movements.find((row: { id: string }) => row.id === id).depositComponents, components);
  } finally { await reopened.close(); }
});

test("5.1 direct domain validation rejects unsafe component sums and leaves synthetic state unchanged", () => {
  for (const depositComponents of [[{ method: "cash", amount: Number.MAX_SAFE_INTEGER + 1 }],
    [{ method: "cash", amount: 5000 }, { method: "cash", amount: 5001 }]] as DepositComponent[][]) {
    const state = fixture();
    const before = structuredClone(state);
    assert.throws(() => postMovement(state, actor, "deposit", { collectorId: "col-1", amount: 10000, depositComponents }), /componente/);
    assert.deepEqual(state, before);
  }
});
