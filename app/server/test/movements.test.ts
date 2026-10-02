import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { buildApp } from "../src/app.js";
import {
  businessDate, cancelMovement, clientStatement, closeDay, createCentralCollections, createCentralPayments,
  postMovement, preview, snapshot, type Movement, type State, type User,
} from "../src/domain.js";
import { seed } from "../src/seed.js";
import { FileStore, MemoryStore, PostgresStore, type Store } from "../src/store.js";

const admin: User = { id: "demo-admin", name: "Administración", role: "admin" };
const collector: User = { id: "demo-collector", name: "Cobrador", role: "collector", collectorId: "col-1" };

function fixture() {
  const state = seed();
  state.movements = [];
  state.charges.push({ ...state.charges[0], id: "second-charge", amount: 50000 });
  return state;
}

function paymentFixture() {
  const state = fixture();
  state.payouts.push({ ...state.payouts[0], id: "second-payout", amount: 50000 });
  return state;
}

async function setup(store: Store = new MemoryStore(fixture())) {
  const app = await buildApp({ store, secret: "synthetic-movement-tests-only-secret-2026", demo: true, origins: [], collectorUrl: "http://localhost:5174" });
  const login = async (email: string) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } })).json().token as string;
  const adminToken = await login("admin@cyp.local"), collectorToken = await login("collector@cyp.local");
  const post = (path: string, payload: Record<string, unknown>, token = adminToken, key = randomUUID()) => app.inject({
    method: "POST", url: path, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
  });
  return { app, store, post, adminToken, collectorToken };
}

test("central collection is atomic, idempotent, and attributes each persisted receipt to the session", async () => {
  const { app, store, post, adminToken, collectorToken } = await setup();
  try {
    const body = { clientId: "cli-1", collectorId: "col-1", lines: [{ chargeId: "chg-1", amount: 10000 }, { chargeId: "second-charge", amount: 50000 }] };
    const key = randomUUID();
    const responses = await Promise.all([post("/api/cobros/central", body, adminToken, key), post("/api/cobros/central", body, adminToken, key)]);
    responses.forEach((response) => assert.equal(response.statusCode, 200, response.body));
    assert.deepEqual(responses[0].json(), responses[1].json());
    const result = responses[0].json();
    assert.equal(result.movements.length, 2);
    assert.equal(result.receipts.length, 2);
    const state = await store.read();
    assert.equal(state.movements.length, 2);
    for (const movement of result.movements) {
      assert.equal(movement.actorId, admin.id);
      assert.equal(movement.registeredCentrally, true);
      assert.equal(movement.collectorId, "col-1");
      assert.equal(movement.clientId, "cli-1");
      assert.equal(businessDate(new Date(movement.createdAt)), businessDate());
      const receipt = result.receipts.find((item: { movementId: string }) => item.movementId === movement.id);
      assert.equal(receipt.token, movement.receiptToken);
      assert.equal((await app.inject(`/api/recibos/${receipt.token}`)).json().id, movement.id);
    }
    assert.equal(state.charges.find((item) => item.id === "second-charge")?.status, "paid");
    const forbidden = await post("/api/cobros/central", body, collectorToken);
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().error.code, "FORBIDDEN");
    const conflict = await post("/api/cobros/central", { ...body, lines: [{ chargeId: "chg-1", amount: 1 }] }, adminToken, key);
    assert.equal(conflict.json().error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await post("/api/cobros/central", { ...body, registeredCentrally: false })).statusCode, 400);
    assert.equal((await post("/api/cobros/central", { ...body, date: "2000-01-01" })).statusCode, 400);
  } finally { await app.close(); }
});

