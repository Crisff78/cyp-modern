import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import { permissionCatalog } from "../src/user-permissions.js";
import {
  accessRole, canOpenPage, effectiveAccess, REMITTANCE_PERMISSION_KEYS, roleRemittancePermissions, rolePermissionIds,
  type RemittancePermission,
} from "../../shared/access.mjs";

const password = "Clave-ficticia-cajero-2026!";
const cashierKeys = ["remittances.view", "remittances.create", "remittances.receipts", "remittances.pay", "remittances.cancel",
  "remittances.clients.create", "remittances.cash.view", "remittances.cash.open", "remittances.cash.close"];
type Reply = { statusCode: number; body: string; json(): any };
type Transfer = { id: string; status: string; sendingUserId: string; registeredBy: string; paidBy?: string; canPay: boolean; canCancel: boolean };
const code = (reply: Reply) => reply.json().error?.code;
const ids = (rows: { id: string }[]) => rows.map(({ id }) => id).sort();

async function setup(t: TestContext) {
  const store = new MemoryStore(seed());
  const app = await buildApp({ store, demo: true, secret: "synthetic-cashier-role-secret-at-least-32-chars", origins: [], collectorUrl: "http://localhost:5174" });
  t.after(() => app.close());
  // Each request comes from its own synthetic address so the login rate limit does not interfere.
  let address = 0;
  const remoteAddress = () => { address += 1; return `10.41.${Math.floor(address / 250)}.${address % 250 + 1}`; };
  const get = (url: string, token: string): Promise<Reply> => app.inject({ url, remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${token}` } });
  const post = (url: string, payload: object, token: string, key = randomUUID()): Promise<Reply> => app.inject({ method: "POST", url, payload,
    remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  const login = async (email: string, secret = password) => {
    const reply = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: remoteAddress(), payload: { email, password: secret } });
    assert.equal(reply.statusCode, 200, reply.body);
    return reply.json().token as string;
  };
  const admin = await login("admin@cyp.local", DEMO_PASSWORD), collector = await login("collector@cyp.local", DEMO_PASSWORD);
  const create = async (role = "cashier", token = admin) => {
    const email = `${role}-${randomUUID()}@example.invalid`;
    const reply = await post("/api/usuarios", { name: `Cuenta ${role} O'Connor`, email, role, password }, token);
    assert.equal(reply.statusCode, 200, reply.body);
    const account = reply.json() as { id: string; name: string; email: string; role: string };
    return { ...account, token: await login(email) };
  };
  const grant = async (id: string, permissionIds: number[], remittancePermissions: string[]) => {
    const revision = (await get(`/api/usuarios/${id}/permisos`, admin)).json().revision as number;
    const reply = await post(`/api/usuarios/${id}/permisos`, { mode: "custom", permissionIds, remittancePermissions, revision }, admin);
    assert.equal(reply.statusCode, 200, reply.body);
  };
  const openCash = (token: string, operatorId: string, currency = "DOP", openingAmount = 0) =>
    post("/api/envios/cajas/abrir", { operatorId, currency, openingAmount }, token);
  const send = async (token: string, body: Record<string, unknown>, amount = 10_000) => {
    const quoted = await get(`/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=${amount}`, token);
    assert.equal(quoted.statusCode, 200, quoted.body);
    const { sourceCurrency, destinationCurrency, quote } = quoted.json();
    return post("/api/envios", { sourceCurrency, destinationCurrency, amount: quoted.json().amount, quote, ...body }, token);
  };
  const sent = async (token: string, senderClientId: string, recipientClientId: string) => {
    const reply = await send(token, { senderClientId, recipientClientId });
    assert.equal(reply.statusCode, 200, reply.body);
    return reply.json() as Transfer;
  };
  return { store, get, post, login, admin, collector, create, grant, openCash, send, sent };
}

test("shared access gives the Cajero its own profile, ceiling and pages without touching other roles", () => {
  assert.equal(accessRole("Cajero"), "cashier"); assert.equal(accessRole("ROLE_CAJERO"), "cashier");
  assert.deepEqual(rolePermissionIds("cashier"), [1, 2]);
  assert.deepEqual(roleRemittancePermissions("cashier"), cashierKeys);
  // Personalized: never rates, commissions or legacy catalogs; the own reports may be added.
  const everything = effectiveAccess("cashier", { permissionMode: "custom", permissionIds: permissionCatalog.permissions.map(({ id }) => id),
    remittancePermissions: [...REMITTANCE_PERMISSION_KEYS] });
  assert.deepEqual(everything.legacy, [1, 2]);
  assert.deepEqual([...everything.remittances].sort(), [...cashierKeys, "remittances.reports"].sort());
  // Opening a cash box stays out of the Collector profile and of the Usuario ceiling.
  assert.equal(roleRemittancePermissions("collector").includes("remittances.cash.open"), false);
  const user = effectiveAccess("user", { permissionMode: "custom", permissionIds: [1, 2], remittancePermissions: [...REMITTANCE_PERMISSION_KEYS] });
  assert.equal(user.remittances.includes("remittances.cash.open"), false);
  assert.equal(user.remittances.includes("remittances.rates.view"), true, "Usuario keeps its personalized path");

  const cashier = { role: "cashier" };
  for (const page of ["remittances", "remittancePayouts", "dailySettlements"]) assert.equal(canOpenPage(cashier, page), true, page);
  for (const page of ["reports", "reportRemittanceCommissions", "clients", "controlPanel", "collectors", "exchangeRates", "remittanceCommissions", "charges", "collections", "users"])
    assert.equal(canOpenPage(cashier, page), false, page);
  const withReports = { role: "cashier", access: effectiveAccess("cashier", { permissionMode: "custom", permissionIds: [1, 2], remittancePermissions: [...cashierKeys, "remittances.reports"] }) };
  assert.equal(canOpenPage(withReports, "reports"), true); assert.equal(canOpenPage(withReports, "reportRemittanceCommissions"), true);
  const custom = (role: string, permissionIds: number[], keys: RemittancePermission[]) => ({ role, access: effectiveAccess(role, { permissionMode: "custom", permissionIds, remittancePermissions: keys }) });
  // Envíos de Dinero needs view; Pagos de Envíos needs receipts.
  const payoutsOnly = custom("user", [1, 2], ["remittances.receipts", "remittances.pay"]);
  assert.equal(canOpenPage(payoutsOnly, "remittances"), false); assert.equal(canOpenPage(payoutsOnly, "remittancePayouts"), true);
  assert.equal(canOpenPage(payoutsOnly, "dailySettlements"), false);
  // Daily settlements: collector settlements (401) or the remittance cash box (cash.view).
  assert.equal(canOpenPage({ role: "admin" }, "dailySettlements"), true);
  assert.equal(canOpenPage({ role: "supervisor" }, "dailySettlements"), true);
  assert.equal(canOpenPage(custom("admin", [1, 401], []), "dailySettlements"), true);
  assert.equal(canOpenPage(custom("admin", [1], ["remittances.cash.view"]), "dailySettlements"), true);
  assert.equal(canOpenPage(custom("admin", [1, 10], ["remittances.view"]), "dailySettlements"), false);
  assert.equal(canOpenPage({ role: "admin" }, "clients"), true);
  assert.equal(canOpenPage({ role: "user" }, "remittances"), false);
});

test("a Cajero starts with its role profile, needs permission 106 and is never linked to a collector", async (t) => {
  const { get, post, admin, create, grant, login, store } = await setup(t);
  const linked = await post("/api/usuarios", { name: "Cajero enlazado", email: `cashier-${randomUUID()}@example.invalid`, role: "cashier", collectorId: "col-1", password }, admin);
  assert.equal(linked.statusCode, 422); assert.equal(code(linked), "COLLECTOR_NOT_ALLOWED");
  const cashier = await create();
  assert.deepEqual((await get(`/api/usuarios/${cashier.id}/permisos`, admin)).json(),
    { userId: cashier.id, permissionIds: [1, 2], mode: "role", remittancePermissions: cashierKeys, revision: 0 });
  assert.deepEqual((await get("/api/auth/me", cashier.token)).json(),
    { id: cashier.id, name: cashier.name, role: "cashier", access: { mode: "role", revision: 0, legacy: [1, 2], remittances: cashierKeys } });
  const linkCashier = await post("/api/cobradores/col-1", { name: "Cobrador", accountId: cashier.id }, admin);
  assert.equal(linkCashier.statusCode, 422); assert.equal(code(linkCashier), "ACCOUNT_ROLE_FORBIDDEN");
  const { token: _token, ...profile } = cashier;
  const edited = await post(`/api/usuarios/${cashier.id}`, { name: profile.name, email: profile.email, role: "cashier", collectorId: "col-1" }, admin);
  assert.equal(edited.statusCode, 422); assert.equal(code(edited), "COLLECTOR_NOT_ALLOWED");
  // A Usuario linked to a collector must be unlinked before becoming a Cajero.
  const user = await create("user");
  assert.equal((await post("/api/cobradores/col-1", { name: "Cobrador", accountId: user.id }, admin)).statusCode, 200);
  const promoted = await post(`/api/usuarios/${user.id}`, { name: user.name, email: user.email, role: "cashier" }, admin);
  assert.equal(promoted.statusCode, 409); assert.equal(code(promoted), "ACCOUNT_LINKED_COLLECTOR");
  assert.equal((await store.read()).accounts.find(({ id }) => id === user.id)?.role, "user");
  // Limited account administration cannot create or promote a Cajero without 106.
  const limited = await create("admin");
  await grant(limited.id, [1, 101, 102], []);
  const limitedToken = await login(limited.email);
  const before = await store.read();
  const blocked = await post("/api/usuarios", { name: "Cajero no autorizado", email: `blocked-${randomUUID()}@example.invalid`, role: "cashier", password }, limitedToken);
  assert.equal(blocked.statusCode, 403, blocked.body);
  assert.equal((await post(`/api/usuarios/${user.id}`, { name: user.name, email: user.email, role: "cashier" }, limitedToken)).statusCode, 403);
  assert.deepEqual(await store.read(), before);
  // Its profile includes code 2, so the Cajero changes his own password.
  const changed = await post(`/api/usuarios/${cashier.id}/clave`, { currentPassword: password, password: "Otra-clave-ficticia-cajero-2026!" }, cashier.token);
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal((await get("/api/auth/me", cashier.token)).statusCode, 401);
});

test("the Cajero opens only his own cash box; Cobrador and Usuario still cannot open one", async (t) => {
  const { get, post, admin, collector, create, grant, openCash, store } = await setup(t);
  const cashier = await create();
  for (const currency of ["DOP", "USD"]) {
    const opened = await openCash(cashier.token, cashier.id, currency, 50_000);
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(opened.json().operatorId, cashier.id); assert.equal(opened.json().openedBy, cashier.id); assert.equal(opened.json().canClose, true);
  }
  const user = await create("user");
  await grant(user.id, [1, 2], [...REMITTANCE_PERMISSION_KEYS]);
  const before = await store.read();
  const foreign = await openCash(cashier.token, "demo-collector", "EUR");
  assert.equal(foreign.statusCode, 403); assert.equal(code(foreign), "FORBIDDEN");
  assert.equal(foreign.json().error.message, "Solo puedes abrir tu propia caja de envíos.");
  assert.equal(code(await openCash(cashier.token, cashier.id, "DOP")), "CASH_EXISTS");
  assert.equal((await openCash(collector, "demo-collector", "DOP")).statusCode, 403);
  assert.equal((await openCash(user.token, user.id, "DOP")).statusCode, 403);
  assert.deepEqual(await store.read(), before);
  // Removing the permission in a personalized profile also removes the own opening.
  await grant(cashier.id, [1, 2], cashierKeys.filter((key) => key !== "remittances.cash.open"));
  const without = await openCash(cashier.token, cashier.id, "EUR");
  assert.equal(without.statusCode, 403); assert.equal(code(without), "PERMISSION_REQUIRED");
  // Administration still opens the Cajero's box and sees him among the operators.
  const operators = (await get("/api/envios/snapshot", admin)).json().operators as { id: string }[];
  assert.deepEqual(operators.find(({ id }) => id === cashier.id), { id: cashier.id, name: cashier.name, role: "cashier" });
  const byAdmin = await openCash(admin, cashier.id, "EUR", 1_000);
  assert.equal(byAdmin.statusCode, 200, byAdmin.body); assert.equal(byAdmin.json().operatorId, cashier.id); assert.equal(byAdmin.json().openedBy, "demo-admin");
  assert.equal((await post(`/api/envios/cajas/${byAdmin.json().id}/cerrar`, { countedAmount: 1_000 }, cashier.token)).statusCode, 200);
});

test("the Cajero serves any client: sends from any route, registers clients anywhere, pays others' receipts and cancels only his own", async (t) => {
  const { store, get, post, admin, collector, create, openCash, send, sent } = await setup(t);
  const cashier = await create();
  assert.equal((await openCash(cashier.token, cashier.id, "DOP", 500_000)).statusCode, 200);
  assert.equal((await openCash(admin, "demo-collector", "DOP")).statusCode, 200);
  const snapshot = (await get("/api/envios/snapshot", cashier.token)).json();
  const state = await store.read();
  assert.equal(snapshot.clients.length, state.clients.length);
  assert.ok(snapshot.clients.every((row: { canSendFrom: boolean; canReceive: boolean }) => row.canSendFrom && row.canReceive));
  assert.deepEqual(snapshot.clientRoutes.map(({ id }: { id: string }) => id).sort(), state.routes.map(({ id }) => id).sort());
  assert.deepEqual(snapshot.operators, [{ id: cashier.id, name: cashier.name, role: "cashier" }]);
  assert.deepEqual(snapshot.rateHistory, []);
  // cli-7 belongs to route-3 (another collector); the Cajero has no route at all.
  assert.deepEqual((await get("/api/envios/clientes/buscar?query=CL-0007&side=sender", cashier.token)).json().ids, ["cli-7"]);
  assert.equal((await get("/api/envios/clientes/cli-7/contacto?side=sender", cashier.token)).statusCode, 200);
  assert.deepEqual((await get("/api/envios/clientes/buscar?query=CL-0007&side=sender", collector)).json().ids, []);
  const own = await sent(cashier.token, "cli-7", "cli-1");
  assert.equal(own.sendingUserId, cashier.id); assert.equal(own.registeredBy, cashier.id);
  const quick = await send(cashier.token, { recipientClientId: "cli-2",
    newSenderClient: { name: "Remitente de práctica O'Connor", identification: "QA-CAJERO-001", phone: "+18095550199", address: "Dirección ficticia", routeId: "route-3", preferredCurrency: "DOP" } });
  assert.equal(quick.statusCode, 200, quick.body);
  assert.equal((await store.read()).clients.find(({ id }) => id === quick.json().senderClientId)?.routeId, "route-3");
  const pendingOther = await sent(collector, "cli-1", "cli-5"), otherToCancel = await sent(collector, "cli-2", "cli-6");
  assert.deepEqual(ids((await get("/api/envios", cashier.token)).json()), [own.id, quick.json().id].sort());
  assert.ok(ids((await get("/api/envios/recibos", cashier.token)).json()).includes(pendingOther.id));
  const paid = await post(`/api/envios/${pendingOther.id}/pagar`, {}, cashier.token);
  assert.equal(paid.statusCode, 200, paid.body); assert.equal(paid.json().paidBy, cashier.id);
  const foreign = await post(`/api/envios/${otherToCancel.id}/cancelar`, { reason: "Prueba ajena" }, cashier.token);
  assert.equal(foreign.statusCode, 403); assert.equal(code(foreign), "FORBIDDEN");
  const cancelled = await post(`/api/envios/${own.id}/cancelar`, { reason: "Error de digitación" }, cashier.token);
  assert.equal(cancelled.statusCode, 200, cancelled.body); assert.equal(cancelled.json().status, "cancelled");
  // He closes his own box with the exact count; without it he cannot send.
  const cash = (await get("/api/envios/snapshot", cashier.token)).json().cashSessions as { id: string; operatorId: string; expected: number }[];
  assert.ok(cash.length === 1 && cash.every(({ operatorId }) => operatorId === cashier.id));
  assert.equal(code(await post(`/api/envios/cajas/${cash[0].id}/cerrar`, { countedAmount: cash[0].expected - 1 }, cashier.token)), "CASH_UNBALANCED");
  const closed = await post(`/api/envios/cajas/${cash[0].id}/cerrar`, { countedAmount: cash[0].expected }, cashier.token);
  assert.equal(closed.statusCode, 200, closed.body); assert.equal(closed.json().status, "closed");
  assert.equal(code(await send(cashier.token, { senderClientId: "cli-5", recipientClientId: "cli-8" })), "CASH_NOT_OPEN");
});

test("the Cajero is refused catalogs, collections, settlements, rates, commissions and configuration; his snapshot carries no legacy data", async (t) => {
  const { store, get, post, admin, create } = await setup(t);
  await store.transaction((state) => {
    state.banks.push({ id: "qa-bank", name: "Banco ficticio", active: true });
    state.delayReasons.push({ id: "qa-delay", reason: "Motivo ficticio", active: true });
    state.services.push({ id: "qa-service", service: "Servicio ficticio", abbr: "SF", caption: "Servicio ficticio", obligated: false, fixedAmount: false, active: true });
  });
  const cashier = await create(), date = (await get("/api/envios/snapshot", cashier.token)).json().businessDate as string;
  const before = await store.read();
  for (const url of ["/api/clientes", "/api/cobradores", "/api/usuarios", "/api/permisos", "/api/configuracion", "/api/cuadres", "/api/bancos", "/api/zonas", "/api/servicios", "/api/cuadres/pendientes?collectorId=col-1",
    `/api/envios/reportes?from=${date}&to=${date}`, `/api/envios/reportes/comisiones?from=${date}&to=${date}`])
    assert.equal((await get(url, cashier.token)).statusCode, 403, url);
  for (const [url, payload] of [["/api/cobros", { chargeId: "chg-1", amount: 100 }], ["/api/cobradores", { name: "No autorizado" }],
    ["/api/clientes", { name: "No autorizado" }], ["/api/envios/tasas", { currency: "USD", rate: "61", date }],
    ["/api/envios/politica-comisiones", { managerCommissionBps: 0 }], ["/api/configuracion", { receiptFooterNote: "No autorizado" }]] as const)
    assert.equal((await post(url, payload, cashier.token)).statusCode, 403, url);
  assert.deepEqual(await store.read(), before);
  const snapshot = (await get("/api/snapshot", cashier.token)).json();
  for (const key of ["banks", "services", "delayReasons", "clients", "routes", "zones", "collectors", "charges", "payouts", "movements", "settlements", "cashReconciliations", "recurringCharges", "payoutRecurring", "history"])
    assert.deepEqual(snapshot[key], [], key);
  assert.deepEqual(snapshot.accounts.map(({ id }: { id: string }) => id), [cashier.id]);
  assert.equal(snapshot.totals.collected, 0);
  // Administration keeps the full operational catalogs.
  const full = (await get("/api/snapshot", admin)).json();
  assert.equal(full.banks.length, 1); assert.equal(full.services.length, 1); assert.equal(full.delayReasons.length, 1);
  assert.equal(full.clients.length, before.clients.length);
});

test("a personalized Cajero never gains rates, commissions or legacy codes, but may add the reports of his own operations", async (t) => {
  const { get, admin, collector, create, grant, openCash, sent, post } = await setup(t);
  const cashier = await create();
  await grant(cashier.id, permissionCatalog.permissions.map(({ id }) => id), [...REMITTANCE_PERMISSION_KEYS]);
  const access = (await get("/api/auth/me", cashier.token)).json().access;
  assert.equal(access.mode, "custom"); assert.deepEqual(access.legacy, [1, 2]);
  assert.deepEqual([...access.remittances].sort(), [...cashierKeys, "remittances.reports"].sort());
  assert.equal((await get("/api/clientes", cashier.token)).statusCode, 403);
  const date = (await get("/api/envios/snapshot", cashier.token)).json().businessDate as string;
  assert.equal((await post("/api/envios/tasas", { currency: "USD", rate: "61", date }, cashier.token)).statusCode, 403);
  assert.equal((await post("/api/envios/politica-comisiones", { managerCommissionBps: 0 }, cashier.token)).statusCode, 403);
  assert.deepEqual((await get("/api/envios/snapshot", cashier.token)).json().rateHistory, []);
  assert.equal((await openCash(cashier.token, cashier.id, "DOP", 100_000)).statusCode, 200);
  assert.equal((await openCash(admin, "demo-collector", "DOP")).statusCode, 200);
  const own = await sent(cashier.token, "cli-5", "cli-1"), other = await sent(collector, "cli-1", "cli-6");
  const report = await get(`/api/envios/reportes?from=${date}&to=${date}`, cashier.token);
  assert.equal(report.statusCode, 200, report.body); assert.equal(report.json().amounts[0].count, 1);
  const consolidated = await get(`/api/envios/reportes/comisiones?from=${date}&to=${date}`, cashier.token);
  assert.equal(consolidated.statusCode, 200, consolidated.body);
  assert.deepEqual(ids(consolidated.json().details), [own.id]);
  assert.ok(ids((await get("/api/envios/recibos", cashier.token)).json()).includes(other.id));
});
