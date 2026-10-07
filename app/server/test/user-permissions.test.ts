import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { FileStore, MemoryStore, PostgresStore, type Store } from "../src/store.js";
import { permissionCatalog } from "../src/user-permissions.js";
import type { AccountRole } from "../src/account-roles.js";

async function setup(t: TestContext, store: Store = new MemoryStore(seed())) {
  const app = await buildApp({ store, demo: true, secret: "synthetic-permissions-test-secret-at-least-32-characters", origins: [], collectorUrl: "http://localhost:5174" });
  t.after(() => app.close());
  const login = async (email = "admin@cyp.local", password = "Demo-CyP-2026!") => {
    const result = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    assert.equal(result.statusCode, 200, result.body);
    return result.json().token as string;
  };
  const token = await login();
  const get = (path: string, actor = token) => app.inject({ url: path, headers: { authorization: `Bearer ${actor}` } });
  const post = (path: string, payload: unknown, actor = token, key = randomUUID()) => app.inject({ method: "POST", url: path, payload: payload as object, headers: { authorization: `Bearer ${actor}`, "idempotency-key": key } });
  const account = async (role: AccountRole = "user") => {
    const body = { name: `María O'Connor & Hijos ${randomUUID()}`, email: `qa-${randomUUID()}@example.invalid`, role, password: "Clave-legítima+#'☃", ...(role === "collector" ? { collectorId: "col-1" } : {}) };
    const result = await post("/api/usuarios", body);
    assert.equal(result.statusCode, 200, result.body);
    return { ...result.json(), body };
  };
  return { app, store, token, login, get, post, account };
}

test("permissions contract preserves all 119 exact legacy entries, including sparse codes 1 and 501", async (t) => {
  const { app, get } = await setup(t);
  const result = await get("/api/permisos");
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json(), permissionCatalog);
  assert.deepEqual(result.json().categories, ["No definido", "Sistema", "Archivos", "Edición", "Reportes y Procesamiento", "Monitoreo", "Otros"]);
  const entries = result.json().permissions;
  assert.equal(entries.length, 119);
  assert.equal(new Set(entries.map((row: { id: number }) => row.id)).size, 119);
  assert.equal(entries.find((row: { id: number }) => row.id === 1).name, "Entrar al sistema");
  assert.equal(entries.find((row: { id: number }) => row.id === 145).name, "Modificar GeoCoordenas del Cliente");
  assert.equal(entries.find((row: { id: number }) => row.id === 340).name, "Visuzalizar Entregas");
  assert.equal(entries.find((row: { id: number }) => row.id === 501).name, "Mostrar Monitor de Cobradores");
  assert.equal(entries.some((row: { id: number }) => row.id === 7), false);
  const spec = (await app.inject("/api/openapi.json")).json();
  assert.ok(spec.paths["/api/permisos"].get);
  const schema = spec.paths["/api/usuarios/{id}/permisos"].post.requestBody.content["application/json"].schema;
  assert.deepEqual(schema.required, ["permissionIds", "revision"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.permissionIds.maxItems, 119);
});

test("permission saves affect only the requested account and preserve credentials, roles and active sessions", async (t) => {
  const { store, token, account, get, post, login } = await setup(t);
  const first = await account(), other = await account(), admin = await account("admin");
  const ownToken = await login(first.email, first.body.password);
  assert.deepEqual((await get(`/api/usuarios/${first.id}/permisos`)).json(), { userId: first.id, permissionIds: [], revision: 0 });
  assert.equal((await get(`/api/usuarios/${admin.id}/permisos`)).json().permissionIds.length, 119);
  const before = await store.read(), target = before.accounts.find(({ id }) => id === first.id)!;
  const saved = await post(`/api/usuarios/${first.id}/permisos`, { permissionIds: [501, 140, 2], revision: 0 });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json(), { userId: first.id, permissionIds: [2, 140, 501], revision: 1 });
  const after = await store.read(), changed = after.accounts.find(({ id }) => id === first.id)!;
  for (const field of ["name", "email", "role", "collectorId", "salt", "passwordHash", "credentialVersion", "status", "createdAt"] as const)
    assert.deepEqual(changed[field], target[field], field);
  assert.deepEqual(after.accounts.find(({ id }) => id === other.id), before.accounts.find(({ id }) => id === other.id));
  assert.deepEqual(after.adminTools.sessions, before.adminTools.sessions);
  assert.deepEqual(after.charges, before.charges);
  assert.deepEqual(after.movements, before.movements);
  assert.equal((await get("/api/auth/me", token)).statusCode, 200);
  assert.equal((await get("/api/auth/me", ownToken)).statusCode, 200);
  const cleared = await post(`/api/usuarios/${admin.id}/permisos`, { permissionIds: [], revision: 0 });
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual((await get(`/api/usuarios/${admin.id}/permisos`)).json().permissionIds, [], "Explicit empty must not restore Admin defaults.");
});

test("Zod rejects invalid IDs, duplicates, mixed strings and injected fields without mutations", async (t) => {
  const { store, post, account } = await setup(t);
  const target = await account(), path = `/api/usuarios/${target.id}/permisos`;
  const before = await store.read();
  const bodies: unknown[] = [
    {}, { permissionIds: [1] }, { revision: 0 },
    ...[[0], [502], [7], [1.5], [true], [null], ["1"], ["1; DROP TABLE users"], [1, 1], Array(120).fill(1)].map((permissionIds) => ({ permissionIds, revision: 0 })),
    { permissionIds: "1", revision: 0 }, { permissionIds: null, revision: 0 },
    ...[-1, 0.5, "0", null, 2_147_483_648].map((revision) => ({ permissionIds: [1], revision })),
    { permissionIds: [1], revision: 0, role: "admin" }, { permissionIds: [1], revision: 0, credentialVersion: 1 },
  ];
  for (const body of bodies) {
    const result = await post(path, body);
    assert.equal(result.statusCode, 400, JSON.stringify(body));
    assert.deepEqual(await store.read(), before);
  }
  const missing = await post("/api/usuarios/unknown-account/permisos", { permissionIds: [1], revision: 0 });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(await store.read(), before);
});