test("invalid central receipt leaves no partial charge, ledger or idempotency changes", async () => {
  const { app, store, post } = await setup();
  const body = { clientId: "cli-1", collectorId: "col-1", lines: [{ chargeId: "chg-1", amount: 10000 }, { chargeId: "second-charge", amount: 50001 }] };
  try {
    const before = await store.read();
    assert.equal((await post("/api/cobros/central", body)).json().error.code, "INVALID_AMOUNT");
    assert.deepEqual(await store.read(), before);
    assert.equal((await post("/api/cobros/central", { ...body, lines: [body.lines[0], body.lines[0]] })).json().error.code, "INVALID_COLLECTION_LINES");
    assert.equal((await post("/api/cobros/central", { ...body, lines: [{ chargeId: "chg-2", amount: 10 }] })).json().error.code, "CHARGE_CLIENT_MISMATCH");
    assert.equal((await post("/api/cobros/central", { ...body, collectorId: "col-2" })).json().error.code, "ROUTE_MISMATCH");
    assert.deepEqual(await store.read(), before);
    await store.transaction((s) => { s.collectors[0].collectionLimit = 12000; });
    assert.equal((await post("/api/cobros/central", { ...body, lines: [{ chargeId: "chg-1", amount: 10000 }, { chargeId: "second-charge", amount: 3000 }] })).json().error.code, "COLLECTION_LIMIT");
    assert.equal((await store.read()).movements.length, 0);
    await store.transaction((s) => { s.routes[0].active = false; });
    assert.equal((await post("/api/cobros/central", body)).json().error.code, "CLIENT_ROUTE_INACTIVE");
    await store.transaction((s) => { s.routes[0].active = true; s.charges[0].currency = "USD"; });
    assert.equal((await post("/api/cobros/central", body)).json().error.code, "CURRENCY_MISMATCH");
    const direct = fixture(), directBefore = structuredClone(direct);
    assert.throws(() => createCentralCollections(direct, admin, body));
    assert.deepEqual(direct, directBefore);
  } finally { await app.close(); }
});

test("central payment persists one atomic batch for concurrent retries and attributes each receipt", async () => {
  const { app, store, post, adminToken, collectorToken } = await setup(new MemoryStore(paymentFixture()));
  try {
    const funding = await post("/api/entregas", { collectorId: "col-1", amount: 200000 });
    assert.equal(funding.statusCode, 200, funding.body);
    const body = { clientId: "cli-2", collectorId: "col-1", lines: [{ payoutId: "pay-1", amount: 10000 }, { payoutId: "second-payout", amount: 50000 }] };
    const key = randomUUID();
    const responses = await Promise.all([post("/api/pagos/central", body, adminToken, key), post("/api/pagos/central", body, adminToken, key)]);
    responses.forEach((response) => assert.equal(response.statusCode, 200, response.body));
    assert.deepEqual(responses[0].json(), responses[1].json());
    const result = responses[0].json();
    assert.equal(result.movements.length, 2);
    assert.equal(result.receipts.length, 2);
    const state = await store.read();
    assert.equal(state.movements.filter((item) => item.type === "payout").length, 2);
    assert.equal(state.payouts.find((item) => item.id === "pay-1")?.paid, 10000);
    assert.equal(state.payouts.find((item) => item.id === "second-payout")?.status, "paid");
    assert.equal(state.idempotency.filter((item) => item.id === `${admin.id}:${key}`).length, 1);
    for (const movement of result.movements) {
      assert.equal(movement.type, "payout");
      assert.equal(movement.actorId, admin.id);
      assert.equal(movement.registeredCentrally, true);
      assert.equal(movement.collectorId, body.collectorId);
      assert.equal(movement.clientId, body.clientId);
      assert.equal(businessDate(new Date(movement.createdAt)), businessDate());
      const receipt = result.receipts.find((item: { movementId: string }) => item.movementId === movement.id);
      assert.equal(receipt.token, movement.receiptToken);
      assert.equal(receipt.url, `http://localhost:5174/?receipt=${movement.receiptToken}`);
      assert.equal((await app.inject(`/api/recibos/${receipt.token}`)).json().id, movement.id);
    }
    const beforeRejected = await store.read();
    const forbidden = await post("/api/pagos/central", body, collectorToken);
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().error.code, "FORBIDDEN");
    for (const field of ["date", "currency", "method", "registeredCentrally"]) {
      assert.equal((await post("/api/pagos/central", { ...body, [field]: "synthetic-unsupported" })).statusCode, 400);
    }
    assert.equal((await post("/api/pagos/central", { ...body, lines: [{ ...body.lines[0], method: "synthetic-unsupported" }] })).statusCode, 400);
    assert.deepEqual(await store.read(), beforeRejected);
  } finally { await app.close(); }
});

