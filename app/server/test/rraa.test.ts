import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { getAdminTools } from "../src/admin-tools.js";
import { DomainError } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { FileStore, MemoryStore, PostgresStore, type Store } from "../src/store.js";
import { createRraaValidator, parseRraaResponse, stationRraaValidated, type RraaValidator } from "../src/rraa.js";

const code = (expected: string) => (error: unknown) => error instanceof DomainError && error.code === expected;
test("RRAA strictly parses OK/license and ER; never authorizes malformed replies", () => {
  assert.equal(parseRraaResponse("OK|QA-LICENSE\r\n"), "QA-LICENSE");
  assert.throws(() => parseRraaResponse("ER|Estación no encontrada."), code("RRAA_STATION_NOT_FOUND"));
  for (const reply of ["", "OK", "OK|", "OK|x|y", "ok|x", "OK|a\nb", "ERROR|x", `OK|${"x".repeat(1025)}`])
    assert.throws(() => parseRraaResponse(reply), code("RRAA_INVALID_RESPONSE"), reply);
});
test("RRAA constructs the encoded tuple and targets only the configured server", async () => {
  let calls = 0;
  const service = createRraaValidator({ endpoint: "http://127.0.0.1:60031/VALSTAT", clientId: "QA-CLIENT", fetch: (async (url, init) => {
    calls++; const target = new URL(String(url));
    assert.equal(target.origin, "http://127.0.0.1:60031");
    assert.equal(target.searchParams.get("p"), "QA-CLIENT|QA station &1|QA/DEVICE?x");
    assert.equal(init?.redirect, "manual"); assert.equal(init?.method, "GET");
    return new Response("OK|QA-LICENSE");
  }) as typeof fetch });
  const result = await service.validate(" QA station &1 ", "QA/DEVICE?x");
  assert.equal(result.clientId, "QA-CLIENT"); assert.equal(result.stationCode, "QA station &1");
  assert.equal(result.license, "QA-LICENSE"); assert(Number.isFinite(Date.parse(result.validatedAt)));
  for (const value of ["", " ", "x|y", "x\ny", "x".repeat(161)]) await assert.rejects(service.validate(value, "QA"), code("RRAA_INPUT_INVALID"));
  assert.equal(calls, 1);
  for (const endpoint of ["file:///VALSTAT", "http://user:pass@localhost/VALSTAT", "http://localhost/VALSTAT?p=x", "http://localhost/other"])
    assert.throws(() => createRraaValidator({ endpoint, clientId: "QA" }));
  assert.throws(() => createRraaValidator({ endpoint: "http://localhost/VALSTAT", clientId: "QA|other" }));
});
test("RRAA rejects redirects, HTTP failures, oversized/invalid UTF8 bodies and timeouts", async () => {
  for (const response of [new Response("OK|FAKE", { status: 302 }), new Response("OK|FAKE", { status: 500 }),
    new Response("x".repeat(4097)), new Response(Uint8Array.from([0xff]))]) {
    const service = createRraaValidator({ endpoint: "http://127.0.0.1/VALSTAT", clientId: "QA", fetch: (async () => response) as typeof fetch });
    await assert.rejects(service.validate("QA-STATION", "QA-DEVICE"), (error: unknown) => error instanceof DomainError && error.status >= 400);
  }
  const service = createRraaValidator({ endpoint: "http://127.0.0.1/VALSTAT", clientId: "QA", timeoutMs: 100, fetch: (async (_url, init) =>
    new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("Timeout")), { once: true }))) as typeof fetch });
  await assert.rejects(service.validate("QA-STATION", "QA-DEVICE"), code("RRAA_UNAVAILABLE"));
});

