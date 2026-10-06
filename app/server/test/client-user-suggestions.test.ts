import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { buildApp } from "../src/app.js";
import { snapshot, type Client, type State } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";

const password = "Synthetic-user-2026!";
const actor = { id: "demo-admin", name: "Prueba", role: "admin" as const };
const clientBody = (client: Client) => ({
  name: client.name, code: client.code, phone: client.phone,
  address: client.address, routeId: client.routeId,
  alias: client.alias ?? "", sector: client.sector ?? "", cellular: client.cellular ?? "",
  email: client.email ?? "", note: client.note ?? "", identification: client.identification ?? "",
  ...(client.lat === undefined ? {} : { lat: client.lat, lng: client.lng }),
});
const accountBody = (overrides: Record<string, unknown> = {}) => ({
  name: "Cuenta sintética", email: "synthetic-preference@example.invalid", role: "collector",
  collectorId: "col-1", ...overrides,
});
async function setup(t: TestContext, initial: State = seed()) {
  const store = new MemoryStore(initial);
  const app = await buildApp({ store, secret: "synthetic-client-user-test-secret-at-least32", demo: true,
    origins: [], collectorUrl: "http://127.0.0.1:5174" });
  t.after(async () => { await app.close(); await store.close(); });
  const login = async (email: string, secret = password) => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: secret } });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().token as string;
  };
  const adminToken = await login("admin@cyp.local", "Demo-CyP-2026!");
  const collectorToken = await login("collector@cyp.local", "Demo-CyP-2026!");
  const post = (url: string, payload: object, key = randomUUID(), token = adminToken) =>
    app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  const get = (url: string, token = adminToken) =>
    app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  return { app, store, post, get, login, adminToken, collectorToken };
}

test("3.2 legacy clients expose DOP preference without changing stored rows or financial history", async (t) => {
  const initial = seed();
  delete initial.clients[0].preferredCurrency;
  initial.clients[1].preferredCurrency = "EUR";
  const { store, get } = await setup(t, initial);
  const before = await store.read();
  for (const url of ["/api/clientes", "/api/snapshot"]) {
    const response = await get(url);
    assert.equal(response.statusCode, 200, response.body);
    const clients = url.endsWith("snapshot") ? response.json().clients : response.json();
    assert.equal(clients.find((row: Client) => row.id === initial.clients[0].id).preferredCurrency, "DOP");
    assert.equal(clients.find((row: Client) => row.id === initial.clients[1].id).preferredCurrency, "EUR");
  }
  assert.deepEqual(await store.read(), before);
  const copy = structuredClone(initial);
  snapshot(copy, actor);
  assert.deepEqual(copy, initial);
});

test("3.2 client creation persists supported preferences, default DOP, and replay creates once", async (t) => {
  const { store, post } = await setup(t);
  for (const currency of [undefined, "DOP", "USD", "EUR"] as const) {
    const body = { name: "Cliente sintético", code: `PREF-${currency ?? "DEFAULT"}`, phone: "509 00 000 000",
      routeId: "route-1", identification: "DOC-SYNTHETIC", ...(currency ? { preferredCurrency: currency } : {}) };
    const key = randomUUID();
    const [created, replay] = await Promise.all([post("/api/clientes", body, key), post("/api/clientes", body, key)]);
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(created.json(), replay.json());
    assert.equal(created.json().preferredCurrency, currency ?? "DOP");
    const state = await store.read();
    assert.equal(state.clients.filter((row) => row.code === body.code).length, 1);
    assert.equal(state.clients.find((row) => row.id === created.json().id)?.preferredCurrency, currency ?? "DOP");
  }
});

test("3.2 invalid currency rejects client creation and editing without partial writes", async (t) => {
  const { store, post } = await setup(t);
  for (const currency of ["HTG", "usd", "", null, 1]) {
    const before = await store.read();
    const client = before.clients[0];
    for (const [url, body] of [
      ["/api/clientes", { name: "Inválido", code: randomUUID(), identification: "SYNTHETIC", routeId: "route-1" }],
      [`/api/clientes/${client.id}`, clientBody(client)],
    ] as const) {
      const response = await post(url, { ...body, preferredCurrency: currency });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().error.code, "VALIDATION");
      assert.deepEqual(await store.read(), before);
    }
  }
});