test("central payment rejects crossed selections and rolls back every line when a batch fails", async () => {
  const { app, store, post } = await setup(new MemoryStore(paymentFixture()));
  const body = { clientId: "cli-2", collectorId: "col-1", lines: [{ payoutId: "pay-1", amount: 10000 }, { payoutId: "second-payout", amount: 50001 }] };
  try {
    const funding = await post("/api/entregas", { collectorId: "col-1", amount: 200000 });
    assert.equal(funding.statusCode, 200, funding.body);
    const before = await store.read();
    assert.equal((await post("/api/pagos/central", body)).json().error.code, "INVALID_AMOUNT");
    assert.deepEqual(await store.read(), before);
    assert.equal((await post("/api/pagos/central", { ...body, clientId: "cli-1", lines: [body.lines[0]] })).json().error.code, "PAYOUT_CLIENT_MISMATCH");
    assert.equal((await post("/api/pagos/central", { ...body, collectorId: "col-2", lines: [body.lines[0]] })).json().error.code, "PAYOUT_COLLECTOR_MISMATCH");
    assert.equal((await post("/api/pagos/central", { ...body, lines: [body.lines[0], body.lines[0]] })).json().error.code, "INVALID_PAYMENT_LINES");
    assert.equal((await post("/api/pagos/central", { ...body, lines: [{ payoutId: "missing-synthetic-payout", amount: 1 }] })).json().error.code, "PAYOUT_CLIENT_MISMATCH");
    assert.equal((await post("/api/pagos/central", { ...body, lines: [] })).statusCode, 400);
    assert.equal((await post("/api/pagos/central", { ...body, lines: Array.from({ length: 101 }, (_, index) => ({ payoutId: `synthetic-${index}`, amount: 1 })) })).statusCode, 400);
    assert.deepEqual(await store.read(), before);
    const direct = paymentFixture();
    postMovement(direct, admin, "office_delivery", { collectorId: "col-1", amount: 200000 });
    const directBefore = structuredClone(direct);
    assert.throws(() => createCentralPayments(direct, admin, body), { code: "INVALID_AMOUNT" });
    assert.deepEqual(direct, directBefore);
    for (const amount of [0, -1, 1.5, 1_000_000_001, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => createCentralPayments(direct, admin, { ...body, lines: [{ payoutId: "pay-1", amount }] }), { code: "INVALID_AMOUNT" });
      assert.deepEqual(direct, directBefore);
    }
    await store.transaction((s) => { s.clients.find((item) => item.id === body.clientId)!.active = false; });
    const inactiveClient = await store.read();
    assert.equal((await post("/api/pagos/central", { ...body, lines: [body.lines[0]] })).json().error.code, "CLIENT_INACTIVE");
    assert.deepEqual(await store.read(), inactiveClient);
    await store.transaction((s) => { s.clients.find((item) => item.id === body.clientId)!.active = true; s.collectors[0].active = false; });
    const inactiveCollector = await store.read();
    assert.equal((await post("/api/pagos/central", { ...body, lines: [body.lines[0]] })).json().error.code, "COLLECTOR_INACTIVE");
    assert.deepEqual(await store.read(), inactiveCollector);
  } finally { await app.close(); }
});

test("partial central payment replays after a later balance commit and rejects changed payload without writes", async () => {
  const { app, store, post, adminToken } = await setup(new MemoryStore(paymentFixture()));
  try {
    assert.equal((await post("/api/entregas", { collectorId: "col-1", amount: 200000 })).statusCode, 200);
    const body = { clientId: "cli-2", collectorId: "col-1", lines: [{ payoutId: "pay-1", amount: 50000 }] };
    const key = randomUUID();
    const first = await post("/api/pagos/central", body, adminToken, key);
    assert.equal(first.statusCode, 200, first.body);
    let state = await store.read();
    assert.equal(state.payouts.find((item) => item.id === "pay-1")?.paid, 50000);
    assert.equal(state.payouts.find((item) => item.id === "pay-1")?.status, "partial");
    const later = await post("/api/pagos", { payoutId: "pay-1", amount: 150000 });
    assert.equal(later.statusCode, 200, later.body);
    state = await store.read();
    assert.equal(state.payouts.find((item) => item.id === "pay-1")?.paid, 200000);
    assert.equal(state.payouts.find((item) => item.id === "pay-1")?.status, "paid");
    const replay = await post("/api/pagos/central", body, adminToken, key);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), first.json());
    assert.deepEqual(await store.read(), state);
    const conflict = await post("/api/pagos/central", { ...body, lines: [{ payoutId: "pay-1", amount: 50001 }] }, adminToken, key);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, "IDEMPOTENCY_CONFLICT");
    assert.deepEqual(await store.read(), state);
  } finally { await app.close(); }
});

