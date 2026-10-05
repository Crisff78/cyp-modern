import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { FileStore, MemoryStore, PostgresStore, type Store } from "../src/store.js";
import { businessDate, clientStatement, closeDay, ledgerCurrency, postMovement, preview, snapshot, type State, type User } from "../src/domain.js";

const admin: User = { id: "demo-admin", name: "QA", role: "admin" };
function fixture() {
  const state = seed();
  state.movements = [];
  state.settlements = [];
  return state;
}
async function setup(initial: State | Store = fixture()) {
  const store = "transaction" in initial ? initial : new MemoryStore(initial);
  const app = await buildApp({ store, secret: "synthetic-fix27-tests-only-secret-2026", demo: true, origins: [], collectorUrl: "http://localhost:5174" });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } })).json().token as string;
  const post = (url: string, payload: Record<string, unknown>, key = randomUUID()) => app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  return { app, store, token, post };
}

test("CYP-QA-015 ESC/POS 58/80 uses the Dominican business date across UTC midnight", async () => {
  const state = fixture();
  const movement = postMovement(state, admin, "collection", { chargeId: "chg-1", amount: 1234 }, new Date("2026-10-02T02:00:00Z"));
  const { app } = await setup(state);
  try {
    for (const width of [58, 80]) {
      const response = await app.inject(`/api/recibos/${movement.receiptToken}/escpos?width=${width}`);
      assert.equal(response.statusCode, 200);
      const printable = response.rawPayload.toString("ascii");
      assert.match(printable, /\n2026-10-01\n/);
      assert.doesNotMatch(printable, /\n2026-10-02\n/);
      assert.match(printable, /RD\$ 12\.34/);
      assert.match(response.headers["content-disposition"] as string, new RegExp(`${width}mm`));
    }
  } finally { await app.close(); }
});

test("CYP-QA-025 oversized JSON returns an actionable 413 and writes nothing", async () => {
  const { app, store, post } = await setup();
  try {
    const before = await store.read();
    const response = await post("/api/cargos/importar", { filas: [{ identificacion: "1", servicio: "X".repeat(70_000), importe: 100 }] });
    assert.equal(response.statusCode, 413, response.body);
    assert.equal(response.json().error.code, "PAYLOAD_TOO_LARGE");
    assert.match(response.json().error.message, /65536|64\s*KiB/);
    assert.deepEqual(await store.read(), before);
  } finally { await app.close(); }
});

test("CYP-QA-039 financial API creates native USD/EUR obligations without conversion", async () => {
  const { app, post } = await setup();
  try {
    for (const currency of ["USD", "EUR"]) {
      const charge = await post("/api/cargos", { clientId: "cli-1", service: "QA", currency, amount: 12345, dueDate: businessDate() });
      assert.equal(charge.statusCode, 200, charge.body);
      assert.equal(charge.json().amount, 12345);
      assert.equal(charge.json().currency, currency);
      const payout = await post("/api/descargos", { clientId: "cli-1", collectorId: "col-1", concept: "QA", currency, amount: 23456 });
      assert.equal(payout.statusCode, 200, payout.body);
      assert.equal(payout.json().currency, currency);
      assert.equal(payout.json().amount, 23456);
    }
  } finally { await app.close(); }
});

