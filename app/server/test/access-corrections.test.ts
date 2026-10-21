import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";
import { getAdminTools } from "../src/admin-tools.js";
import { createDemoStationControl } from "../src/rraa.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import * as access from "../../shared/access.mjs";

// Corrections of the PR 36 review (points S1–S17), with synthetic accounts and data only.
// Cases of one point are compared as a whole table, so a regression shows every broken case at once.
const { rolePermissionIds, roleRemittancePermissions } = access;
const password = "Clave-ficticia-correcciones-2026!";
const configured = { adminEmail: "principal@example.invalid", adminPassword: "Principal-ficticia-2026!" };
type Reply = { statusCode: number; body: string; json(): any };
const code = (reply: Reply) => reply.json().error?.code;
const outcome = (reply: Reply) => [reply.statusCode, code(reply)];
const denied = (reason: string) => [403, reason];

async function setup(t: TestContext, mode: "demo" | "configured" = "demo") {
  const store = new MemoryStore(seed());
  const app = await buildApp({ store, secret: "synthetic-access-corrections-secret-at-least-32", origins: [], collectorUrl: "http://localhost:5174",
    ...(mode === "demo" ? { demo: true, demoStationControl: createDemoStationControl() } : { demo: false, ...configured }) });
  t.after(() => app.close());
  // Each request comes from its own synthetic address so the login rate limit does not interfere.
  let address = 0;
  const remoteAddress = () => { address += 1; return `10.42.${Math.floor(address / 250)}.${address % 250 + 1}`; };
  const get = (url: string, token: string): Promise<Reply> => app.inject({ url, remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${token}` } });
  const post = (url: string, payload: object, token: string, key = randomUUID()): Promise<Reply> => app.inject({ method: "POST", url, payload,
    remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  const login = async (email: string, secret = password) => {
    const reply = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: remoteAddress(), payload: { email, password: secret } });
    assert.equal(reply.statusCode, 200, reply.body);
    return reply.json().token as string;
  };
  const admin = mode === "demo" ? await login("admin@cyp.local", DEMO_PASSWORD) : await login(configured.adminEmail, configured.adminPassword);
  const account = async (role = "client", extra: Record<string, unknown> = {}) => {
    const email = `${role}-${randomUUID()}@example.invalid`;
    const reply = await post("/api/usuarios", { name: `Cuenta ${role} sintética`, email, role, password, ...extra }, admin);
    assert.equal(reply.statusCode, 200, reply.body);
    const row = reply.json() as { id: string; name: string; role: string };
    return { ...row, email, token: await login(email) };
  };
  const grant = async (id: string, permissionIds: number[], remittancePermissions: string[] = []) => {
    const revision = (await get(`/api/usuarios/${id}/permisos`, admin)).json().revision as number;
    const reply = await post(`/api/usuarios/${id}/permisos`, { mode: "custom", permissionIds, remittancePermissions, revision }, admin);
    assert.equal(reply.statusCode, 200, reply.body);
  };
  // An Admin account in personalized mode with the entry code and the given codes.
  const limitedAdmin = async (ids: number[]) => { const row = await account("admin"); await grant(row.id, [1, ...ids]); return row; };
  const send = async (token: string, body: Record<string, unknown>) => {
    const quoted = await get("/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=10000", token);
    assert.equal(quoted.statusCode, 200, quoted.body);
    const { sourceCurrency, destinationCurrency, amount, quote } = quoted.json();
    return post("/api/envios", { sourceCurrency, destinationCurrency, amount, quote, ...body }, token);
  };
  const openCash = (operatorId: string, token = admin) => post("/api/envios/cajas/abrir", { operatorId, currency: "DOP", openingAmount: 0 }, token);
  const activeSession = async (userId: string) => getAdminTools(await store.read()).sessions.find((row) => row.userId === userId && !row.revokedAt)!;
  const accountRows = async (ids: string[]) => structuredClone((await store.read()).accounts.filter(({ id }) => ids.includes(id)));
  return { store, app, admin, get, post, login, account, grant, limitedAdmin, send, openCash, activeSession, accountRows };
}

test("S1 107, 103, 104, 106 and 116 cannot take over, demote, lock out or sign out a broader account", async (t) => {
  const { admin, get, post, account, limitedAdmin, activeSession, accountRows } = await setup(t);
  const m107 = await limitedAdmin([101, 107]), m103 = await limitedAdmin([101, 103]), m104 = await limitedAdmin([101, 104]);
  const m106 = await limitedAdmin([101, 103, 106]), m116 = await limitedAdmin([115, 116]);
  // Each attempt has its own target, so one result never hides another.
  const targets = { password: await account("admin"), demote: await account("admin"), supervisor: await account("supervisor"), signIn: await account("admin"),
    demote106: await account("admin"), disable: await account("admin"), reactivate: await account("admin"), session: await account("admin"), plain: await account("client") };
  assert.equal((await post(`/api/usuarios/${targets.reactivate.id}/estado`, { status: "disabled" }, admin)).statusCode, 200);
  const ids = Object.values(targets).map(({ id }) => id), before = await accountRows(ids), session = await activeSession(targets.session.id);
  const profile = (row: { name: string; email: string }, role: string, name = row.name) => ({ name, email: row.email, role });
  const attempts = {
    "107 resets its password": await post(`/api/usuarios/${targets.password.id}/clave`, { password: "Tomada-ficticia-2026" }, m107.token),
    "103 demotes an Admin": await post(`/api/usuarios/${targets.demote.id}`, profile(targets.demote, "client"), m103.token),
    "103 demotes a Supervisor": await post(`/api/usuarios/${targets.supervisor.id}`, profile(targets.supervisor, "undefined"), m103.token),
    "103 promotes a Usuario to Admin": await post(`/api/usuarios/${targets.plain.id}`, profile(targets.plain, "admin"), m103.token),
    "103 changes its sign-in data": await post(`/api/usuarios/${targets.signIn.id}`, profile(targets.signIn, "admin", "Nombre cambiado"), m103.token),
    "106 demotes it": await post(`/api/usuarios/${targets.demote106.id}`, profile(targets.demote106, "client"), m106.token),
    "104 disables it": await post(`/api/usuarios/${targets.disable.id}/estado`, { status: "disabled" }, m104.token),
    "104 reactivates it": await post(`/api/usuarios/${targets.reactivate.id}/estado`, { status: "active" }, m104.token),
    "116 closes its session": await post(`/api/sesiones/${session.id}/cerrar`, {}, m116.token),
  };
  assert.deepEqual(Object.fromEntries(Object.entries(attempts).map(([label, reply]) => [label, outcome(reply)])), {
    "107 resets its password": denied("ACCOUNT_MORE_PRIVILEGED"),
    "103 demotes an Admin": denied("PERMISSION_REQUIRED"),
    "103 demotes a Supervisor": denied("PERMISSION_REQUIRED"),
    "103 promotes a Usuario to Admin": denied("PERMISSION_REQUIRED"),
    "103 changes its sign-in data": denied("ACCOUNT_MORE_PRIVILEGED"),
    "106 demotes it": denied("ACCOUNT_MORE_PRIVILEGED"),
    "104 disables it": denied("ACCOUNT_MORE_PRIVILEGED"),
    "104 reactivates it": denied("ACCOUNT_MORE_PRIVILEGED"),
    "116 closes its session": denied("ACCOUNT_MORE_PRIVILEGED"),
  });
  assert.deepEqual(await accountRows(ids), before, "no account changed");
  assert.equal((await activeSession(targets.session.id))?.id, session.id);
  assert.equal((await get("/api/usuarios", targets.password.token)).statusCode, 200, "the broader account keeps working");
});

test("S1 accounts within the actor's own access, and administrators with full access, stay manageable", async (t) => {
  const { post, account, limitedAdmin, activeSession } = await setup(t);
  const m107 = await limitedAdmin([101, 107]), m103 = await limitedAdmin([101, 103]), m104 = await limitedAdmin([101, 104]), m116 = await limitedAdmin([115, 116]);
  const plain = await account("client"), narrower = await limitedAdmin([115]), broader = await account("admin"), peer = await account("admin");
  const attempts = {
    "107 resets a Usuario password": await post(`/api/usuarios/${plain.id}/clave`, { password: "Reiniciada-ficticia-2026" }, m107.token),
    "103 renames a Usuario": await post(`/api/usuarios/${plain.id}`, { name: "Usuario renombrado", email: plain.email, role: "client" }, m103.token),
    // Informative fields do not revoke sessions and stay with 103.
    "103 sets the nickname of a broader account": await post(`/api/usuarios/${m107.id}`, { name: m107.name, email: m107.email, role: "admin", nickname: "Apodo" }, m103.token),
    "104 disables a Usuario": await post(`/api/usuarios/${plain.id}/estado`, { status: "disabled" }, m104.token),
    "104 reactivates a Usuario": await post(`/api/usuarios/${plain.id}/estado`, { status: "active" }, m104.token),
    "116 closes a narrower session": await post(`/api/sesiones/${(await activeSession(narrower.id)).id}/cerrar`, {}, m116.token),
    "a full Admin disables a broader account": await post(`/api/usuarios/${broader.id}/estado`, { status: "disabled" }, peer.token),
    "a full Admin reactivates it": await post(`/api/usuarios/${broader.id}/estado`, { status: "active" }, peer.token),
    "a full Admin resets its password": await post(`/api/usuarios/${broader.id}/clave`, { password: "Reiniciada-ficticia-2026" }, peer.token),
    "a full Admin closes another session": await post(`/api/sesiones/${(await activeSession(m116.id)).id}/cerrar`, {}, peer.token),
    "a full Admin demotes it": await post(`/api/usuarios/${broader.id}`, { name: broader.name, email: broader.email, role: "client" }, peer.token),
  };
  for (const [label, reply] of Object.entries(attempts)) assert.equal(reply.statusCode, 200, `${label}: ${reply.body}`);
});

test("S1 the demo bootstrap administrator is changed only by itself", async (t) => {
  const { admin, get, post, login, account, activeSession } = await setup(t);
  const other = await account("admin");
  const changed = "Nueva-ficticia-principal-2026";
  assert.equal((await post("/api/usuarios/demo-admin/clave", { currentPassword: DEMO_PASSWORD, password: changed }, admin)).statusCode, 200);
  const bootstrap = await login("admin@cyp.local", changed), session = await activeSession("demo-admin");
  const attempts = {
    password: await post("/api/usuarios/demo-admin/clave", { password: "Robada-ficticia-2026" }, other.token),
    profile: await post("/api/usuarios/demo-admin", { name: "Administración", email: "admin@cyp.local", role: "admin", nickname: "Cambiado" }, other.token),
    role: await post("/api/usuarios/demo-admin", { name: "Administración", email: "admin@cyp.local", role: "client" }, other.token),
    status: await post("/api/usuarios/demo-admin/estado", { status: "disabled" }, other.token),
    permissions: await post("/api/usuarios/demo-admin/permisos", { mode: "custom", permissionIds: [1], remittancePermissions: [], revision: 0 }, other.token),
    session: await post(`/api/sesiones/${session.id}/cerrar`, {}, other.token),
  };
  const protectedAccount = denied("ACCOUNT_PROTECTED");
  assert.deepEqual(Object.fromEntries(Object.entries(attempts).map(([label, reply]) => [label, outcome(reply)])),
    { password: protectedAccount, profile: protectedAccount, role: protectedAccount, status: protectedAccount, permissions: protectedAccount, session: protectedAccount });
  assert.equal((await get("/api/usuarios", bootstrap)).statusCode, 200);
  assert.equal((await post("/api/usuarios/demo-admin", { name: "Administración", email: "admin@cyp.local", role: "admin", nickname: "Principal" }, bootstrap)).statusCode, 200);
  assert.equal((await post(`/api/usuarios/${other.id}/estado`, { status: "disabled" }, bootstrap)).statusCode, 200, "it still manages the others");
});

test("S1 the configured bootstrap administrator is changed only by itself", async (t) => {
  const { admin, get, post, login, account, activeSession } = await setup(t, "configured");
  const other = await account("admin");
  // Before its first own password change it is not stored yet, but its sessions are.
  const early = await post(`/api/sesiones/${(await activeSession("configured-admin")).id}/cerrar`, {}, other.token);
  assert.deepEqual(outcome(early), denied("ACCOUNT_PROTECTED"));
  const changed = "Nueva-ficticia-configurada-2026";
  assert.equal((await post("/api/usuarios/configured-admin/clave", { currentPassword: configured.adminPassword, password: changed }, admin)).statusCode, 200);
  const bootstrap = await login(configured.adminEmail, changed), session = await activeSession("configured-admin");
  const attempts = {
    password: await post("/api/usuarios/configured-admin/clave", { password: "Robada-ficticia-2026" }, other.token),
    role: await post("/api/usuarios/configured-admin", { name: "Administración", email: configured.adminEmail, role: "client" }, other.token),
    status: await post("/api/usuarios/configured-admin/estado", { status: "disabled" }, other.token),
    session: await post(`/api/sesiones/${session.id}/cerrar`, {}, other.token),
  };
  const protectedAccount = denied("ACCOUNT_PROTECTED");
  assert.deepEqual(Object.fromEntries(Object.entries(attempts).map(([label, reply]) => [label, outcome(reply)])),
    { password: protectedAccount, role: protectedAccount, status: protectedAccount, session: protectedAccount });
  assert.equal((await get("/api/usuarios", bootstrap)).statusCode, 200);
  assert.equal((await post(`/api/usuarios/${other.id}/estado`, { status: "disabled" }, bootstrap)).statusCode, 200, "it still manages the others");
});

test("S2 a role change without 106 cannot turn a personalized Cobrador or a Cajero into a Cliente, nor change any other access", async (t) => {
  const { admin, post, account, grant, limitedAdmin, accountRows } = await setup(t);
  const collector = await account("collector", { collectorId: "col-2" });
  await grant(collector.id, rolePermissionIds("collector"), ["remittances.view", "remittances.create", "remittances.receipts", "remittances.pay"]);
  const cashier = await account("cashier"), desk = await account("cashier");
  await grant(desk.id, [1, 2], ["remittances.view"]);
  const m103 = await limitedAdmin([101, 103]), ids = [collector.id, cashier.id, desk.id], before = await accountRows(ids);
  const change = (target: { id: string; name: string; email: string }, role: string, token = m103.token) =>
    post(`/api/usuarios/${target.id}`, { name: target.name, email: target.email, role }, token);
  assert.deepEqual({
    "personalized Cobrador → Cliente": outcome(await change(collector, "client")),
    "Cajero → Cliente": outcome(await change(cashier, "client")),
    "personalized Cajero → No definido": outcome(await change(desk, "undefined")),
  }, {
    "personalized Cobrador → Cliente": denied("PERMISSION_REQUIRED"),
    "Cajero → Cliente": denied("PERMISSION_REQUIRED"),
    "personalized Cajero → No definido": denied("PERMISSION_REQUIRED"),
  });
  assert.deepEqual(await accountRows(ids), before);
  // Only moving between «No definido» and «Cliente», neither of which has access, stays with 103.
  const blank = await account("undefined");
  assert.equal((await change(blank, "client")).statusCode, 200);
  assert.equal((await change(blank, "undefined")).statusCode, 200);
  // With 106 the change is allowed.
  assert.equal((await change(collector, "client", admin)).statusCode, 200);
});

test("S3 a personalized Cobrador keeps his own record, routes, movements, closed days and totals", async (t) => {
  const { store, get, account, grant } = await setup(t);
  const collector = await account("collector", { collectorId: "col-2" });
  const closed = (collectorId: string, date: string) => ({ id: randomUUID(), collectorId, date, collected: 0, deposited: 0, officeDelivered: 0, paidToClients: 0,
    difference: 0, status: "closed" as const, closedAt: `${date}T22:00:00.000Z`, actorId: "demo-admin" });
  await store.transaction((state) => { state.settlements.push(closed("col-2", "2026-01-05"), closed("col-1", "2026-01-05")); });
  const own = (snapshot: any) => ({ collectors: snapshot.collectors, routes: snapshot.routes, zones: snapshot.zones, movements: snapshot.movements,
    settlements: snapshot.settlements, cashReconciliations: snapshot.cashReconciliations, history: snapshot.history,
    totals: snapshot.totals, totalsByCurrency: snapshot.totalsByCurrency });
  const roleView = (await get("/api/snapshot", collector.token)).json();
  assert.deepEqual(roleView.collectors.map(({ id, collectionLimit }: { id: string; collectionLimit: number }) => [id, collectionLimit]), [["col-2", 2_500_000]]);
  assert.ok(roleView.movements.some(({ type }: { type: string }) => type === "office_delivery"));
  assert.deepEqual(roleView.settlements.map(({ collectorId }: { collectorId: string }) => collectorId), ["col-2"]);
  // Personalized exactly like the role profile: the terminal sees the same own data.
  await grant(collector.id, rolePermissionIds("collector"), roleRemittancePermissions("collector"));
  assert.deepEqual(own((await get("/api/snapshot", collector.token)).json()), own(roleView));
  // Even with only the entry codes, his own cash data stays; catalog data follows the permissions.
  await grant(collector.id, [1, 2], []);
  const minimal = (await get("/api/snapshot", collector.token)).json();
  assert.deepEqual(own(minimal), own(roleView));
  assert.deepEqual(minimal.charges, []); assert.deepEqual(minimal.clients, []);
});

test("S4 Cliente and No definido accounts on their role profile change their own password", async (t) => {
  const { post, login, account, grant } = await setup(t);
  for (const role of ["client", "undefined"]) {
    const row = await account(role);
    const reply = await post(`/api/usuarios/${row.id}/clave`, { currentPassword: password, password: "Otra-ficticia-propia-2026" }, row.token);
    assert.equal(reply.statusCode, 200, `${role}: ${reply.body}`);
    await login(row.email, "Otra-ficticia-propia-2026");
  }
  // Personalized permissions can still withdraw it through code 2.
  const desk = await account("cashier");
  await grant(desk.id, [1], ["remittances.view"]);
  const withdrawn = await post(`/api/usuarios/${desk.id}/clave`, { currentPassword: password, password: "Otra-ficticia-propia-2026" }, desk.token);
  assert.equal(withdrawn.statusCode, 403); assert.equal(code(withdrawn), "PERMISSION_REQUIRED");
  // The interface reads the same rule from the shared module.
  const canChange = (role: string, selection?: Parameters<typeof access.effectiveAccess>[1]) => access.canChangeOwnPassword({ role, access: access.effectiveAccess(role, selection) });
  assert.deepEqual(["client", "undefined", "cashier", "collector", "supervisor", "admin"].map((role) => canChange(role)), [true, true, true, true, true, true]);
  assert.equal(canChange("cashier", { permissionMode: "custom", permissionIds: [1], remittancePermissions: ["remittances.view"] }), false);
  assert.equal(canChange("cashier", { permissionMode: "custom", permissionIds: [1, 2], remittancePermissions: ["remittances.view"] }), true);
});

test("S5 the full edit of a collector cannot change his limits without 156", async (t) => {
  const { store, post, limitedAdmin } = await setup(t);
  const editor = await limitedAdmin([150, 152]);
  const limits = await post("/api/cobradores/col-1", { name: "Cobrador", collectionLimit: 99_900_000, payoutLimit: 99_900_000 }, editor.token);
  assert.deepEqual(outcome(limits), denied("PERMISSION_REQUIRED"));
  assert.deepEqual((({ collectionLimit, payoutLimit }) => [collectionLimit, payoutLimit])((await store.read()).collectors.find(({ id }) => id === "col-1")!), [2_500_000, 1_000_000]);
  assert.equal((await post("/api/cobradores/col-1", { name: "Cobrador renombrado" }, editor.token)).statusCode, 200, "editing the rest stays with 152");
  assert.equal((await post("/api/cobradores/col-1", { name: "Cobrador", collectionLimit: 3_000_000, payoutLimit: 1_000_000 }, (await limitedAdmin([150, 152, 156])).token)).statusCode, 200);
});

test("S6 generating recurring charges creates real charges, so it also needs 300 and 301", async (t) => {
  const { store, post, limitedAdmin } = await setup(t);
  const charges = (await store.read()).charges.length;
  const batch = { clientIds: ["cli-1"], service: "Préstamo", amount: 5_000_000, dueDate: "2026-10-30" };
  const templatesOnly = await post("/api/cargos/recurrentes", batch, (await limitedAdmin([350, 351])).token);
  assert.deepEqual(outcome(templatesOnly), denied("PERMISSION_REQUIRED"));
  assert.equal((await store.read()).charges.length, charges);
  assert.equal((await post("/api/cargos/recurrentes", batch, (await limitedAdmin([300, 301, 350, 351])).token)).statusCode, 200);
});

test("S7 closing the collector's day also needs «Cerrar Día» (403)", async (t) => {
  const { store, admin, get, post, limitedAdmin } = await setup(t);
  const date = (await get("/api/snapshot", admin)).json().businessDate;
  const settlements = (await store.read()).settlements.length;
  const close = await post("/api/cuadres", { collectorId: "col-3", date }, (await limitedAdmin([401, 402])).token);
  assert.deepEqual(outcome(close), denied("PERMISSION_REQUIRED"));
  assert.equal((await store.read()).settlements.length, settlements);
  assert.equal((await post("/api/cuadres", { collectorId: "col-3", date }, (await limitedAdmin([401, 402, 403])).token)).statusCode, 200);
});

test("S8 the full edit of PCPs, stations and recurring payouts cannot inactivate or archive without that permission", async (t) => {
  const { store, admin, post, limitedAdmin } = await setup(t);
  const group = (await post("/api/grupos-pcp", { name: "Grupo sintético" }, admin)).json();
  const pcpBody = (number: string, extra: object = {}) => ({ name: `PCP ${number}`, number, groupId: group.id, ...extra });
  const pcp = (await post("/api/pcps", pcpBody("QA-PCP-1"), admin)).json(), inactivePcp = (await post("/api/pcps", pcpBody("QA-PCP-2"), admin)).json();
  assert.equal((await post(`/api/pcps/${inactivePcp.id}`, pcpBody("QA-PCP-2", { active: false }), admin)).statusCode, 200);
  const station = (await post("/api/estaciones", { name: "EST-PRUEBA-01", deviceId: "DISP-PRUEBA-01", active: true }, admin)).json();
  const stationBody = (extra: object = {}) => ({ name: "EST-PRUEBA-01", deviceId: "DISP-PRUEBA-01", ...extra });
  const template = (await post("/api/descargos-recurrentes", { clientId: "cli-1", concept: "Pago fijo sintético", amount: 10_000, frequency: "monthly", nextRunDate: "2026-11-01" }, admin)).json();
  const pcpEditor = await limitedAdmin([170, 172]), stationEditor = await limitedAdmin([111, 113]), payoutEditor = await limitedAdmin([390, 392]);
  assert.deepEqual({
    "172 inactivates a PCP": outcome(await post(`/api/pcps/${pcp.id}`, pcpBody("QA-PCP-1", { active: false }), pcpEditor.token)),
    "113 inactivates a station": outcome(await post(`/api/estaciones/${station.id}`, stationBody({ active: false }), stationEditor.token)),
    "392 archives a recurring payout": outcome(await post(`/api/descargos-recurrentes/${template.id}`, { status: "archived" }, payoutEditor.token)),
  }, {
    "172 inactivates a PCP": denied("PERMISSION_REQUIRED"),
    "113 inactivates a station": denied("PERMISSION_REQUIRED"),
    "392 archives a recurring payout": denied("PERMISSION_REQUIRED"),
  });
  // Omitting `active` in an edit keeps the current state instead of switching it silently.
  assert.equal((await post(`/api/pcps/${inactivePcp.id}`, pcpBody("QA-PCP-2", { name: "PCP renombrado" }), pcpEditor.token)).statusCode, 200);
  assert.equal((await post(`/api/estaciones/${station.id}`, stationBody({ description: "Descripción sintética" }), stationEditor.token)).statusCode, 200);
  const rows = async () => { const state = await store.read(), tools = getAdminTools(state);
    return { pcp: tools.pcps.find(({ id }) => id === pcp.id)!.active, inactivePcp: tools.pcps.find(({ id }) => id === inactivePcp.id)!.active,
      station: tools.stations.find(({ id }) => id === station.id)!.active, payout: state.payoutRecurring.find(({ id }) => id === template.id)!.status }; };
  assert.deepEqual(await rows(), { pcp: true, inactivePcp: false, station: true, payout: "active" });
  // With the permission of each action.
  assert.equal((await post(`/api/pcps/${inactivePcp.id}`, pcpBody("QA-PCP-2", { active: true }), (await limitedAdmin([170, 172, 173])).token)).statusCode, 200);
  assert.equal((await post(`/api/descargos-recurrentes/${template.id}`, { status: "paused" }, payoutEditor.token)).statusCode, 200, "pausing stays with 392");
  assert.equal((await post(`/api/descargos-recurrentes/${template.id}`, { status: "archived" }, (await limitedAdmin([390, 392, 393])).token)).statusCode, 200);
});

test("S10 a duplicate document in the quick sign-up says how to continue", async (t) => {
  const { store, admin, get, account, send, openCash } = await setup(t);
  await store.transaction((state) => {
    const inactive = state.clients.find(({ id }) => id === "cli-1")!; inactive.identification = "001-0000001-1"; inactive.active = false;
    state.clients.find(({ id }) => id === "cli-2")!.identification = "QA-DOC-CLI-2";
    state.clients.find(({ id }) => id === "cli-5")!.identification = "PAS-QA-RUTA-2";
  });
  const cashier = await account("cashier"), collector = await account("collector", { collectorId: "col-1" });
  assert.equal((await openCash(cashier.id, cashier.token)).statusCode, 200);
  assert.equal((await openCash(collector.id, admin)).statusCode, 200);
  const draft = (identification: string, routeId = "route-1") => ({ name: "Cliente nuevo sintético", identification, phone: "", address: "", routeId, preferredCurrency: "DOP" });
  const before = await store.read();
  assert.deepEqual({
    // Inactive record: the search cannot show it, so ask Administration to reactivate it.
    "inactive record": outcome(await send(cashier.token, { newSenderClient: draft("00100000011"), recipientClientId: "cli-3" })),
    // The same person on both sides, as two new records or as the selected sender.
    "same document on both new records": outcome(await send(cashier.token, { newSenderClient: draft("QA-MISMA-1"), newRecipientClient: draft("qa misma 1") })),
    "same document as the selected sender": outcome(await send(cashier.token, { senderClientId: "cli-2", newRecipientClient: draft("QA DOC CLI 2") })),
    // A desk serves any route: the active record is found by its document.
    "desk, active record of another route": outcome(await send(cashier.token, { newSenderClient: draft("PAS-QA-RUTA-2"), recipientClientId: "cli-3" })),
    // A collector cannot send from another route, but can choose that record as recipient.
    "collector sender of another route": outcome(await send(collector.token, { newSenderClient: draft("PAS-QA-RUTA-2"), recipientClientId: "cli-3" })),
    "collector recipient of another route": outcome(await send(collector.token, { senderClientId: "cli-2", newRecipientClient: draft("PAS-QA-RUTA-2") })),
  }, {
    "inactive record": [409, "CLIENT_INACTIVE_EXISTS"],
    "same document on both new records": [422, "SAME_CLIENT"],
    "same document as the selected sender": [422, "SAME_CLIENT"],
    "desk, active record of another route": [409, "CLIENT_ALREADY_EXISTS"],
    "collector sender of another route": [409, "CLIENT_OTHER_ROUTE"],
    "collector recipient of another route": [409, "CLIENT_ALREADY_EXISTS"],
  });
  const after = await store.read();
  assert.equal(after.clients.length, before.clients.length); assert.deepEqual(after.clientIdentityReservations, before.clientIdentityReservations);
  assert.deepEqual((await get("/api/envios/clientes/buscar?query=PAS-QA-RUTA-2&side=sender", cashier.token)).json().ids, ["cli-5"]);
  assert.deepEqual((await get("/api/envios/clientes/buscar?query=PAS-QA-RUTA-2&side=recipient&senderId=cli-2", collector.token)).json().ids, ["cli-5"]);
});

test("S11 the Cobrador profile keeps the quick sign-up during a remittance, only in his own route (intentional since PR 36)", async (t) => {
  const { store, account, send, openCash } = await setup(t);
  assert.ok(roleRemittancePermissions("collector").includes("remittances.clients.create"));
  assert.equal(rolePermissionIds("collector").includes(141), false, "the catalog sign-up (141) stays out of the profile");
  const collector = await account("collector", { collectorId: "col-1" });
  assert.equal((await openCash(collector.id)).statusCode, 200);
  const draft = (identification: string, routeId: string) => ({ name: "Destinatario sintético", identification, phone: "", address: "", routeId, preferredCurrency: "DOP" });
  const other = await send(collector.token, { senderClientId: "cli-2", newRecipientClient: draft("QA-S11-OTRA", "route-2") });
  assert.deepEqual(outcome(other), [422, "ROUTE_NOT_FOUND"]);
  const own = await send(collector.token, { senderClientId: "cli-2", newRecipientClient: draft("QA-S11-PROPIA", "route-1") });
  assert.equal(own.statusCode, 200, own.body);
  assert.equal((await store.read()).clients.find(({ id }) => id === own.json().recipientClientId)!.routeId, "route-1");
});

test("S12 Supervisor consults every remittance, receipt, cash box and report without acting on them", async (t) => {
  const { get, post, account, send, openCash } = await setup(t);
  const cashier = await account("cashier");
  assert.equal((await openCash(cashier.id, cashier.token)).statusCode, 200);
  const sent = await send(cashier.token, { senderClientId: "cli-1", recipientClientId: "cli-2" });
  assert.equal(sent.statusCode, 200, sent.body);
  const supervisor = await account("supervisor");
  const outgoing = (await get("/api/envios", supervisor.token)).json(), receipts = (await get("/api/envios/recibos", supervisor.token)).json();
  assert.deepEqual(outgoing.map(({ id }: { id: string }) => id), [sent.json().id]); assert.deepEqual(receipts.map(({ id }: { id: string }) => id), [sent.json().id]);
  assert.equal(outgoing[0].canPay, false); assert.equal(outgoing[0].canCancel, false);
  const snapshot = (await get("/api/envios/snapshot", supervisor.token)).json();
  assert.equal(snapshot.transfers.length, 1);
  assert.deepEqual(snapshot.cashSessions.map(({ operatorId, canClose }: { operatorId: string; canClose: boolean }) => [operatorId, canClose]), [[cashier.id, false]]);
  const date = snapshot.businessDate, report = (await get(`/api/envios/reportes?from=${date}&to=${date}`, supervisor.token)).json();
  assert.equal(report.amounts[0].count, 1); assert.equal(report.cash.length, 1);
  assert.equal((await post(`/api/envios/${sent.json().id}/pagar`, {}, supervisor.token)).statusCode, 403, "still read-only");
});

test("S13 consultation-only accounts receive the names of their remittances without the client catalog", async (t) => {
  const { store, get, account, grant, send, openCash } = await setup(t);
  const desk = await account("cashier");
  await grant(desk.id, [1, 2], ["remittances.view", "remittances.create"]);
  assert.equal((await openCash(desk.id)).statusCode, 200);
  for (const [senderClientId, recipientClientId] of [["cli-1", "cli-2"], ["cli-3", "cli-4"]])
    assert.equal((await send(desk.token, { senderClientId, recipientClientId })).statusCode, 200);
  // The second row stands for a remittance saved before the frozen contacts existed.
  await store.transaction((state) => { delete state.remittances.transfers[1].senderContact; delete state.remittances.transfers[1].recipientContact; });
  await grant(desk.id, [1, 2], ["remittances.view"]);
  const rows = (await get("/api/envios", desk.token)).json();
  assert.deepEqual(rows.map((row: any) => [row.senderContact?.name ?? null, row.recipientContact?.name ?? null]), [["Colmado La Esquina", "María Rodríguez"], [null, null]]);
  const snapshot = (await get("/api/envios/snapshot", desk.token)).json();
  assert.deepEqual(snapshot.clients.map(({ id, name }: { id: string; name: string }) => [id, name]),
    [["cli-1", "Colmado La Esquina"], ["cli-2", "María Rodríguez"], ["cli-3", "Taller Don Pedro"], ["cli-4", "Farmacia Central"]]);
  for (const row of snapshot.clients) assert.equal(Object.hasOwn(row, "phone"), false);
  const unrelated = await account("cashier");
  await grant(unrelated.id, [1, 2], ["remittances.view"]);
  assert.deepEqual((await get("/api/envios/snapshot", unrelated.token)).json().clients, [], "no operations, no clients");
});

test("S15 a new recipient without its own phone keeps the phone written for the remittance", async (t) => {
  const { store, account, send, openCash } = await setup(t);
  const cashier = await account("cashier");
  assert.equal((await openCash(cashier.id, cashier.token)).statusCode, 200);
  const created = await send(cashier.token, { senderClientId: "cli-1", recipientPhone: "809-555-0199",
    newRecipientClient: { name: "Destinatario sintético", identification: "QA-SIN-TEL-1", phone: "", address: "", routeId: "route-2", preferredCurrency: "DOP" } });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(created.json().recipientContact.phone, "809-555-0199");
  assert.equal((await store.read()).clients.find(({ id }) => id === created.json().recipientClientId)!.phone, "809-555-0199");
  // An existing record is still completed only by administration.
  await store.transaction((state) => { state.clients.find(({ id }) => id === "cli-3")!.phone = ""; });
  assert.equal((await send(cashier.token, { senderClientId: "cli-1", recipientClientId: "cli-3", recipientPhone: "809-555-0177" })).statusCode, 200);
  assert.equal((await store.read()).clients.find(({ id }) => id === "cli-3")!.phone, "");
});

test("S16 the snapshot says which operators can register a remittance", async (t) => {
  const { admin, get, account, grant, send, openCash } = await setup(t);
  const receiptsOnly = await account("cashier"), viewOnlyCollector = await account("collector", { collectorId: "col-2" }), cashier = await account("cashier");
  await grant(receiptsOnly.id, [1, 2], ["remittances.receipts"]);
  await grant(viewOnlyCollector.id, rolePermissionIds("collector"), ["remittances.view"]);
  const snapshot = (await get("/api/envios/snapshot", admin)).json();
  const listed = snapshot.operators.map(({ id }: { id: string }) => id), sending = new Set<string>(snapshot.sendingOperatorIds ?? []);
  for (const id of [receiptsOnly.id, viewOnlyCollector.id, cashier.id, "demo-admin", "demo-collector"]) assert.ok(listed.includes(id), id);
  assert.deepEqual([receiptsOnly.id, viewOnlyCollector.id, cashier.id, "demo-admin", "demo-collector"].map((id) => sending.has(id)), [false, false, true, true, true]);
  // The cash box of a payer can still be opened; sending on its behalf is refused, as the list announces.
  assert.equal((await openCash(receiptsOnly.id)).statusCode, 200);
  const refused = await send(admin, { senderClientId: "cli-1", recipientClientId: "cli-2", sendingUserId: receiptsOnly.id });
  assert.deepEqual(outcome(refused), denied("OPERATOR_FORBIDDEN"));
  assert.deepEqual((await get("/api/envios/snapshot", cashier.token)).json().sendingOperatorIds, [cashier.id]);
});

test("S17 the collector monitor needs 501; zone and route monitors keep 500", async (t) => {
  const { get, limitedAdmin } = await setup(t);
  const monitors = await limitedAdmin([500]), collectorMonitor = await limitedAdmin([501]);
  assert.deepEqual({
    "500 opens the collector map": (await get("/api/monitoring/collector/col-1/map-data", monitors.token)).statusCode,
    "500 opens the route map": (await get("/api/monitoring/route/route-1/map-data", monitors.token)).statusCode,
    "501 opens the collector map": (await get("/api/monitoring/collector/col-1/map-data", collectorMonitor.token)).statusCode,
  }, { "500 opens the collector map": 403, "500 opens the route map": 200, "501 opens the collector map": 200 });
});
