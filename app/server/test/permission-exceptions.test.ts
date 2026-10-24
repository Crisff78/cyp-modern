import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { FileStore, MemoryStore } from "../src/store.js";
import { seed } from "../src/seed.js";
import { assertAdmin } from "../src/domain.js";
import { effectiveAccess, canOpenPage, hasPermission, hasRoleExceptions } from "../../shared/access.mjs";

async function setup(t: TestContext, store = new MemoryStore(seed())) {
  const app = await buildApp({ store, demo: true, secret: "synthetic-exceptions-secret-longer-than-32-characters", origins: [], collectorUrl: "/collector/" });
  t.after(() => app.close());
  const login = async (email = "admin") => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: email === "admin" ? "Demo-CyP-2026!" : "Synthetic-Exception-2026!" } });
    assert.equal(response.statusCode, 200, response.body); return response.json().token as string;
  };
  const admin = await login();
  const post = (url: string, payload: object, token = admin, key = randomUUID()) => app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  const get = (url: string, token = admin) => app.inject({ url, headers: { authorization: `Bearer ${token}` } });
  const create = async (role: string) => {
    const email = `${randomUUID()}@example.invalid`;
    const response = await post("/api/usuarios", { name: "Cuenta sintética", role, email, password: "Synthetic-Exception-2026!", ...(role === "collector" ? { collectorId: "col-1" } : {}) });
    assert.equal(response.statusCode, 200, response.body); return { ...response.json(), token: await login(email) };
  };
  const grant = (id: string, permissionIds: number[], revision = 0, extra: object = {}) => post(`/api/usuarios/${id}/permisos`, { permissionIds, remittancePermissions: [], mode: "custom", revision, ...extra });
  return { store, app, post, get, create, grant };
}

test("confirmed role exceptions are effective without turning historical selections into new grants", () => {
  const selection = { permissionMode: "custom" as const, permissionIds: [1, 140, 141], remittancePermissions: [] };
  const old = { role: "supervisor", access: effectiveAccess("supervisor", selection) };
  const extra = { role: "supervisor", access: effectiveAccess("supervisor", { ...selection, roleExceptions: true }) };
  assert.equal(hasPermission(old, 141), false); assert.equal(hasPermission(extra, 141), true);
  assert.equal(hasRoleExceptions(extra), true); assert.equal(canOpenPage(extra, "clients"), true);
  assert.throws(() => assertAdmin({ ...extra, id: "synthetic", name: "Prueba" }), /requiere administración/, "a serialized access object alone cannot bypass a domain guard");
  assert.equal(hasPermission({ role: "supervisor", access: effectiveAccess("supervisor", { ...selection, permissionMode: "role", roleExceptions: true }) }, 141), false);
});

test("Supervisor can really create a client after confirmation, then loses the action with the same session after revocation", async (t) => {
  const { store, create, grant, post, get } = await setup(t), account = await create("supervisor");
  const client = { name: "Ana O'Connor & Hijos", identification: "PAS-SYNTHETIC-ONE", routeId: "route-1" };
  // Pick a genuine seeded route, without assuming its external identifier.
  client.routeId = (await store.read()).routes[0].id;
  assert.equal((await grant(account.id, [1, 140, 141])).statusCode, 200);
  assert.equal((await post("/api/clientes", client, account.token)).statusCode, 403);
  const before = (await store.read()).accounts.find(({ id }) => id === account.id)!;
  const confirmed = await grant(account.id, [1, 140, 141], 1, { roleExceptions: true });
  assert.equal(confirmed.statusCode, 200, confirmed.body); assert.equal(confirmed.json().roleExceptions, true);
  const me = (await get("/api/auth/me", account.token)).json();
  assert.equal(me.role, "supervisor"); assert.equal(me.access.legacy.includes(141), true);
  const created = await post("/api/clientes", client, account.token);
  assert.equal(created.statusCode, 200, created.body);
  const after = (await store.read()).accounts.find(({ id }) => id === account.id)!;
  assert.equal(after.passwordHash, before.passwordHash); assert.equal(after.credentialVersion, before.credentialVersion);
  assert.equal((await post("/api/zonas", { name: "No concedida" }, account.token)).statusCode, 403);
  assert.equal((await post("/api/bancos", { name: "No concedido" }, account.token)).statusCode, 403);
  assert.equal((await grant(account.id, [1, 140], 2, { roleExceptions: false })).statusCode, 200);
  assert.equal((await post("/api/clientes", { ...client, identification: "PAS-SYNTHETIC-TWO" }, account.token)).statusCode, 403);
});