test("CYP-QA-039 native balances, partial payments, retries and cancellations remain isolated", async () => {
  const { app, store, post } = await setup();
  try {
    const dop = await post("/api/entregas", { collectorId: "col-1", amount: 45678 });
    assert.equal(dop.statusCode, 200, dop.body);
    for (const currency of ["USD", "EUR"] as const) {
      const payout = (await post("/api/descargos", { clientId: "cli-1", collectorId: "col-1", concept: "QA nativo", currency, amount: 12345 })).json();
      const body = { clientId: "cli-1", collectorId: "col-1", currency, lines: [{ payoutId: payout.id, amount: 2345 }] };
      const unfunded = await post("/api/pagos/central", body);
      assert.equal(unfunded.statusCode, 409);
      assert.equal(unfunded.json().error.code, "INSUFFICIENT_PAYOUT_CASH");
      const delivery = await post("/api/entregas", { collectorId: "col-1", currency, amount: 12345 });
      assert.equal(delivery.statusCode, 200, delivery.body);
      const key = randomUUID();
      const [paid, replay] = await Promise.all([post("/api/pagos/central", body, key), post("/api/pagos/central", body, key)]);
      assert.equal(paid.statusCode, 200, paid.body);
      assert.deepEqual(paid.json(), replay.json());
      const movement = paid.json().movements[0];
      assert.equal(movement.currency, currency);
      assert.equal(movement.amount, 2345);
      assert.equal((await store.read()).movements.filter((row) => row.payoutId === payout.id).length, 1);
      const state = await store.read();
      assert.equal(state.payouts.find((row) => row.id === payout.id)?.status, "partial");
      assert.equal(preview(state, "col-1", undefined, currency).paidToClients, 2345);
      assert.equal(preview(state, "col-1").officeDelivered, 45678);
      assert.equal(preview(state, "col-1").paidToClients, 0);
      const mismatched = await post("/api/pagos/central", { ...body, currency: "DOP" });
      assert.equal(mismatched.statusCode, 422);
      assert.equal(mismatched.json().error.code, "CURRENCY_MISMATCH");
      const receipt = (await app.inject(`/api/recibos/${movement.receiptToken}`)).json();
      assert.equal(receipt.currency, currency);
      assert.equal(receipt.businessDate, businessDate(new Date(movement.createdAt)));
      for (const width of [58, 80]) {
        const printable = (await app.inject(`/api/recibos/${movement.receiptToken}/escpos?width=${width}`)).rawPayload.toString("ascii");
        assert.match(printable, new RegExp(`${currency} 23\\.45`));
        assert.doesNotMatch(printable, /RD\$/);
      }
      const cancelled = await post(`/api/pagos/${movement.id}/cancelar`, { reason: "QA sintético" });
      assert.equal(cancelled.statusCode, 200, cancelled.body);
      assert.equal(preview(await store.read(), "col-1", undefined, currency).paidToClients, 0);
      assert.equal((await store.read()).payouts.find((row) => row.id === payout.id)?.status, "pending");
      const cancelledReplay = await post("/api/pagos/central", body, key);
      assert.deepEqual(cancelledReplay.json(), paid.json());
      assert.equal(preview(await store.read(), "col-1", undefined, currency).paidToClients, 0);
    }
  } finally { await app.close(); }
});

test("CYP-QA-039 native collection/deposit lifecycle, currency limits and collector DOP scope", async () => {
  const { app, store, post } = await setup();
  try {
    const collectorToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "collector@cyp.local", password: "Demo-CyP-2026!" } })).json().token;
    for (const currency of ["USD", "EUR"] as const) {
      const charge = (await post("/api/cargos", { clientId: "cli-1", service: "QA", concept: "Concepto separado", currency, amount: 12345, dueDate: businessDate() })).json();
      const body = { clientId: "cli-1", collectorId: "col-1", currency, lines: [{ chargeId: charge.id, amount: 12345 }] };
      const collection = await post("/api/cobros/central", body);
      assert.equal(collection.statusCode, 200, collection.body);
      const movement = collection.json().movements[0];
      assert.equal(movement.currency, currency);
      const receipt = (await app.inject(`/api/recibos/${movement.receiptToken}`)).json();
      assert.equal(receipt.concept, "Concepto separado");
      assert.equal(receipt.currency, currency);
      const wrong = await post("/api/depositos", { collectorId: "col-1", currency: "DOP", amount: 12345 });
      assert.equal(wrong.statusCode, 409);
      const brokenBreakdown = await post("/api/depositos", { collectorId: "col-1", currency, amount: 12345, denominations: [{ denominacion: 100, cantidad: 1 }] });
      assert.equal(brokenBreakdown.statusCode, 422);
      const deposit = await post("/api/depositos", { collectorId: "col-1", currency, amount: 12345, note: "QA", denominations: [{ denominacion: 12345, cantidad: 1 }] });
      assert.equal(deposit.statusCode, 200, deposit.body);
      assert.equal(preview(await store.read(), "col-1", undefined, currency).difference, 0);
      assert.equal(deposit.json().movement.note, "QA");
      assert.deepEqual(deposit.json().movement.denominations, [{ denominacion: 12345, cantidad: 1 }]);
      assert.equal((await post(`/api/depositos/${deposit.json().movement.id}/cancelar`, {})).statusCode, 200);
      assert.equal(preview(await store.read(), "col-1", undefined, currency).difference, 12345);
      const forbidden = await app.inject({ method: "POST", url: "/api/cobros", payload: { chargeId: charge.id, amount: 1 }, headers: { authorization: `Bearer ${collectorToken}`, "idempotency-key": randomUUID() } });
      assert.equal(forbidden.statusCode, 422);
      assert.equal(forbidden.json().error.code, "UNSUPPORTED_COLLECTOR_CURRENCY");
      const collectorSnapshot = (await app.inject({ url: "/api/snapshot", headers: { authorization: `Bearer ${collectorToken}` } })).json();
      assert.ok(collectorSnapshot.charges.every((row: { currency: string }) => row.currency === "DOP"));
      assert.ok(collectorSnapshot.movements.every((row: { currency: string }) => row.currency === "DOP"));
      const adminSnapshot = snapshot(await store.read(), admin);
      assert.equal(adminSnapshot.totals.collected, 0);
      assert.equal(adminSnapshot.totalsByCurrency[currency].collected, 12345);
    }
    await store.transaction((state) => {
      state.collectors[0].collectionLimit = 12345;
      state.charges.push({ ...state.charges[0], id: "usd-limit", amount: 1, currency: "USD", collected: 0, status: "pending" });
    });
    const limit = await post("/api/cobros", { chargeId: "usd-limit", amount: 1 });
    assert.equal(limit.statusCode, 409);
    assert.equal(limit.json().error.code, "COLLECTION_LIMIT");
    assert.equal(preview(await store.read(), "col-1").collected, 0);
  } finally { await app.close(); }
});

