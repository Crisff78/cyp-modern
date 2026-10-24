import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { seed } from "../src/seed.js";
import { effectiveAccess, hasPermission, hasRemittancePermission } from "../../shared/access.mjs";

async function setup(t: TestContext) {
  const store = new MemoryStore(seed());
  const app = await buildApp({ store, demo: true, secret: "isolated-effective-access-test-secret-at-least-32", origins: [], collectorUrl: "/collector/" });
  t.after(() => app.close());
  const login = async (email: string, password = "Demo-CyP-2026!") => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    assert.equal(response.statusCode, 200, response.body); return response.json().token as string;
  };
  const admin = await login("admin");
  const get = (path: string, token = admin) => app.inject({ url: path, headers: { authorization: `Bearer ${token}` } });
  const post = (path: string, body: unknown, token = admin, key = randomUUID()) => app.inject({ method: "POST", url: path, payload: body as object,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  const account = async (role = "cashier") => {
    const email = `qa-${randomUUID()}@example.invalid`;
    const response = await post("/api/usuarios", { role, name: "Operador sintético", email, password: "Ficticia-segura-2026!" });
    assert.equal(response.statusCode, 200, response.body); return { ...response.json(), email } as { id: string; email: string };
  };
  const grant = (id: string, permissionIds: number[], remittancePermissions: string[], revision = 0) =>
    post(`/api/usuarios/${id}/permisos`, { mode: "custom", permissionIds, remittancePermissions, revision });
  return { store, app, admin, get, post, login, account, grant };
}

test("role profiles retain old referential selections until personalized; ceilings never turn Supervisor into Admin", () => {
  assert.equal(hasPermission({ role: "admin", access: effectiveAccess("admin", { permissionIds: [] }) }, 140), true);
  const restricted = { role: "admin", access: effectiveAccess("admin", { permissionMode: "custom", permissionIds: [1, 140], remittancePermissions: [] }) };
  assert.equal(hasPermission(restricted, 140), true); assert.equal(hasPermission(restricted, 141), false);
  const supervisor = { role: "supervisor", access: effectiveAccess("supervisor", { permissionMode: "custom", permissionIds: [1, 140, 141], remittancePermissions: ["remittances.create", "remittances.view"] }) };
  assert.equal(hasPermission(supervisor, 140), true); assert.equal(hasPermission(supervisor, 141), false);
  assert.equal(hasRemittancePermission(supervisor, "remittances.view"), true); assert.equal(hasRemittancePermission(supervisor, "remittances.create"), false);
  // The Cajero opens his cash box from the role profile; personalized, he may add reports but never rates or commissions.
  const cashier = { role: "cashier", access: effectiveAccess("cashier") };
  assert.equal(hasRemittancePermission(cashier, "remittances.cash.open"), true); assert.equal(hasRemittancePermission(cashier, "remittances.reports"), false);
  assert.equal(hasPermission(cashier, 1), true); assert.equal(hasPermission(cashier, 140), false);
  const personalized = { role: "cashier", access: effectiveAccess("cashier", { permissionMode: "custom", permissionIds: [1, 2, 140, 401],
    remittancePermissions: ["remittances.view", "remittances.reports", "remittances.rates.view", "remittances.commissions.view", "remittances.rates.manage"] }) };
  assert.deepEqual(personalized.access.legacy, [1, 2]); assert.deepEqual(personalized.access.remittances, ["remittances.view", "remittances.reports"]);
  // Collector and Cliente still never open a cash box.
  assert.equal(hasRemittancePermission({ role: "collector", access: effectiveAccess("collector") }, "remittances.cash.open"), false);
  const user = { role: "client", access: effectiveAccess("client", { permissionMode: "custom", permissionIds: [1, 2], remittancePermissions: ["remittances.cash.view", "remittances.cash.open"] }) };
  assert.equal(hasRemittancePermission(user, "remittances.cash.open"), false);
});

test("custom Admin permissions protect API routes and remove unauthorized snapshot data", async (t) => {
  const { account, grant, login, get, post } = await setup(t), target = await account("admin");
  assert.equal((await grant(target.id, [1, 140], [])).statusCode, 200);
  const token = await login(target.email, "Ficticia-segura-2026!");
  assert.equal((await get("/api/clientes", token)).statusCode, 200);
  assert.equal((await get("/api/usuarios", token)).statusCode, 403);
  assert.equal((await get("/api/cargos", token)).statusCode, 403);
  assert.equal((await post("/api/clientes", { name: "No autorizado" }, token)).statusCode, 403);
  const snapshot = (await get("/api/snapshot", token)).json();
  assert.ok(snapshot.clients.length > 0); assert.deepEqual(snapshot.charges, []); assert.deepEqual(snapshot.movements, []);
  assert.deepEqual(snapshot.collectors, []); assert.deepEqual(snapshot.settlements, []); assert.deepEqual(snapshot.totals.collected, 0);
});

test("two users of the same role have different effective actions; revocation takes effect with the existing token", async (t) => {
  const { account, grant, login, get } = await setup(t), first = await account(), second = await account();
  const keys = ["remittances.view", "remittances.create", "remittances.receipts"];
  assert.equal((await grant(first.id, [1, 2], keys)).statusCode, 200);
  assert.equal((await grant(second.id, [1, 2], ["remittances.view"])).statusCode, 200);
  const a = await login(first.email, "Ficticia-segura-2026!"), b = await login(second.email, "Ficticia-segura-2026!");
  assert.equal((await get("/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=100", a)).statusCode, 200);
  assert.equal((await get("/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=100", b)).statusCode, 403);
  assert.equal((await get("/api/usuarios", a)).statusCode, 403);
  assert.equal((await grant(first.id, [1, 2], ["remittances.view"], 1)).statusCode, 200);
  assert.equal((await get("/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=100", a)).statusCode, 403);
  assert.equal((await get("/api/envios", a)).statusCode, 200);
  assert.equal((await get("/api/auth/me", a)).json().access.remittances.includes("remittances.create"), false);
});

test("removing the entry permission blocks operations and a new login without changing role or credentials", async (t) => {
  const { account, grant, login, get, app } = await setup(t), target = await account();
  assert.equal((await grant(target.id, [1, 2], ["remittances.view"])).statusCode, 200);
  const token = await login(target.email, "Ficticia-segura-2026!");
  assert.equal((await grant(target.id, [2], ["remittances.view"], 1)).statusCode, 200);
  assert.equal((await get("/api/envios", token)).statusCode, 403);
  assert.equal((await get("/api/auth/me", token)).statusCode, 200);
  const relogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: target.email, password: "Ficticia-segura-2026!" } });
  assert.equal(relogin.statusCode, 403); assert.equal(relogin.json().error.code, "ACCESS_REVOKED");
});