test("collection cancellations restore pending balances, hide receipts and remain once-only events", async () => {
  const { app, store, post, adminToken, collectorToken } = await setup();
  try {
    const first = (await post("/api/cobros", { chargeId: "chg-1", amount: 10000 }, collectorToken)).json().movement as Movement;
    const second = (await post("/api/cobros", { chargeId: "chg-1", amount: 440000 }, collectorToken)).json().movement as Movement;
    assert.equal(first.registeredCentrally, false);
    assert.equal((await store.read()).charges[0].status, "paid");
    const path = `/api/cobros/${first.id}/cancelar`;
    assert.equal((await post(path, { reason: "Error" }, collectorToken)).statusCode, 403);
    assert.equal((await post(path, { reason: "   " })).statusCode, 400);
    assert.equal((await post(`/api/pagos/${first.id}/cancelar`, { reason: "Error" })).statusCode, 404);
    const key = randomUUID();
    const cancelled = await post(path, { reason: "  Digitado por error  " }, adminToken, key);
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().cancellationNote, "Digitado por error");
    assert.equal(cancelled.json().cancelledBy, admin.id);
    assert.equal(cancelled.json().receiptToken, undefined);
    assert.deepEqual((await post(path, { reason: "  Digitado por error  " }, adminToken, key)).json(), cancelled.json());
    const again = await post(path, { reason: "No sobrescribir el motivo original" });
    assert.equal(again.json().cancellationNote, "Digitado por error");
    let state = await store.read();
    assert.equal(state.movementCancellations.length, 1);
    assert.equal(state.charges[0].collected, 440000);
    assert.equal(state.charges[0].status, "partial");
    const original = state.movements.find((item) => item.id === first.id)!;
    for (const field of ["id", "amount", "createdAt", "collectorId", "chargeId", "actorId", "receiptToken"] as const) assert.equal(original[field], first[field]);
    assert.equal((await app.inject(`/api/recibos/${first.receiptToken}`)).statusCode, 404);
    assert.equal((await app.inject(`/api/recibos/${first.receiptToken}/escpos`)).statusCode, 404);
    assert.equal(snapshot(state, admin).movements.find((item) => item.id === first.id)?.receiptToken, undefined);
    await post(`/api/cobros/${second.id}/cancelar`, { reason: "Corregir recibo" });
    state = await store.read();
    assert.equal(state.charges[0].collected, 0);
    assert.equal(state.charges[0].status, "pending");
    assert.equal(preview(state, "col-1").collected, 0);
    assert.equal(snapshot(state, admin).totals.collected, 0);
    assert.equal(snapshot(state, admin).history.at(-1)?.collected, 0);
    assert.equal(clientStatement(state, admin, "cli-1").resumen.totalCobrado, 0);
    assert.equal((await post("/api/cobros", { chargeId: "chg-1", amount: 450000 }, collectorToken)).statusCode, 200);
  } finally { await app.close(); }
});

