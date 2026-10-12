// Server tests for the October review corrections (points C4.2.1, B5, B9, B21, C5.4, B15 and the access fixes).
// Everything runs in memory with synthetic data: no database, no network and no real credentials.
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import test, { type TestContext } from "node:test";
import { buildApp } from "../src/app.js";
import type { AccountRole } from "../src/account-roles.js";
import { createAuthSession, getAdminTools, type AuthorizationRequest } from "../src/admin-tools.js";
import { businessDate, emptyState, type State, type User } from "../src/domain.js";
import { createRemittance, openRemittanceCash, quoteRemittance, remittanceOperators, setCommissionPolicy, setDailyRate,
  type CreateRemittanceInput, type Currency } from "../src/remittances.js";
import { createDemoStationControl, type RraaValidator } from "../src/rraa.js";
import { seed } from "../src/seed.js";
import { createStationInstallationChallenge, installationIdForPublicKey, listStationInstallations, queryStationInstallation,
  registerStationInstallation, type StationInstallationOptions } from "../src/station-installations.js";
import { signingPayload, type StationInstallationChallenge } from "../src/station-installation-protocol.js";
import { MemoryStore } from "../src/store.js";

const demoPassword = "Demo-CyP-2026!";
const accountPassword = "Clave-Sintetica-2026";
const sessionFields = ["sid", "authVersion", "iat", "exp"];
const cli = (number: number) => `CLI${String(number).padStart(8, "0")}`;
const errorCode = (expected: string, message?: RegExp) => (error: unknown) => {
  assert.equal((error as { code: string }).code, expected);
  if (message) assert.match((error as Error).message, message);
  return true;
};

async function setup(t: TestContext, initial: State = seed()) {
  const store = new MemoryStore(initial);
  const app = await buildApp({ store, demo: true, secret: "synthetic-october-review-secret-at-least-32-characters",
    origins: [], collectorUrl: "http://127.0.0.1:5174" });
  t.after(async () => { await app.close(); await store.close(); });
  const attempt = (email: string, password: string) => app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  const login = async (email = "admin@cyp.local", password = demoPassword) => {
    const response = await attempt(email, password);
    assert.equal(response.statusCode, 200, response.body);
    return response.json().token as string;
  };
  const adminToken = await login();
  const post = (url: string, payload: object, token = adminToken, key = randomUUID()) =>
    app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  const get = (url: string, token = adminToken) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  const account = async (role: AccountRole, name: string, extra: Record<string, unknown> = {}) => {
    const body = { name, email: `${role}-${randomUUID()}@example.invalid`, role, password: accountPassword, ...extra };
    const response = await post("/api/usuarios", body);
    assert.equal(response.statusCode, 200, response.body);
    return { id: response.json().id as string, name, email: body.email, role, token: await login(body.email, accountPassword) };
  };
  return { app, store, attempt, login, adminToken, post, get, account };
}
type Env = Awaited<ReturnType<typeof setup>>;
type SavedClient = { id: string; code: string; internalIdentification: string; identification: string; phone: string };

let documents = 0;
const clientInput = (overrides: Record<string, unknown> = {}) => ({
  name: "Cliente sintético de revisión", routeId: "route-1", identification: `DOC-REVISION-${++documents}`, ...overrides,
});
async function createClient(env: Env, overrides: Record<string, unknown> = {}) {
  const response = await env.post("/api/clientes", clientInput(overrides));
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as SavedClient;
}
// A rejected client must leave no trace: no client, no reservation and no used number.
async function rejectClient(env: Env, overrides: Record<string, unknown>, status: number, code: string) {
  const before = await env.store.read();
  const response = await env.post("/api/clientes", clientInput(overrides));
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.json().error.code, code, response.body);
  assert.deepEqual(await env.store.read(), before);
  return response.json().error.message as string;
}
async function reserve(env: Env, body: Record<string, unknown> = {}) {
  const response = await env.post("/api/clientes/sugerencias", body);
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as { reservationId: string; code: string; internalIdentification: string };
}
const seriesCodes = (state: State) => state.clientIdentityReservations.map((row) => row.code).filter((code) => /^CLI\d+$/.test(code));

// ---------------------------------------------------------------------------------------------
// C4.2.1 — a single series of client codes
// ---------------------------------------------------------------------------------------------

test("C4.2.1 a new client without a code receives the next consecutive CLI code", async (t) => {
  const env = await setup(t);
  const omitted = await createClient(env);
  const empty = await createClient(env, { code: "" });
  const blank = await createClient(env, { code: "   " });
  assert.deepEqual([omitted.code, empty.code, blank.code], [cli(1), cli(2), cli(3)]);
  for (const client of [omitted, empty, blank]) assert.match(client.internalIdentification, /^INT\d{8}$/);
  assert.equal(new Set([omitted, empty, blank].map((client) => client.internalIdentification)).size, 3);

  // Repeating the same request (same Idempotency-Key) returns the same client and uses no extra number.
  const key = randomUUID(), body = clientInput();
  const first = await env.post("/api/clientes", body, env.adminToken, key);
  const replay = await env.post("/api/clientes", body, env.adminToken, key);
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(replay.json(), first.json());
  assert.equal(first.json().code, cli(4));
  assert.equal((await createClient(env)).code, cli(5));

  const state = await env.store.read();
  assert.deepEqual(state.clients.filter((client) => /^CLI/.test(client.code)).map((client) => client.code), [cli(1), cli(2), cli(3), cli(4), cli(5)]);
  const listed = (await env.get("/api/clientes")).json() as SavedClient[];
  assert.equal(listed.find((client) => client.id === omitted.id)?.code, cli(1));
});

test("C4.2.1 a client saved with its own code (its phone) keeps it, gets an internal identification and uses no CLI number", async (t) => {
  const env = await setup(t);
  const generated = await createClient(env);
  assert.equal(generated.code, cli(1));

  const phone = "8095550123";
  const own = await createClient(env, { code: phone, phone });
  assert.equal(own.code, phone);
  assert.equal(own.phone, phone);
  assert.match(own.internalIdentification, /^INT\d{8}$/);
  assert.notEqual(own.internalIdentification, generated.internalIdentification);

  // Only the generated client holds a number of the series.
  const state = await env.store.read();
  assert.deepEqual(seriesCodes(state), [cli(1)]);
  assert.equal(state.clients.find((client) => client.id === own.id)?.internalIdentification, own.internalIdentification);
  assert.equal(state.clientIdentityReservations.filter((row) => row.clientId === own.id).length, 1);

  // Both the form button and a save without code continue right after the last generated code.
  assert.equal((await reserve(env)).code, cli(2));
  assert.equal((await createClient(env)).code, cli(3));
});

test("C4.2.1 a repeated own code is rejected with CLIENT_CODE_EXISTS and nothing is reserved", async (t) => {
  const env = await setup(t);
  const phone = "8095550177";
  await createClient(env, { code: phone, phone });
  const message = await rejectClient(env, { code: phone, name: "Otro cliente con el mismo teléfono" }, 409, "CLIENT_CODE_EXISTS");
  assert.equal(message, "El código de cliente ya existe.");
  // The code of a client that existed before the change is protected in the same way.
  await rejectClient(env, { code: "CL-0001" }, 409, "CLIENT_CODE_EXISTS");
  // So is a generated code that already belongs to a client.
  const generated = await createClient(env);
  assert.equal(generated.code, cli(1));
  await rejectClient(env, { code: generated.code }, 409, "CLIENT_CODE_EXISTS");
  // The failed attempts did not use numbers of the series.
  assert.equal((await createClient(env)).code, cli(2));
  assert.equal((await env.store.read()).clients.filter((client) => client.code === phone).length, 1);
});