async function fixture(store: Store = new MemoryStore(seed()), publicWeb = false) {
  let failure = false, calls = 0;
  const rraa: RraaValidator = { clientId: "QA-COMPANY", async validate(stationCode, deviceId) {
    calls++; if (failure) throw new DomainError("RRAA_STATION_NOT_FOUND", "RRAA: Estación no encontrada.", 422);
    if (!deviceId || stationCode.includes("|")) throw new DomainError("RRAA_INPUT_INVALID", "Código o dispositivo inválido.", 422);
    return { clientId: this.clientId, stationCode, deviceId, license: "QA-LICENSE", validatedAt: new Date().toISOString() };
  } };
  const app = await buildApp({ store, rraa, publicWeb, secret: "rraa-synthetic-tests-secret-long-enough", demo: true,
    origins: ["http://localhost:5173"], collectorUrl: "http://localhost:5174" });
  const login = async (email: string) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } })).json().token;
  const token = await login("admin@cyp.local"), collector = await login("collector@cyp.local");
  const post = (path: string, body: object, key = randomUUID(), bearer = token) => app.inject({ method: "POST", url: `/api${path}`, payload: body,
    headers: { authorization: `Bearer ${bearer}`, "idempotency-key": key } });
  const get = (path: string, bearer = token) => app.inject({ method: "GET", url: `/api${path}`, headers: { authorization: `Bearer ${bearer}` } });
  return { app, store, rraa, post, get, collector, calls: () => calls, fail: (value: boolean) => { failure = value; } };
}
const input = { name: "QA-STATION", number: "QA-1", deviceId: "QA-DEVICE", description: "Ficticia", group: "Cobros", type: "Cobros y Pagos" };
test("station preview is read-only, Admin-only and excludes browser-supplied authorization", async () => {
  const env = await fixture();
  try {
    assert.deepEqual((await env.get("/estaciones/rraa")).json(), { configured: true, clientId: "QA-COMPANY" });
    assert.equal((await env.get("/estaciones/rraa", env.collector)).statusCode, 403);
    const spec = (await env.get("/openapi.json")).json();
    assert.equal(spec.paths["/api/estaciones/validar"].post.parameters.some((header: { name: string }) => header.name === "Idempotency-Key"), false);
    assert.equal(spec.paths["/api/estaciones"].post.parameters.some((header: { name: string; required: boolean }) => header.name === "Idempotency-Key" && header.required), true);
    const before = await env.store.read();
    const result = await env.post("/estaciones/validar", { stationCode: input.name, deviceId: input.deviceId });
    assert.equal(result.statusCode, 200); assert.equal(result.json().license, "QA-LICENSE");
    assert.deepEqual(await env.store.read(), before);
    assert.equal((await env.post("/estaciones/validar", { stationCode: input.name, deviceId: input.deviceId }, randomUUID(), env.collector)).statusCode, 403);
    for (const forged of [{ clientId: "OTHER" }, { endpoint: "http://evil.invalid/VALSTAT" }, { license: "FORGED" }, { rraaValidatedAt: new Date().toISOString() }, { version: "forged" }])
      assert.equal((await env.post("/estaciones", { ...input, ...forged })).statusCode, 400);
    assert.equal(env.calls(), 1);
  } finally { await env.app.close(); }
});
test("station save/activation revalidate, bind identity, and replay idempotently without another provider call", async () => {
  const env = await fixture();
  try {
    const key = randomUUID(), created = await env.post("/estaciones", input, key);
    assert.equal(created.statusCode, 200, created.body);
    const station = created.json(); assert.equal(station.active, false); assert.equal(station.rraaValidated, true);
    assert.notEqual(station.id, input.number); assert.equal(station.rraaValidatedBy, "demo-admin");
    const repeat = await env.post("/estaciones", input, key); assert.deepEqual(repeat.json(), station); assert.equal(env.calls(), 1);
    assert.equal((await env.post("/estaciones", { ...input, name: "CHANGED" }, key)).statusCode, 409);
    const activated = await env.post(`/estaciones/${station.id}/actividad`, { active: true });
    assert.equal(activated.statusCode, 200); assert.equal(activated.json().active, true); assert.equal(env.calls(), 2);
    const edit = await env.post(`/estaciones/${station.id}`, { ...input, name: "QA-NEW", deviceId: "QA-NEW-DEVICE", active: true });
    assert.equal(edit.statusCode, 200, edit.body); assert.equal(edit.json().id, station.id);
    assert.equal(edit.json().rraaStationCode, "QA-NEW"); assert.equal(edit.json().rraaDeviceId, "QA-NEW-DEVICE");
    assert.equal(env.calls(), 3);
    assert.equal((await env.post("/estaciones", { ...input, name: "OTHER" })).statusCode, 409);
    assert.equal(env.calls(), 3);
    assert.equal(stationRraaValidated(edit.json(), "OTHER-COMPANY"), false);
    assert.equal(stationRraaValidated({ ...edit.json(), deviceId: "FORGED" }, env.rraa.clientId), false);
  } finally { await env.app.close(); }
});
test("RRAA failure rolls back station mutations; deactivation remains available without provider", async () => {
  const env = await fixture();
  try {
    const created = (await env.post("/estaciones", { ...input, active: true })).json();
    env.fail(true); const before = await env.store.read();
    for (const [path, body] of [[`/estaciones/${created.id}`, { ...input, name: "QA-CHANGED", active: true }],
      [`/estaciones/${created.id}/actividad`, { active: true }], ["/estaciones", { ...input, name: "QA-OTHER", number: "QA-OTHER", deviceId: "QA-OTHER" }]] as const) {
      assert.equal((await env.post(path, body)).statusCode, 422);
      assert.deepEqual(await env.store.read(), before);
    }
    const count = env.calls();
    assert.equal((await env.post(`/estaciones/${created.id}/actividad`, { active: false })).statusCode, 200);
    assert.equal(env.calls(), count); assert.equal((await env.get("/estaciones")).json()[0].active, false);
    assert.equal((await env.post(`/estaciones/${created.id}/actividad`, { active: true }, randomUUID(), env.collector)).statusCode, 403);
  } finally { await env.app.close(); }
});
test("new PCP associations require active proof for current company; historical links may be retained/removed", async () => {
  const env = await fixture();
  try {
    const station = (await env.post("/estaciones", input)).json();
    const group = (await env.post("/grupos-pcp", { name: "QA-GROUP" })).json();
    const pcp = (await env.post("/pcps", { number: "QA-PCP", name: "QA-PCP", groupId: group.id })).json();
    const path = `/pcps/${pcp.id}/estaciones`;
    assert.equal((await env.post(path, { stationIds: [station.id] })).json().error.code, "STATION_INACTIVE");
    await env.post(`/estaciones/${station.id}/actividad`, { active: true });
    assert.equal((await env.post(path, { stationIds: [station.id] })).statusCode, 200);
    env.rraa.clientId = "OTHER-COMPANY";
    assert.equal((await env.get("/estaciones")).json()[0].rraaValidated, false);
    assert.equal((await env.post(path, { stationIds: [station.id] })).statusCode, 200);
    assert.equal((await env.post(path, { stationIds: [] })).statusCode, 200);
    assert.equal((await env.post(path, { stationIds: [station.id] })).json().error.code, "STATION_RRAA_REQUIRED");
  } finally { await env.app.close(); }
});