test("CYP-QA-039 day closure never nets one currency against another or changes old DOP movements", () => {
  const state = fixture();
  state.movements = [
    { id: "legacy", type: "office_delivery", amount: 200, collectorId: "col-1", createdAt: new Date().toISOString(), actorId: admin.id },
    { id: "usd", type: "collection", amount: 200, currency: "USD", collectorId: "col-1", createdAt: new Date().toISOString(), actorId: admin.id },
    { id: "eur", type: "payout", amount: 200, currency: "EUR", collectorId: "col-1", createdAt: new Date().toISOString(), actorId: admin.id },
  ];
  assert.equal(preview(state, "col-1").officeDelivered, 200);
  assert.equal(preview(state, "col-1", undefined, "USD").collected, 200);
  assert.throws(() => closeDay(state, admin, "col-1", businessDate()), /cada moneda/);
  assert.equal(state.settlements.length, 0);
  assert.equal(state.movements[0].currency, undefined);
});

test("CYP-QA-039 legacy foreign labels with DOP ledger are explicit conflicts, never converted or consumed", async () => {
  const state = fixture();
  state.charges[0] = { ...state.charges[0], currency: "USD", amount: 20000, collected: 5000, status: "partial" };
  state.movements.push({ id: "legacy-dop-collection", collectorId: "col-1", clientId: "cli-1", chargeId: "chg-1", type: "collection", amount: 5000, createdAt: new Date().toISOString(), actorId: admin.id });
  const { app, store, post } = await setup(state);
  try {
    const before = await store.read();
    const projected = snapshot(before, admin);
    const charge = projected.charges.find((row) => row.id === "chg-1")!;
    assert.equal(charge.currency, "USD");
    assert.equal(charge.collected, 5000); // Preserve the original stored aggregate for review.
    assert.equal(charge.currencyConflict, true);
    assert.deepEqual(charge.collectedByCurrency, { DOP: 5000, USD: 0, EUR: 0 });
    assert.equal(projected.totalsByCurrency.DOP.collected, 5000);
    assert.equal(projected.totalsByCurrency.USD.collected, 0);
    const statement = clientStatement(before, admin, "cli-1");
    assert.equal(statement.resumenByCurrency.USD.totalCargado, 0);
    assert.equal(statement.resumenByCurrency.USD.totalPendiente, 0);
    assert.equal(statement.currencyConflicts[0].id, "chg-1");
    const attempt = await post("/api/cobros", { chargeId: "chg-1", amount: 5000 });
    assert.equal(attempt.statusCode, 409);
    assert.equal(attempt.json().error.code, "LEGACY_CURRENCY_RECONCILIATION_REQUIRED");
    const edit = await post("/api/cargos/chg-1", { clientId: "cli-1", service: "QA", amount: 20000, currency: "USD", dueDate: businessDate() });
    assert.equal(edit.statusCode, 409);
    assert.equal(edit.json().error.code, "LEGACY_CURRENCY_RECONCILIATION_REQUIRED");
    assert.deepEqual(await store.read(), before);
    assert.equal((await store.read()).movements[0].currency, undefined);
  } finally { await app.close(); }
});

