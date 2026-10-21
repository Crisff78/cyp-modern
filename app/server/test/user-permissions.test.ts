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
import { rolePermissionIds, roleRemittancePermissions } from "../../shared/access.mjs";

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
  const account = async (role: AccountRole = "client") => {
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
  assert.deepEqual((await get(`/api/usuarios/${first.id}/permisos`)).json(), { userId: first.id, permissionIds: [], revision: 0, mode: "role", remittancePermissions: [] });
  assert.equal((await get(`/api/usuarios/${admin.id}/permisos`)).json().permissionIds.length, 119);
  const cashier = await account("cashier");
  assert.deepEqual((await get(`/api/usuarios/${cashier.id}/permisos`)).json(),
    { userId: cashier.id, permissionIds: [1, 2], revision: 0, mode: "role", remittancePermissions: roleRemittancePermissions("cashier") });
  const before = await store.read(), target = before.accounts.find(({ id }) => id === first.id)!;
  // The previous contract (no `mode`) keeps the account's mode: the list is stored, not applied.
  const saved = await post(`/api/usuarios/${first.id}/permisos`, { permissionIds: [501, 140, 2], revision: 0 });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json(), { userId: first.id, permissionIds: [2, 140, 501], revision: 1, mode: "role", remittancePermissions: [] });
  const after = await store.read(), changed = after.accounts.find(({ id }) => id === first.id)!;
  for (const field of ["name", "email", "role", "collectorId", "salt", "passwordHash", "credentialVersion", "status", "createdAt"] as const)
    assert.deepEqual(changed[field], target[field], field);
  assert.deepEqual(after.accounts.find(({ id }) => id === other.id), before.accounts.find(({ id }) => id === other.id));
  assert.deepEqual(after.adminTools.sessions, before.adminTools.sessions);
  assert.deepEqual(after.charges, before.charges);
  assert.deepEqual(after.movements, before.movements);
  // Operational endpoints, not the exempt /api/auth/me, prove that the sessions still work.
  assert.equal((await get("/api/usuarios", token)).statusCode, 200);
  assert.equal((await post(`/api/usuarios/${first.id}/clave`, { currentPassword: first.body.password, password: first.body.password }, ownToken)).statusCode, 200);
  const adminToken = await login(admin.email, admin.body.password);
  const cleared = await post(`/api/usuarios/${admin.id}/permisos`, { permissionIds: [], revision: 0 });
  assert.equal(cleared.statusCode, 200); assert.equal(cleared.json().mode, "role");
  assert.deepEqual((await get(`/api/usuarios/${admin.id}/permisos`)).json().permissionIds, [], "Explicit empty must not restore Admin defaults.");
  // A legacy body without `mode` never revokes an Admin that works with its role profile.
  assert.equal((await get("/api/usuarios", adminToken)).statusCode, 200);
  assert.equal((await get("/api/snapshot", adminToken)).statusCode, 200);
  // Only an explicit personalized mode applies the stored selection.
  assert.equal((await post(`/api/usuarios/${admin.id}/permisos`, { mode: "custom", permissionIds: [], revision: 1 })).statusCode, 200);
  assert.equal((await get("/api/usuarios", adminToken)).json().error.code, "ACCESS_REVOKED");
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
  const keys = ["remittances.view", "remittances.create", "remittances.receipts", "remittances.pay", "remittances.cancel", "remittances.clients.create", "remittances.cash.view",
    "remittances.cash.open", "remittances.cash.close", "remittances.reports", "remittances.rates.view", "remittances.rates.manage", "remittances.commissions.view", "remittances.commissions.manage"];
  const keysWithout = (...left: string[]) => keys.filter((key) => !left.includes(key));
  // The most each role can reach with every code and every key of Envíos personalized, written out apart from
  // access.mjs so a leak there is caught here. Without «Entrar al sistema» (No definido, Cliente) nothing applies.
  const ceilings: Record<"undefined" | "client" | "collector" | "supervisor" | "cashier", { legacy: number[]; remittances: string[] }> = {
    undefined: { legacy: [], remittances: [] },
    // A Cliente has no access at all, not even personalized.
    client: { legacy: [], remittances: [] },
    collector: { legacy: rolePermissionIds("collector"), remittances: keysWithout("remittances.cash.open", "remittances.rates.manage", "remittances.commissions.view", "remittances.commissions.manage") },
    supervisor: { legacy: rolePermissionIds("supervisor"), remittances: ["remittances.view", "remittances.receipts", "remittances.cash.view", "remittances.reports", "remittances.rates.view", "remittances.commissions.view"] },
    cashier: { legacy: [1, 2], remittances: keysWithout("remittances.rates.view", "remittances.rates.manage", "remittances.commissions.view", "remittances.commissions.manage") },
  };
  const sorted = <T extends string | number>(values: readonly T[]) => [...values].sort((a, b) => String(a).localeCompare(String(b), "en", { numeric: true }));
  for (const role of ["undefined", "client", "collector", "supervisor", "cashier"] as const) {
    const target = await account(role), actor = await login(target.email, target.body.password);
    // An explicit personalized mode: a body without `mode` would only store the lists (S9).
    const assigned = await post(`/api/usuarios/${target.id}/permisos`, { permissionIds: all, mode: "custom", remittancePermissions: keys, revision: 0 });
    assert.equal(assigned.statusCode, 200, assigned.body); assert.equal(assigned.json().mode, "custom");
    const before = await store.read();
    assert.equal((await get("/api/permisos", actor)).statusCode, role === "supervisor" ? 200 : 403);
    assert.equal((await get(`/api/usuarios/${target.id}/permisos`, actor)).statusCode, role === "supervisor" ? 200 : 403);
    assert.equal((await post(`/api/usuarios/${target.id}/permisos`, { permissionIds: [], revision: 1 }, actor)).statusCode, 403);
    assert.equal((await post("/api/cobradores", { name: "No autorizado" }, actor)).statusCode, 403);
    const me = (await get("/api/auth/me", actor)).json();
    assert.equal(me.role, role); assert.equal(me.access.mode, "custom", `${role} applies the personalized selection`);
    assert.deepEqual(sorted(me.access.legacy), sorted(ceilings[role].legacy), `${role} stays within its ceiling of codes`);
    assert.deepEqual(sorted(me.access.remittances), sorted(ceilings[role].remittances), `${role} stays within its ceiling of Envíos`);
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
  assert.equal((await post(`/api/usuarios/${targetAccount.id}/permisos`, { permissionIds: [1, 2, 500, 501], mode: "custom", remittancePermissions: ["remittances.view", "remittances.create"], revision: 0 })).statusCode, 200);
  const secondStore = new PostgresStore(url);
  t.after(() => secondStore.close());
  const saved = (await secondStore.read()).accounts.find(({ id }) => id === targetAccount.id)!;
  assert.deepEqual(saved.permissionIds, [1, 2, 500, 501]); assert.equal(saved.permissionRevision, 1);
  assert.equal(saved.permissionMode, "custom"); assert.deepEqual(saved.remittancePermissions, ["remittances.create", "remittances.view"]);
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
    for (const invalid of [["remittances.unknown"], [null], Array(15).fill("remittances.view")]) {
      await client.query("SAVEPOINT invalid_remittance_permissions");
      await assert.rejects(client.query("UPDATE users SET remittance_permissions=$1 WHERE id=$2", [invalid, targetAccount.id]), (error: unknown) => (error as { code: string }).code === "23514");
      await client.query("ROLLBACK TO SAVEPOINT invalid_remittance_permissions");
    }
    await client.query("SAVEPOINT invalid_permission_mode");
    await assert.rejects(client.query("UPDATE users SET permission_mode='owner' WHERE id=$1", [targetAccount.id]), (error: unknown) => (error as { code: string }).code === "23514");
    await client.query("ROLLBACK TO SAVEPOINT invalid_permission_mode");
    await client.query("ROLLBACK");
  } finally { await client.end(); }
});