test("new PCP links revalidate with RRAA and reject revoked or unavailable licenses atomically", async () => {
  const env = await fixture();
  try {
    const station = (await env.post("/estaciones", { ...input, active: true })).json();
    const other = (await env.post("/estaciones", { ...input, name: "QA-SECOND-STATION", number: "QA-SECOND", deviceId: "QA-SECOND-DEVICE", active: true })).json();
    const group = (await env.post("/grupos-pcp", { name: "QA-FRESH-RRAA-GROUP" })).json();
    const pcp = (await env.post("/pcps", { name: "QA-FRESH-RRAA-PCP", number: "QA-FRESH-RRAA-PCP", groupId: group.id })).json();
    const path = `/pcps/${pcp.id}/estaciones`, before = await env.store.read();
    env.fail(true);
    const rejected = await env.post(path, { stationIds: [station.id] });
    assert.equal(rejected.statusCode, 422); assert.equal(rejected.json().error.code, "RRAA_STATION_NOT_FOUND");
    assert.deepEqual(await env.store.read(), before, "rejection keeps license, activity and links unchanged");
    const validate = env.rraa.validate;
    env.rraa.validate = async () => { throw new DomainError("RRAA_UNAVAILABLE", "Proveedor no disponible.", 502); };
    assert.equal((await env.post(path, { stationIds: [station.id] })).statusCode, 502);
    assert.deepEqual(await env.store.read(), before);
    env.fail(false);
    env.rraa.validate = async (stationCode, deviceId) => {
      if (stationCode === other.name) throw new DomainError("RRAA_STATION_NOT_FOUND", "RRAA: Estación no encontrada.", 422);
      return validate.call(env.rraa, stationCode, deviceId);
    };
    assert.equal((await env.post(path, { stationIds: [station.id, other.id] })).statusCode, 422);
    assert.deepEqual(await env.store.read(), before, "a later rejection also rolls back the first refreshed license");
    env.rraa.validate = validate;
    const calls = env.calls();
    assert.equal((await env.post(path, { stationIds: [station.id] })).statusCode, 200);
    assert.equal(env.calls(), calls + 1, "new link obtains fresh validation");
    env.fail(true);
    assert.equal((await env.post(path, { stationIds: [station.id] })).statusCode, 200, "existing links can be retained offline");
    assert.equal((await env.post(path, { stationIds: [] })).statusCode, 200, "existing links can be removed offline");
    assert.equal(env.calls(), calls + 1);
  } finally { await env.app.close(); }
});
test("RRAA proof and license persist through FileStore reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-rraa-")), file = join(directory, "state.json");
  const env = await fixture(await FileStore.open(file, seed()));
  try {
    const station = (await env.post("/estaciones", { ...input, active: true })).json();
    await env.app.close();
    const reopened = await FileStore.open(file, seed());
    try { assert.equal(stationRraaValidated(getAdminTools(await reopened.read()).stations.find((row) => row.id === station.id)!, "QA-COMPANY"), true); }
    finally { await reopened.close(); }
  } finally { await env.app.close(); await rm(directory, { recursive: true, force: true }); }
});
test("public demo never enables real RRAA even if a validator is supplied", async () => {
  const env = await fixture(undefined, true);
  try {
    assert.equal((await env.get("/estaciones/rraa")).json().configured, false);
    assert.equal((await env.post("/estaciones", input)).statusCode, 409);
    assert.equal(env.calls(), 0);
  } finally { await env.app.close(); }
});