test("catalog assignments never elevate roles; only Admin can save and Supervisor remains read-only", async (t) => {
  const { store, account, login, get, post } = await setup(t);
  const all = permissionCatalog.permissions.map(({ id }) => id);
  for (const role of ["undefined", "user", "collector", "supervisor"] as const) {
    const target = await account(role), actor = await login(target.email, target.body.password);
    const assigned = await post(`/api/usuarios/${target.id}/permisos`, { permissionIds: all, revision: 0 });
    assert.equal(assigned.statusCode, 200);
    const before = await store.read();
    assert.equal((await get("/api/permisos", actor)).statusCode, role === "supervisor" ? 200 : 403);
    assert.equal((await get(`/api/usuarios/${target.id}/permisos`, actor)).statusCode, role === "supervisor" ? 200 : 403);
    assert.equal((await post(`/api/usuarios/${target.id}/permisos`, { permissionIds: [], revision: 1 }, actor)).statusCode, 403);
    assert.equal((await post("/api/cobradores", { name: "No autorizado" }, actor)).statusCode, 403);
    assert.equal((await get("/api/auth/me", actor)).json().role, role);
    assert.deepEqual(await store.read(), before);
  }
});

test("permission revisions and idempotent retries prevent stale or duplicate writes", async (t) => {
  const { store, token, post, account } = await setup(t);
  const target = await account(), path = `/api/usuarios/${target.id}/permisos`, key = randomUUID();
  const body = { permissionIds: [1, 501], revision: 0 };
  const first = await post(path, body, token, key);
  assert.equal(first.statusCode, 200);
  const committed = await store.read();
  const retry = await post(path, body, token, key);
  assert.equal(retry.statusCode, 200); assert.deepEqual(retry.json(), first.json());
  assert.deepEqual(await store.read(), committed);
  assert.equal((await post(path, { permissionIds: [2], revision: 0 }, token, key)).statusCode, 409);
  const stale = await post(path, { permissionIds: [2], revision: 0 });
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, "PERMISSIONS_CHANGED");
  assert.deepEqual(await store.read(), committed);
  const races = await Promise.all([post(path, { permissionIds: [2], revision: 1 }), post(path, { permissionIds: [3], revision: 1 })]);
  assert.deepEqual(races.map(({ statusCode }) => statusCode).sort(), [200, 409]);
  assert.equal((await store.read()).accounts.find(({ id }) => id === target.id)?.permissionRevision, 2);
});

test("FileStore persists explicit permission assignments and empty selections across reopen", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-permissions-test-")), path = join(directory, "state.json");
  t.after(async () => { await unlink(path); await rmdir(directory); });
  const store = await FileStore.open(path, seed());
  const { account, post } = await setup(t, store);
  const target = await account("admin");
  assert.equal((await post(`/api/usuarios/${target.id}/permisos`, { permissionIds: [], revision: 0 })).statusCode, 200);
  const reopened = await FileStore.open(path, seed());
  const persisted = (await reopened.read()).accounts.find(({ id }) => id === target.id)!;
  assert.deepEqual(persisted.permissionIds, []); assert.equal(persisted.permissionRevision, 1);
  assert.equal(persisted.credentialVersion, 1);
  assert.ok((await readFile(path, "utf8")).includes('"permissionIds":[]'));
  await reopened.close();
});

test("PostgreSQL migration and Store persist user permissions without touching credentials", { skip: !process.env.CYP_PERMISSION_TEST_DATABASE_URL }, async (t) => {
  const url = process.env.CYP_PERMISSION_TEST_DATABASE_URL!, target = new URL(url);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55436");
  assert.equal(target.pathname, "/cyp_permissions_qa"); assert.equal(target.username, "qa_cyp");
  const store = new PostgresStore(url);
  const { account, post, get } = await setup(t, store);
  const targetAccount = await account("admin");
  const before = (await store.read()).accounts.find(({ id }) => id === targetAccount.id)!;
  assert.equal((await post(`/api/usuarios/${targetAccount.id}/permisos`, { permissionIds: [2, 500, 501], revision: 0 })).statusCode, 200);
  const secondStore = new PostgresStore(url);
  t.after(() => secondStore.close());
  const saved = (await secondStore.read()).accounts.find(({ id }) => id === targetAccount.id)!;
  assert.deepEqual(saved.permissionIds, [2, 500, 501]); assert.equal(saved.permissionRevision, 1);
  assert.equal(saved.passwordHash, before.passwordHash); assert.equal(saved.credentialVersion, before.credentialVersion);
  assert.equal((await post(`/api/usuarios/${targetAccount.id}/permisos`, { permissionIds: [], revision: 1 })).statusCode, 200);
  assert.deepEqual((await get(`/api/usuarios/${targetAccount.id}/permisos`)).json().permissionIds, []);
  assert.deepEqual((await secondStore.read()).accounts.find(({ id }) => id === targetAccount.id)!.permissionIds, []);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const invalid of [[7], [0], [502], [null]]) {
      await client.query("SAVEPOINT invalid_permissions");
      await assert.rejects(client.query("UPDATE users SET legacy_permission_ids=$1 WHERE id=$2", [invalid, targetAccount.id]), (error: unknown) => (error as { code: string }).code === "23514");
      await client.query("ROLLBACK TO SAVEPOINT invalid_permissions");
    }
    await client.query("ROLLBACK");
  } finally { await client.end(); }
});
