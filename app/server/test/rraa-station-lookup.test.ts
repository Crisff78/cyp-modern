import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { getAdminTools } from "../src/admin-tools.js";
import { DomainError } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { FileStore, MemoryStore, PostgresStore, type Store } from "../src/store.js";
import { createDemoStationControl, createRraaValidator, limitRraaCalls, parseRraaStationData, resolveRraaStation } from "../src/rraa.js";

const errorCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;
test("STATDAT accepts exactly OK/device/license/SO and refuses incomplete or unsafe provider data", () => {
  assert.deepEqual(parseRraaStationData("OK|QA-DEVICE|QA-LICENSE|7\r\n"), { deviceId: "QA-DEVICE", license: "QA-LICENSE", operatingSystem: "7" });
  assert.throws(() => parseRraaStationData("ER|ENE"), errorCode("RRAA_STATION_NOT_FOUND"));
  assert.throws(() => parseRraaStationData("ER|CNE"), errorCode("RRAA_CLIENT_NOT_FOUND"));
  for (const text of ["", "OK|x", "OK||license|7", "OK|device||7", "OK|device|license|", "OK|device|license|7|extra",
    "OK|dev\nice|license|7", "OK|device|license|S\0O", `OK|${"x".repeat(161)}|license|7`, `OK|device|${"x".repeat(1025)}|7`, "ER|ENE|extra"])
    assert.throws(() => parseRraaStationData(text), errorCode("RRAA_INVALID_RESPONSE"));
});

async function provider() {
  const calls: Array<{ path: string; tuple: string }> = [];
  let rejectLookup = false, rejectValidation = false, changedLicense = false, changedDevice = false;
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://127.0.0.1"), lookup = url.pathname === "/STATDAT";
    const tuple = url.searchParams.get(lookup ? "P" : "p") ?? "";
    calls.push({ path: url.pathname, tuple });
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    if (request.method !== "GET" || !["/STATDAT", "/VALSTAT"].includes(url.pathname)) { response.writeHead(501); response.end("Unexpected request"); return; }
    const [company, station, device] = tuple.split("|");
    if (company !== "QA-COMPANY") { response.end("ER|CNE"); return; }
    const known = ["QA STATION &1", "QA-SECOND", "QA-DUPLICATE"].includes(station);
    if (!known || (lookup ? rejectLookup : rejectValidation)) { response.end("ER|ENE"); return; }
    const expectedDevice = station === "QA-SECOND" ? "QA-SECOND-DEVICE" : changedDevice ? "QA-REPLACED-DEVICE" : "QA-DEVICE";
    if (lookup) response.end(`OK|${expectedDevice}|QA-LICENSE|7`);
    else response.end(device === expectedDevice ? `OK|${changedLicense ? "QA-DIFFERENT-LICENSE" : "QA-LICENSE"}` : "ER|ENE");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const rraa = createRraaValidator({ endpoint: `http://127.0.0.1:${address.port}/VALSTAT`, clientId: "QA-COMPANY" });
  return { rraa, calls, rejectLookup: (value: boolean) => { rejectLookup = value; }, rejectValidation: (value: boolean) => { rejectValidation = value; },
    changedLicense: (value: boolean) => { changedLicense = value; }, changedDevice: (value: boolean) => { changedDevice = value; },
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}

test("real HTTP adapter resolves station-only using uppercase P and validates the returned identity without guessing it", async () => {
  const env = await provider();
  try {
    const result = await resolveRraaStation(env.rraa, " QA STATION &1 ");
    assert.equal(result.deviceId, "QA-DEVICE"); assert.equal(result.license, "QA-LICENSE"); assert.equal(result.operatingSystem, "7");
    assert.deepEqual(env.calls, [{ path: "/STATDAT", tuple: "QA-COMPANY|QA STATION &1" }, { path: "/VALSTAT", tuple: "QA-COMPANY|QA STATION &1|QA-DEVICE" }]);
    for (const name of ["", " ", "station|other", "station\nother", "x".repeat(161)])
      await assert.rejects(env.rraa.lookup!(name), errorCode("RRAA_INPUT_INVALID"));
    assert.equal(env.calls.length, 2, "bad inputs never contact the provider");
    await assert.rejects(resolveRraaStation(env.rraa, "QA STATION &1", "FORGED"), errorCode("RRAA_STATION_MISMATCH"));
    assert.equal(env.calls.at(-1)?.path, "/STATDAT", "a supplied foreign identity never reaches VALSTAT");
    env.changedLicense(true);
    await assert.rejects(resolveRraaStation(env.rraa, "QA STATION &1"), errorCode("RRAA_DATA_CHANGED"));
    env.changedLicense(false); env.rejectValidation(true);
    await assert.rejects(resolveRraaStation(env.rraa, "QA STATION &1"), errorCode("RRAA_STATION_NOT_FOUND"));
  } finally { await env.close(); }
});

test("STATDAT uses the same redirect, size, encoding and timeout protections as VALSTAT", async () => {
  for (const response of [new Response("OK|dev|lic|7", { status: 302 }), new Response("OK|dev|lic|7", { status: 503 }),
    new Response("x".repeat(4097)), new Response(Uint8Array.from([0xff]))]) {
    const rraa = createRraaValidator({ endpoint: "http://127.0.0.1/VALSTAT", clientId: "QA", fetch: (async () => response) as typeof fetch });
    await assert.rejects(rraa.lookup!("QA-STATION"), (error: unknown) => error instanceof DomainError && error.status >= 400);
  }
  const slow = createRraaValidator({ endpoint: "http://127.0.0.1/VALSTAT", clientId: "QA", timeoutMs: 100,
    fetch: (async (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("Timeout")), { once: true }))) as typeof fetch });
  await assert.rejects(slow.lookup!("QA-STATION"), errorCode("RRAA_UNAVAILABLE"));
});

