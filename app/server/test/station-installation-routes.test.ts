import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { createAuthSession, getAdminTools } from "../src/admin-tools.js";
import { DomainError, emptyState, type User } from "../src/domain.js";
import { MemoryStore } from "../src/store.js";
import { registerStationInstallationRoutes } from "../src/station-installation-routes.js";
import { installationIdForPublicKey, type InstallationActor } from "../src/station-installations.js";
import { signingPayload, type StationInstallationChallenge } from "../src/station-installation-protocol.js";

const origin = "http://localhost:5173", secondOrigin = "http://localhost:5174", base = "/api/estaciones/station-a";
function identity() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  return { publicKeySpki, installationId: installationIdForPublicKey(publicKeySpki),
    prove: (challenge: StationInstallationChallenge) => sign("sha256", Buffer.from(signingPayload(challenge)), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url") };
}
async function fixture() {
  const state = emptyState(), actors: Record<string, InstallationActor> = {};
  for (const role of ["admin", "supervisor", "collector"] as const) {
    const actor: User = { id: `fictional-${role}`, name: `Actor ${role}`, role };
    actors[role] = { ...actor, sid: createAuthSession(state, actor).id };
  }
  getAdminTools(state).stations.push({ id: "station-a", name: "Provider-A", number: "A", deviceId: "", description: "", group: "", type: "", license: "", version: "", active: false });
  const store = new MemoryStore(state), app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.code(error.status).send({ error: { code: error.code } });
    if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: "VALIDATION" } });
    return reply.code((error as { statusCode?: number }).statusCode ?? 500).send({ error: { code: "REQUEST_ERROR" } });
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  const user = (req: { headers: Record<string, unknown> }) => actors[String(req.headers["x-test-actor"] ?? "admin")];
  registerStationInstallationRoutes(app, store, user, () => {}, { origins: [origin, secondOrigin], rraaClientId: "fictional-company" });
  const post = (suffix: string, body: object, role = "admin", key?: string, requestOrigin = origin) => app.inject({ method: "POST", url: `${base}${suffix}`,
    payload: body, headers: { origin: requestOrigin, "x-test-actor": role, ...(key ? { "idempotency-key": key } : {}) } });
  const key = identity();
  const challenge = async (purpose: "register" | "query", role = "admin") => {
    const response = await post("/instalaciones/desafios", { purpose, installationId: key.installationId, ...(purpose === "register" ? { publicKeySpki: key.publicKeySpki } : {}) }, role);
    assert.equal(response.statusCode, 200);
    return response.json() as StationInstallationChallenge;
  };
  const register = async () => {
    const proof = await challenge("register");
    const body = { challengeId: proof.challengeId, installationId: key.installationId, publicKeySpki: key.publicKeySpki, signature: key.prove(proof), confirmed: true };
    const idempotencyKey = randomUUID(), response = await post("/instalaciones", body, "admin", idempotencyKey);
    assert.equal(response.statusCode, 200);
    return { response, body, idempotencyKey };
  };
  return { app, store, actors, post, key, challenge, register };
}

test("registration confirmation and strict shapes are administrative; exact trusted origins support Vite proxy", async () => {
  const env = await fixture();
  try {
    const body = { purpose: "register", installationId: env.key.installationId, publicKeySpki: env.key.publicKeySpki };
    assert.equal((await env.post("/instalaciones/desafios", body, "collector")).statusCode, 403);
    assert.equal((await env.post("/instalaciones/desafios", body, "supervisor")).statusCode, 403);
    assert.equal((await env.post("/instalaciones/desafios", { ...body, tenant: "invented" })).statusCode, 400);
    assert.equal((await env.post("/instalaciones/desafios", body, "admin", undefined, "https://foreign.test")).statusCode, 403);
    assert.equal((await env.post("/instalaciones/desafios", body, "admin", undefined, "")).statusCode, 403);
    const proof = await env.challenge("register"); assert.equal(proof.origin, origin);
    const registration = { challengeId: proof.challengeId, installationId: env.key.installationId, publicKeySpki: env.key.publicKeySpki, signature: env.key.prove(proof), confirmed: true };
    assert.equal((await env.post("/instalaciones", registration)).statusCode, 400);
    assert.equal((await env.post("/instalaciones", { ...registration, confirmed: false }, "admin", randomUUID())).statusCode, 400);
    assert.equal((await env.post("/instalaciones", registration, "admin", randomUUID(), secondOrigin)).statusCode, 409);
    assert.equal((await env.post("/instalaciones", registration, "admin", randomUUID())).statusCode, 200);
  } finally { await env.app.close(); await env.store.close(); }
});

test("serialized registration and idempotent replay do not reuse proof or duplicate a registration", async () => {
  const env = await fixture();
  try {
    const proof = await env.challenge("register"), body = { challengeId: proof.challengeId, installationId: env.key.installationId,
      publicKeySpki: env.key.publicKeySpki, signature: env.key.prove(proof), confirmed: true }, idempotencyKey = randomUUID();
    const responses = await Promise.all([env.post("/instalaciones", body, "admin", idempotencyKey), env.post("/instalaciones", body, "admin", idempotencyKey)]);
    assert.equal(responses[0].statusCode, 200); assert.equal(responses[1].statusCode, 200);
    assert.equal(responses[0].body, responses[1].body);
    assert.equal((await env.post("/instalaciones", { ...body, signature: identity().prove(proof) }, "admin", idempotencyKey)).statusCode, 409);
    assert.equal((await env.post("/instalaciones", body, "admin", randomUUID())).statusCode, 409);
    const saved = getAdminTools(await env.store.read()); assert.equal(saved.installations.length, 1); assert.equal(saved.installationChallenges.length, 0);
    assert.equal("publicKeySpki" in responses[0].json(), false);
  } finally { await env.app.close(); await env.store.close(); }
});

