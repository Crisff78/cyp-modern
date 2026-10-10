import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { getAdminTools } from "../src/admin-tools.js";
import { PostgresStore } from "../src/store.js";
import { installationIdForPublicKey } from "../src/station-installations.js";
import { signingPayload, type StationInstallationChallenge } from "../src/station-installation-protocol.js";

const origin = "https://station-installations.test", secondOrigin = "https://second-installation.test";
const clientId = "fictional-installation-company", stationId = "fictional-installation-station";
const base = `/api/estaciones/${stationId}`;

async function browserIdentity() {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  assert.equal(pair.privateKey.extractable, false);
  const publicKeySpki = Buffer.from(await webcrypto.subtle.exportKey("spki", pair.publicKey)).toString("base64url");
  return { publicKeySpki, installationId: installationIdForPublicKey(publicKeySpki),
    async prove(challenge: StationInstallationChallenge) {
      const proof = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey,
        new TextEncoder().encode(signingPayload(challenge)));
      assert.equal(proof.byteLength, 64);
      return Buffer.from(proof).toString("base64url");
    } };
}

test("isolated PostgreSQL 001–030 persist installation proofs, serialize consumption and preserve revoked history", {
  skip: !process.env.CYP_STATION_INSTALLATION_TEST_DATABASE_URL,
}, async () => {
  // Refuse every destination except the explicitly provisioned disposable lab.
  const target = new URL(process.env.CYP_STATION_INSTALLATION_TEST_DATABASE_URL!);
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55435");
  assert.equal(target.username, "october_nine_qa"); assert.equal(target.pathname, "/cyp_station_installations_test");
  assert.equal(target.search, ""); assert.equal(target.hash, "");
  const sql = new pg.Client({ connectionString: target.toString() });
  await sql.connect();
  type Fixture = { store: PostgresStore; app: Awaited<ReturnType<typeof buildApp>> };
  const fixtures = new Set<Fixture>();
  let providerCalls = 0;
  async function fixture(company = clientId): Promise<Fixture> {
    const store = new PostgresStore(target.toString());
    try {
      const app = await buildApp({ store, secret: "fictional-installation-postgres-test-signing-secret", demo: true,
        origins: [origin, secondOrigin], collectorUrl: "http://localhost:5174", buildVersion: "fictional-test-build",
        rraa: { clientId: company, async validate() { providerCalls++; throw new Error("Provider access is forbidden in this isolated test."); } } });
      const result = { store, app }; fixtures.add(result); return result;
    } catch (error) { await store.close(); throw error; }
  }
  async function closeFixture(item: Fixture) { fixtures.delete(item); await item.app.close(); }
  const count = async (table: string) => Number((await sql.query(`SELECT count(*) AS count FROM "${table.replaceAll('"', '""')}"`)).rows[0].count);
  try {
    const server = (await sql.query("SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,current_setting('port') AS port")).rows[0];
    assert.deepEqual(server, { database: "cyp_station_installations_test", role: "october_nine_qa", host: "127.0.0.1", port: "55435" });
    const directory = new URL("../database/", import.meta.url);
    const files = (await readdir(directory)).filter((file) => /^\d{3}_.+\.sql$/.test(file) && Number(file.slice(0, 3)) <= 30).sort();
    assert.equal(files.length, 30);
    const ledger = (await sql.query("SELECT name,sha256 FROM cyp_schema_migrations ORDER BY name")).rows;
    assert.deepEqual(ledger.map((row) => row.name), files);
    for (const file of files) assert.equal(ledger.find((row) => row.name === file)?.sha256,
      createHash("sha256").update(await readFile(new URL(file, directory), "utf8")).digest("hex"), file);
    const tables = (await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((row) => String(row.tablename));
    for (const table of ["station_installation_scope", "station_installations", "station_installation_challenges"]) assert.ok(tables.includes(table), table);
    // Migrations seed only the default commission policy. Never reuse a prior run's data.
    for (const table of tables.filter((name) => !["cyp_schema_migrations", "remittance_commission_policy"].includes(name)))
      assert.equal(await count(table), 0, `The disposable database must be empty before seeding: ${table}`);

    const initial = await fixture();
    assert.equal(getAdminTools(await initial.store.read()).installationScopeId, undefined);
    assert.equal(await count("station_installation_scope"), 0, "read() must not generate a namespace");
    const validatedAt = new Date().toISOString();
    await initial.store.transaction((state) => {
      assert.equal(getAdminTools(state).stations.length, 0);
      getAdminTools(state).stations.push({ id: stationId, number: "FICT-001", name: "Fictional provider station", deviceId: "fictional-provider-device",
        description: "Disposable test fixture", group: "", type: "", license: "fictional-existing-provider-license", version: "fictional-provider-version", active: true,
        rraaClientId: clientId, rraaStationCode: "Fictional provider station", rraaDeviceId: "fictional-provider-device",
        rraaValidatedAt: validatedAt, rraaValidatedBy: "fictional-validation-actor" });
    });
    assert.equal(await count("station_installation_scope"), 0, "unrelated persistence must not generate a namespace");
    const stationBefore = structuredClone(getAdminTools(await initial.store.read()).stations);
    const stationSqlBefore = (await sql.query("SELECT * FROM pcp_stations ORDER BY id")).rows;
    const licensePolicyBefore = (await sql.query("SELECT * FROM remittance_commission_policy ORDER BY id")).rows;
    const login = await initial.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin", password: "Demo-CyP-2026!" } });
    assert.equal(login.statusCode, 200, login.body);
    const token = login.json().token as string;
    assert.equal(typeof token, "string");
    const post = (item: Fixture, suffix: string, body: object, idempotencyKey?: string, requestOrigin = origin) =>
      item.app.inject({ method: "POST", url: `${base}${suffix}`, payload: body,
        headers: { authorization: `Bearer ${token}`, origin: requestOrigin, ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) } });
    const list = (item: Fixture) => item.app.inject({ method: "GET", url: `${base}/instalaciones`, headers: { authorization: `Bearer ${token}`, origin } });
    const key = await browserIdentity();
    const challenge = async (item: Fixture, purpose: "register" | "query") => {
      const response = await post(item, "/instalaciones/desafios", { purpose, installationId: key.installationId,
        ...(purpose === "register" ? { publicKeySpki: key.publicKeySpki } : {}) });
      assert.equal(response.statusCode, 200, response.body);
      return response.json() as StationInstallationChallenge;
    };
    const registrationChallenge = await challenge(initial, "register");
    const namespace = getAdminTools(await initial.store.read()).installationScopeId!;
    assert.match(namespace, /^[a-f0-9-]{36}$/);
    assert.equal(registrationChallenge.scopeId, JSON.stringify([namespace, clientId]));
    assert.equal(await count("station_installation_scope"), 1);
    assert.deepEqual((await sql.query("SELECT id,scope_id FROM station_installation_scope")).rows, [{ id: "main", scope_id: namespace }]);
    assert.deepEqual(getAdminTools(await initial.store.read()).installationChallenges, [registrationChallenge]);
    await assert.rejects(sql.query("UPDATE station_installation_challenges SET nonce=$2 WHERE challenge_id=$1",
      [registrationChallenge.challengeId, "A".repeat(43)]), /cannot be changed/);
    const registrationBody = { challengeId: registrationChallenge.challengeId, installationId: key.installationId,
      publicKeySpki: key.publicKeySpki, signature: await key.prove(registrationChallenge), confirmed: true };
    const registrationKey = randomUUID(), registered = await post(initial, "/instalaciones", registrationBody, registrationKey);
    assert.equal(registered.statusCode, 200, registered.body);
    assert.equal(registered.json().status, "active");
    assert.equal(registered.json().registeredBy, "demo-admin");
    assert.equal("publicKeySpki" in registered.json(), false);
    assert.equal(await count("station_installations"), 1); assert.equal(await count("station_installation_challenges"), 0);
    await closeFixture(initial);

    // Both apps use new Store instances and the original persisted session and idempotency result.
    const reopened = await fixture(), concurrent = await fixture();
    const replay = await post(reopened, "/instalaciones", registrationBody, registrationKey);
    assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), registered.json());
    const historyBefore = getAdminTools(await reopened.store.read()).installations[0];
    assert.equal(historyBefore.publicKeySpki, key.publicKeySpki); assert.equal(historyBefore.algorithm, "ECDSA-P256-SHA256");
    assert.equal(historyBefore.scopeId, registrationChallenge.scopeId); assert.equal(historyBefore.revision, registered.json().revision);
    assert.deepEqual((await list(reopened)).json().installations, [registered.json()]);
    assert.equal(await count("station_installations"), 1);
    const wrongKey = await browserIdentity();
    const conflicting = await post(reopened, "/instalaciones", { ...registrationBody, signature: await wrongKey.prove(registrationChallenge) }, registrationKey);
    assert.equal(conflicting.statusCode, 409); assert.equal(conflicting.json().error.code, "IDEMPOTENCY_CONFLICT");
    await assert.rejects(sql.query("UPDATE station_installation_scope SET scope_id=$1 WHERE id='main'", [randomUUID()]), /immutable/);
    await assert.rejects(sql.query("DELETE FROM station_installation_scope WHERE id='main'"), /immutable/);
    await assert.rejects(sql.query("UPDATE station_installations SET public_key_spki=$2 WHERE installation_id=$1", [key.installationId, wrongKey.publicKeySpki]), /immutable/);
    await assert.rejects(sql.query("UPDATE station_installations SET registered_at=registered_at+interval '1 second' WHERE installation_id=$1", [key.installationId]), /immutable/);
    await assert.rejects(sql.query("DELETE FROM station_installations WHERE installation_id=$1", [key.installationId]), /cannot be deleted/);
    await assert.rejects(reopened.store.transaction((state) => { getAdminTools(state).installations[0].publicKeySpki = wrongKey.publicKeySpki; }), /immutable/);
    await assert.rejects(reopened.store.transaction((state) => { getAdminTools(state).installations = []; }), /cannot be deleted/);

    const failedChallenge = await challenge(reopened, "query");
    const wrongProof = await post(reopened, "/datos", { challengeId: failedChallenge.challengeId, installationId: key.installationId, signature: await wrongKey.prove(failedChallenge) });
    assert.equal(wrongProof.statusCode, 403); assert.equal(wrongProof.json().error.code, "INSTALLATION_PROOF_INVALID");
    const consumedFailure = await post(concurrent, "/datos", { challengeId: failedChallenge.challengeId, installationId: key.installationId, signature: await key.prove(failedChallenge) });
    assert.equal(consumedFailure.statusCode, 409); assert.equal(consumedFailure.json().error.code, "INSTALLATION_CHALLENGE_UNAVAILABLE");
    assert.equal(await count("station_installation_challenges"), 0, "failed proof consumption must commit");

    const queryChallenge = await challenge(reopened, "query");
    const queryBody = { challengeId: queryChallenge.challengeId, installationId: key.installationId, signature: await key.prove(queryChallenge) };
    const otherScope = await fixture("fictional-other-company");
    assert.deepEqual((await list(otherScope)).json().installations, []);
    const foreignScope = await post(otherScope, "/datos", queryBody);
    assert.equal(foreignScope.statusCode, 404); assert.equal(foreignScope.json().error.code, "INSTALLATION_NOT_FOUND");
    await closeFixture(otherScope);
    // A valid 80-character provider ID expands when JSON escapes backslashes.
    const escapedClientId = "\\".repeat(80), escapedScope = await fixture(escapedClientId);
    const escapedChallenge = await challenge(escapedScope, "register");
    assert.equal(escapedChallenge.scopeId, JSON.stringify([namespace, escapedClientId]));
    assert.ok(escapedChallenge.scopeId.length > 128);
    assert.equal(getAdminTools(await escapedScope.store.read()).installationScopeId, namespace);
    assert.equal(getAdminTools(await escapedScope.store.read()).installationChallenges.some((row) => row.challengeId === escapedChallenge.challengeId), true);
    const escapedInvalidProof = await post(escapedScope, "/instalaciones", { ...registrationBody, challengeId: escapedChallenge.challengeId,
      signature: await wrongKey.prove(escapedChallenge) }, randomUUID());
    assert.equal(escapedInvalidProof.statusCode, 403); assert.equal(escapedInvalidProof.json().error.code, "INSTALLATION_PROOF_INVALID");
    await closeFixture(escapedScope);
    const wrongOrigin = await post(concurrent, "/datos", queryBody, undefined, secondOrigin);
    assert.equal(wrongOrigin.statusCode, 409); assert.equal(wrongOrigin.json().error.code, "INSTALLATION_CHALLENGE_MISMATCH");
    assert.equal(await count("station_installation_challenges"), 1, "foreign scope/origin must not consume the owner's challenge");
    const queried = await Promise.all([post(reopened, "/datos", queryBody), post(concurrent, "/datos", queryBody)]);
    assert.deepEqual(queried.map((response) => response.statusCode).sort(), [200, 409]);
    assert.equal(queried.find((response) => response.statusCode === 409)!.json().error.code, "INSTALLATION_CHALLENGE_UNAVAILABLE");
    const data = queried.find((response) => response.statusCode === 200)!.json();
    assert.equal(data.installationId, key.installationId); assert.equal(data.installationStatus, "active");
    assert.equal(data.active, true); assert.equal(data.rraaValidationStatus, "validated"); assert.equal(data.rraaValidatedAt, validatedAt);
    assert.equal(data.cypBuildVersion, "fictional-test-build"); assert.ok(Number.isFinite(Date.parse(data.queriedAt)));
    for (const field of ["license", "version", "publicKeySpki", "signature", "nonce", "scopeId"]) assert.equal(field in data, false, field);
    assert.equal(await count("station_installation_challenges"), 0);

    const revokePath = `/instalaciones/${key.installationId}/revocar`, revocationKey = randomUUID();
    const revokeBody = { revision: historyBefore.revision, reason: "Replacement in a disposable test" };
    const stale = await post(reopened, revokePath, { ...revokeBody, revision: randomUUID() }, randomUUID());
    assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, "INSTALLATION_REVISION_CHANGED");
    const revoked = await post(reopened, revokePath, revokeBody, revocationKey);
    assert.equal(revoked.statusCode, 200, revoked.body); assert.equal(revoked.json().status, "revoked");
    assert.notEqual(revoked.json().revision, historyBefore.revision); assert.equal(revoked.json().revokedBy, "demo-admin");
    assert.equal(revoked.json().revocationReason, revokeBody.reason);
    await closeFixture(reopened);
    const final = await fixture();
    const revokedReplay = await post(final, revokePath, revokeBody, revocationKey);
    assert.equal(revokedReplay.statusCode, 200, revokedReplay.body); assert.deepEqual(revokedReplay.json(), revoked.json());
    const repeated = await post(final, revokePath, { ...revokeBody, revision: revoked.json().revision }, randomUUID());
    assert.equal(repeated.statusCode, 409); assert.equal(repeated.json().error.code, "INSTALLATION_REVOKED");
    assert.equal((await post(final, "/instalaciones/desafios", { purpose: "query", installationId: key.installationId })).statusCode, 409);
    const cannotRegister = await post(final, "/instalaciones/desafios", { purpose: "register", installationId: key.installationId, publicKeySpki: key.publicKeySpki });
    assert.equal(cannotRegister.statusCode, 409); assert.equal(cannotRegister.json().error.code, "INSTALLATION_ALREADY_REGISTERED");
    const historicalReplay = await post(final, "/instalaciones", registrationBody, registrationKey);
    assert.equal(historicalReplay.statusCode, 200); assert.deepEqual(historicalReplay.json(), registered.json());
    await assert.rejects(sql.query("UPDATE station_installations SET status='active',revision=$2,revoked_at=NULL,revoked_by=NULL,revocation_reason=NULL WHERE installation_id=$1",
      [key.installationId, randomUUID()]), /irreversible revocation/);
    await assert.rejects(sql.query("UPDATE station_installations SET revocation_reason='Changed history' WHERE installation_id=$1", [key.installationId]), /irreversible revocation/);
    await assert.rejects(final.store.transaction((state) => { getAdminTools(state).installations[0].status = "active"; }), /immutable/);
    const saved = getAdminTools(await final.store.read()), historyAfter = saved.installations[0];
    assert.equal(historyAfter.status, "revoked"); assert.equal(historyAfter.revision, revoked.json().revision);
    for (const field of ["scopeId", "stationId", "installationId", "publicKeySpki", "algorithm", "registeredAt", "registeredBy"] as const)
      assert.equal(historyAfter[field], historyBefore[field], field);
    assert.equal(saved.installationScopeId, namespace); assert.equal(saved.installations.length, 1); assert.equal(saved.installationChallenges.length, 0);
    assert.deepEqual(saved.stations, stationBefore); assert.deepEqual((await sql.query("SELECT * FROM pcp_stations ORDER BY id")).rows, stationSqlBefore);
    assert.deepEqual((await sql.query("SELECT * FROM remittance_commission_policy ORDER BY id")).rows, licensePolicyBefore);
    assert.equal(providerCalls, 0);
    assert.ok(saved.traces.some((row) => row.action === "installation.query.rejected"));
    assert.ok(saved.traces.some((row) => row.action === "installation.revoke.completed"));
    assert.equal(saved.traces.some((row) => Object.keys(row).some((field) => ["signature", "nonce", "publicKeySpki", "body"].includes(field))), false);
  } finally {
    const results = await Promise.allSettled([...fixtures].map((item) => item.app.close()));
    await sql.end();
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
});
