import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { ACCOUNT_ROLES, type AccountRole } from "../src/account-roles.js";
import { postMovement, type User } from "../src/domain.js";
import { remittanceOperators } from "../src/remittances.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";

async function setup(t: TestContext) {
  const initial = seed();
  initial.collectors[0].accountId = "LEGACY-ACCOUNT-CODE";
  const store = new MemoryStore(initial);
  const app = await buildApp({ store, demo: true, secret: "synthetic-account-roles-secret-at-least-32-characters", origins: [], collectorUrl: "http://localhost:5174" });
  t.after(() => app.close());
  const login = async (email = "admin@cyp.local", password = "Demo-CyP-2026!") => {
    const result = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    assert.equal(result.statusCode, 200, result.body);
    return result.json().token as string;
  };
  const adminToken = await login();
  const post = (url: string, payload: object, token = adminToken, key = randomUUID()) => app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  const get = (url: string, token = adminToken) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  const account = async (role: AccountRole) => {
    const body = { name: `José O'Connor & Hijos ${role}`, email: `${role}-${randomUUID()}@example.invalid`, role, ...(role === "collector" ? { collectorId: "col-1" } : {}), password: "Ab#'☃" };
    const result = await post("/api/usuarios", body);
    assert.equal(result.statusCode, 200, result.body);
    return { ...result.json(), body };
  };
  return { initial, store, app, login, post, get, account };
}

test("five explicit roles create/edit with unchanged legacy codes and safe OpenAPI contracts", async (t) => {
  const { app, store, account, post, get } = await setup(t);
  const identities = [];
  for (const role of ACCOUNT_ROLES) {
    const row = await account(role); identities.push(row);
    assert.equal(row.role, role); assert.equal(row.name, `José O'Connor & Hijos ${role}`);
    assert.equal(row.passwordHash, undefined); assert.equal(row.salt, undefined);
    const { password: omitted, ...body } = row.body;
    const edited = await post(`/api/usuarios/${row.id}`, { ...body, nickname: "Apodo legítimo + ventas" });
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal(edited.json().role, role); assert.equal(edited.json().nickname, "Apodo legítimo + ventas");
    assert.ok(omitted);
  }
  const before = await store.read();
  for (const invalid of ["ADMIN", "superadmin", "client", "No definido", "", 1, null]) {
    const result = await post("/api/usuarios", { name: "Cuenta inválida", email: "invalid@example.invalid", password: "Qa3", role: invalid });
    assert.equal(result.statusCode, 400, result.body);
  }
  assert.deepEqual(await store.read(), before);
  const listed = (await get("/api/usuarios")).json();
  for (const row of identities) assert.equal(listed.find((item: { id: string }) => item.id === row.id).role, row.role);
  const spec = (await app.inject("/api/openapi.json")).json();
  for (const path of ["/api/usuarios", "/api/usuarios/{id}"]) {
    assert.deepEqual(spec.paths[path].post.requestBody.content["application/json"].schema.properties.role.enum, ACCOUNT_ROLES);
  }
});

test("new roles cannot acquire financial writes; Supervisor has administrative read access", async (t) => {
  const { store, login, account, post, get } = await setup(t);
  for (const role of ["undefined", "user", "supervisor"] as const) {
    const row = await account(role), token = await login(row.email, row.body.password);
    assert.equal((await get("/api/auth/me", token)).json().role, role);
    const before = await store.read();
    for (const [url, payload] of [["/api/cobradores", { name: "No autorizado" }], ["/api/cobros", { chargeId: "chg-1", amount: 100 }], ["/api/envios/cajas/abrir", { operatorId: row.id, currency: "DOP", openingAmount: 0 }]] as const) {
      assert.equal((await post(url, payload, token)).statusCode, 403);
    }
    assert.deepEqual(await store.read(), before);
    for (const url of ["/api/snapshot", "/api/usuarios", "/api/cobradores", "/api/zonas", "/api/configuracion", "/api/monitoring/collector/col-1/map-data"]) {
      assert.equal((await get(url, token)).statusCode, role === "supervisor" ? 200 : 403, `${role}: ${url}`);
    }
    if (role === "supervisor") assert.equal((await get("/api/snapshot", token)).json().collectors.length, before.collectors.length);
    const actor: User = { id: row.id, name: row.name, role, collectorId: "col-1" };
    assert.throws(() => postMovement(structuredClone(before), actor, "collection", { chargeId: "chg-1", amount: 100 }), (error: unknown) => (error as { code: string }).code === "FORBIDDEN");
    assert.deepEqual(remittanceOperators(before, { id: row.id, name: row.name, role }), []);
    assert.equal((await post("/api/auth/logout", {}, token)).statusCode, 200);
  }
  const operators = remittanceOperators(await store.read(), { id: "demo-admin", name: "QA", role: "admin" });
  assert.ok(operators.every((row) => row.role === "admin" || row.role === "collector"));
});