test("3.2 preference edits and omitted preferences preserve obligations, ledger and other client fields", async (t) => {
  const { store, post } = await setup(t);
  const before = await store.read();
  const client = before.clients[0];
  for (const currency of ["USD", "EUR", "DOP"] as const) {
    const response = await post(`/api/clientes/${client.id}`, { ...clientBody(client), preferredCurrency: currency });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().preferredCurrency, currency);
    const state = await store.read();
    assert.deepEqual(state.charges, before.charges);
    assert.deepEqual(state.payouts, before.payouts);
    assert.deepEqual(state.movements, before.movements);
    assert.deepEqual(state.remittances, before.remittances);
    assert.deepEqual(state.accounts, before.accounts);
  }
  await post(`/api/clientes/${client.id}`, { ...clientBody(client), preferredCurrency: "EUR" });
  const omitted = await post(`/api/clientes/${client.id}`, clientBody(client));
  assert.equal(omitted.statusCode, 200, omitted.body);
  assert.equal(omitted.json().preferredCurrency, "EUR");
  const persisted = (await store.read()).clients.find((row) => row.id === client.id)!;
  const reloaded = new MemoryStore(await store.read());
  t.after(() => reloaded.close());
  assert.equal((await reloaded.read()).clients.find((row) => row.id === client.id)?.preferredCurrency, "EUR");
  assert.equal(persisted.phone, client.phone);
  assert.equal(persisted.note, client.note ?? "");
});

test("3.2 shared phone numbers remain separate clients, not merged or made unique", async (t) => {
  const { store, post } = await setup(t);
  const phone = "509 00 000 000";
  for (const code of ["SYN-PHONE-A", "SYN-PHONE-B"]) {
    const response = await post("/api/clientes", { name: "Teléfono compartido", code, phone,
      routeId: "route-1", identification: "SYN-DOC", preferredCurrency: "USD" });
    assert.equal(response.statusCode, 200, response.body);
  }
  const clients = (await store.read()).clients.filter((row) => row.phone === phone);
  assert.equal(clients.length, 2);
  assert.notEqual(clients[0].id, clients[1].id);
});

test("2.9 account provisioning exposes informative fields without credential secrets, replay is stable", async (t) => {
  const { store, post, get } = await setup(t);
  const key = randomUUID();
  const body = accountBody({ password, nickname: "  Apodo sintético  ", note: "  Nota informativa  " });
  const created = await post("/api/usuarios", body, key);
  assert.equal(created.statusCode, 200, created.body);
  const replay = await post("/api/usuarios", body, key);
  assert.deepEqual(replay.json(), created.json());
  const row = created.json();
  assert.equal(row.nickname, "Apodo sintético");
  assert.equal(row.note, "Nota informativa");
  assert.equal(Object.hasOwn(row, "salt"), false);
  assert.equal(Object.hasOwn(row, "passwordHash"), false);
  for (const url of ["/api/usuarios", "/api/snapshot"]) {
    const response = await get(url);
    assert.equal(response.statusCode, 200, response.body);
    const accounts = url.endsWith("snapshot") ? response.json().accounts : response.json();
    assert.deepEqual(accounts.find((account: { id: string }) => account.id === row.id), row);
  }
  assert.equal((await store.read()).accounts.filter((account) => account.id === row.id).length, 1);
});

test("2.9 nickname and note edits preserve credentials, effective role, status and existing sessions", async (t) => {
  const { store, post, login, get } = await setup(t);
  const created = await post("/api/usuarios", accountBody({ password }));
  assert.equal(created.statusCode, 200, created.body);
  const accountId = created.json().id;
  const accountToken = await login(accountBody().email);
  const before = await store.read();
  const key = randomUUID();
  const body = accountBody({ nickname: "  Cobrador A  ", note: "  Nota A  " });
  const edited = await post(`/api/usuarios/${accountId}`, body, key);
  assert.equal(edited.statusCode, 200, edited.body);
  const replay = await post(`/api/usuarios/${accountId}`, body, key);
  assert.deepEqual(replay.json(), edited.json());
  const after = await store.read();
  const original = before.accounts.find((account) => account.id === accountId)!;
  const current = after.accounts.find((account) => account.id === accountId)!;
  for (const field of ["salt", "passwordHash", "credentialVersion", "status", "role", "collectorId", "email", "name", "createdAt"] as const)
    assert.equal(current[field], original[field], field);
  assert.equal(current.nickname, "Cobrador A");
  assert.equal(current.note, "Nota A");
  assert.deepEqual(after.adminTools.sessions, before.adminTools.sessions);
  assert.deepEqual(after.movements, before.movements);
  assert.equal((await get("/api/auth/me", accountToken)).statusCode, 200);
  const reloaded = new MemoryStore(after);
  t.after(() => reloaded.close());
  assert.deepEqual((await reloaded.read()).accounts, after.accounts);
});

test("2.9 omitted informative fields are preserved; explicit blanks clear only those fields", async (t) => {
  const { store, post } = await setup(t);
  const created = await post("/api/usuarios", accountBody({ password, nickname: "Apodo", note: "Nota existente" }));
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id;
  const omitted = await post(`/api/usuarios/${id}`, accountBody());
  assert.equal(omitted.statusCode, 200, omitted.body);
  assert.equal(omitted.json().nickname, "Apodo");
  assert.equal(omitted.json().note, "Nota existente");
  const before = (await store.read()).accounts.find((row) => row.id === id)!;
  const cleared = await post(`/api/usuarios/${id}`, accountBody({ nickname: "  ", note: "  " }));
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json().nickname, "");
  assert.equal(cleared.json().note, "");
  assert.equal(cleared.json().credentialVersion, before.credentialVersion);
});