test("No definido and Cliente may receive explicit office functions; their default profiles and roles stay unchanged", async (t) => {
  const { create, grant, get } = await setup(t);
  for (const role of ["undefined", "client", "cashier"]) {
    const account = await create(role);
    assert.equal((await grant(account.id, [1, 140], 0, { roleExceptions: true })).statusCode, 200);
    const me = (await get("/api/auth/me", account.token)).json();
    assert.equal(me.role, role); assert.equal(hasRoleExceptions(me), true); assert.equal(canOpenPage(me, "clients"), true);
    const response = await get("/api/snapshot", account.token);
    assert.equal(response.statusCode, 200, response.body); assert.ok(response.json().clients.length);
    assert.deepEqual(response.json().accounts.map((row: { id: string }) => row.id), [account.id]);
    assert.equal((await get("/api/usuarios", account.token)).statusCode, 403);
  }
});

test("limited permission managers cannot delegate or manufacture access they do not possess", async (t) => {
  const { create, grant, post, store } = await setup(t), manager = await create("supervisor"), target = await create("client");
  assert.equal((await grant(manager.id, [1, 101, 102, 103, 106, 140], 0, { roleExceptions: true })).statusCode, 200);
  const broader = await create("admin");
  const before = await store.read();
  const stripped = await post(`/api/usuarios/${broader.id}/permisos`, { permissionIds: [], mode: "custom", revision: 0 }, manager.token);
  assert.equal(stripped.statusCode, 403, stripped.body); assert.equal(stripped.json().error.code, "ACCOUNT_MORE_PRIVILEGED");
  assert.deepEqual(await store.read(), before);
  for (const payload of [
    { permissionIds: [1, 140, 141], mode: "custom", roleExceptions: true, revision: 0 },
    { permissionIds: [], mode: "role", revision: 1 },
  ]) {
    const response = await post(`/api/usuarios/${payload.mode === "role" ? manager.id : target.id}/permisos`, payload, manager.token);
    assert.equal(response.statusCode, 403, response.body); assert.equal(response.json().error.code, "PERMISSION_DELEGATION_FORBIDDEN");
    assert.deepEqual(await store.read(), before);
  }
  const newAdmin = await post("/api/usuarios", { name: "No autorizado", email: "cannot-elevate@example.invalid", role: "admin", password: "Ficticia-Segura-2026!" }, manager.token);
  assert.equal(newAdmin.statusCode, 403, newAdmin.body); assert.deepEqual(await store.read(), before);
  const allowed = await post(`/api/usuarios/${target.id}/permisos`, { permissionIds: [1, 140], mode: "custom", roleExceptions: true, revision: 0 }, manager.token);
  assert.equal(allowed.statusCode, 200, allowed.body);
  const edited = await post(`/api/usuarios/${manager.id}`, { name: manager.name, email: manager.email, role: "supervisor", note: "Nota propia autorizada" }, manager.token);
  assert.equal(edited.statusCode, 200, edited.body);
  const promoted = await post(`/api/usuarios/${manager.id}`, { name: manager.name, email: manager.email, role: "admin" }, manager.token);
  assert.equal(promoted.statusCode, 403, promoted.body);
});

test("collector catalog exceptions preserve foreign-route write isolation and roll back the entire mutation", async (t) => {
  const { create, grant, get, post, store } = await setup(t), account = await create("collector");
  assert.equal((await grant(account.id, [1, 130, 132, 140, 141, 142, 300, 301], 0, { roleExceptions: true })).statusCode, 200);
  const state = await store.read(), own = state.routes.find((row) => row.collectorId === "col-1")!, foreign = state.routes.find((row) => row.collectorId !== "col-1")!;
  assert(own); assert(foreign);
  // Keep the reassignment valid according to the primary-route business rule:
  // this probe must be rejected by ownership, not by the absence of a backup route.
  await store.transaction((draft) => { draft.routes.push({ ...foreign, id: "synthetic-secondary-route", name: "Ruta secundaria sintética", active: true }); });
  const before = await store.read();
  const blocked = await post("/api/clientes", { name: "Fuera de ruta", identification: "PAS-FOREIGN", routeId: foreign.id }, account.token);
  assert.equal(blocked.statusCode, 403, blocked.body); assert.deepEqual(await store.read(), before);
  const foreignClient = state.clients.find((row) => row.routeId === foreign.id)!;
  const moved = await post(`/api/clientes/${foreignClient.id}`, { code: foreignClient.code, name: foreignClient.name, routeId: own.id }, account.token);
  assert.equal(moved.statusCode, 403, moved.body); assert.deepEqual(await store.read(), before);
  const movedRoute = await post(`/api/rutas/${foreign.id}`, { name: foreign.name, sector: foreign.sector, collectorId: "col-1" }, account.token);
  assert.equal(movedRoute.statusCode, 403, movedRoute.body); assert.deepEqual(await store.read(), before);
  const allowed = await post("/api/clientes", { name: "En su ruta", identification: "PAS-OWN", routeId: own.id }, account.token);
  assert.equal(allowed.statusCode, 200, allowed.body);
  const charge = await post("/api/cargos", { clientId: state.clients.find((row) => row.routeId === foreign.id)!.id, service: "Prueba", amount: 100, dueDate: "2026-10-22" }, account.token);
  assert.equal(charge.statusCode, 403, charge.body);
  const snapshot = (await get("/api/snapshot", account.token)).json();
  assert.ok(snapshot.routes.every((row: { collectorId: string }) => row.collectorId === "col-1"));
  assert.equal(snapshot.clients.some((row: { routeId: string }) => row.routeId === foreign.id), false);
});

