import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { emptyState, type User } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { FileStore, MemoryStore, PostgresStore, type Store } from "../src/store.js";
import { assertAuthSession, createAuthSession, getAdminTools, recordMutationTrace, revokeAuthSession, revokeUserSessions, seedAdminTools } from "../src/admin-tools.js";

const admin: User = { id: "demo-admin", name: "Admin", role: "admin" };
async function setup(store: Store = new MemoryStore(seed())) {
  const app = await buildApp({ store, secret: "admin-tools-test-secret-at-least-32-characters", demo: true,
    origins: ["http://localhost:5173"], collectorUrl: "http://localhost:5174" });
  const login = async (email = "admin@cyp.local") => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } });
    assert.equal(response.statusCode, 200); return response.json().token as string;
  };
  const token = await login(), collectorToken = await login("collector@cyp.local");
  const get = (url: string, bearer = token) => app.inject({ method: "GET", url: `/api${url}`, headers: { authorization: `Bearer ${bearer}` } });
  const post = (url: string, body: object, bearer = token, key = randomUUID()) => app.inject({ method: "POST", url: `/api${url}`,
    payload: body, headers: { authorization: `Bearer ${bearer}`, "idempotency-key": key } });
  return { app, store, login, token, collectorToken, get, post };
}

test("admin tools restrict every list and catalog mutation to administrators", async () => {
  const env = await setup();
  try {
    for (const path of ["/estaciones", "/grupos-pcp", "/pcps", "/sesiones", "/trazas", "/solicitudes-autorizacion"]) {
      assert.equal((await env.get(path)).statusCode, 200, path);
      assert.equal((await env.get(path, env.collectorToken)).statusCode, 403, path);
    }
    assert.equal((await env.post("/grupos-pcp", { name: "Sin permiso" }, env.collectorToken)).statusCode, 403);
    assert.equal((await env.post("/estaciones", { name: "E1", number: "1", generatedLicense: true })).statusCode, 400);
    assert.equal((await env.post("/solicitudes-autorizacion", { clientId: "cli-1", collectorId: "col-1", forCollection: true, note: "Solicitud", status: "approved" })).statusCode, 400);
  } finally { await env.app.close(); }
});

test("PCPs are independent persistent entities with validated station associations", async () => {
  const env = await setup();
  try {
    const group = await env.post("/grupos-pcp", { name: "Grupo de prueba" }); assert.equal(group.statusCode, 200);
    assert.equal((await env.post("/grupos-pcp", { name: "grupo de prueba" })).statusCode, 409);
    // Historical fixtures bypass the disabled manual endpoint; no RRAA validity is inferred.
    const station = { id: randomUUID(), name: "Terminal de prueba", number: "TP-1", license: "", deviceId: "", version: "", description: "", group: "", type: "", active: true };
    await env.store.transaction((state) => { getAdminTools(state).stations.push(station); });
    assert.equal((await env.post("/estaciones", { name: station.name, number: station.number })).statusCode, 409);
    assert.equal((await env.post("/estaciones", { name: "Otra", number: "tp-1" })).statusCode, 409);
    const pcp = await env.post("/pcps", { name: "Punto independiente", number: "P-1", groupId: group.json().id }); assert.equal(pcp.statusCode, 200);
    const path = `/pcps/${pcp.json().id}/estaciones`;
    assert.equal((await env.post(path, { stationIds: [station.id] })).json().error.code, "STATION_RRAA_REQUIRED");
    await env.store.transaction((state) => { getAdminTools(state).pcpStations.push({ pcpId: pcp.json().id, stationId: station.id }); });
    assert.equal((await env.post(path, { stationIds: [station.id] })).statusCode, 200);
    assert.equal((await env.post(path, { stationIds: [station.id, "missing"] })).statusCode, 404);
    const stored = (await env.get("/pcps")).json().find((row: { id: string }) => row.id === pcp.json().id);
    assert.deepEqual(stored.stationIds, [station.id]);
    assert.equal((await env.post(`/grupos-pcp/${group.json().id}/eliminar`, {})).statusCode, 409);
    assert.equal((await env.store.read()).clients.some((client) => client.id === pcp.json().id), false);
    const { id: stationId, ...stationInput } = station;
    assert.equal((await env.post(`/estaciones/${stationId}`, { ...stationInput, active: false })).statusCode, 409);
    assert.equal((await env.post(path, { stationIds: [] })).statusCode, 200);
    assert.equal((await env.post(path, { stationIds: [stationId] })).statusCode, 409);
  } finally { await env.app.close(); }
});