test("C4.2.1 a code reserved by another open form is rejected with CLIENT_CODE_RESERVED", async (t) => {
  const env = await setup(t);
  const formA = await reserve(env), formB = await reserve(env);
  assert.deepEqual([formA.code, formB.code], [cli(1), cli(2)]);

  // Typed by hand in a form without reservation.
  const message = await rejectClient(env, { code: formA.code }, 409, "CLIENT_CODE_RESERVED");
  assert.match(message, /reservado por otro formulario/);
  // Sent by a form that holds a different reservation.
  await rejectClient(env, { code: formA.code, reservationId: formB.reservationId }, 409, "CLIENT_CODE_RESERVED");

  // The form that reserved the code can use it, and the other form keeps its own.
  const savedA = await createClient(env, { code: formA.code, reservationId: formA.reservationId });
  assert.equal(savedA.code, formA.code);
  assert.equal(savedA.internalIdentification, formA.internalIdentification);
  // Once a client has the code, the answer is "exists" instead of "reserved".
  await rejectClient(env, { code: formA.code }, 409, "CLIENT_CODE_EXISTS");
  const savedB = await createClient(env, { code: formB.code, reservationId: formB.reservationId });
  assert.equal(savedB.code, formB.code);
  // A reservation is used only once.
  await rejectClient(env, { code: "REUSO-RESERVA", reservationId: formA.reservationId }, 409, "CLIENT_RESERVATION_UNAVAILABLE");
  assert.equal((await createClient(env)).code, cli(3));
});

test("C4.2.1 generated codes stay consecutive after several clients with their own code", async (t) => {
  const env = await setup(t);
  const saved: SavedClient[] = [], generated: string[] = [];
  const own = async (code: string) => { const client = await createClient(env, { code }); assert.equal(client.code, code); saved.push(client); };
  const next = async () => { const client = await createClient(env); saved.push(client); generated.push(client.code); };

  await next();
  await own("8095550101"); await own("8095550102"); await own("829-555-0103");
  await next();
  await own("TEL-8495550104"); await own("8095550105");
  await next();
  // A form that asked for its code with the button also takes the next number.
  const form = await reserve(env);
  saved.push(await createClient(env, { code: form.code, reservationId: form.reservationId }));
  generated.push(form.code);
  await own("8095550106");
  await next();

  assert.deepEqual(generated, [cli(1), cli(2), cli(3), cli(4), cli(5)]);
  const state = await env.store.read();
  assert.deepEqual(seriesCodes(state), generated);
  // Every client, with generated or own code, has a distinct internal identification in order of creation.
  const internal = saved.map((client) => client.internalIdentification);
  for (const value of internal) assert.match(value, /^INT\d{8}$/);
  assert.equal(new Set(internal).size, saved.length);
  assert.deepEqual(internal, [...internal].sort());
  assert.equal(new Set(state.clients.map((client) => client.code)).size, state.clients.length);
});