test("copied textual IDs fail, failed signatures are consumed, and query proof only succeeds once", async () => {
  const env = await fixture();
  try {
    await env.register(); const before = structuredClone(getAdminTools(await env.store.read()).stations);
    const rejected = await env.challenge("query", "supervisor"), wrong = { challengeId: rejected.challengeId, installationId: env.key.installationId, signature: identity().prove(rejected) };
    assert.equal((await env.post("/datos", wrong, "supervisor")).statusCode, 403);
    assert.equal((await env.post("/datos", { ...wrong, signature: env.key.prove(rejected) }, "supervisor")).statusCode, 409);
    const proof = await env.challenge("query", "supervisor"), body = { challengeId: proof.challengeId, installationId: env.key.installationId, signature: env.key.prove(proof) };
    const responses = await Promise.all([env.post("/datos", body, "supervisor"), env.post("/datos", body, "supervisor")]);
    assert.equal(responses.filter((response) => response.statusCode === 200).length, 1);
    assert.equal(responses.filter((response) => response.statusCode === 409).length, 1);
    const result = responses.find((response) => response.statusCode === 200)!.json();
    assert.equal(result.rraaValidationStatus, "not_validated"); assert.equal(result.active, false);
    for (const field of ["license", "version", "publicKeySpki", "nonce", "cypBuildVersion"]) assert.equal(field in result, false);
    const saved = getAdminTools(await env.store.read()); assert.deepEqual(saved.stations, before);
    assert.equal(saved.installations.length, 1);
    assert.equal(saved.installations[0].publicKeySpki === env.key.publicKeySpki, true);
    assert.equal(saved.installationChallenges.length, 0);
    assert.equal(saved.traces.some((row) => row.action === "installation.query.rejected"), true);
    assert.equal(saved.traces.every((row) => !Object.keys(row).some((field) => ["signature", "nonce", "publicKeySpki", "body"].includes(field))), true);
  } finally { await env.app.close(); await env.store.close(); }
});

test("session revocation is rechecked and expected revision protects irreversible installation revocation", async () => {
  const env = await fixture();
  try {
    const registration = await env.register(), proof = await env.challenge("query", "supervisor");
    await env.store.transaction((state) => { getAdminTools(state).sessions.find((row) => row.id === env.actors.supervisor.sid)!.revokedAt = new Date().toISOString(); });
    assert.equal((await env.post("/datos", { challengeId: proof.challengeId, installationId: env.key.installationId, signature: env.key.prove(proof) }, "supervisor")).statusCode, 401);
    const suffix = `/instalaciones/${env.key.installationId}/revocar`, body = { revision: registration.response.json().revision, reason: "Reemplazo ficticio" };
    assert.equal((await env.post(suffix, { ...body, revision: randomUUID() }, "admin", randomUUID())).statusCode, 409);
    const idempotencyKey = randomUUID(), result = await env.post(suffix, body, "admin", idempotencyKey);
    assert.equal(result.statusCode, 200); assert.equal(result.json().status, "revoked");
    assert.equal((await env.post(suffix, body, "admin", idempotencyKey)).body, result.body);
    assert.equal((await env.post(suffix, body, "admin", randomUUID())).statusCode, 409);
    assert.equal((await env.post("/instalaciones/desafios", { purpose: "query", installationId: env.key.installationId })).statusCode, 409);
    assert.equal((await env.post("/instalaciones", registration.body, "admin", registration.idempotencyKey)).statusCode, 200);
    assert.equal(getAdminTools(await env.store.read()).installations[0].status, "revoked");
  } finally { await env.app.close(); await env.store.close(); }
});

test("native route throttle keys each actor separately and bounds request bodies", async () => {
  const env = await fixture();
  try {
    for (let index = 0; index < 60; index++) assert.equal((await env.app.inject({ method: "GET", url: `${base}/instalaciones`, headers: { "x-test-actor": "admin" } })).statusCode, 200);
    assert.equal((await env.app.inject({ method: "GET", url: `${base}/instalaciones`, headers: { "x-test-actor": "admin" } })).statusCode, 429);
    assert.equal((await env.app.inject({ method: "GET", url: `${base}/instalaciones`, headers: { "x-test-actor": "supervisor" } })).statusCode, 200);
    const saved = getAdminTools(await env.store.read());
    assert.equal(saved.installationScopeId, undefined);
    assert.equal(saved.installations.length, 0); assert.equal(saved.installationChallenges.length, 0);
    assert.equal((await env.post("/instalaciones/desafios", { padding: "x".repeat(5000) })).statusCode, 413);
  } finally { await env.app.close(); await env.store.close(); }
});