test("payment and delivery cancellation preserve cash availability and restore payout authorization", async () => {
  const { app, store, post } = await setup();
  try {
    const delivery = (await post("/api/entregas", { collectorId: "col-1", amount: 200000 })).json().movement as Movement;
    const payment = (await post("/api/pagos", { payoutId: "pay-1", amount: 200000 })).json().movement as Movement;
    assert.equal(payment.registeredCentrally, true);
    assert.equal((await post(`/api/entregas/${delivery.id}/cancelar`, { reason: "Error" })).json().error.code, "INSUFFICIENT_PAYOUT_CASH");
    assert.equal((await store.read()).movementCancellations.length, 0);
    const results = await Promise.all([post(`/api/pagos/${payment.id}/cancelar`, { reason: "Pago equivocado" }), post(`/api/pagos/${payment.id}/cancelar`, { reason: "Pago equivocado" })]);
    assert.ok(results.every((response) => response.statusCode === 200));
    let state = await store.read();
    assert.equal(state.movementCancellations.length, 1);
    assert.equal(state.payouts[0].paid, 0);
    assert.equal(state.payouts[0].status, "pending");
    assert.equal(preview(state, "col-1").paidToClients, 0);
    assert.equal(snapshot(state, admin).history.at(-1)?.paid, 0);
    assert.equal((await app.inject(`/api/recibos/${payment.receiptToken}`)).statusCode, 404);
    assert.equal((await post(`/api/entregas/${delivery.id}/cancelar`, { reason: "Se retiró la entrega" })).statusCode, 200);
    state = await store.read();
    assert.equal(preview(state, "col-1").difference, 0);
    assert.equal(state.movements.length, 2);
    assert.equal(state.movementCancellations.length, 2);
    assert.equal((await post("/api/cuadres", { collectorId: "col-1", date: businessDate() })).statusCode, 200);
  } finally { await app.close(); }
});

test("cancellation refuses deposited cash, payout overflow, closed or earlier days without changing state", () => {
  const now = new Date("2026-09-29T12:00:00.000Z"), state = fixture();
  const collection = postMovement(state, collector, "collection", { chargeId: "chg-1", amount: 10000 }, now);
  postMovement(state, admin, "deposit", { collectorId: "col-1", amount: 10000 }, now);
  const depositedState = structuredClone(state);
  assert.throws(() => cancelMovement(state, admin, collection.id, "collection", "Error", now), { code: "INSUFFICIENT_COLLECTION_CASH" });
  assert.deepEqual(state, depositedState);
  closeDay(state, admin, "col-1", businessDate(now), now);
  const closedState = structuredClone(state);
  assert.throws(() => cancelMovement(state, admin, collection.id, "collection", "Error", now), { code: "DAY_CLOSED" });
  assert.deepEqual(state, closedState);
  const old = fixture();
  const oldMovement = postMovement(old, collector, "collection", { chargeId: "chg-1", amount: 10000 }, new Date("2026-09-28T12:00:00Z"));
  const oldBefore = structuredClone(old);
  assert.throws(() => cancelMovement(old, admin, oldMovement.id, "collection", "Error", now), { code: "CANCELLATION_DAY_MISMATCH" });
  assert.deepEqual(old, oldBefore);
  const limits = fixture();
  limits.collectors[0].payoutLimit = 200000;
  postMovement(limits, admin, "office_delivery", { collectorId: "col-1", amount: 200000 }, now);
  const payment = postMovement(limits, collector, "payout", { payoutId: "pay-1", amount: 200000 }, now);
  postMovement(limits, admin, "office_delivery", { collectorId: "col-1", amount: 200000 }, now);
  const limitBefore = structuredClone(limits);
  assert.throws(() => cancelMovement(limits, admin, payment.id, "payout", "Error", now), { code: "PAYOUT_LIMIT" });
  assert.deepEqual(limits, limitBefore);
});

test("FileStore loads old files and retains central provenance, cancellations and balances after reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-movement-test-"));
  const path = join(directory, "synthetic-state.json");
  const legacy = fixture();
  delete (legacy as Partial<State>).movementCancellations;
  await writeFile(path, JSON.stringify(legacy));
  const store = await FileStore.open(path, fixture());
  const movement = await store.transaction((state) => createCentralCollections(state, admin, { clientId: "cli-1", collectorId: "col-1", lines: [{ chargeId: "chg-1", amount: 10000 }] })[0]);
  await store.transaction((state) => cancelMovement(state, admin, movement.id, "collection", "Reabrir saldo"));
  await store.close();
  const reopened = await FileStore.open(path, fixture());
  try {
    const state = await reopened.read();
    assert.equal(state.movementCancellations.length, 1);
    assert.equal(state.movements[0].registeredCentrally, true);
    assert.equal(state.movements[0].cancellationNote, "Reabrir saldo");
    assert.equal(state.charges[0].status, "pending");
    assert.equal(preview(state, "col-1").collected, 0);
    assert.equal(JSON.parse(await readFile(path, "utf8")).movementCancellations[0].actorId, admin.id);
  } finally { await reopened.close(); await unlink(path); await rmdir(directory); }
});