test("C4.2.1 hand-typed CLI/INT codes cannot move the series and codes already in use are skipped", async (t) => {
  const initial = seed();
  // Historical clients that already used codes with the format of the series.
  initial.clients[0].code = cli(2);
  initial.clients[1].code = cli(500);
  const env = await setup(t, initial);

  for (const code of [cli(50), "cli00000051", "CLI7", "INT00000009"]) {
    const message = await rejectClient(env, { code }, 422, "CLIENT_CODE_SYSTEM_FORMAT");
    assert.match(message, /los asigna el sistema/);
  }
  // The historical CLI00000500 does not move the series; CLI00000002 is skipped, never duplicated.
  assert.equal((await createClient(env)).code, cli(1));
  assert.equal((await createClient(env)).code, cli(3));
  assert.equal((await createClient(env)).code, cli(4));
  const codes = (await env.store.read()).clients.map((client) => client.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("C4.2.1 editing a client applies the same rules to its code", async (t) => {
  const env = await setup(t);
  const legacy = (await env.store.read()).clients[0];
  const body = (code: string) => ({ name: legacy.name, code, phone: legacy.phone, address: legacy.address, routeId: legacy.routeId });
  const edit = (code: string) => env.post(`/api/clientes/${legacy.id}`, body(code));
  const form = await reserve(env);

  const before = await env.store.read();
  const reserved = await edit(form.code);
  assert.equal(reserved.statusCode, 409, reserved.body);
  assert.equal(reserved.json().error.code, "CLIENT_CODE_RESERVED");
  const system = await edit(cli(77));
  assert.equal(system.statusCode, 422, system.body);
  assert.equal(system.json().error.code, "CLIENT_CODE_SYSTEM_FORMAT");
  const taken = await edit("CL-0002");
  assert.equal(taken.statusCode, 409, taken.body);
  assert.equal(taken.json().error.code, "CLIENT_CODE_EXISTS");
  assert.deepEqual(await env.store.read(), before);

  // Its own phone as code is accepted and the series is untouched.
  const saved = await edit("8095550100");
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().code, "8095550100");
  assert.equal((await createClient(env)).code, cli(2));
});

// Known limit, by design: a NEW client form shares one reservation between "Generar código"
// and "Generar identificación" (a single request, covered by the interface tests). If that
// form is then saved with its own code, the reserved number stays unused, like a cancelled form.
test("C4.2.1 a new form that reserved its identity and is saved with its own code leaves that number unused", async (t) => {
  const env = await setup(t);
  assert.equal((await createClient(env)).code, cli(1));
  const form = await reserve(env);
  assert.equal(form.code, cli(2));
  const own = await createClient(env, { code: "8095550199", phone: "8095550199", reservationId: form.reservationId, identification: form.internalIdentification });
  assert.equal(own.code, "8095550199");
  assert.equal(own.internalIdentification, form.internalIdentification);
  assert.equal((await createClient(env)).code, cli(3));
});

test("C4.2.1 an existing client that receives its internal identification keeps its code and uses no CLI number", async (t) => {
  const env = await setup(t);
  assert.equal((await createClient(env)).code, cli(1));
  const legacy = (await env.store.read()).clients[0];
  // The form of an existing client asks only for the identification.
  const form = await reserve(env, { identificationOnly: true });
  assert.equal(Object.hasOwn(form, "code"), false);
  const saved = await env.post(`/api/clientes/${legacy.id}`, { name: legacy.name, code: legacy.code, phone: legacy.phone,
    address: legacy.address, routeId: legacy.routeId, reservationId: form.reservationId });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().code, legacy.code);
  assert.equal(saved.json().internalIdentification, form.internalIdentification);
  assert.equal((await createClient(env)).code, cli(2));
});

// ---------------------------------------------------------------------------------------------
// B9 — authorization requests show who registered and who resolved them
// ---------------------------------------------------------------------------------------------

type RequestRow = AuthorizationRequest & { createdByName?: string; resolvedByName?: string };
async function listRequests(env: Env, query = "", token = env.adminToken) {
  const response = await env.get(`/api/solicitudes-autorizacion${query}`, token);
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as { items: RequestRow[]; total: number };
}
function requestTarget(state: State) {
  const client = state.clients[0];
  return { clientId: client.id, collectorId: state.routes.find((route) => route.id === client.routeId)!.collectorId };
}

test("B9 authorization requests return createdByName and, once resolved, resolvedByName with the account name", async (t) => {
  const env = await setup(t);
  const target = requestTarget(await env.store.read());
  const ana = await env.account("admin", "Ana Pérez Revisión");
  const input = { ...target, forCollection: true, note: "Solicitud sintética de revisión" };
  const fromSystem = await env.post("/api/solicitudes-autorizacion", input);
  const fromAna = await env.post("/api/solicitudes-autorizacion", { ...input, note: "Segunda solicitud sintética" }, ana.token);
  assert.equal(fromSystem.statusCode, 200, fromSystem.body);
  assert.equal(fromAna.statusCode, 200, fromAna.body);
  const row = (items: RequestRow[], id: string) => { const found = items.find((item) => item.id === id); assert.ok(found, id); return found; };

  const pending = await listRequests(env);
  assert.equal(pending.total, 2);
  const systemRow = row(pending.items, fromSystem.json().id), anaRow = row(pending.items, fromAna.json().id);
  assert.equal(systemRow.createdBy, "demo-admin");
  assert.equal(systemRow.createdByName, "Administración");
  assert.equal(anaRow.createdBy, ana.id);
  assert.equal(anaRow.createdByName, "Ana Pérez Revisión");
  // Nobody has resolved them yet.
  for (const item of pending.items) { assert.equal(item.resolvedBy, undefined); assert.equal(item.resolvedByName, undefined); }

  const byAna = await env.post(`/api/solicitudes-autorizacion/${systemRow.id}/resolver`, { status: "approved", note: "Aprobada en revisión" }, ana.token);
  const bySystem = await env.post(`/api/solicitudes-autorizacion/${anaRow.id}/resolver`, { status: "rejected", note: "Rechazada en revisión" });
  assert.equal(byAna.statusCode, 200, byAna.body);
  assert.equal(bySystem.statusCode, 200, bySystem.body);

  const resolved = await listRequests(env);
  assert.equal(row(resolved.items, systemRow.id).resolvedBy, ana.id);
  assert.equal(row(resolved.items, systemRow.id).resolvedByName, "Ana Pérez Revisión");
  assert.equal(row(resolved.items, systemRow.id).createdByName, "Administración");
  assert.equal(row(resolved.items, anaRow.id).resolvedBy, "demo-admin");
  assert.equal(row(resolved.items, anaRow.id).resolvedByName, "Administración");
  // The names do not depend on who reads: another administrator and a supervisor see the same.
  const supervisor = await env.account("supervisor", "Sara Supervisora");
  for (const token of [ana.token, supervisor.token]) {
    const seen = await listRequests(env, "?status=approved", token);
    assert.equal(seen.total, 1);
    assert.equal(seen.items[0].createdByName, "Administración");
    assert.equal(seen.items[0].resolvedByName, "Ana Pérez Revisión");
  }

  // The names are calculated when reading: nothing extra is stored and a renamed account shows its new name.
  for (const stored of getAdminTools(await env.store.read()).authorizationRequests as RequestRow[]) {
    assert.equal(Object.hasOwn(stored, "createdByName"), false);
    assert.equal(Object.hasOwn(stored, "resolvedByName"), false);
  }
  const renamed = await env.post(`/api/usuarios/${ana.id}`, { name: "Ana Pérez de Gómez", email: ana.email, role: "admin" });
  assert.equal(renamed.statusCode, 200, renamed.body);
  const afterRename = await listRequests(env);
  assert.equal(row(afterRename.items, anaRow.id).createdByName, "Ana Pérez de Gómez");
  assert.equal(row(afterRename.items, systemRow.id).resolvedByName, "Ana Pérez de Gómez");
  assert.equal(row(afterRename.items, anaRow.id).createdBy, ana.id);
});

const historicalRequests = (state: State, authors: string[]): AuthorizationRequest[] => authors.map((createdBy, index) => ({
  id: `req-historical-${index + 1}`, ...requestTarget(state), forCollection: index % 2 === 0, note: "Solicitud histórica sintética",
  status: "pending" as const, createdAt: new Date(Date.UTC(2026, 9, 1 + index, 15)).toISOString(), createdBy,
}));

test("B9 the list of authorization requests does not break for accounts that do not exist", async (t) => {
  const env = await setup(t);
  await env.store.transaction((state) => {
    const [orphan, system, anonymous, lost] = historicalRequests(state, ["cuenta-eliminada", "demo-collector", "", "demo-admin"]);
    Object.assign(orphan, { status: "approved", resolvedAt: orphan.createdAt, resolvedBy: "otra-cuenta-eliminada", resolutionNote: "Decisión histórica" });
    // The client and the collector of this one are gone too.
    Object.assign(lost, { clientId: "cliente-inexistente", collectorId: "cobrador-inexistente" });
    getAdminTools(state).authorizationRequests.push(orphan, system, anonymous, lost);
  });

  const listed = await listRequests(env);
  assert.equal(listed.total, 4);
  const byId = Object.fromEntries(listed.items.map((item) => [item.id, item]));
  // Unknown accounts: the stored id is still there and there is simply no name.
  assert.equal(byId["req-historical-1"].createdBy, "cuenta-eliminada");
  assert.equal(byId["req-historical-1"].resolvedBy, "otra-cuenta-eliminada");
  assert.equal(byId["req-historical-1"].createdByName, undefined);
  assert.equal(byId["req-historical-1"].resolvedByName, undefined);
  assert.equal(byId["req-historical-1"].resolutionNote, "Decisión histórica");
  // Built-in accounts are not in the accounts catalog but still have a name.
  assert.equal(byId["req-historical-2"].createdByName, "Cobrador");
  assert.equal(byId["req-historical-4"].createdByName, "Administración");
  assert.equal(byId["req-historical-3"].createdByName, undefined);
  // Filters and paging keep working with those rows.
  assert.equal((await listRequests(env, "?status=approved")).items[0].id, "req-historical-1");
  assert.equal((await listRequests(env, "?limit=1&offset=3")).items.length, 1);
  assert.equal((await listRequests(env, "?q=no-existe")).total, 0);
});

// An id that is also a property name of every JavaScript object must not be read as a built-in account.
test("B9 an unknown account id never produces a name that is not text", async (t) => {
  const env = await setup(t);
  // Ids that are also property names of every JavaScript object.
  const authors = ["__proto__", "constructor", "toString"];
  await env.store.transaction((state) => { getAdminTools(state).authorizationRequests.push(...historicalRequests(state, authors)); });
  const listed = await listRequests(env);
  assert.equal(listed.total, authors.length);
  for (const item of listed.items) assert.equal(item.createdByName, undefined, `${item.createdBy}: ${JSON.stringify(item.createdByName)}`);
});

// ---------------------------------------------------------------------------------------------
// C5.4 — support contact data in general settings
// ---------------------------------------------------------------------------------------------

const supportContact = {
  "soporte.nombre": "Ana Pérez (Soporte Técnico)",
  "soporte.telefono": "809-555-0100 ext. 12",
  "soporte.whatsapp": "+1 (809) 555-0101",
  "soporte.correo": "soporte@example.invalid",
  "soporte.horario": "Lunes a viernes, de 8:00 a 17:00",
};

test("C5.4 valid support contact settings are saved and returned unchanged", async (t) => {
  const env = await setup(t);
  const saved = await env.post("/api/configuracion", { config: supportContact });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json(), { ok: true });
  assert.deepEqual((await env.get("/api/configuracion")).json().config, supportContact);

  // They live next to the other general settings without disturbing them.
  const mixed = { ...supportContact, "general.empresa": "Empresa sintética", "general.telefono": "809-555-0199", receiptFooterNote: "Gracias" };
  assert.equal((await env.post("/api/configuracion", { config: mixed })).statusCode, 200);
  assert.deepEqual((await env.get("/api/configuracion")).json().config, mixed);

  // Every field may be left empty: the support window then has nothing to show.
  const empty = Object.fromEntries(Object.keys(supportContact).map((key) => [key, ""]));
  assert.equal((await env.post("/api/configuracion", { config: empty })).statusCode, 200);
  assert.deepEqual((await env.get("/api/configuracion")).json().config, empty);

  // A supervisor reads them; a collector neither reads nor saves them.
  const supervisor = await env.account("supervisor", "Sara Supervisora");
  assert.deepEqual((await env.get("/api/configuracion", supervisor.token)).json().config, empty);
  const collectorToken = await env.login("collector@cyp.local");
  assert.equal((await env.get("/api/configuracion", collectorToken)).statusCode, 403);
  assert.equal((await env.post("/api/configuracion", { config: supportContact }, collectorToken)).statusCode, 403);
  assert.deepEqual((await env.get("/api/configuracion")).json().config, empty);
});

test("C5.4 invalid support phone, WhatsApp and e-mail are rejected without changing the settings", async (t) => {
  const env = await setup(t);
  assert.equal((await env.post("/api/configuracion", { config: supportContact })).statusCode, 200);
  const before = await env.store.read();
  const invalid: [string, unknown][] = [
    ["soporte.telefono", "llamar al encargado"],
    ["soporte.telefono", "809-555-0100 ext. 1234567"],
    ["soporte.telefono", "+"],
    ["soporte.telefono", 8095550100],
    ["soporte.whatsapp", "whatsapp"],
    ["soporte.whatsapp", "809 555 0101 / 809 555 0102"],
    ["soporte.whatsapp", `8${"0".repeat(40)}`],
    ["soporte.correo", "soporte-arroba-example"],
    ["soporte.correo", "soporte@"],
    ["soporte.correo", "soporte@example"],
    ["soporte.correo", "uno@example.invalid, dos@example.invalid"],
    ["soporte.nombre", 12345],
    ["soporte.nombre", "N".repeat(161)],
    ["soporte.nombre", "Dos\nlíneas"],
    ["soporte.horario", null],
    ["soporte.horario", "H".repeat(161)],
  ];
  for (const [key, value] of invalid) {
    const response = await env.post("/api/configuracion", { config: { ...supportContact, [key]: value } });
    assert.equal(response.statusCode, 400, `${key}=${JSON.stringify(value)}: ${response.body}`);
    assert.equal(response.json().error.code, "VALIDATION");
    assert.ok(response.json().error.message.includes(key), response.body);
  }
  assert.deepEqual(await env.store.read(), before);
  assert.deepEqual((await env.get("/api/configuracion")).json().config, supportContact);
});