test("new remittance clients and the remittance commit together; an exact retry creates no second identities", async (t) => {
  const { store, account, grant, login, get, post } = await setup(t), target = await account();
  const permissions = ["remittances.view", "remittances.create", "remittances.clients.create", "remittances.receipts", "remittances.cash.view"];
  assert.equal((await grant(target.id, [1, 2], permissions)).statusCode, 200);
  assert.equal((await post("/api/envios/cajas/abrir", { operatorId: target.id, currency: "DOP", openingAmount: 0 })).statusCode, 200);
  const token = await login(target.email, "Ficticia-segura-2026!"), routeId = (await store.read()).routes[0].id;
  const quote = (await get("/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=10000", token)).json();
  const draft = (name: string, identification: string) => ({ name, identification, phone: "+18095550101", address: "Dirección ficticia", routeId, preferredCurrency: "DOP" });
  const body = { ...quote, newSenderClient: draft("Remitente O'Connor", "QA-DOC-SENDER"), newRecipientClient: draft("Destinatario & Hijos", "QA-DOC-RECIPIENT") };
  // Only the creation contract fields, never calculated totals supplied by the client.
  const payload = { sourceCurrency: quote.sourceCurrency, destinationCurrency: quote.destinationCurrency, amount: quote.amount, quote: quote.quote,
    newSenderClient: body.newSenderClient, newRecipientClient: body.newRecipientClient };
  const before = await store.read(), key = randomUUID(), first = await post("/api/envios", payload, token, key);
  assert.equal(first.statusCode, 200, first.body);
  const saved = first.json(), state = await store.read();
  assert.equal(state.clients.length, before.clients.length + 2); assert.notEqual(saved.senderClientId, saved.recipientClientId);
  assert.equal(saved.senderContact.identification, "QA-DOC-SENDER"); assert.equal(saved.recipientContact.name, "Destinatario & Hijos");
  assert.ok(state.clients.find(({ id }) => id === saved.senderClientId)?.internalIdentification);
  const retry = await post("/api/envios", payload, token, key);
  assert.equal(retry.statusCode, 200); assert.deepEqual(retry.json(), saved);
  assert.equal((await store.read()).clients.length, state.clients.length);
  const conflicting = await post("/api/envios", payload, token);
  assert.equal(conflicting.statusCode, 409); assert.equal(conflicting.json().error.code, "CLIENT_ALREADY_EXISTS");
  assert.equal((await store.read()).clients.length, state.clients.length);
});