test("CYP-QA-039 currency normalization accepts only declared names, including legacy labels", () => {
  assert.equal(ledgerCurrency("Peso Dominicano"), "DOP");
  assert.equal(ledgerCurrency("Dólar Estadounidense"), "USD");
  assert.equal(ledgerCurrency("Euro"), "EUR");
  for (const invalid of ["constructor", "toString", "__proto__", "GBP"])
    assert.throws(() => ledgerCurrency(invalid), /DOP, USD o EUR/);
});

test("CYP-QA-039 historical UI aliases stay supported and unsupported metadata cannot crash snapshots", () => {
  assert.equal(ledgerCurrency("Dólar Americano"), "USD");
  const state = fixture();
  state.charges[0] = { ...state.charges[0], currency: "Moneda histórica sin equivalencia", amount: 20000, collected: 5000, status: "partial" };
  state.movements.push({ id: "unknown-old-dop", collectorId: "col-1", clientId: "cli-1", chargeId: "chg-1", type: "collection", amount: 5000, createdAt: new Date().toISOString(), actorId: admin.id });
  const before = structuredClone(state);
  const projected = snapshot(state, admin);
  const charge = projected.charges.find((row) => row.id === "chg-1")!;
  assert.equal(charge.currency, "Moneda histórica sin equivalencia");
  assert.equal(charge.currencyConflict, true);
  assert.equal(charge.currencyUnsupported, true);
  assert.deepEqual(charge.collectedByCurrency, { DOP: 5000, USD: 0, EUR: 0 });
  const statement = clientStatement(state, admin, "cli-1");
  assert.ok(statement.currencyConflicts.some((row) => row.id === "chg-1"));
  assert.equal(statement.resumen.totalCobrado, 5000);
  assert.deepEqual(state, before);
});

test("CYP-QA-039 monitoring map exposes distinct currencies and its legacy scalar stays DOP", async () => {
  const initial = fixture();
  initial.clients[0].lat = 18.1;
  initial.clients[0].lng = -69.1;
  const { app, token, post } = await setup(initial);
  const map = () => app.inject({ url: "/api/monitoring/collector/col-1/map-data", headers: { authorization: `Bearer ${token}` } });
  try {
    const before = (await map()).json().stops.find((row: { id: string }) => row.id === "pcp-cli-1");
    for (const currency of ["USD", "EUR"]) {
      assert.equal((await post("/api/cargos", { clientId: "cli-1", service: "QA", currency, amount: 12345, dueDate: businessDate() })).statusCode, 200);
    }
    const stop = (await map()).json().stops.find((row: { id: string }) => row.id === "pcp-cli-1");
    assert.equal(stop.amount_due, before.amount_due);
    assert.equal(stop.amount_due_by_currency.DOP, before.amount_due);
    assert.equal(stop.amount_due_by_currency.USD, 123.45);
    assert.equal(stop.amount_due_by_currency.EUR, 123.45);
  } finally { await app.close(); }
});

test("CYP-QA-039 pending DOP retry across the currency upgrade keeps its old fingerprint and creates no second movement", async () => {
  const state = fixture(), key = randomUUID();
  const body = { collectorId: "col-1", amount: 12345 };
  const movement = postMovement(state, admin, "office_delivery", body);
  delete movement.currency; // Exact pre-016 representation.
  const response = { movement: JSON.parse(JSON.stringify(movement)) };
  state.idempotency.push({ id: `${admin.id}:${key}`, fingerprint: createHash("sha256").update(JSON.stringify({ path: "/api/entregas", body })).digest("hex"), response, createdAt: movement.createdAt });
  const { app, store, post } = await setup(state);
  try {
    const before = await store.read();
    const replay = await post("/api/entregas", body, key);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), response);
    assert.deepEqual(await store.read(), before);
    const changed = await post("/api/entregas", { ...body, currency: "USD" }, key);
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await store.read()).movements.length, 1);
  } finally { await app.close(); }
});