// ---------------------------------------------------------------------------------------------
// Access — unified login message
// ---------------------------------------------------------------------------------------------

test("login answers 'Usuario o contraseña incorrectos.' for every kind of wrong credentials", async (t) => {
  const env = await setup(t);
  const user = await env.account("user", "Usuario Sintético");
  const disabled = await env.account("supervisor", "Cuenta Desactivada");
  assert.equal((await env.post(`/api/usuarios/${disabled.id}/estado`, { status: "disabled" })).statusCode, 200);
  const expected = { error: { code: "INVALID_CREDENTIALS", message: "Usuario o contraseña incorrectos." } };
  const attempts: [string, string, string][] = [
    ["built-in administrator, wrong password", "admin@cyp.local", "Clave-Equivocada-2026"],
    ["built-in collector by user name, wrong password", "collector.demo", "Clave-Equivocada-2026"],
    ["user that does not exist", "nadie@example.invalid", demoPassword],
    ["account, wrong password", user.email, "Clave-Equivocada-2026"],
    ["disabled account, right password", disabled.email, accountPassword],
  ];
  for (const [label, email, password] of attempts) {
    const response = await env.attempt(email, password);
    assert.equal(response.statusCode, 401, `${label}: ${response.body}`);
    // Same body in every case: it does not reveal whether the user exists.
    assert.deepEqual(response.json(), expected, label);
  }
  // The right credentials still work after the failed attempts.
  assert.equal((await env.attempt("admin", demoPassword)).statusCode, 200);
});

// ---------------------------------------------------------------------------------------------
// Access — remittance operators do not expose session data
// ---------------------------------------------------------------------------------------------

test("GET /api/envios/snapshot returns the caller as operator without session fields", async (t) => {
  const env = await setup(t);
  const collectorToken = await env.login("collector@cyp.local");
  const admin = await env.account("admin", "Ana Pérez Remesas");
  const collector = await env.account("collector", "Carlos Cobrador Remesas", { collectorId: "col-2" });
  const callers: [string, Record<string, unknown>][] = [
    [env.adminToken, { id: "demo-admin", name: "Administración", role: "admin" }],
    [collectorToken, { id: "demo-collector", name: "Cobrador", role: "collector", collectorId: "col-1" }],
    [admin.token, { id: admin.id, name: admin.name, role: "admin" }],
    [collector.token, { id: collector.id, name: collector.name, role: "collector", collectorId: "col-2" }],
  ];
  for (const [token, self] of callers) {
    const payload = env.app.jwt.decode(token) as Record<string, unknown>;
    // The token does carry session data; it must stay out of the answer.
    for (const field of sessionFields) assert.ok(payload[field] !== undefined, `${String(self.id)} token: ${field}`);
    const response = await env.get("/api/envios/snapshot", token);
    assert.equal(response.statusCode, 200, response.body);
    const operators = response.json().operators as Record<string, unknown>[];
    assert.deepEqual(operators.find((operator) => operator.id === self.id), self);
    for (const operator of operators) {
      for (const field of sessionFields) assert.equal(Object.hasOwn(operator, field), false, `${String(operator.id)}: ${field}`);
      assert.deepEqual(Object.keys(operator).filter((key) => !["id", "name", "role", "collectorId"].includes(key)), []);
    }
    // The session id appears nowhere in the answer (the version of an account is a short counter, not checked as text).
    assert.equal(response.body.includes(String(payload.sid)), false);
    if (self.role === "collector") assert.deepEqual(operators, [self]);
  }
  // The clean operator is still accepted when the administrator opens a cash box for itself.
  const opened = await env.post("/api/envios/cajas/abrir", { operatorId: "demo-admin", currency: "USD", openingAmount: 0 });
  assert.equal(opened.statusCode, 200, opened.body);
});

test("remittanceOperators builds the caller from its business identity only", () => {
  const state = seed();
  const session = { sid: randomUUID(), authVersion: "synthetic-version", iat: 1_760_000_000, exp: 1_760_028_800 };
  const systemOperators: User[] = [
    { id: "demo-admin", name: "Administración", role: "admin" },
    { id: "demo-collector", name: "Cobrador", role: "collector", collectorId: "col-1" },
  ];
  const collector = { id: "demo-collector", name: "Cobrador", role: "collector", collectorId: "col-1", ...session } as User;
  assert.deepEqual(remittanceOperators(state, collector, systemOperators), [{ id: "demo-collector", name: "Cobrador", role: "collector", collectorId: "col-1" }]);
  const admin = { id: "demo-admin", name: "Administración", role: "admin", ...session } as User;
  assert.deepEqual(remittanceOperators(state, admin, systemOperators), systemOperators);
  // An administrator that is not a system operator is added clean, without a collectorId key.
  const other = { id: "other-admin", name: "Otra administradora", role: "admin", ...session } as User;
  assert.deepEqual(remittanceOperators(state, other, systemOperators).at(-1), { id: "other-admin", name: "Otra administradora", role: "admin" });
  // The token payload itself is not modified.
  assert.equal((collector as User & typeof session).sid, session.sid);
});

// ---------------------------------------------------------------------------------------------
// Access — a changed rate is reported before a principal mismatch
// ---------------------------------------------------------------------------------------------

test("createRemittance reports the changed rate before the principal mismatch it causes", () => {
  const now = new Date("2026-10-09T16:00:00Z"), date = businessDate(now);
  const admin: User = { id: "demo-admin", name: "Administración", role: "admin" };
  const collector: User = { id: "demo-collector", name: "Cobrador", role: "collector", collectorId: "col-1" };
  const pair = { sourceCurrency: "USD" as Currency, destinationCurrency: "EUR" as Currency, commissionBps: 500 };
  const state = seed();
  setCommissionPolicy(state, admin, { transactionCommissionBps: 500, managerCommissionBps: 0 }, now);
  setDailyRate(state, admin, { currency: "USD", rate: "60", date }, now);
  setDailyRate(state, admin, { currency: "EUR", rate: "75", date }, now);
  openRemittanceCash(state, admin, { operatorId: collector.id, currency: "USD", openingAmount: 0 }, [collector], now);
  // The user asks for 80.00 EUR at destination; the server calculates the principal.
  const input = (): CreateRemittanceInput => {
    const quoted = quoteRemittance(state, { ...pair, amount: 8000, amountMode: "destination" }, now);
    return { ...pair, amount: quoted.amount, requestedReceiveAmount: 8000, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoted.quote };
  };
  const stale = input();
  assert.equal(stale.amount, 10000);

  // Only the principal is wrong: the specific message is kept.
  const transfers = state.remittances.transfers.length;
  assert.throws(() => createRemittance(state, collector, { ...input(), amount: stale.amount + 1 }, [], now), errorCode("QUOTE_CHANGED", /El principal no coincide/));
  // The rate changes after quoting: the principal no longer matches either, but the cause is the rate.
  setDailyRate(state, admin, { currency: "USD", rate: "61", date }, now);
  assert.notEqual(quoteRemittance(state, { ...pair, amount: 8000, amountMode: "destination" }, now).amount, stale.amount);
  assert.throws(() => createRemittance(state, collector, stale, [], now), errorCode("QUOTE_CHANGED", /La fecha o la tasa cambió/));
  assert.equal(state.remittances.transfers.length, transfers);
  // Quoting again with the new rate works.
  assert.equal(createRemittance(state, collector, input(), [], now).requestedReceiveAmount, 8000);
});

// ---------------------------------------------------------------------------------------------
// B15 — remittances are not a charge service
// ---------------------------------------------------------------------------------------------

const chargeInput = (service: string) => ({ clientId: "cli-1", service, amount: 12_500, dueDate: businessDate() });

test("B15 a remittance cannot be registered as a new charge", async (t) => {
  const env = await setup(t);
  const before = await env.store.read();
  for (const service of ["Remesas del Exterior", "remesas del exterior", "Remesa"]) {
    const response = await env.post("/api/cargos", chargeInput(service));
    assert.equal(response.statusCode, 422, response.body);
    assert.equal(response.json().error.code, "REMITTANCE_SERVICE");
    assert.match(response.json().error.message, /Envíos de Dinero/);
  }
  assert.deepEqual(await env.store.read(), before);
  const accepted = await env.post("/api/cargos", chargeInput("Servicio semanal"));
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().service, "Servicio semanal");
});