async function fixture(store: Store = new MemoryStore(seed())) {
  const upstream = await provider();
  const app = await buildApp({ store, rraa: upstream.rraa, demo: true, secret: "station-lookup-synthetic-secret-at-least-32-characters",
    origins: [], collectorUrl: "http://localhost:5174" });
  const login = async (email: string) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } })).json().token;
  const admin = await login("admin@cyp.local"), collector = await login("collector@cyp.local");
  const post = (path: string, payload: object, key = randomUUID(), token = admin) => app.inject({ method: "POST", url: `/api${path}`, payload,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  const get = (path: string) => app.inject({ method: "GET", url: `/api${path}`, headers: { authorization: `Bearer ${admin}` } });
  return { ...upstream, app, store, post, get, collector, close: async () => { await app.close(); await upstream.close(); } };
}

test("station-only API lookup is Admin-only, has no catalog writes, and rejects browser-controlled company/URL/license/OS", async () => {
  const env = await fixture();
  try {
    assert.equal((await env.get("/estaciones/rraa")).json().canObtainData, true);
    const before = await env.store.read();
    const result = await env.post("/estaciones/obtener-datos", { stationCode: "QA STATION &1" });
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().deviceId, "QA-DEVICE"); assert.equal(result.json().operatingSystem, "7");
    assert.deepEqual(await env.store.read(), before);
    assert.equal((await env.post("/estaciones/obtener-datos", { stationCode: "QA STATION &1" }, randomUUID(), env.collector)).statusCode, 403);
    for (const extra of [{ clientId: "FOREIGN" }, { endpoint: "http://evil.invalid" }, { deviceId: "FORGED" }, { license: "FORGED" }, { operatingSystem: "FORGED" }])
      assert.equal((await env.post("/estaciones/obtener-datos", { stationCode: "QA STATION &1", ...extra })).statusCode, 400);
    const spec = (await env.get("/openapi.json")).json();
    assert.equal(spec.paths["/api/estaciones/obtener-datos"].post.parameters.some((header: { name: string }) => header.name === "Idempotency-Key"), false);
    assert.equal(env.calls.length, 2);
  } finally { await env.close(); }
});

test("station save allocates numbers transactionally, stores provider ID/license/SO, and never trusts stale or forged bindings", async () => {
  const env = await fixture();
  try {
    const key = randomUUID(), created = await env.post("/estaciones", { name: "QA STATION &1", active: true }, key);
    assert.equal(created.statusCode, 200, created.body);
    const station = created.json();
    assert.equal(station.number, "1"); assert.equal(station.deviceId, "QA-DEVICE"); assert.equal(station.license, "QA-LICENSE");
    assert.equal(station.operatingSystem, "7"); assert.equal(station.version, ""); assert.equal(station.rraaClientId, "QA-COMPANY"); assert.equal(station.rraaValidated, true);
    const calls = env.calls.length;
    assert.deepEqual((await env.post("/estaciones", { name: "QA STATION &1", active: true }, key)).json(), station);
    assert.equal(env.calls.length, calls, "idempotent retry performs no additional lookup/validation");
    const results = await Promise.all([env.post("/estaciones", { name: "QA-SECOND" }), env.post("/estaciones", { name: "QA-DUPLICATE" })]);
    assert.equal(results[0].statusCode, 200); assert.equal(results[0].json().number, "2");
    assert.equal(results[1].statusCode, 409, "the same provider identity cannot be registered for a second station");
    const before = await env.store.read();
    for (const extra of [{ deviceId: "FORGED" }, { clientId: "FOREIGN" }, { license: "FORGED" }, { operatingSystem: "FORGED" }])
      assert.ok((await env.post(`/estaciones/${station.id}`, { name: station.name, ...extra })).statusCode >= 400);
    assert.deepEqual(await env.store.read(), before);
    env.changedDevice(true);
    const stale = await env.post(`/estaciones/${station.id}`, { name: station.name, deviceId: station.deviceId });
    assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, "RRAA_STATION_MISMATCH");
    assert.equal((await env.post(`/estaciones/${station.id}/actividad`, { active: true })).statusCode, 409);
    assert.deepEqual(await env.store.read(), before, "provider changes cannot silently rebind saved identities");
    env.changedDevice(false); env.rejectValidation(true);
    assert.equal((await env.post(`/estaciones/${station.id}`, { name: station.name })).statusCode, 422);
    assert.deepEqual(await env.store.read(), before, "rejected validation rolls back all station edits");
    const count = env.calls.length;
    assert.equal((await env.post(`/estaciones/${station.id}/actividad`, { active: false })).statusCode, 200);
    assert.equal(env.calls.length, count, "deactivation remains available while the provider is down");
  } finally { await env.close(); }
});