test("session IDs bind actor identity, expiry and individual revocation", () => {
  const state = emptyState(), start = new Date("2026-09-29T12:00:00Z");
  const session = createAuthSession(state, admin, start);
  assert.equal(assertAuthSession(state, admin, session.id, start).id, session.id);
  assert.throws(() => assertAuthSession(state, admin, undefined, start), /sesión terminó/);
  assert.throws(() => assertAuthSession(state, { ...admin, id: "other" }, session.id, start), /sesión terminó/);
  assert.throws(() => assertAuthSession(state, admin, session.id, new Date("2026-09-29T20:00:00Z")), /sesión terminó/);
  revokeAuthSession(state, admin, session.id, start);
  assert.throws(() => assertAuthSession(state, admin, session.id, start), /sesión terminó/);
  assert.throws(() => revokeAuthSession(state, admin, session.id, start), /ya está cerrada/);
});

test("closing a listed session rejects its JWT while another login remains active", async () => {
  const env = await setup();
  try {
    const second = await env.login();
    const { sid: _sid, ...withoutSession } = env.app.jwt.decode(env.token) as Record<string, unknown>;
    assert.equal((await env.get("/snapshot", env.app.jwt.sign(withoutSession))).statusCode, 401);
    assert.equal((await env.get("/snapshot", env.app.jwt.sign({ ...withoutSession, sid: "unknown-session" }))).statusCode, 401);
    const own = (await env.get("/sesiones", second)).json().items.find((row: { current: boolean }) => row.current);
    assert.ok(own?.id); assert.equal(own.status, "active");
    assert.equal((await env.post(`/sesiones/${own.id}/cerrar`, {}, env.collectorToken)).statusCode, 403);
    assert.equal((await env.post(`/sesiones/${own.id}/cerrar`, {})).statusCode, 200);
    assert.equal((await env.get("/snapshot", second)).statusCode, 401);
    assert.equal((await env.get("/snapshot")).statusCode, 200);
    const closed = (await env.get("/sesiones?status=closed")).json().items;
    assert.ok(closed.some((row: { id: string }) => row.id === own.id));
    assert.ok(!JSON.stringify(closed).includes(second));
  } finally { await env.app.close(); }
});

test("authorization requests have one audited decision and never change money", async () => {
  const env = await setup();
  try {
    const baseline = await env.store.read();
    const client = baseline.clients[0], collectorId = baseline.routes.find((route) => route.id === client.routeId)!.collectorId;
    const input = { clientId: client.id, collectorId, forCollection: true, note: "Nota privada de prueba no apta para traza" };
    const request = await env.post("/solicitudes-autorizacion", input); assert.equal(request.statusCode, 200);
    const mismatch = baseline.collectors.find((collector) => collector.id !== collectorId)!;
    assert.equal((await env.post("/solicitudes-autorizacion", { ...input, collectorId: mismatch.id })).statusCode, 422);
    const path = `/solicitudes-autorizacion/${request.json().id}/resolver`, key = randomUUID();
    const decision = { status: "approved", note: "Revisado administrativamente" };
    assert.equal((await env.post(path, decision, env.collectorToken)).statusCode, 403);
    assert.equal((await env.post(path, decision, env.token, key)).statusCode, 200);
    assert.equal((await env.post(path, decision, env.token, key)).statusCode, 200);
    assert.equal((await env.post(path, { status: "rejected", note: "Intento de sustituir decisión" })).statusCode, 409);
    const after = await env.store.read();
    assert.deepEqual(after.movements, baseline.movements); assert.deepEqual(after.payouts, baseline.payouts); assert.deepEqual(after.collectors, baseline.collectors);
    const traceRows = (await env.get("/trazas")).json().items;
    assert.equal(traceRows.filter((row: { resource: string }) => row.resource === "/api/solicitudes-autorizacion/:id/resolver").length, 1);
    assert.equal(JSON.stringify(traceRows).includes(input.note), false);
    const requestRows = (await env.get("/solicitudes-autorizacion?status=approved")).json().items;
    assert.equal(requestRows[0].resolutionNote, decision.note); assert.equal(requestRows[0].resolvedBy, "demo-admin");
  } finally { await env.app.close(); }
});