test("PostgreSQL movement lifecycle survives reread and protects typed references and append-only events", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["/cyp_remittances_backend", "/cyp_remittances_backend_install_20260928"].includes(new URL(url).pathname), "Use only the approved disposable synthetic databases.");
  const store = new PostgresStore(url), other = new PostgresStore(url);
  const prefix = `movement-test-${randomUUID()}`, now = new Date();
  const ids = { collector: `${prefix}-collector`, route: `${prefix}-route`, client: `${prefix}-client`, charge: `${prefix}-charge`, payout: `${prefix}-payout` };
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await store.transaction((state) => {
      const sample = fixture();
      state.collectors.push({ ...sample.collectors[0], id: ids.collector, routeId: ids.route });
      state.routes.push({ ...sample.routes[0], id: ids.route, collectorId: ids.collector });
      state.clients.push({ ...sample.clients[0], id: ids.client, code: `${prefix}-code`, routeId: ids.route });
      state.charges.push({ ...sample.charges[0], id: ids.charge, clientId: ids.client });
      state.payouts.push({ ...sample.payouts[0], id: ids.payout, clientId: ids.client, collectorId: ids.collector });
    });
    const movements = await store.transaction((state) => {
      const collection = createCentralCollections(state, admin, { clientId: ids.client, collectorId: ids.collector, lines: [{ chargeId: ids.charge, amount: 10000 }] }, now)[0];
      const delivery = postMovement(state, admin, "office_delivery", { collectorId: ids.collector, amount: 10000 }, now);
      const payment = postMovement(state, admin, "payout", { payoutId: ids.payout, amount: 10000 }, now);
      return { collection, delivery, payment };
    });
    const before = (await client.query("SELECT * FROM collections WHERE id=$1", [movements.collection.id])).rows[0];
    await Promise.all([
      store.transaction((state) => cancelMovement(state, admin, movements.collection.id, "collection", "Corrección", now)),
      other.transaction((state) => cancelMovement(state, admin, movements.collection.id, "collection", "Corrección", now)),
    ]);
    await store.transaction((state) => {
      cancelMovement(state, admin, movements.payment.id, "payout", "Corrección", now);
      cancelMovement(state, admin, movements.delivery.id, "office_delivery", "Corrección", now);
    });
    const state = await other.read();
    assert.equal(state.movementCancellations.filter((event) => event.movementId === movements.collection.id).length, 1);
    for (const movement of Object.values(movements)) assert.equal(state.movements.find((item) => item.id === movement.id)?.cancellationNote, "Corrección");
    assert.equal(state.movements.find((item) => item.id === movements.collection.id)?.registeredCentrally, true);
    assert.equal(state.movements.find((item) => item.id === movements.payment.id)?.registeredCentrally, true);
    assert.equal(state.charges.find((item) => item.id === ids.charge)?.status, "pending");
    assert.equal(state.payouts.find((item) => item.id === ids.payout)?.paid, 0);
    assert.equal(preview(state, ids.collector).difference, 0);
    assert.deepEqual((await client.query("SELECT * FROM collections WHERE id=$1", [movements.collection.id])).rows[0], before);
    await assert.rejects(client.query("UPDATE movement_cancellations SET reason='changed' WHERE movement_id=$1", [movements.collection.id]), /append-only/);
    await assert.rejects(client.query("DELETE FROM movement_cancellations WHERE movement_id=$1", [movements.collection.id]), /append-only/);
    await assert.rejects(client.query("INSERT INTO movement_cancellations(id,movement_id,movement_type,reason,actor_id) VALUES($1,$2,'payout','Invalid source',$3)", [randomUUID(), movements.collection.id, admin.id]), /foreign key/);
    await assert.rejects(client.query("INSERT INTO movement_cancellations(id,movement_id,movement_type,reason,actor_id) VALUES($1,$2,'collection','Duplicate',$3)", [randomUUID(), movements.collection.id, admin.id]), /unique constraint/);
  } finally { await client.end(); await store.close(); await other.close(); }
});