const qaUrl = process.env.CYP_PHASE234_TEST_DATABASE_URL;
test("migration 025 persists RRAA proof in isolated native PostgreSQL without authorizing historical stations", { skip: !qaUrl }, async () => {
  const target = new URL(qaUrl!);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55434"); assert.equal(target.pathname, "/cyp_phase234_qa");
  assert.equal(target.username, "phase234_qa");
  const store = new PostgresStore(qaUrl!), env = await fixture(store), prefix = `rraa-qa-${randomUUID()}`;
  let stationId = "";
  try {
    const result = await env.post("/estaciones", { ...input, name: prefix, number: prefix, deviceId: prefix, active: true });
    assert.equal(result.statusCode, 200, result.body); stationId = result.json().id;
    const station = getAdminTools(await store.read()).stations.find((row) => row.id === stationId)!;
    assert.equal(station.license, "QA-LICENSE"); assert.equal(stationRraaValidated(station, "QA-COMPANY"), true);
    const independent = new PostgresStore(qaUrl!);
    try { assert.equal(stationRraaValidated(getAdminTools(await independent.read()).stations.find((row) => row.id === stationId)!, "QA-COMPANY"), true); }
    finally { await independent.close(); }
    const client = new pg.Client({ connectionString: qaUrl }); await client.connect();
    try {
      await assert.rejects(client.query("UPDATE pcp_stations SET device_id=$1 WHERE id=$2", ["FORGED", stationId]), (error: unknown) => (error as { code?: string }).code === "23514");
      const old = await client.query("SELECT rraa_validated_at FROM pcp_stations WHERE id <> $1 AND rraa_client_id IS NULL LIMIT 1", [stationId]);
      if (old.rowCount) assert.equal(old.rows[0].rraa_validated_at, null);
    } finally { await client.end(); }
  } finally {
    // Station deletions are intentionally unsupported in the application store;
    // remove only this uniquely identified synthetic fixture directly in QA.
    const cleanup = new pg.Client({ connectionString: qaUrl }); await cleanup.connect();
    try { await cleanup.query("DELETE FROM pcp_stations WHERE id=$1", [stationId]); }
    finally { await cleanup.end(); await env.app.close(); }
  }
});
