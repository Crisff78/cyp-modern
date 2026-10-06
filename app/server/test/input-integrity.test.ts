import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { seed } from "../src/seed.js";
import { frequencyCodes, saveRecurringCharges } from "../src/catalog-store.js";

async function setup(t: TestContext) {
  const initial = seed();
  initial.services.push({ id: "integrity-service", service: "Servicio de prueba", abbr: "INT", caption: "Prueba", obligated: false, active: true, fixedAmount: false });
  const store = new MemoryStore(initial);
  const app = await buildApp({ store, demo: true, secret: "synthetic-integrity-tests-secret-at-least-32", origins: [], collectorUrl: "http://localhost:5174" });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200);
  const token = login.json().token;
  const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() } });
  const client = { name: "Cliente de prueba", code: "INT-001", routeId: initial.routes[0].id, identification: "DOC-INT-001" };
  const recurring = { clientId: initial.clients[0].id, service: "Servicio de prueba", frequency: "Mensual", startDate: "2026-10-06", amount: 100, active: true };
  return { app, store, post, client, recurring, initial };
}

test("recurring days reject malformed strings, out-of-range values and wrong types before saving", async (t) => {
  const { store, post, recurring } = await setup(t);
  const before = await store.read();
  for (const field of ["day1", "day2"]) for (const invalid of ["abc", "99", "", " ", " 1", "1 ", "1.0", "1e1", "0x10", "+1", "-1", "1x", "001", "1;SELECT", 0, 32, -1, 1.5, true, false, [], {}]) {
    const response = await post("/api/cargos-recurrentes", { ...recurring, [field]: invalid });
    assert.equal(response.statusCode, 400, `${field}=${JSON.stringify(invalid)}: ${response.body}`);
  }
  assert.deepEqual(await store.read(), before);
});

test("all defined frequencies accept optional month days, null and absent days", async (t) => {
  const { post, recurring } = await setup(t);
  for (const frequency of Object.keys(frequencyCodes).filter((label) => label !== "No Definida")) {
    const explicit = await post("/api/cargos-recurrentes", { ...recurring, frequency, day1: 1, day2: "31" });
    assert.equal(explicit.statusCode, 200, `${frequency}: ${explicit.body}`);
    assert.equal(explicit.json().day1, "1");
    assert.equal(explicit.json().day2, "31");
    const omitted = await post("/api/cargos-recurrentes", { ...recurring, frequency });
    assert.equal(omitted.statusCode, 200, omitted.body);
    assert.equal(omitted.json().day1, "");
    assert.equal(omitted.json().day2, "");
    const empty = await post("/api/cargos-recurrentes", { ...recurring, frequency, day1: null, day2: null });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.json().day1, "");
    assert.equal(empty.json().day2, "");
  }
});

test("recurring edits normalize numeric strings and preserve the legacy text-column representation", async (t) => {
  const { store, post, recurring } = await setup(t);
  const created = await post("/api/cargos-recurrentes", { ...recurring, day1: "01", day2: "15" });
  assert.equal(created.statusCode, 200, created.body);
  const before = await store.read();
  const edited = await post(`/api/cargos-recurrentes/${created.json().id}`, { ...recurring, day1: 31, day2: null });
  assert.equal(edited.statusCode, 200, edited.body);
  const after = await store.read();
  assert.equal(after.recurringCharges[0].day1, "31");
  assert.equal(after.recurringCharges[0].day2, "");
  const calls: unknown[][] = [];
  const capture = { query: async (_sql: string, params: unknown[]) => { calls.push(params); return { rows: [] }; } } as unknown as Parameters<typeof saveRecurringCharges>[0];
  await saveRecurringCharges(capture, after, before, async () => "integrity-service");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][13], "31");
  assert.equal(calls[0][14], "");
  const invalid = await post(`/api/cargos-recurrentes/${created.json().id}`, { ...recurring, day2: "oops" });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(await store.read(), after);
});

test("undefined frequency accepts unused days but rejects supplied calendar days", async (t) => {
  const { post, recurring } = await setup(t);
  assert.equal((await post("/api/cargos-recurrentes", { ...recurring, frequency: "No Definida", day1: 1 })).statusCode, 400);
  assert.equal((await post("/api/cargos-recurrentes", { ...recurring, frequency: "No Definida", day1: null, day2: null })).statusCode, 200);
});