test("a failed cash validation rolls back new clients and reservations", async (t) => {
  const { store, get, post } = await setup(t), routeId = (await store.read()).routes[0].id;
  const quote = (await get("/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=10000")).json();
  const body = { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 10000, quote: quote.quote,
    newSenderClient: { name: "Cliente nuevo", identification: "QA-ROLLBACK-1", phone: "", address: "", routeId, preferredCurrency: "DOP" }, recipientClientId: "cli-2" };
  // Resolve a real seed recipient, avoiding a fabricated fixture identity.
  body.recipientClientId = (await store.read()).clients[1].id;
  const before = await store.read(), result = await post("/api/envios", body);
  assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, "CASH_NOT_OPEN");
  const after = await store.read();
  assert.deepEqual(after.clients, before.clients); assert.deepEqual(after.clientIdentityReservations, before.clientIdentityReservations);
  assert.deepEqual(after.remittances, before.remittances);
});

test("report-only cashiers see their own operations, not the pending payout queue; administrative endpoints stay blocked", async (t) => {
  const { store, account, grant, login, post, get } = await setup(t), cashier = await account(), other = await account();
  const permissions = ["remittances.view", "remittances.create", "remittances.receipts", "remittances.reports"];
  for (const target of [cashier, other]) {
    assert.equal((await grant(target.id, [1, 2], permissions)).statusCode, 200);
    assert.equal((await post("/api/envios/cajas/abrir", { operatorId: target.id, currency: "DOP", openingAmount: 0 })).statusCode, 200);
  }
  const firstToken = await login(cashier.email, "Ficticia-segura-2026!"), otherToken = await login(other.email, "Ficticia-segura-2026!");
  const clients = (await store.read()).clients;
  const quote = (await get("/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=10000", firstToken)).json();
  const payload = { senderClientId: clients[0].id, recipientClientId: clients[1].id, sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 10000, quote: quote.quote };
  const own = await post("/api/envios", payload, firstToken), foreign = await post("/api/envios", payload, otherToken);
  assert.equal(own.statusCode, 200, own.body); assert.equal(foreign.statusCode, 200, foreign.body);
  assert.equal((await get("/api/envios/recibos", firstToken)).json().length, 2, "payout permission includes the pending queue");
  assert.equal((await grant(cashier.id, [1, 2], ["remittances.reports"], 1)).statusCode, 200);
  const date = (await get("/api/envios/snapshot", firstToken)).json().businessDate;
  const report = await get(`/api/envios/reportes?from=${date}&to=${date}`, firstToken);
  assert.equal(report.statusCode, 200, report.body); assert.equal(report.json().amounts[0].count, 1);
  assert.equal((await get(`/api/envios/reportes/comisiones?from=${date}&to=${date}`, firstToken)).statusCode, 403);
  assert.deepEqual(report.json().commissionAllocations, {details:[],totals:[]});
  for (const endpoint of ["/api/envios", "/api/envios/recibos", "/api/configuracion", "/api/usuarios"])
    assert.equal((await get(endpoint, firstToken)).statusCode, 403, endpoint);
});