test("CYP-QA-039 pending charge retry preserves pre-upgrade legacy currency labels without creating another obligation", async () => {
  const state = fixture(), key = randomUUID();
  const body = { clientId: "cli-1", service: "QA", concept: "", currency: "Peso Dominicano", note: "", amount: 12345, dueDate: businessDate(), required: false };
  const charge = { id: "legacy-pending-charge", ...body, collected: 0, status: "pending" as const };
  state.charges.push(charge);
  state.idempotency.push({ id: `${admin.id}:${key}`, fingerprint: createHash("sha256").update(JSON.stringify({ path: "/api/cargos", body })).digest("hex"), response: structuredClone(charge), createdAt: new Date().toISOString() });
  const { app, store, post } = await setup(state);
  try {
    const before = await store.read();
    const replay = await post("/api/cargos", { clientId: "cli-1", service: "QA", amount: 12345, dueDate: body.dueDate }, key);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), charge);
    assert.deepEqual(await store.read(), before);
    assert.equal((await post("/api/cargos", { ...body, amount: 12346 }, key)).statusCode, 409);
  } finally { await app.close(); }
});

test("CYP-QA-039 a committed pre-upgrade central partial payment replays without debiting again", async () => {
  const state = fixture(), key = randomUUID();
  const payoutId = state.payouts[0].id;
  const body = { clientId: "cli-1", collectorId: "col-1", lines: [{ payoutId, amount: 2345 }] };
  const delivery = postMovement(state, admin, "office_delivery", { collectorId: "col-1", amount: 12345 });
  const payment = postMovement(state, admin, "payout", body.lines[0]);
  delete delivery.currency;
  delete payment.currency;
  const response = JSON.parse(JSON.stringify({ movements: [payment], receipts: [{ movementId: payment.id, token: payment.receiptToken, url: `http://localhost:5174/?receipt=${payment.receiptToken}` }] }));
  state.idempotency.push({ id: `${admin.id}:${key}`, fingerprint: createHash("sha256").update(JSON.stringify({ path: "/api/pagos/central", body })).digest("hex"), response, createdAt: payment.createdAt });
  const { app, store, post } = await setup(state);
  try {
    const before = await store.read();
    const replay = await post("/api/pagos/central", body, key);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), response);
    assert.deepEqual(await store.read(), before);
    assert.equal((await store.read()).payouts.find((row) => row.id === payoutId)?.paid, 2345);
    assert.equal((await post("/api/pagos/central", { ...body, currency: "USD" }, key)).statusCode, 409);
  } finally { await app.close(); }
});

test("CYP-QA-039 FileStore preserves old DOP records and native currencies after reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-fix27-native-currencies-"));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  const file = join(directory, "synthetic.json");
  let store: Store | undefined;
  try {
    const initial = fixture();
    initial.movements.push({ id: "legacy-file", collectorId: "col-1", type: "office_delivery", amount: 9876, createdAt: new Date().toISOString(), actorId: admin.id });
    await writeFile(file, JSON.stringify(initial));
    store = await FileStore.open(file, fixture());
    await store.transaction((state) => {
      state.payouts.push({ ...state.payouts[0], id: "eur-file", currency: "EUR", amount: 3456, paid: 0 });
      postMovement(state, admin, "office_delivery", { collectorId: "col-1", currency: "EUR", amount: 3456 });
      postMovement(state, admin, "payout", { payoutId: "eur-file", amount: 1234 });
    });
    await store.close();
    store = await FileStore.open(file, fixture());
    const saved = await store.read();
    assert.equal(saved.movements.find((row) => row.id === "legacy-file")?.currency, undefined);
    assert.equal(preview(saved, "col-1").officeDelivered, 9876);
    assert.equal(preview(saved, "col-1").paidToClients, 0);
    assert.equal(preview(saved, "col-1", undefined, "EUR").paidToClients, 1234);
    assert.equal(saved.payouts.find((row) => row.id === "eur-file")?.currency, "EUR");
    const onDisk = JSON.parse(await readFile(file, "utf8"));
    assert.equal(Object.hasOwn(onDisk.movements.find((row: { id: string }) => row.id === "legacy-file"), "currency"), false);
    assert.equal(onDisk.movements.find((row: { type: string }) => row.type === "payout").currency, "EUR");
  } finally {
    await store?.close();
    await unlink(file).catch(() => {});
    await rmdir(directory);
  }
});