test("client contacts reject bad email and phone formats on create and edit", async (t) => {
  const { store, post, client } = await setup(t);
  const created = await post("/api/clientes", { ...client, phone: "+1 (809) 555-0101", cellular: "809-555-0102", email: "contacto+ventas@example.com" });
  assert.equal(created.statusCode, 200, created.body);
  const before = await store.read();
  const invalidFields = [
    ...["abc", "809-555-0101 ext 2", "1234567", "1234567890123456", "809+5550101", "++18095550101", "809/555/0101", "809\t5550101", "(())", "１23456789"].flatMap((value) => [{ phone: value }, { cellular: value }]),
    ...["sin-correo", "a@@example.com", "a@example", "a b@example.com", "x".repeat(201)].map((email) => ({ email })),
  ];
  for (const fields of invalidFields) for (const url of ["/api/clientes", `/api/clientes/${created.json().id}`]) {
    const response = await post(url, { ...client, ...fields });
    assert.equal(response.statusCode, 400, `${url} ${JSON.stringify(fields)}: ${response.body}`);
  }
  assert.deepEqual(await store.read(), before);
});

test("optional contacts remain empty and valid formatted phones are preserved", async (t) => {
  const { post, client } = await setup(t);
  for (const [index, phone] of ["", "        ", "12345678", "123456789012345", "+1 (809) 555-0101", "809 555 0101"].entries()) {
    const response = await post("/api/clientes", { ...client, code: `INT-PHONE-${index}`, phone, cellular: "", email: "" });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().phone, phone.trim());
  }
  const missing = await post("/api/clientes", { ...client, code: "INT-NO-CONTACT" });
  assert.equal(missing.statusCode, 200, missing.body);
  assert.equal(missing.json().phone, "");
  assert.equal(missing.json().cellular, "");
  assert.equal(missing.json().email, "");
});

test("PCP phone and collector cellular enforce the same contract on create and edit", async (t) => {
  const { store, post } = await setup(t);
  const group = await post("/api/grupos-pcp", { name: "Grupo de integridad" });
  assert.equal(group.statusCode, 200, group.body);
  const pcp = { name: "PCP de integridad", number: "INT-PCP", groupId: group.json().id, phone: "+1-809-555-0101" };
  const created = await post("/api/pcps", pcp);
  assert.equal(created.statusCode, 200, created.body);
  const collector = { name: "Cobrador de integridad", cellular: "(809) 555-0101" };
  const savedCollector = await post("/api/cobradores", collector);
  assert.equal(savedCollector.statusCode, 200, savedCollector.body);
  const before = await store.read();
  for (const value of ["texto", "12", "1".repeat(16), "809;5550101", "8095550101".repeat(5)]) {
    for (const url of ["/api/pcps", `/api/pcps/${created.json().id}`]) assert.equal((await post(url, { ...pcp, phone: value })).statusCode, 400);
    for (const url of ["/api/cobradores", `/api/cobradores/${savedCollector.json().id}`]) assert.equal((await post(url, { ...collector, cellular: value })).statusCode, 400);
  }
  assert.deepEqual(await store.read(), before);
});

test("contact validation preserves Unicode names, addresses, document codes and passwords with symbols", async (t) => {
  const { app, post, client } = await setup(t);
  const name = "José O'Connor & Hijos #2", address = "Av. Núñez #12 / local (B), próximo a la estación.";
  const response = await post("/api/clientes", { ...client, name, address, alias: "Pepe / O'Connor", email: "jose+ventas@example.com", phone: "+1 (809) 555-0101" });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().name, name);
  assert.equal(response.json().address, address);
  assert.equal(response.json().identification, client.identification);
  const password = "  Ñandú O'Connor!#@2026 +  ";
  const email = "integridad+clave@example.com";
  const account = await post("/api/usuarios", { name, email, role: "admin", password });
  assert.equal(account.statusCode, 200, account.body);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  assert.equal(login.statusCode, 200, login.body);
  const stripped = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: password.trim() } });
  assert.equal(stripped.statusCode, 401);
});