// The rule of "Crear cargo" also holds when an existing charge is edited.
test("B15 an existing charge cannot be changed into a remittance either", async (t) => {
  const env = await setup(t);
  const created = await env.post("/api/cargos", chargeInput("Servicio semanal"));
  assert.equal(created.statusCode, 200, created.body);
  const edited = await env.post(`/api/cargos/${created.json().id}`, chargeInput("Remesas del Exterior"));
  assert.equal(edited.statusCode, 422, edited.body);
  assert.equal(edited.json().error.code, "REMITTANCE_SERVICE");
});

// ---------------------------------------------------------------------------------------------
// Receipt footer — each line of the note is printed on its own line
// ---------------------------------------------------------------------------------------------

test("the ESC/POS receipt keeps the lines of the footer note", async (t) => {
  const env = await setup(t);
  const receiptFooterNote = "Gracias por su pago\r\nSoporte: 809-555-0100\n\nAtención de lunes a viernes";
  assert.equal((await env.post("/api/configuracion", { config: { receiptFooterNote } })).statusCode, 200);
  const collected = await env.post("/api/cobros", { chargeId: "chg-1", amount: 100 });
  assert.equal(collected.statusCode, 200, collected.body);
  const token = collected.json().movement.receiptToken as string;
  const printed = await env.app.inject(`/api/recibos/${token}/escpos`);
  assert.equal(printed.statusCode, 200);
  assert.ok(printed.body.includes("No es comprobante fiscal\nGracias por su pago\nSoporte: 809-555-0100\nAtencion de lunes a viernes\n"), JSON.stringify(printed.body));
  // The shareable receipt returns the note exactly as it was saved.
  assert.equal((await env.app.inject(`/api/recibos/${token}`)).json().footerNote, receiptFooterNote);
});

// ---------------------------------------------------------------------------------------------
// B21 — phone typed for the recipient of a transfer
// ---------------------------------------------------------------------------------------------

function recipientPhoneScenario(recordPhone: string, recordCellular: string) {
  const now = new Date("2026-10-09T16:00:00Z"), date = businessDate(now);
  const admin: User = { id: "demo-admin", name: "Administración", role: "admin" };
  const collector: User = { id: "demo-collector", name: "Cobrador", role: "collector", collectorId: "col-1" };
  const pair = { sourceCurrency: "USD" as Currency, destinationCurrency: "EUR" as Currency, commissionBps: 500 };
  const state = seed();
  setCommissionPolicy(state, admin, { transactionCommissionBps: 500, managerCommissionBps: 0 }, now);
  setDailyRate(state, admin, { currency: "USD", rate: "60", date }, now);
  setDailyRate(state, admin, { currency: "EUR", rate: "75", date }, now);
  for (const operator of [admin, collector]) openRemittanceCash(state, admin, { operatorId: operator.id, currency: "USD", openingAmount: 0 }, [admin, collector], now);
  const record = state.clients.find((client) => client.id === "cli-5")!;
  record.phone = recordPhone; record.cellular = recordCellular;
  const send = (user: User, recipientPhone?: string) => {
    const quoted = quoteRemittance(state, { ...pair, amount: 10000 }, now);
    return createRemittance(state, user, { ...pair, amount: quoted.amount, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoted.quote,
      ...(recipientPhone === undefined ? {} : { recipientPhone }) }, [admin, collector], now);
  };
  return { admin, collector, record, send };
}

test("B21 an administrator completes the empty phone of the record and the transfer keeps it", () => {
  const { admin, record, send } = recipientPhoneScenario("", "");
  const transfer = send(admin, " 809-555-7777 ");
  assert.equal(transfer.recipientContact?.phone, "809-555-7777");
  assert.equal(transfer.recipientContact?.cellular, "");
  assert.equal(record.phone, "809-555-7777");
});

test("B21 a collector writes the phone only in the copy of the transfer, never in the record", () => {
  const { collector, record, send } = recipientPhoneScenario("", "");
  const transfer = send(collector, "809-555-7777");
  assert.equal(transfer.recipientContact?.phone, "809-555-7777");
  assert.equal(record.phone, "");
  assert.equal(record.cellular, "");
});

test("B21 a phone already in the record is never replaced; the copy keeps both numbers", () => {
  const { admin, record, send } = recipientPhoneScenario("8095550100", "");
  const transfer = send(admin, "829-555-0200");
  assert.equal(transfer.recipientContact?.phone, "829-555-0200");
  assert.equal(transfer.recipientContact?.cellular, "8095550100");
  assert.equal(record.phone, "8095550100");
  assert.equal(record.cellular, "");
});

test("B21 without a typed phone the transfer keeps the contact of the record", () => {
  const { collector, record, send } = recipientPhoneScenario("8095550100", "8295550200");
  for (const typed of [undefined, "", "   "]) {
    const transfer = send(collector, typed);
    assert.equal(transfer.recipientContact?.phone, "8095550100");
    assert.equal(transfer.recipientContact?.cellular, "8295550200");
  }
  assert.equal(record.phone, "8095550100");
});

test("B21 the same number written with other separators is not a new phone", () => {
  const { admin, record, send } = recipientPhoneScenario("809-555-0100", "");
  const transfer = send(admin, "(809) 555-0100");
  assert.equal(transfer.recipientContact?.phone, "809-555-0100");
  assert.equal(transfer.recipientContact?.cellular, "");
  assert.equal(record.phone, "809-555-0100");
});

test("B21 typing the cellular of the record puts it first without repeating or losing a number", () => {
  const { admin, record, send } = recipientPhoneScenario("8095550100", "8295550200");
  const transfer = send(admin, "829-555-0200");
  assert.equal(transfer.recipientContact?.phone, "829-555-0200");
  assert.equal(transfer.recipientContact?.cellular, "8095550100");
  assert.equal(record.phone, "8095550100");
  assert.equal(record.cellular, "8295550200");
  // A record with only a cellular: an administrator typing that same number does not copy it into the phone.
  const onlyCellular = recipientPhoneScenario("", "8295550200");
  const second = onlyCellular.send(onlyCellular.admin, "829 555 0200");
  assert.equal(second.recipientContact?.phone, "829 555 0200");
  assert.equal(second.recipientContact?.cellular, "");
  assert.equal(onlyCellular.record.phone, "");
});

test("B21 a phone the API cannot accept is rejected as VALIDATION and nothing is saved", async (t) => {
  const env = await setup(t);
  const before = await env.store.read();
  const body = (recipientPhone: unknown) => ({ sourceCurrency: "USD", destinationCurrency: "EUR", amount: 10000, senderClientId: "cli-1", recipientClientId: "cli-5",
    recipientPhone, quote: { date: businessDate(), sourceRate: "60", destinationRate: "75" } });
  for (const invalid of ["809.555.1234", "555-1234", "809-555-1234 ext 2", "llamar a la tienda", 8095551234]) {
    const response = await env.post("/api/envios", body(invalid));
    assert.equal(response.statusCode, 400, `${JSON.stringify(invalid)}: ${response.body}`);
    assert.equal(response.json().error.code, "VALIDATION");
    assert.ok(response.json().error.message.includes("recipientPhone"), response.body);
  }
  assert.deepEqual(await env.store.read(), before);
});

// ---------------------------------------------------------------------------------------------
// B15 — the same rule in the import by file, in the batch and for an old remittance charge
// ---------------------------------------------------------------------------------------------

test("B15 a charge import rejects the remittance rows and keeps the rest", async (t) => {
  const env = await setup(t);
  const before = (await env.store.read()).charges.length;
  const response = await env.post("/api/cargos/importar", { filas: [
    { identificacion: "CL-0001", servicio: "Remesas del Exterior", importe: 12_500 },
    { identificacion: "CL-0001", servicio: "remesa", importe: 100 },
    { identificacion: "CL-0001", servicio: "Servicio semanal", importe: 300 },
  ] });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().creados, 1);
  assert.deepEqual(response.json().errores.map((row: { fila: number }) => row.fila), [1, 2]);
  for (const row of response.json().errores as { mensaje: string }[]) assert.match(row.mensaje, /Envíos de Dinero/);
  const charges = (await env.store.read()).charges;
  assert.equal(charges.length, before + 1);
  assert.equal(charges.some((charge) => /remesa/i.test(charge.service)), false);
});