test("modern permissions reject unknown keys, duplicates and overposting without mutating state", async (t) => {
  const { store, account, post } = await setup(t), target = await account(), before = await store.read();
  for (const extra of [ { mode: "owner" }, { remittancePermissions: ["remittances.admin"] }, { remittancePermissions: ["remittances.view", "remittances.view"] }, { remittancePermissions: [1] }, { remittancePermissions: ["remittances.view"], role: "admin" } ]) {
    assert.equal((await post(`/api/usuarios/${target.id}/permisos`, { permissionIds: [1], revision: 0, ...extra })).statusCode, 400);
    assert.deepEqual(await store.read(), before);
  }
});

test("limited account administration cannot bypass individual restrictions by creating a privileged role", async (t) => {
  const { account, grant, login, post, store } = await setup(t), limited = await account("admin");
  assert.equal((await grant(limited.id, [1, 101, 102], [])).statusCode, 200);
  const token = await login(limited.email, "Ficticia-segura-2026!");
  const before = await store.read();
  // A Cajero starts with its role profile, so creating one also needs permission 106.
  for (const role of ["admin", "cashier"]) {
    const forbidden = await post("/api/usuarios", { role, name: "No autorizado", email: `blocked-${role}@example.invalid`, password: "Ficticia-Segura-2026!" }, token);
    assert.equal(forbidden.statusCode, 403, role); assert.deepEqual(await store.read(), before);
  }
  const allowed = await post("/api/usuarios", { role: "client", name: "Sin permisos iniciales", email: "unprivileged-user@example.invalid", password: "Ficticia-Segura-2026!" }, token);
  assert.equal(allowed.statusCode, 200, allowed.body); assert.equal(allowed.json().role, "client");
});

test("editing a catalog record cannot hide an unauthorized activation change inside its full payload", async (t) => {
  const { account, grant, login, post, store } = await setup(t), editor = await account("admin");
  const created = await post("/api/zonas", { name: "Zona sintética para permisos" });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal((await grant(editor.id, [1, 120, 122], [])).statusCode, 200);
  const token = await login(editor.email, "Ficticia-segura-2026!"), zone = created.json();
  await store.transaction((state) => { delete state.zones.find(({ id }) => id === zone.id)!.active; });
  const before = await store.read();
  const denied = await post(`/api/zonas/${zone.id}`, { name: zone.name, active: false }, token);
  assert.equal(denied.statusCode, 403); assert.deepEqual(await store.read(), before);
  assert.equal((await post(`/api/zonas/${zone.id}`, { name: `${zone.name} QA`, active: true }, token)).statusCode, 200,
    "saving an existing active legacy row does not require inactivation permission");
});

test("an Admin cannot remove his own access or the permission administration from himself", async (t) => {
  const { store, post, login, account } = await setup(t);
  const own = await account("admin"), token = await login(own.email, "Ficticia-segura-2026!");
  const before = (await store.read()).accounts.find(({ id }) => id === own.id)!;
  const refused = await post(`/api/usuarios/${own.id}/permisos`, { mode: "custom", permissionIds: [1, 10, 101], remittancePermissions: [], revision: before.permissionRevision ?? 0 }, token);
  assert.equal(refused.statusCode, 409, refused.body); assert.equal(refused.json().error.code, "OWN_ADMIN_ACCESS");
  const after = (await store.read()).accounts.find(({ id }) => id === own.id)!;
  assert.equal(after.permissionRevision ?? 0, before.permissionRevision ?? 0); assert.equal(after.permissionMode ?? "role", before.permissionMode ?? "role");
});