test("logout revokes only the caller session and account changes can revoke all its sessions", async () => {
  const env = await setup();
  try {
    assert.equal((await env.post("/auth/logout", { sid: "another-session" }, env.collectorToken)).statusCode, 400);
    assert.equal((await env.post("/auth/logout", {}, env.collectorToken)).statusCode, 200);
    assert.equal((await env.get("/snapshot", env.collectorToken)).statusCode, 401);
    assert.equal((await env.get("/snapshot")).statusCode, 200);
    const second = await env.login();
    await env.store.transaction((state) => revokeUserSessions(state, "demo-admin", "admin-changing-credentials"));
    assert.equal((await env.get("/snapshot")).statusCode, 401);
    assert.equal((await env.get("/snapshot", second)).statusCode, 401);
  } finally { await env.app.close(); }
});

test("traces preserve successful actions once and omit bodies and credentials", async () => {
  const env = await setup();
  try {
    const before = getAdminTools(await env.store.read()).traces.length, key = randomUUID();
    await env.post("/grupos-pcp", { name: "Nombre privado para comprobar omisión" }, env.token, key);
    await env.post("/grupos-pcp", { name: "Nombre privado para comprobar omisión" }, env.token, key);
    await env.post("/grupos-pcp", { name: "Nombre privado para comprobar omisión" });
    const traces = getAdminTools(await env.store.read()).traces;
    assert.equal(traces.length, before + 1);
    assert.deepEqual(Object.keys(traces.at(-1)!).sort(), ["id", "actorId", "action", "resource", "resourceId", "createdAt"].sort());
    assert.equal(JSON.stringify(traces).includes("Nombre privado"), false); assert.equal(JSON.stringify(traces).includes(env.token), false);
    const page = await env.get("/trazas?limit=1&offset=0"); assert.equal(page.json().items.length, 1); assert.equal(page.json().total, traces.length);
    assert.equal((await env.get("/trazas?from=2026-10-01&to=2026-09-01")).statusCode, 400);
    assert.equal((await env.get("/trazas?from=2000-01-01&to=2000-01-02")).json().total, 0);
  } finally { await env.app.close(); }
});

test("audit captures only resource template and safe identifiers even if result has secrets", () => {
  const state = emptyState();
  const result = recordMutationTrace(state, admin, "/api/usuarios/:id/clave", { id: "valid-account-id" }, { password: "private-value", token: "private-token" });
  assert.equal(result.resourceId, "valid-account-id");
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("FileStore restores catalogs, links, sessions and audit after reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-admin-tools-test-")), path = join(directory, "state.json");
  let store: Store | undefined;
  try {
    store = await FileStore.open(path, emptyState());
    await store.transaction((state) => { seedAdminTools(state); createAuthSession(state, admin); });
    const before = await store.read(); await store.close();
    store = await FileStore.open(path, emptyState());
    assert.deepEqual(getAdminTools(await store.read()), getAdminTools(before));
    const data = getAdminTools(await store.read()); assert.equal(data.sessions.length, 1); assert.equal(data.traces.length, 1); assert.equal(data.authorizationRequests.length, 0);
    await store.transaction(seedAdminTools); assert.equal(getAdminTools(await store.read()).stations.length, 1);
  } finally {
    await store?.close();
    assert.equal(dirname(directory), tmpdir());
    await rm(directory, { recursive: true, force: true });
  }
});

