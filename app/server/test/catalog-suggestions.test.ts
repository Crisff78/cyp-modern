import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";

async function setup(t: TestContext) {
  const state = seed();
  const collector = state.collectors.find((row) => row.id === "col-1")!;
  Object.assign(collector, { name: "Cobrador sintético de límites", ident: "QA-LIMIT-001", cellular: "+1-809-555-0101", accountId: "QA-ACCOUNT", lat: 18.5, lng: -69.9 });
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-catalog-suggestions-secret-32-characters", origins: ["http://localhost:5173"], collectorUrl: "http://localhost:5174" });
  t.after(() => app.close());
  const login = async (email: string) => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } });
    assert.equal(response.statusCode, 200);
    return response.json().token as string;
  };
  const adminToken = await login("admin@cyp.local"), collectorToken = await login("collector@cyp.local");
  const post = (body: unknown, options: { id?: string; token?: string | null; key?: string | null } = {}) => app.inject({
    method: "POST", url: `/api/cobradores/${options.id ?? "col-1"}/limites`, payload: body as object,
    headers: { ...(options.token === null ? {} : { authorization: `Bearer ${options.token ?? adminToken}` }), ...(options.key === null ? {} : { "idempotency-key": options.key ?? randomUUID() }) },
  });
  const financialAndIdentity = async () => {
    const current = await store.read();
    return structuredClone({ collectors: current.collectors, routes: current.routes, zones: current.zones, charges: current.charges, payouts: current.payouts, movements: current.movements, accounts: current.accounts });
  };
  const postService = (body: unknown, rowId?: string) => app.inject({ method: "POST", url: `/api/servicios${rowId ? `/${rowId}` : ""}`, payload: body as object, headers: { authorization: `Bearer ${adminToken}`, "idempotency-key": randomUUID() } });
  return { app, store, collectorToken, post, postService, financialAndIdentity };
}

test("collector limits update only the two limits, preserving identity, relationships and financial records", async (t) => {
  const env = await setup(t), before = await env.financialAndIdentity();
  const response = await env.post({ collectionLimit: 230_001, payoutLimit: 140_002 });
  assert.equal(response.statusCode, 200, response.body);
  const after = await env.financialAndIdentity();
  const original = before.collectors.find((row) => row.id === "col-1")!;
  const expected = { ...original, collectionLimit: 230_001, payoutLimit: 140_002 };
  assert.deepEqual(response.json(), expected);
  assert.deepEqual(after, { ...before, collectors: before.collectors.map((row) => row.id === "col-1" ? expected : row) });
});

test("collector limits reject extra identity, activity and relationship fields without changing state", async (t) => {
  const env = await setup(t), before = await env.financialAndIdentity();
  for (const extra of [{ name: "Otro nombre" }, { ident: "OTHER" }, { cellular: "OTHER" }, { accountId: "OTHER" }, { active: false }, { routeId: "route-2" }, { lat: 0 }, { deviceId: "OTHER" }]) {
    const response = await env.post({ collectionLimit: 100_000, payoutLimit: 100_000, ...extra });
    assert.equal(response.statusCode, 400);
  }
  assert.deepEqual(await env.financialAndIdentity(), before);
});

test("collector limits require both positive integer amounts within the existing limit range", async (t) => {
  const env = await setup(t), before = await env.financialAndIdentity();
  for (const body of [{}, { collectionLimit: 100 }, { payoutLimit: 100 }, ...[0, -1, 1.1, "100", 1_000_000_001, Number.MAX_SAFE_INTEGER + 1].flatMap((invalid) => [{ collectionLimit: invalid, payoutLimit: 100 }, { collectionLimit: 100, payoutLimit: invalid }])]) {
    const response = await env.post(body);
    assert.equal(response.statusCode, 400);
  }
  assert.deepEqual(await env.financialAndIdentity(), before);
  const boundary = await env.post({ collectionLimit: 1, payoutLimit: 1_000_000_000 });
  assert.equal(boundary.statusCode, 200);
});

test("collector limits enforce session, existing collector, admin role and idempotency key", async (t) => {
  const env = await setup(t), body = { collectionLimit: 100_000, payoutLimit: 200_000 }, before = await env.financialAndIdentity();
  assert.equal((await env.post(body, { token: null })).statusCode, 401);
  assert.equal((await env.post(body, { token: env.collectorToken })).statusCode, 403);
  assert.equal((await env.post(body, { id: "synthetic-missing-collector" })).statusCode, 404);
  const noKey = await env.post(body, { key: null });
  assert.equal(noKey.statusCode, 400);
  assert.equal(noKey.json().error.code, "IDEMPOTENCY_REQUIRED");
  assert.deepEqual(await env.financialAndIdentity(), before);
});