test("B15 a batch of recurring charges cannot be generated for a remittance", async (t) => {
  const env = await setup(t);
  const before = await env.store.read();
  const batch = (service: string) => env.post("/api/cargos/recurrentes", { service, amount: 12_500, dueDate: businessDate(), clientIds: ["cli-1", "cli-2"] });
  const rejected = await batch("Remesas del Exterior");
  assert.equal(rejected.statusCode, 422, rejected.body);
  assert.equal(rejected.json().error.code, "REMITTANCE_SERVICE");
  assert.deepEqual(await env.store.read(), before);
  const accepted = await batch("Servicio semanal");
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().count, 2);
});

test("B15 a charge that already was a remittance in older data can still be corrected", async (t) => {
  const initial = seed();
  const old = initial.charges.find((charge) => charge.collected === 0 && charge.status === "pending" && !initial.movements.some((movement) => movement.chargeId === charge.id))!;
  old.service = "Remesas del Exterior";
  const env = await setup(t, initial);
  const edit = (service: string, amount: number) => env.post(`/api/cargos/${old.id}`, { clientId: old.clientId, service, amount, dueDate: old.dueDate });
  const kept = await edit("Remesas del Exterior", old.amount + 100);
  assert.equal(kept.statusCode, 200, kept.body);
  assert.equal(kept.json().amount, old.amount + 100);
  // Any other remittance name is a new remittance charge and is rejected.
  const renamed = await edit("Remesa internacional", old.amount);
  assert.equal(renamed.statusCode, 422, renamed.body);
  assert.equal(renamed.json().error.code, "REMITTANCE_SERVICE");
});

// ---------------------------------------------------------------------------------------------
// C4.2.2 — the identification of an identification-only reservation is not a client code
// ---------------------------------------------------------------------------------------------

test("C4.2.2 the identification reserved for an existing client cannot be saved as a code", async (t) => {
  const env = await setup(t);
  const legacy = (await env.store.read()).clients[0];
  const form = await reserve(env, { identificationOnly: true });
  const before = await env.store.read();
  const body = (code: string) => ({ name: legacy.name, code, phone: legacy.phone, address: legacy.address, routeId: legacy.routeId, reservationId: form.reservationId });

  const edited = await env.post(`/api/clientes/${legacy.id}`, body(form.internalIdentification));
  assert.equal(edited.statusCode, 422, edited.body);
  assert.equal(edited.json().error.code, "CLIENT_CODE_SYSTEM_FORMAT");
  // The client has no identification yet, so "Generar código" is still offered.
  assert.match(edited.json().error.message, /Pulsa Generar código/);
  assert.match(await rejectClient(env, { code: form.internalIdentification, reservationId: form.reservationId }, 422, "CLIENT_CODE_SYSTEM_FORMAT"), /los asigna el sistema/);
  assert.deepEqual(await env.store.read(), before);

  // With its own code the same reservation gives the identification, as before.
  const saved = await env.post(`/api/clientes/${legacy.id}`, body(legacy.code));
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().internalIdentification, form.internalIdentification);
  // Once the client has its identification, the message no longer points to "Generar código".
  const later = await env.post(`/api/clientes/${legacy.id}`, { ...body(cli(77)), reservationId: undefined });
  assert.equal(later.statusCode, 422, later.body);
  assert.match(later.json().error.message, /Escribe otro código\./);
});

// ---------------------------------------------------------------------------------------------
// B21 and B15 through the real routes
// ---------------------------------------------------------------------------------------------

test("B21 a valid phone travels through POST /api/envios and a retry with the same key saves one transfer", async (t) => {
  const initial = seed();
  const now = new Date(), date = businessDate(now);
  const admin: User = { id: "demo-admin", name: "Administración", role: "admin" };
  setCommissionPolicy(initial, admin, { transactionCommissionBps: 500, managerCommissionBps: 0 }, now);
  setDailyRate(initial, admin, { currency: "USD", rate: "60", date }, now);
  setDailyRate(initial, admin, { currency: "EUR", rate: "75", date }, now);
  openRemittanceCash(initial, admin, { operatorId: admin.id, currency: "USD", openingAmount: 0 }, [admin], now);
  const record = initial.clients.find((client) => client.id === "cli-5")!;
  record.phone = "8095550100"; record.cellular = "";
  const env = await setup(t, initial);

  const quoted = await env.get("/api/envios/cotizacion?sourceCurrency=USD&destinationCurrency=EUR&amount=10000");
  assert.equal(quoted.statusCode, 200, quoted.body);
  const body = { sourceCurrency: "USD", destinationCurrency: "EUR", amount: quoted.json().amount as number, senderClientId: "cli-1", recipientClientId: "cli-5",
    recipientPhone: "829-555-0200", quote: quoted.json().quote as Record<string, unknown> };
  const transfers = (await env.store.read()).remittances.transfers.length;
  const key = randomUUID();
  const first = await env.post("/api/envios", body, env.adminToken, key);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().recipientContact.phone, "829-555-0200");
  assert.equal(first.json().recipientContact.cellular, "8095550100");
  const again = await env.post("/api/envios", body, env.adminToken, key);
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().id, first.json().id);
  const after = await env.store.read();
  assert.equal(after.remittances.transfers.length, transfers + 1);
  // The record already had a phone: it is not replaced.
  assert.equal(after.clients.find((client) => client.id === "cli-5")!.phone, "8095550100");
});

test("B15 a recurring charge template cannot use a remittance service of the catalog", async (t) => {
  const initial = seed();
  initial.services.push({ id: "review-remittance-service", service: "Remesas del Exterior", abbr: "REM", caption: "Remesas", obligated: false, active: true, fixedAmount: false });
  const env = await setup(t, initial);
  const before = await env.store.read();
  const template = (service: string) => env.post("/api/cargos-recurrentes", { clientId: initial.clients[0].id, service, frequency: "Mensual", startDate: businessDate(), amount: 100, active: true });
  const rejected = await template("Remesas del Exterior");
  assert.equal(rejected.statusCode, 422, rejected.body);
  assert.equal(rejected.json().error.code, "REMITTANCE_SERVICE");
  assert.deepEqual(await env.store.read(), before);
});

test("B21 a new number for a record with phone and cellular goes first in the copy and keeps the cellular", () => {
  const { collector, record, send } = recipientPhoneScenario("8095550100", "8295550200");
  const transfer = send(collector, "849-555-0300");
  assert.equal(transfer.recipientContact?.phone, "849-555-0300");
  assert.equal(transfer.recipientContact?.cellular, "8295550200");
  assert.equal(record.phone, "8095550100");
  assert.equal(record.cellular, "8295550200");
});

test("B21 two numbers that only share their last digits are different phones", () => {
  const { admin, record, send } = recipientPhoneScenario("8095550100", "");
  const transfer = send(admin, "8295550100");
  assert.equal(transfer.recipientContact?.phone, "8295550100");
  assert.equal(transfer.recipientContact?.cellular, "8095550100");
  assert.equal(record.phone, "8095550100");
});

// ---------------------------------------------------------------------------------------------
// B5 — practice station control of the demo: station data must be in the company control
// ---------------------------------------------------------------------------------------------

async function stationApp(t: TestContext, extra: { publicWeb?: boolean; rraa?: RraaValidator; control?: boolean } = {}) {
  const store = new MemoryStore(seed());
  const app = await buildApp({ store, demo: true, secret: "synthetic-station-control-secret-at-least-32-characters", origins: [],
    collectorUrl: "http://127.0.0.1:5174", publicWeb: extra.publicWeb, rraa: extra.rraa,
    demoStationControl: extra.control === false ? undefined : createDemoStationControl() });
  t.after(async () => { await app.close(); await store.close(); });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: demoPassword } })).json().token as string;
  const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() } });
  const get = (url: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  return { store, post, get };
}
const stationInput = (name: string, deviceId: string, active = true) => ({ name, number: "PRUEBA-1", deviceId, description: "", group: "", type: "", active });

