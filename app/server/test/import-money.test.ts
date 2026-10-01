import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { buildApp } from "../src/app.js";
import {
  businessDate,
  importCharges,
  importPayouts,
  MAX_MONEY_AMOUNT,
  type User,
} from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";

const admin: User = { id: "synthetic-import-admin", name: "Admin de prueba", role: "admin" };
const identification = "SINTETICO-IMPORT-MONEY";
const imports = [
  { path: "/api/cargos/importar", collection: "charges", label: "cargos" },
  { path: "/api/descargos/importar", collection: "payouts", label: "descargos" },
] as const;

function row(path: string, importe: unknown) {
  return path === "/api/cargos/importar"
    ? { identificacion: identification, servicio: "Servicio sintético", importe }
    : { identificacion: identification, concepto: "Concepto sintético", importe, cobrador: "col-1" };
}

async function setup(t: TestContext) {
  const state = seed();
  state.clients.find((client) => client.id === "cli-1")!.code = identification;
  const store = new MemoryStore(state);
  const app = await buildApp({
    store, secret: "synthetic-import-money-only-secret-2026", demo: true,
    origins: [], collectorUrl: "http://localhost:5174",
  });
  t.after(() => app.close());
  const login = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" },
  });
  assert.equal(login.statusCode, 200);
  const token = login.json().token as string;
  const post = (path: string, payload: unknown, key = randomUUID()) => app.inject({
    method: "POST", url: path, payload,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
  });
  return { post, store };
}

for (const { path, collection, label } of imports) {
  test(`${label}: import accepts exact monetary boundaries and preserves integer cents`, async (t) => {
    const { post, store } = await setup(t);
    const before = await store.read();
    const result = await post(path, { filas: [row(path, 1), row(path, MAX_MONEY_AMOUNT)] });
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(result.json(), { creados: 2, errores: [] });
    const after = await store.read();
    assert.deepEqual(after[collection].slice(0, before[collection].length), before[collection]);
    assert.deepEqual(after[collection].slice(before[collection].length).map((entry) => entry.amount), [1, MAX_MONEY_AMOUNT]);
    assert.deepEqual(after.movements, before.movements, "Importing obligations must not append ledger movements.");
  });

  test(`${label}: invalid money stays a per-row business error without unsafe or partial invalid writes`, async (t) => {
    const { post, store } = await setup(t);
    const before = await store.read();
    const invalid = [0, -1, 1.5, MAX_MONEY_AMOUNT + 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1];
    const payload = { filas: [row(path, 12345), ...invalid.map((amount) => row(path, amount))] };
    const key = randomUUID();
    const result = await post(path, payload, key);
    assert.equal(result.statusCode, 200, result.body);
    const summary = result.json();
    assert.equal(summary.creados, 1);
    assert.deepEqual(summary.errores.map((error: { fila: number }) => error.fila), [2, 3, 4, 5, 6, 7]);
    for (const error of summary.errores) {
      assert.match(error.mensaje, /entero seguro/);
      assert.match(error.mensaje, /1000000000 centavos/);
    }
    const committed = await store.read();
    assert.deepEqual(committed[collection].slice(0, before[collection].length), before[collection]);
    assert.equal(committed[collection].length, before[collection].length + 1);
    assert.equal(committed[collection].at(-1)?.amount, 12345);
    assert.deepEqual(committed.movements, before.movements);

    const replay = await post(path, payload, key);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), summary);
    assert.deepEqual(await store.read(), committed, "Replaying a partial import must not create the valid row again.");
  });

  test(`${label}: structurally invalid money rejects the whole import before a valid row is written`, async (t) => {
    const { post, store } = await setup(t);
    const before = await store.read();
    const result = await post(path, { filas: [row(path, 12345), row(path, "12500")] });
    assert.equal(result.statusCode, 400, result.body);
    const after = await store.read();
    assert.deepEqual(after.charges, before.charges);
    assert.deepEqual(after.payouts, before.payouts);
    assert.deepEqual(after.movements, before.movements);
  });
}

test("import domain rejects non-finite, fractional, unsafe and over-limit amounts for both obligation types", () => {
  const state = seed();
  state.clients.find((client) => client.id === "cli-1")!.code = identification;
  const before = structuredClone(state);
  const invalid = [NaN, Infinity, -Infinity, 0, -1, 1.5, MAX_MONEY_AMOUNT + 1, Number.MAX_SAFE_INTEGER + 1];
  const charges = importCharges(state, admin, invalid.map((importe) => ({
    identificacion: identification, servicio: "Servicio sintético", importe,
  })));
  const payouts = importPayouts(state, admin, invalid.map((importe) => ({
    identificacion: identification, concepto: "Concepto sintético", importe,
  })));
  assert.equal(charges.creados, 0);
  assert.equal(payouts.creados, 0);
  assert.equal(charges.errores.length, invalid.length);
  assert.equal(payouts.errores.length, invalid.length);
  assert.deepEqual(state, before);
});

test("individual charges and charge imports share the existing monetary maximum", async (t) => {
  const { post, store } = await setup(t);
  const before = await store.read();
  const accepted = await post("/api/cargos", {
    clientId: "cli-1", service: "Servicio límite sintético", amount: MAX_MONEY_AMOUNT,
    dueDate: businessDate(),
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const rejected = await post("/api/cargos", {
    clientId: "cli-1", service: "Servicio exceso sintético", amount: MAX_MONEY_AMOUNT + 1,
    dueDate: businessDate(),
  });
  assert.equal(rejected.statusCode, 400, rejected.body);
  const after = await store.read();
  assert.equal(after.charges.length, before.charges.length + 1);
  assert.equal(after.charges.at(-1)?.amount, MAX_MONEY_AMOUNT);
  assert.deepEqual(after.movements, before.movements);
});