test("collector accounts persist eligible IDs and reject new Admin/unknown/mismatched links", async (t) => {
  const { initial, store, account, post } = await setup(t);
  const collector = initial.collectors[0];
  const legacy = await post(`/api/cobradores/${collector.id}`, { name: "Nombre legítimo editado", accountId: collector.accountId });
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.equal(legacy.json().accountId, "LEGACY-ACCOUNT-CODE");
  for (const role of ["undefined", "supervisor", "collector", "user"] as const) {
    const row = await account(role);
    const result = await post(`/api/cobradores/${collector.id}`, { name: collector.name, accountId: row.id });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal((await store.read()).collectors.find((item) => item.id === collector.id)?.accountId, row.id);
  }
  const admin = await account("admin"), assignedCollector = await account("collector");
  const before = await store.read();
  for (const accountId of [admin.id, "UNKNOWN'; SELECT 1--"]) {
    const result = await post(`/api/cobradores/${collector.id}`, { name: collector.name, accountId });
    assert.equal(result.statusCode, 422, result.body);
  }
  assert.equal((await post("/api/cobradores/col-2", { name: "Segundo cobrador", accountId: assignedCollector.id })).statusCode, 409);
  assert.deepEqual(await store.read(), before);
  const row = await account("user");
  const created = await post("/api/cobradores", { name: "Nuevo cobrador con cuenta", accountId: row.id });
  assert.equal(created.statusCode, 200, created.body); assert.equal(created.json().accountId, row.id);
});

test("linked accounts require explicit unlink before Admin promotion; role edits still revoke sessions", async (t) => {
  const { account, login, post, get, store } = await setup(t);
  const row = await account("user"), token = await login(row.email, row.body.password);
  const { password: omitted, ...profile } = row.body;
  assert.ok(omitted);
  assert.equal((await post("/api/cobradores/col-1", { name: "Cobrador", accountId: row.id })).statusCode, 200);
  assert.equal((await post(`/api/usuarios/${row.id}`, { ...profile, role: "admin" })).statusCode, 409);
  assert.equal((await store.read()).accounts.find((item) => item.id === row.id)?.role, "user");
  assert.equal((await post("/api/cobradores/col-1", { name: "Cobrador", accountId: "" })).statusCode, 200);
  assert.equal((await post(`/api/usuarios/${row.id}`, { ...profile, role: "admin" })).statusCode, 200);
  assert.equal((await get("/api/auth/me", token)).statusCode, 401);
  assert.equal((await get("/api/snapshot", await login(row.email, row.body.password))).statusCode, 200);
});

test("PostgreSQL migration accepts all roles in users and sessions, preserving historical rows", { skip: !process.env.CYP_ROLE_TEST_DATABASE_URL }, async () => {
  const url = process.env.CYP_ROLE_TEST_DATABASE_URL!, target = new URL(url);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55436");
  assert.equal(target.pathname, "/cyp_roles_qa"); assert.equal(target.username, "qa_cyp");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const role of ACCOUNT_ROLES) {
      const id = `role-qa-${randomUUID()}`;
      await client.query("INSERT INTO users(id,name,role) VALUES($1,$2,$3)", [id, "José O'Connor QA", role]);
      await client.query("INSERT INTO auth_sessions(id,user_id,user_name,role,started_at,expires_at) VALUES($1,$2,$3,$4,now(),now()+interval '1 hour')", [randomUUID(), id, "QA", role]);
      assert.equal((await client.query("SELECT role FROM users WHERE id=$1", [id])).rows[0].role, role);
    }
    await client.query("SAVEPOINT invalid_role");
    await assert.rejects(client.query("INSERT INTO users(id,name,role) VALUES($1,'QA','unknown')", [randomUUID()]), (error: unknown) => (error as { code: string }).code === "23514");
    await client.query("ROLLBACK TO SAVEPOINT invalid_role");
    assert.equal((await client.query("SELECT count(*)::int AS n FROM users WHERE id IN ('legacy-role-admin','legacy-role-collector') AND role IN ('admin','collector')")).rows[0].n, 2);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