test("2.9 invalid informative values and unknown security fields reject atomically", async (t) => {
  const { store, post } = await setup(t);
  const created = await post("/api/usuarios", accountBody({ password }));
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id;
  for (const invalid of [{ nickname: "x".repeat(121) }, { note: "x".repeat(1001) }, { nickname: null },
    { note: 99 }, { salt: "unexpected" }, { credentialVersion: 90 }, { status: "disabled" }]) {
    const before = await store.read();
    const response = await post(`/api/usuarios/${id}`, accountBody(invalid));
    assert.equal(response.statusCode, 400, response.body);
    assert.deepEqual(await store.read(), before);
  }
});

test("2.9 existing security edit still rotates version and revokes sessions", async (t) => {
  const { store, post, login, get } = await setup(t);
  const created = await post("/api/usuarios", accountBody({ password, nickname: "Apodo" }));
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id;
  const token = await login(accountBody().email);
  const original = (await store.read()).accounts.find((row) => row.id === id)!;
  const updated = await post(`/api/usuarios/${id}`, accountBody({ email: "synthetic-new@example.invalid", nickname: "Nuevo" }));
  assert.equal(updated.statusCode, 200, updated.body);
  const current = (await store.read()).accounts.find((row) => row.id === id)!;
  assert.equal(current.credentialVersion, original.credentialVersion + 1);
  assert.equal(current.passwordHash, original.passwordHash);
  assert.equal(current.salt, original.salt);
  assert.equal(current.role, original.role);
  assert.equal((await get("/api/auth/me", token)).statusCode, 401);
});

test("2.8 approved three-character minimum applies to provisioning and reset, preserving auth safeguards", async (t) => {
  const { app, store, post, login, get, adminToken } = await setup(t);
  const two = "Sy";
  const three = "Syn";
  assert.equal(two.length, 2);
  assert.equal(three.length, 3);
  const before = await store.read();
  const weak = await post("/api/usuarios", accountBody({ password: two }));
  assert.equal(weak.statusCode, 400, weak.body);
  assert.deepEqual(await store.read(), before);
  const created = await post("/api/usuarios", accountBody({ password: three }));
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id;
  const accountToken = await login(accountBody().email, three);
  const original = await store.read();
  const invalidReset = await post(`/api/usuarios/${id}/clave`, { password: two });
  assert.equal(invalidReset.statusCode, 400, invalidReset.body);
  assert.deepEqual(await store.read(), original);
  assert.equal((await get("/api/auth/me", accountToken)).statusCode, 200);
  const key = randomUUID();
  const reset = await post(`/api/usuarios/${id}/clave`, { password: "New" }, key);
  assert.equal(reset.statusCode, 200, reset.body);
  const replay = await post(`/api/usuarios/${id}/clave`, { password: "New" }, key);
  assert.deepEqual(replay.json(), reset.json());
  const prior = original.accounts.find((row) => row.id === id)!;
  const current = (await store.read()).accounts.find((row) => row.id === id)!;
  assert.equal(current.credentialVersion, prior.credentialVersion + 1);
  assert.notEqual(current.salt, prior.salt);
  assert.notEqual(current.passwordHash, prior.passwordHash);
  assert.equal(current.status, prior.status);
  assert.equal(current.role, prior.role);
  assert.equal(current.collectorId, prior.collectorId);
  assert.equal((await get("/api/auth/me", accountToken)).statusCode, 401);
  assert.equal((await get("/api/auth/me", adminToken)).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: prior.email, password: three } })).statusCode, 401);
  const newToken = await login(prior.email, "New");
  assert.equal((await get("/api/auth/me", newToken)).statusCode, 200);
  // The independently configured bootstrap admin retains its fourteen-character guard.
  await assert.rejects(buildApp({ store: new MemoryStore(seed()), secret: "synthetic-client-user-test-secret-at-least32", demo: false,
    origins: [], collectorUrl: "http://127.0.0.1:5174", adminEmail: "bootstrap@example.invalid", adminPassword: "SynPass10!" }), /14/);
});

test("2.9 and 3.2 preference mutations do not expand collector permissions", async (t) => {
  const { store, post, collectorToken } = await setup(t);
  const client = (await store.read()).clients[0];
  const before = await store.read();
  const editedClient = await post(`/api/clientes/${client.id}`, { ...clientBody(client), preferredCurrency: "EUR" }, randomUUID(), collectorToken);
  assert.equal(editedClient.statusCode, 403, editedClient.body);
  const provisioned = await post("/api/usuarios", accountBody({ password, nickname: "Unauthorized" }), randomUUID(), collectorToken);
  assert.equal(provisioned.statusCode, 403, provisioned.body);
  assert.deepEqual(await store.read(), before);
});