test("B5 the practice control of the demo finds only the stations registered for the example company", async () => {
  const control = createDemoStationControl();
  assert.equal(control.simulated, true);
  const found = await control.validate(" EST-PRUEBA-01 ", " DISP-PRUEBA-01 ");
  assert.ok(Number.isFinite(Date.parse(found.validatedAt)));
  assert.deepEqual({ ...found, validatedAt: "" }, { clientId: "EMPRESA-DEMO", stationCode: "EST-PRUEBA-01", deviceId: "DISP-PRUEBA-01", license: "LIC-DEMO-01", validatedAt: "" });
  assert.equal((await control.validate("EST-PRUEBA-99", "DISP-PRUEBA-99")).license, "LIC-DEMO-99");
  // The example stations of the demo catalogue are registered too.
  assert.equal((await control.validate("DEMO V2 · Estación 2", "DEMO-V2-DISPOSITIVO-02")).license, "LIC-DEMO-V2-02");
  for (const example of control.examples ?? []) assert.match((await control.validate(example.stationCode, example.deviceId)).license, /^LIC-DEMO-\d\d$/);
  const unknown = [["Cualquier estación", "123"], ["EST-PRUEBA-01", "DISP-PRUEBA-02"], ["EST-PRUEBA-00", "DISP-PRUEBA-00"], ["est-prueba-01", "DISP-PRUEBA-01"],
    ["EST-PRUEBA-1", "DISP-PRUEBA-1"], ["EST-PRUEBA-100", "DISP-PRUEBA-100"], ["DEMO V2 · Estación 2", "DEMO-V2-DISPOSITIVO-03"], ["EST-PRUEBA-01", "disp-prueba-01"],
    // A valid code with text before or after it is other data: the expressions are anchored at both ends.
    ["EST-PRUEBA-100", "DISP-PRUEBA-10"], ["EST-PRUEBA-01 extra", "DISP-PRUEBA-01"], ["X EST-PRUEBA-01", "DISP-PRUEBA-01"],
    ["X DEMO V2 · Estación 2", "DEMO-V2-DISPOSITIVO-02"], ["DEMO V2 · Estación 2 bis", "DEMO-V2-DISPOSITIVO-02"],
    // The catalogue of the demo has six example stations.
    ["DEMO V2 · Estación 7", "DEMO-V2-DISPOSITIVO-07"], ["DEMO V2 · Estación 0", "DEMO-V2-DISPOSITIVO-00"]];
  for (const [stationCode, deviceId] of unknown)
    await assert.rejects(control.validate(stationCode, deviceId), errorCode("RRAA_STATION_NOT_FOUND", /Estación no encontrada/), `${stationCode} / ${deviceId}`);
  for (const [stationCode, deviceId] of [["", "x"], ["x", ""], ["a|b", "x"], ["x", "a\nb"]])
    await assert.rejects(control.validate(stationCode, deviceId), errorCode("RRAA_INPUT_INVALID"));
});

test("B5 with the practice control a station is created, edited and activated only with data of the company control", async (t) => {
  const env = await stationApp(t);
  const status = (await env.get("/api/estaciones/rraa")).json();
  assert.deepEqual({ configured: status.configured, simulated: status.simulated, clientId: status.clientId }, { configured: true, simulated: true, clientId: "EMPRESA-DEMO" });
  assert.deepEqual(status.examples, [1, 2, 3].map((number) => ({ stationCode: `EST-PRUEBA-0${number}`, deviceId: `DISP-PRUEBA-0${number}` })));
  assert.deepEqual(status.exampleRange, ["EST-PRUEBA-01", "EST-PRUEBA-99"]);

  const before = await env.store.read();
  for (const [name, deviceId] of [["Estación inventada", "DISPOSITIVO-CUALQUIERA"], ["EST-PRUEBA-01", "OTRO-DISPOSITIVO"]]) {
    const rejected = await env.post("/api/estaciones", stationInput(name, deviceId));
    assert.equal(rejected.statusCode, 422, rejected.body);
    assert.equal(rejected.json().error.code, "RRAA_STATION_NOT_FOUND");
    const preview = await env.post("/api/estaciones/validar", { stationCode: name, deviceId });
    assert.equal(preview.statusCode, 422, preview.body);
  }
  assert.deepEqual(await env.store.read(), before);

  const created = await env.post("/api/estaciones", stationInput("EST-PRUEBA-01", "DISP-PRUEBA-01"));
  assert.equal(created.statusCode, 200, created.body);
  const station = created.json();
  assert.deepEqual({ license: station.license, validated: station.rraaValidated, active: station.active, client: station.rraaClientId },
    { license: "LIC-DEMO-01", validated: true, active: true, client: "EMPRESA-DEMO" });
  // Its identifier cannot be changed to data the control does not know; the saved record stays as it was.
  const edited = await env.post(`/api/estaciones/${station.id}`, stationInput("EST-PRUEBA-01", "DISPOSITIVO-CAMBIADO"));
  assert.equal(edited.statusCode, 422, edited.body);
  assert.equal(getAdminTools(await env.store.read()).stations.find((row) => row.id === station.id)!.deviceId, "DISP-PRUEBA-01");
  // The window now offers the next pairs that are still free (names and devices are unique).
  assert.deepEqual((await env.get("/api/estaciones/rraa")).json().examples.map((item: { stationCode: string }) => item.stationCode), ["EST-PRUEBA-02", "EST-PRUEBA-03", "EST-PRUEBA-04"]);
  // A registered station can be inactivated and activated again.
  assert.equal((await env.post(`/api/estaciones/${station.id}/actividad`, { active: false })).json().active, false);
  const activated = await env.post(`/api/estaciones/${station.id}/actividad`, { active: true });
  assert.equal(activated.statusCode, 200, activated.body);
  assert.equal(activated.json().rraaValidated, true);
  // Activation asks the control every time: stations it does not know stay inactive.
  await env.store.transaction((state) => { getAdminTools(state).stations.push(
    { id: "unknown-station", number: "LEG-1", name: "Estación inventada", deviceId: "X-1", description: "", group: "", type: "", license: "", version: "", active: false },
    { id: "no-device-station", number: "LEG-2", name: "Estación sin dispositivo", deviceId: "", description: "", group: "", type: "", license: "", version: "", active: false }); });
  const unknown = await env.post("/api/estaciones/unknown-station/actividad", { active: true });
  assert.equal(unknown.statusCode, 422, unknown.body);
  assert.equal(unknown.json().error.code, "RRAA_STATION_NOT_FOUND");
  const noDevice = await env.post("/api/estaciones/no-device-station/actividad", { active: true });
  assert.equal(noDevice.statusCode, 422, noDevice.body);
  assert.match(noDevice.json().error.message, /no tiene ID dispositivo/);
  for (const id of ["unknown-station", "no-device-station"]) assert.equal(getAdminTools(await env.store.read()).stations.find((row) => row.id === id)!.active, false);
});

test("B5 the practice control exists only in demo mode; the public demo never calls a real validator", async (t) => {
  await assert.rejects(buildApp({ store: new MemoryStore(seed()), demo: false, secret: "synthetic-station-control-secret-at-least-32-characters", origins: [],
    collectorUrl: "http://127.0.0.1:5174", adminEmail: "admin@example.invalid", adminPassword: "Clave-Sintetica-Larga-2026", demoStationControl: createDemoStationControl() }),
    /solo existe en modo demo/);
  // Neither can it be passed as if it were the provider.
  await assert.rejects(buildApp({ store: new MemoryStore(seed()), demo: false, secret: "synthetic-station-control-secret-at-least-32-characters", origins: [],
    collectorUrl: "http://127.0.0.1:5174", adminEmail: "admin@example.invalid", adminPassword: "Clave-Sintetica-Larga-2026", rraa: createDemoStationControl() }),
    /solo existe en modo demo/);

  let realCalls = 0;
  const real: RraaValidator = { clientId: "QA-COMPANY", async validate(stationCode, deviceId) {
    realCalls += 1; return { clientId: "QA-COMPANY", stationCode, deviceId, license: "QA-LICENSE", validatedAt: new Date().toISOString() };
  } };
  // Public demo: the practice control answers even if a real validator was supplied.
  const publicDemo = await stationApp(t, { publicWeb: true, rraa: real });
  assert.equal((await publicDemo.get("/api/estaciones/rraa")).json().clientId, "EMPRESA-DEMO");
  assert.equal((await publicDemo.post("/api/estaciones", stationInput("Estación inventada", "X-1"))).statusCode, 422);
  assert.equal((await publicDemo.post("/api/estaciones", stationInput("EST-PRUEBA-02", "DISP-PRUEBA-02"))).statusCode, 200);
  assert.equal(realCalls, 0);
  // Local demo with the provider configured: the provider comes first.
  const withProvider = await stationApp(t, { rraa: real });
  assert.deepEqual((await withProvider.get("/api/estaciones/rraa")).json(), { configured: true, clientId: "QA-COMPANY" });
  assert.equal((await withProvider.post("/api/estaciones", stationInput("Estación del proveedor", "X-1"))).json().license, "QA-LICENSE");
  assert.equal(realCalls, 1);
  // With a provider the activation is not judged by CyP first: even a station without device goes to the provider, as before.
  await withProvider.store.transaction((state) => { getAdminTools(state).stations.push(
    { id: "provider-no-device", number: "LEG-3", name: "Estación histórica", deviceId: "", description: "", group: "", type: "", license: "", version: "", active: false }); });
  assert.equal((await withProvider.post("/api/estaciones/provider-no-device/actividad", { active: true })).statusCode, 200);
  assert.equal(realCalls, 2);
  // Without any control everything stays closed, as before.
  const closed = await stationApp(t, { control: false });
  assert.deepEqual((await closed.get("/api/estaciones/rraa")).json(), { configured: false });
  const refused = await closed.post("/api/estaciones", stationInput("EST-PRUEBA-01", "DISP-PRUEBA-01"));
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().error.code, "STATION_RRAA_REQUIRED");
});