test("PostgreSQL native financial currencies survive reopening and preserve immutable money", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const target = new URL(url);
  assert.equal(target.hostname, "127.0.0.1", "Only the disposable QA cluster is allowed.");
  assert.equal(target.port, "55435");
  assert.equal(target.pathname, "/cyp_remittances_backend");
  assert.match(target.username, /^qa_fix27_[a-f0-9]+$/);
  const store = new PostgresStore(url);
  const prefix = `native-${randomUUID()}`;
  const collectorId = `${prefix}-collector`, routeId = `${prefix}-route`, clientId = `${prefix}-client`;
  await store.transaction((state) => {
    if (state.collectors.length === 0) Object.assign(state, seed());
    state.collectors.push({ ...state.collectors[0], id: collectorId, routeId, active: true });
    state.routes.push({ ...state.routes[0], id: routeId, collectorId, active: true });
    state.clients.push({ ...state.clients[0], id: clientId, code: clientId, routeId, collectionPointId: randomUUID(), active: true });
  });
  const { app, post } = await setup(store);
  const sql = new pg.Client({ connectionString: url });
  const reread = new PostgresStore(url);
  try {
    await sql.connect();
    for (const currency of ["USD", "EUR"] as const) {
      const charge = (await post("/api/cargos", { clientId, service: "Moneda nativa QA", currency, amount: 4321, dueDate: businessDate() })).json();
      const cobro = await post("/api/cobros/central", { clientId, collectorId, currency, lines: [{ chargeId: charge.id, amount: 1234 }] });
      assert.equal(cobro.statusCode, 200, cobro.body);
      const receipt = cobro.json().movements[0];
      const payout = (await post("/api/descargos", { clientId, collectorId, concept: "QA", currency, amount: 4321 })).json();
      assert.equal((await post("/api/entregas", { collectorId, currency, amount: 4321 })).statusCode, 200);
      const body = { clientId, collectorId, currency, lines: [{ payoutId: payout.id, amount: 2345 }] }, key = randomUUID();
      const payment = await post("/api/pagos/central", body, key);
      assert.equal(payment.statusCode, 200, payment.body);
      assert.deepEqual((await post("/api/pagos/central", body, key)).json(), payment.json());
      const saved = await reread.read();
      assert.equal(saved.charges.find((row) => row.id === charge.id)?.currency, currency);
      assert.equal(saved.payouts.find((row) => row.id === payout.id)?.currency, currency);
      assert.equal(saved.payouts.find((row) => row.id === payout.id)?.dueDate, businessDate());
      assert.equal(saved.movements.find((row) => row.id === receipt.id)?.currency, currency);
      assert.equal(preview(saved, collectorId, undefined, currency).collected, 1234);
      assert.equal(preview(saved, collectorId, undefined, currency).paidToClients, 2345);
      assert.equal(preview(saved, collectorId).difference, 0);
      await assert.rejects(sql.query("UPDATE collections SET currency='DOP' WHERE id=$1", [receipt.id]), /immutable/);
      await assert.rejects(sql.query(`INSERT INTO collections(id,collector_id,client_id,charge_id,amount,collected_at,receipt_token,receipt_revoked,actor_id,registered_centrally,currency)
        SELECT $1,collector_id,client_id,charge_id,1,collected_at,$2,false,actor_id,true,'DOP' FROM collections WHERE id=$3`,
      [randomUUID(), randomUUID(), receipt.id]), /currency must match/i);
      assert.equal((await post(`/api/pagos/${payment.json().movements[0].id}/cancelar`, { reason: "QA" })).statusCode, 200);
      assert.equal(preview(await reread.read(), collectorId, undefined, currency).paidToClients, 0);
    }
  } finally {
    await sql.end();
    await reread.close();
    await app.close();
  }
});