test("resolved provider data survives FileStore reopening without changing the software version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-station-lookup-")), file = join(directory, "state.json");
  const env = await fixture(await FileStore.open(file, seed()));
  try {
    const saved = (await env.post("/estaciones", { name: "QA STATION &1" })).json();
    const reopened = await FileStore.open(file, seed());
    try {
      const station = getAdminTools(await reopened.read()).stations.find((row) => row.id === saved.id)!;
      assert.equal(station.operatingSystem, "7"); assert.equal(station.deviceId, "QA-DEVICE"); assert.equal(station.version, "");
    } finally { await reopened.close(); }
  } finally {
    await env.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith("cyp-station-lookup-"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("STATDAT and VALSTAT share the provider call budget and outage pause; demo lookup only knows registered fictional stations", async () => {
  const env = await provider();
  try {
    let clock = 0;
    const limited = limitRraaCalls(env.rraa, 2, () => clock);
    for (let count = 0; count < 3; count++) await assert.rejects(limited.lookup!(""), errorCode("RRAA_INPUT_INVALID"));
    await resolveRraaStation(limited, "QA STATION &1");
    await assert.rejects(limited.lookup!("QA STATION &1"), errorCode("RRAA_RATE_LIMITED")); assert.equal(env.calls.length, 2);
    clock = 60_001; await limited.lookup!("QA-SECOND");
    const unavailable = limitRraaCalls({ ...env.rraa, lookup: async () => { throw new DomainError("RRAA_UNAVAILABLE", "Unavailable", 502); } }, 20, () => clock);
    await assert.rejects(unavailable.lookup!("QA-SECOND"), errorCode("RRAA_UNAVAILABLE"));
    await assert.rejects(unavailable.validate("QA-SECOND", "QA-SECOND-DEVICE"), errorCode("RRAA_PAUSED"));
    const demo = createDemoStationControl(), data = await resolveRraaStation(demo, "EST-PRUEBA-01");
    assert.equal(data.deviceId, "DISP-PRUEBA-01"); assert.equal(data.operatingSystem, "SO-DEMO");
    await assert.rejects(demo.lookup!("Inventada"), errorCode("RRAA_STATION_NOT_FOUND"));
  } finally { await env.close(); }
});

const qaUrl = process.env.CYP_RRAA_LOOKUP_TEST_DATABASE_URL;
test("migration 031 persists STATDAT OS separately, preserves historical stations and rejects unsafe values in isolated PostgreSQL", { skip: !qaUrl }, async () => {
  const target = new URL(qaUrl!);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55436");
  assert.equal(target.pathname, "/cyp_rraa_statdat_qa"); assert.equal(target.username, "rraa_statdat_qa");
  const sql = new pg.Client({ connectionString: qaUrl }); await sql.connect();
  const store = new PostgresStore(qaUrl!);
  let env: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    const historical = (await sql.query("SELECT * FROM pcp_stations WHERE id=$1", ["qa-historical-station"])).rows[0];
    assert.equal(historical.operating_system, null); assert.equal(historical.version, "QA-VERSION-BEFORE");
    assert.equal(historical.license, "QA-HISTORICAL-LICENSE"); assert.equal(historical.rraa_client_id, null);
    assert.equal((await store.read()).clients.length, 0, "the dedicated QA database must contain no operational clients");
    await store.transaction((state) => {
      const tools = getAdminTools(state), seeded = seed();
      Object.assign(state, seeded); Object.assign(getAdminTools(state), tools);
    });
    env = await fixture(store);
    const saved = await env.post("/estaciones", { name: "QA STATION &1", active: true });
    assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().number, "101");
    const reopened = new PostgresStore(qaUrl!);
    try {
      const station = getAdminTools(await reopened.read()).stations.find((row) => row.id === saved.json().id)!;
      assert.equal(station.deviceId, "QA-DEVICE"); assert.equal(station.license, "QA-LICENSE"); assert.equal(station.operatingSystem, "7");
      assert.equal(station.version, ""); assert.equal(station.rraaClientId, "QA-COMPANY");
    } finally { await reopened.close(); }
    for (const text of ["", " padded ", "SO|OTHER", "SO\nOTHER", "x".repeat(161)])
      await assert.rejects(sql.query("UPDATE pcp_stations SET operating_system=$1 WHERE id=$2", [text, saved.json().id]),
        (error: unknown) => (error as { code: string }).code === "23514");
    assert.deepEqual((await sql.query("SELECT * FROM pcp_stations WHERE id=$1", ["qa-historical-station"])).rows[0], historical);
  } finally { if (env) await env.close(); else await store.close(); await sql.end(); }
});