test("exception request schema rejects spoofed confirmations and idempotent retries do not grant twice", async (t) => {
  const { create, post, store } = await setup(t), account = await create("supervisor");
  const body = { permissionIds: [1, 140, 141], mode: "custom", revision: 0, roleExceptions: true }, url = `/api/usuarios/${account.id}/permisos`;
  for (const value of ["true", 1, null, {}, [true]]) assert.equal((await post(url, { ...body, roleExceptions: value })).statusCode, 400);
  const key = randomUUID(), first = await post(url, body, undefined, key), snapshot = await store.read();
  assert.equal(first.statusCode, 200, first.body); const retry = await post(url, body, undefined, key);
  assert.equal(retry.statusCode, 200); assert.deepEqual(retry.json(), first.json()); assert.deepEqual(await store.read(), snapshot);
  assert.equal((await post(url, { ...body, permissionIds: [1, 140] })).statusCode, 409);
});

test("additional remittance rights enable rates, commission settings and only the operator's own cash box", async (t) => {
  const { create, grant, get, post } = await setup(t), account = await create("supervisor");
  const remittancePermissions = ["remittances.rates.view", "remittances.rates.manage", "remittances.commissions.view", "remittances.commissions.manage", "remittances.cash.view", "remittances.cash.open"];
  assert.equal((await grant(account.id, [1, 200, 201], 0, { roleExceptions: true, remittancePermissions })).statusCode, 200);
  const date = (await get("/api/snapshot", account.token)).json().businessDate;
  const rates = await post("/api/envios/tasas", { currency: "USD", date, rate: "60", purchaseRate: "59", saleRate: "61" }, account.token);
  assert.equal(rates.statusCode, 200, rates.body);
  assert.equal((await post("/api/envios/politica-comisiones", { transactionCommissionBps: 0, managerCommissionBps: 0 }, account.token)).statusCode, 200);
  const ownCash = await post("/api/envios/cajas/abrir", { operatorId: account.id, currency: "DOP", openingAmount: 0 }, account.token);
  assert.equal(ownCash.statusCode, 200, ownCash.body);
  const foreignCash = await post("/api/envios/cajas/abrir", { operatorId: "demo-admin", currency: "USD", openingAmount: 0 }, account.token);
  assert.equal(foreignCash.statusCode, 403, foreignCash.body);
  assert.ok((await get("/api/envios/snapshot", account.token)).json().rateHistory.length);
});

test("confirmed exceptions survive reopening a local file store", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-exception-test-")), file = join(directory, "state.json");
  const store = await FileStore.open(file, seed());
  const app = await buildApp({ store, demo: true, secret: "file-exceptions-synthetic-secret-longer-than-32-characters", origins: [], collectorUrl: "/collector/" });
  t.after(() => app.close());
  await store.transaction((state) => {
    state.accounts.push({ id: "synthetic-file-account", name: "Cuenta sintética", email: "file@example.invalid", role: "supervisor",
      permissionMode: "custom", permissionIds: [1, 140, 141], remittancePermissions: [], roleExceptions: true,
      salt: "synthetic", passwordHash: "unused-in-this-persistence-test", credentialVersion: 1, status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  });
  const reopened = await FileStore.open(file, seed()); t.after(() => reopened.close());
  const account = (await reopened.read()).accounts.find((row) => row.role === "supervisor")!;
  assert.equal(effectiveAccess(account.role, account).legacy.includes(141), true);
});