test("collector limits replay the same intent and reject changed payload under its key", async (t) => {
  const env = await setup(t), key = randomUUID(), body = { collectionLimit: 200_001, payoutLimit: 300_002 };
  const first = await env.post(body, { key });
  assert.equal(first.statusCode, 200);
  const confirmed = await env.financialAndIdentity();
  const replay = await env.post(body, { key });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body, first.body);
  assert.deepEqual(await env.financialAndIdentity(), confirmed);
  const collision = await env.post({ ...body, collectionLimit: 999_999 }, { key });
  assert.equal(collision.statusCode, 409);
  assert.deepEqual(await env.financialAndIdentity(), confirmed);
});

test("collector limits A to B to A with distinct confirmed intents persist the final A", async (t) => {
  const env = await setup(t), a = { collectionLimit: 310_000, payoutLimit: 410_000 }, b = { collectionLimit: 320_000, payoutLimit: 420_000 };
  const keys = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, body] of [a, b, a].entries()) {
    const response = await env.post(body, { key: keys[index] });
    assert.equal(response.statusCode, 200);
    const saved = (await env.store.read()).collectors.find((row) => row.id === "col-1")!;
    assert.equal(saved.collectionLimit, body.collectionLimit);
    assert.equal(saved.payoutLimit, body.payoutLimit);
  }
});

const serviceBase = { service: "Servicio informativo sintético", abbr: "QA-REF", caption: "Referencias manuales", obligated: false, active: true, fixedAmount: false };
test("service manual references persist explicit currency, exact cents and operator units without financial effects", async (t) => {
  const env = await setup(t), before = await env.financialAndIdentity();
  const input = { ...serviceBase, referencePriceCents: 12345, referenceCurrency: "USD", taxReference: "  18 % anotado  ", benefitReference: "  20 USD por unidad  ", referenceQuantity: "  2 unidades  " };
  const saved = await env.postService(input);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json(), { ...input, id: saved.json().id, taxReference: "18 % anotado", benefitReference: "20 USD por unidad", referenceQuantity: "2 unidades" });
  assert.deepEqual(await env.financialAndIdentity(), before);
  const zero = await env.postService({ ...serviceBase, referencePriceCents: 0, referenceCurrency: "DOP" }, saved.json().id);
  assert.equal(zero.statusCode, 200, zero.body);
  assert.equal(zero.json().referencePriceCents, 0);
  assert.deepEqual(await env.financialAndIdentity(), before);
});

test("service manual references preserve omitted fields, clear with null and leave historical blanks empty", async (t) => {
  const env = await setup(t);
  const initial = await env.postService(serviceBase);
  assert.equal(initial.statusCode, 200, initial.body);
  for (const key of ["referencePriceCents", "referenceCurrency", "taxReference", "benefitReference", "referenceQuantity"]) assert.equal(Object.hasOwn(initial.json(), key), false);
  const rowId = initial.json().id;
  const refs = { referencePriceCents: 1_000_000_000, referenceCurrency: "EUR", taxReference: "No aplica", benefitReference: "5 EUR", referenceQuantity: "1 lote" };
  assert.equal((await env.postService({ ...serviceBase, ...refs }, rowId)).statusCode, 200);
  const omitted = await env.postService(serviceBase, rowId);
  assert.equal(omitted.statusCode, 200);
  for (const [key, value] of Object.entries(refs)) assert.equal(omitted.json()[key], value);
  const halfClear = await env.postService({ ...serviceBase, referenceCurrency: null }, rowId);
  assert.equal(halfClear.statusCode, 422);
  assert.equal(halfClear.json().error.code, "SERVICE_REFERENCE_PAIR");
  const clear = Object.fromEntries(Object.keys(refs).map((key) => [key, null]));
  const cleared = await env.postService({ ...serviceBase, ...clear }, rowId);
  assert.equal(cleared.statusCode, 200, cleared.body);
  for (const key of Object.keys(refs)) assert.equal(cleared.json()[key], null);
});

test("service manual references reject missing currency, unsafe prices and invalid annotations atomically", async (t) => {
  const env = await setup(t), before = structuredClone(await env.store.read());
  const invalid: Array<Record<string, unknown>> = [
    { referencePriceCents: 100 }, { referenceCurrency: "DOP" },
    ...[-1, 1.5, "1", 1_000_000_001, Number.MAX_SAFE_INTEGER + 1].map((value) => ({ referencePriceCents: value, referenceCurrency: "USD" })),
    { referencePriceCents: 100, referenceCurrency: "JPY" },
    { taxReference: " " }, { taxReference: "x".repeat(161) }, { benefitReference: "x".repeat(161) },
    { referenceQuantity: "x".repeat(65) }, { referenceQuantity: 2 }, { inventory: 2 },
  ];
  for (const reference of invalid) {
    const response = await env.postService({ ...serviceBase, ...reference });
    assert([400, 422].includes(response.statusCode), response.body);
    const after = await env.store.read();
    assert.deepEqual(after.services, before.services);
    assert.deepEqual(await env.financialAndIdentity(), { collectors: before.collectors, routes: before.routes, zones: before.zones, charges: before.charges, payouts: before.payouts, movements: before.movements, accounts: before.accounts });
  }
});