test("PostgreSQL admin tools survive reopening and preserve revoked sessions and immutable audit", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = process.env.TEST_DATABASE_URL!, target = new URL(url);
  assert.equal(target.pathname, "/cyp_remittances_backend", "Use only the approved disposable synthetic database.");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) && target.port === "55435", "Use only the isolated loopback PostgreSQL test cluster on 55435.");
  const prefix = `admin-tools-${randomUUID()}`;
  const ids = { collector: `${prefix}-collector`, route: `${prefix}-route`, client: `${prefix}-client`, reason: `${prefix}-reason` };
  const config = { secret: "admin-tools-test-secret-at-least-32-characters", demo: true, origins: ["http://localhost:5173"], collectorUrl: "http://localhost:5174" };
  let store: PostgresStore | undefined = new PostgresStore(url);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const sql = new pg.Client({ connectionString: url });
  try {
    await sql.connect();
    await store.transaction((state) => {
      const sample = seed();
      state.collectors.push({ ...sample.collectors[0], id: ids.collector, routeId: ids.route, name: `Cobrador ${prefix}` });
      state.routes.push({ ...sample.routes[0], id: ids.route, collectorId: ids.collector, name: `Ruta ${prefix}` });
      state.clients.push({ ...sample.clients[0], id: ids.client, code: prefix, routeId: ids.route, name: `Cliente ${prefix}` });
      state.delayReasons.push({ id: ids.reason, reason: `Motivo ${prefix}`, active: true });
    });
    app = await buildApp({ ...config, store });
    const login = async () => {
      const response = await app!.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
      assert.equal(response.statusCode, 200); return response.json().token as string;
    };
    const token = await login(), revocableToken = await login();
    const post = async (path: string, payload: object) => {
      const response = await app!.inject({ method: "POST", url: `/api${path}`, payload,
        headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() } });
      assert.equal(response.statusCode, 200, response.body); return response.json();
    };
    const group = await post("/grupos-pcp", { name: `Grupo ${prefix}` });
    const station = { id: randomUUID(), name: `Estación ${prefix}`, number: prefix, deviceId: `${prefix}-device`, description: "Dispositivo ficticio", version: "versión registrada", license: "", group: "", type: "", active: true };
    await store.transaction((state) => { getAdminTools(state).stations.push(station); });
    const pcp = await post("/pcps", { name: `PCP ${prefix}`, number: prefix, groupId: group.id, address: "Dirección ficticia", phone: "" });
    await store.transaction((state) => { getAdminTools(state).pcpStations.push({ pcpId: pcp.id, stationId: station.id }); });
    await post(`/pcps/${pcp.id}/estaciones`, { stationIds: [station.id] });
    const request = await post("/solicitudes-autorizacion", { clientId: ids.client, collectorId: ids.collector, delayReasonId: ids.reason, forCollection: true, note: "Detalle privado ficticio PG015" });
    await post(`/solicitudes-autorizacion/${request.id}/resolver`, { status: "approved", note: "Resolución ficticia PG015" });
    const sessions = await app.inject({ url: "/api/sesiones", headers: { authorization: `Bearer ${revocableToken}` } });
    const toClose = sessions.json().items.find((row: { current: boolean }) => row.current);
    assert.ok(toClose?.id);
    await post(`/sesiones/${toClose.id}/cerrar`, {});
    const before = getAdminTools(await store.read());
    const requestTraces = before.traces.filter((row) => row.resourceId === request.id);
    assert.equal(requestTraces.length, 2);
    assert.equal(JSON.stringify(requestTraces).includes("privado"), false);
    await app.close(); app = undefined; store = undefined;

    store = new PostgresStore(url);
    const restored = getAdminTools(await store.read());
    for (const key of ["pcpGroups", "stations", "pcps", "authorizationRequests", "sessions", "traces"] as const)
      assert.deepEqual(restored[key], before[key], `PostgreSQL preserves ${key} across a new Store`);
    assert.deepEqual(restored.pcpStations, before.pcpStations);
    assert.equal(restored.authorizationRequests.find((row) => row.id === request.id)?.status, "approved");
    assert.equal(restored.authorizationRequests.find((row) => row.id === request.id)?.resolutionNote, "Resolución ficticia PG015");
    assert.equal(restored.authorizationRequests.find((row) => row.id === request.id)?.delayReasonId, ids.reason);
    assert.equal(restored.sessions.find((row) => row.id === toClose.id)?.revokedBy, "demo-admin");
    assert.ok(restored.pcpStations.some((row) => row.pcpId === pcp.id && row.stationId === station.id));
    assert.equal(restored.stations.find((row) => row.id === station.id)?.deviceId, `${prefix}-device`);
    app = await buildApp({ ...config, store });
    assert.equal((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
    assert.equal((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${revocableToken}` } })).statusCode, 401);
    await assert.rejects(sql.query("UPDATE admin_traces SET action='changed' WHERE id=$1", [requestTraces[0].id]), /append-only/);
    await assert.rejects(sql.query("DELETE FROM admin_traces WHERE id=$1", [requestTraces[0].id]), /append-only/);
    assert.deepEqual((await store.read()).adminTools.traces, before.traces);
  } finally {
    if (app) await app.close(); else await store?.close();
    await sql.end();
  }
});