// A P-256 installation identity like the one the browser keeps.
function installationIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeySpki = publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  return { publicKeySpki, installationId: installationIdForPublicKey(publicKeySpki),
    prove: (challenge: StationInstallationChallenge) => sign("sha256", Buffer.from(signingPayload(challenge)), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url") };
}

test("B5 the installation data of a practice station report the same validation as the list", () => {
  const now = new Date("2026-10-12T12:00:00Z"), origin = "https://installation.test";
  const state = emptyState(), admin: User = { id: "fictional-admin", name: "Admin ficticio", role: "admin" };
  const actor = { ...admin, sid: createAuthSession(state, admin, now).id };
  getAdminTools(state).stations.push({ id: "practice-station", name: "EST-PRUEBA-01", number: "P-1", deviceId: "DISP-PRUEBA-01", description: "", group: "", type: "",
    license: "LIC-DEMO-01", version: "", active: true, rraaClientId: "EMPRESA-DEMO", rraaStationCode: "EST-PRUEBA-01", rraaDeviceId: "DISP-PRUEBA-01",
    rraaValidatedAt: now.toISOString(), rraaValidatedBy: admin.id });
  const register = (key: ReturnType<typeof installationIdentity>, options: StationInstallationOptions) => {
    const challenge = createStationInstallationChallenge(state, actor, "practice-station", { purpose: "register", installationId: key.installationId, publicKeySpki: key.publicKeySpki }, origin, options, now);
    registerStationInstallation(state, actor, "practice-station", { challengeId: challenge.challengeId, installationId: key.installationId, publicKeySpki: key.publicKeySpki,
      signature: key.prove(challenge), confirmed: true }, origin, options, now);
  };
  const query = (key: ReturnType<typeof installationIdentity>, options: StationInstallationOptions) => {
    const challenge = createStationInstallationChallenge(state, actor, "practice-station", { purpose: "query", installationId: key.installationId }, origin, options, now);
    return queryStationInstallation(state, actor, "practice-station", { challengeId: challenge.challengeId, installationId: key.installationId, signature: key.prove(challenge) }, origin, options, now);
  };
  // Public demo: installations are stored without a provider company; the practice control only names who validated.
  const withControl: StationInstallationOptions = { validationClientId: "EMPRESA-DEMO" }, withoutControl: StationInstallationOptions = {};
  const first = installationIdentity(); register(first, withControl);
  const seen = query(first, withControl);
  assert.equal(seen.rraaValidationStatus, "validated");
  assert.equal(seen.rraaValidatedAt, now.toISOString());
  // The scope did not change: the same installation is found without the control, and there the station is not validated.
  assert.equal(listStationInstallations(state, actor, "practice-station", withoutControl).installations.length, 1);
  assert.equal(query(first, withoutControl).rraaValidationStatus, "not_validated");
  // Another provider company is another scope: the installation is not listed there.
  const otherScope: StationInstallationOptions = { rraaClientId: "other-company", validationClientId: "EMPRESA-DEMO" };
  assert.equal(listStationInstallations(state, actor, "practice-station", otherScope).installations.length, 0);
  // When both companies are given, the provider one decides only the scope and the validation one decides the state.
  const second = installationIdentity(); register(second, otherScope);
  assert.equal(query(second, otherScope).rraaValidationStatus, "validated");
  assert.equal(query(second, { rraaClientId: "other-company" }).rraaValidationStatus, "not_validated");
});

test("B5 through the app, the data of an installation match the list and the practice control leaves the installation scope alone", async (t) => {
  const origin = "http://localhost:5173";
  const run = async (extra: { publicWeb?: boolean; rraa?: RraaValidator }, name: string, deviceId: string) => {
    const store = new MemoryStore(seed());
    const app = await buildApp({ store, demo: true, secret: "synthetic-station-control-secret-at-least-32-characters", origins: [origin],
      collectorUrl: "http://127.0.0.1:5174", ...extra, demoStationControl: createDemoStationControl() });
    t.after(async () => { await app.close(); await store.close(); });
    const token = (await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin }, payload: { email: "admin@cyp.local", password: demoPassword } })).json().token as string;
    const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload, headers: { origin, authorization: `Bearer ${token}`, "idempotency-key": randomUUID() } });
    const created = await post("/api/estaciones", stationInput(name, deviceId));
    assert.equal(created.statusCode, 200, created.body);
    const base = `/api/estaciones/${created.json().id}`, key = installationIdentity();
    const registration = await post(`${base}/instalaciones/desafios`, { purpose: "register", installationId: key.installationId, publicKeySpki: key.publicKeySpki });
    assert.equal(registration.statusCode, 200, registration.body);
    const registered = await post(`${base}/instalaciones`, { challengeId: registration.json().challengeId, installationId: key.installationId, publicKeySpki: key.publicKeySpki,
      signature: key.prove(registration.json()), confirmed: true });
    assert.equal(registered.statusCode, 200, registered.body);
    const question = await post(`${base}/instalaciones/desafios`, { purpose: "query", installationId: key.installationId });
    assert.equal(question.statusCode, 200, question.body);
    const answer = await post(`${base}/datos`, { challengeId: question.json().challengeId, installationId: key.installationId, signature: key.prove(question.json()) });
    assert.equal(answer.statusCode, 200, answer.body);
    const rows = (await app.inject({ method: "GET", url: "/api/estaciones", headers: { origin, authorization: `Bearer ${token}` } })).json() as Array<{ id: string; rraaValidated: boolean; rraaValidatedAt: string }>;
    const saved = (getAdminTools(await store.read()) as unknown as { installations: Array<{ scopeId: string }> }).installations;
    assert.equal(saved.length, 1);
    return { data: answer.json() as { rraaValidationStatus: string; rraaValidatedAt?: string }, listed: rows.find((row) => row.id === created.json().id)!,
      scope: JSON.parse(saved[0].scopeId) as [string, string | null] };
  };
  const real: RraaValidator = { clientId: "QA-COMPANY", async validate(stationCode, deviceId) {
    return { clientId: "QA-COMPANY", stationCode, deviceId, license: "QA-LICENSE", validatedAt: new Date().toISOString() };
  } };
  // Public demo and local demo without provider: the practice control validates and installations keep their scope without a company.
  for (const extra of [{ publicWeb: true }, { publicWeb: true, rraa: real }, {}]) {
    const seen = await run(extra, "EST-PRUEBA-01", "DISP-PRUEBA-01");
    assert.equal(seen.listed.rraaValidated, true);
    assert.equal(seen.data.rraaValidationStatus, "validated");
    assert.equal(seen.data.rraaValidatedAt, seen.listed.rraaValidatedAt);
    assert.equal(seen.scope[1], null);
  }
  // Local demo with a provider: nothing changes, the scope carries the provider company.
  const provider = await run({ rraa: real }, "Estación del proveedor", "X-1");
  assert.equal(provider.data.rraaValidationStatus, "validated");
  assert.equal(provider.data.rraaValidatedAt, provider.listed.rraaValidatedAt);
  assert.equal(provider.scope[1], "QA-COMPANY");
});
