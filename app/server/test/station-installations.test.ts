import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, webcrypto } from "node:crypto";
import { emptyState, DomainError, type User } from "../src/domain.js";
import { createAuthSession, getAdminTools } from "../src/admin-tools.js";
import { createStationInstallationChallenge, installationIdForPublicKey, listStationInstallations,
  queryStationInstallation, registerStationInstallation, revokeStationInstallation } from "../src/station-installations.js";
import { INSTALLATION_PROTOCOL_VERSION, signingPayload, type StationInstallationChallenge } from "../src/station-installation-protocol.js";

const origin = "https://installation.test", options = { rraaClientId: "fictional-company", buildVersion: "test-build" };
const now = new Date("2026-10-10T12:00:00Z");
function identity() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeySpki = publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  return { publicKeySpki, installationId: installationIdForPublicKey(publicKeySpki),
    prove: (challenge: StationInstallationChallenge) => sign("sha256", Buffer.from(signingPayload(challenge)),
      { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url") };
}
function fixture() {
  const state = emptyState(), admin: User = { id: "fictional-admin", name: "Admin ficticio", role: "admin" };
  const session = createAuthSession(state, admin, now), actor = { ...admin, sid: session.id };
  const station = { id: "station-a", name: "RRAA-A", number: "A", deviceId: "provider-device-a", description: "", group: "", type: "",
    license: "fictional-provider-response", version: "", active: true, rraaClientId: options.rraaClientId,
    rraaStationCode: "RRAA-A", rraaDeviceId: "provider-device-a", rraaValidatedAt: now.toISOString(), rraaValidatedBy: admin.id };
  getAdminTools(state).stations.push(station, { ...station, id: "station-b", name: "RRAA-B" });
  return { state, actor, station, key: identity() };
}
function expectedCode(operation: () => unknown, code: string) {
  assert.throws(operation, (error) => error instanceof DomainError && error.code === code);
}
function register(env: ReturnType<typeof fixture>) {
  const challenge = createStationInstallationChallenge(env.state, env.actor, "station-a", { purpose: "register",
    installationId: env.key.installationId, publicKeySpki: env.key.publicKeySpki }, origin, options, now);
  return registerStationInstallation(env.state, env.actor, "station-a", { challengeId: challenge.challengeId,
    installationId: env.key.installationId, publicKeySpki: env.key.publicKeySpki, signature: env.key.prove(challenge), confirmed: true }, origin, options, now);
}

test("P-256 identity and versioned signing payload bind canonical public bytes", () => {
  const env = fixture(), challenge = createStationInstallationChallenge(env.state, env.actor, "station-a",
    { purpose: "register", installationId: env.key.installationId, publicKeySpki: env.key.publicKeySpki }, origin, options, now);
  assert.match(env.key.installationId, /^CYP-INST-[a-f0-9]{64}$/);
  assert.equal(installationIdForPublicKey(env.key.publicKeySpki), env.key.installationId);
  assert.equal(challenge.version, INSTALLATION_PROTOCOL_VERSION);
  assert.equal(Buffer.from(challenge.nonce, "base64url").length, 32);
  assert.equal(Date.parse(challenge.expiresAt) - Date.parse(challenge.createdAt), 60_000);
  assert.equal(JSON.parse(signingPayload(challenge)).length, 11);
  assert.equal(JSON.parse(challenge.scopeId)[1], options.rraaClientId);
  assert.notEqual(signingPayload({ ...challenge, purpose: "query" }), signingPayload(challenge));
  expectedCode(() => installationIdForPublicKey(`${env.key.publicKeySpki}=`), "INSTALLATION_PUBLIC_KEY_INVALID");
  const other = identity();
  expectedCode(() => createStationInstallationChallenge(env.state, env.actor, "station-a",
    { purpose: "register", installationId: env.key.installationId, publicKeySpki: other.publicKeySpki }, origin, options, now), "INSTALLATION_ID_MISMATCH");
});

test("nonextractable SubtleCrypto P-256 signing interoperates with Node IEEE-P1363 verification", async () => {
  const env = fixture();
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  assert.equal(pair.privateKey.extractable, false);
  await assert.rejects(() => webcrypto.subtle.exportKey("pkcs8", pair.privateKey));
  const publicKeySpki = Buffer.from(await webcrypto.subtle.exportKey("spki", pair.publicKey)).toString("base64url");
  const installationId = installationIdForPublicKey(publicKeySpki);
  const challenge = createStationInstallationChallenge(env.state, env.actor, "station-a",
    { purpose: "register", installationId, publicKeySpki }, origin, options, now);
  const bytes = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey,
    new TextEncoder().encode(signingPayload(challenge)));
  assert.equal(bytes.byteLength, 64);
  const result = registerStationInstallation(env.state, env.actor, "station-a", { challengeId: challenge.challengeId,
    installationId, publicKeySpki, signature: Buffer.from(bytes).toString("base64url"), confirmed: true }, origin, options, now);
  assert.equal(result.status, "active");
  assert.equal(result.installationId === installationId, true);
});

test("proof cannot cross origin, session, station, company, purpose or expiration", () => {
  const env = fixture(); register(env);
  const challenge = createStationInstallationChallenge(env.state, env.actor, "station-a", { purpose: "query", installationId: env.key.installationId }, origin, options, now);
  const body = { challengeId: challenge.challengeId, installationId: env.key.installationId, signature: env.key.prove(challenge) };
  expectedCode(() => queryStationInstallation(env.state, env.actor, "station-a", body, "https://other.test", options, now), "INSTALLATION_CHALLENGE_MISMATCH");
  const second = createAuthSession(env.state, env.actor, now);
  expectedCode(() => queryStationInstallation(env.state, { ...env.actor, sid: second.id }, "station-a", body, origin, options, now), "INSTALLATION_CHALLENGE_MISMATCH");
  expectedCode(() => queryStationInstallation(env.state, env.actor, "station-b", body, origin, options, now), "INSTALLATION_NOT_FOUND");
  expectedCode(() => queryStationInstallation(env.state, env.actor, "station-a", body, origin, { rraaClientId: "other-company" }, now), "INSTALLATION_NOT_FOUND");
  expectedCode(() => registerStationInstallation(env.state, env.actor, "station-b", { ...body, publicKeySpki: env.key.publicKeySpki, confirmed: true }, origin, options, now), "INSTALLATION_CHALLENGE_MISMATCH");
  expectedCode(() => queryStationInstallation(env.state, env.actor, "station-a", body, origin, options, new Date(now.getTime() + 60_000)), "INSTALLATION_CHALLENGE_EXPIRED");
  expectedCode(() => queryStationInstallation(env.state, env.actor, "station-a", body, origin, options, now), "INSTALLATION_CHALLENGE_UNAVAILABLE");
});

test("only the registered key queries data and logical revocation keeps RRAA metadata intact", () => {
  const env = fixture(), originalStation = structuredClone(env.station), registered = register(env);
  const badChallenge = createStationInstallationChallenge(env.state, env.actor, "station-a", { purpose: "query", installationId: env.key.installationId }, origin, options, now);
  const copiedId = { challengeId: badChallenge.challengeId, installationId: env.key.installationId, signature: identity().prove(badChallenge) };
  expectedCode(() => queryStationInstallation(env.state, env.actor, "station-a", copiedId, origin, options, now), "INSTALLATION_PROOF_INVALID");
  expectedCode(() => queryStationInstallation(env.state, env.actor, "station-a", copiedId, origin, options, now), "INSTALLATION_CHALLENGE_UNAVAILABLE");
  const challenge = createStationInstallationChallenge(env.state, env.actor, "station-a", { purpose: "query", installationId: env.key.installationId }, origin, options, now);
  const result = queryStationInstallation(env.state, env.actor, "station-a", { challengeId: challenge.challengeId, installationId: env.key.installationId,
    signature: env.key.prove(challenge) }, origin, options, now);
  assert.equal(result.rraaValidationStatus, "validated"); assert.equal(result.cypBuildVersion, "test-build");
  assert.equal("license" in result, false); assert.equal("publicKeySpki" in result, false);
  expectedCode(() => revokeStationInstallation(env.state, env.actor, "station-a", env.key.installationId,
    { revision: "wrong-revision", reason: "Cambio ficticio" }, options, now), "INSTALLATION_REVISION_CHANGED");
  const revoked = revokeStationInstallation(env.state, env.actor, "station-a", env.key.installationId,
    { revision: registered.revision, reason: "Cambio ficticio" }, options, now);
  assert.equal(revoked.status, "revoked"); assert.notEqual(revoked.revision, registered.revision);
  expectedCode(() => createStationInstallationChallenge(env.state, env.actor, "station-a", { purpose: "query", installationId: env.key.installationId }, origin, options, now), "INSTALLATION_REVOKED");
  expectedCode(() => createStationInstallationChallenge(env.state, env.actor, "station-a", { purpose: "register", publicKeySpki: env.key.publicKeySpki,
    installationId: env.key.installationId }, origin, options, now), "INSTALLATION_ALREADY_REGISTERED");
  assert.deepEqual(env.station, originalStation);
  assert.equal(listStationInstallations(env.state, env.actor, "station-a", { rraaClientId: "other-company" }).installations.length, 0);
});

test("active challenge cap and expiration pruning bound each actor's pending work", () => {
  const env = fixture();
  for (let index = 0; index < 20; index++) createStationInstallationChallenge(env.state, env.actor, "station-a",
    { purpose: "register", installationId: env.key.installationId, publicKeySpki: env.key.publicKeySpki }, origin, options, now);
  expectedCode(() => createStationInstallationChallenge(env.state, env.actor, "station-a", { purpose: "register", installationId: env.key.installationId,
    publicKeySpki: env.key.publicKeySpki }, origin, options, now), "INSTALLATION_CHALLENGE_LIMIT");
  createStationInstallationChallenge(env.state, env.actor, "station-a", { purpose: "register", installationId: env.key.installationId,
    publicKeySpki: env.key.publicKeySpki }, origin, options, new Date(now.getTime() + 60_000));
  assert.equal(getAdminTools(env.state).installationChallenges.length, 1);
});
