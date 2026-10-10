import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../src/store.js";
import { emptyState, type User } from "../src/domain.js";
import { getAdminTools, createAuthSession } from "../src/admin-tools.js";
import { createStationInstallationChallenge, installationIdForPublicKey, listStationInstallations,
  registerStationInstallation, queryStationInstallation, revokeStationInstallation } from "../src/station-installations.js";
import { signingPayload, type StationInstallationChallenge } from "../src/station-installation-protocol.js";

test("legacy FileStore reads do not generate a namespace; installation and revocation survive reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-installation-file-")), file = join(directory, "fictional.json");
  try {
    const initial = emptyState(), admin: User = { id: "fictional-file-admin", name: "Admin ficticio", role: "admin" };
    const tools = getAdminTools(initial);
    tools.stations.push({ id: "fictional-station", number: "F1", name: "Estación ficticia", deviceId: "",
      description: "", group: "", type: "", license: "", version: "", active: false });
    const actor = { ...admin, sid: createAuthSession(initial, admin).id };
    const legacy = structuredClone(initial);
    const legacyTools = getAdminTools(legacy) as unknown as Record<string, unknown>;
    delete legacyTools.installations; delete legacyTools.installationChallenges;
    const oldBytes = JSON.stringify(legacy);
    await writeFile(file, oldBytes, "utf8");
    let store = await FileStore.open(file, emptyState());
    const read = await store.read();
    assert.deepEqual(listStationInstallations(read, actor, "fictional-station", {}), { installations: [], identityKind: "installation" });
    assert.equal(getAdminTools(read).installationScopeId, undefined);
    assert.equal(await readFile(file, "utf8"), oldBytes);

    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKeySpki = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
    const installationId = installationIdForPublicKey(publicKeySpki), origin = "https://fixture.test";
    const proof = (challenge: StationInstallationChallenge) => sign("sha256", Buffer.from(signingPayload(challenge)),
      { key: pair.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    const challenge = await store.transaction((state) => createStationInstallationChallenge(state, actor, "fictional-station",
      { purpose: "register", installationId, publicKeySpki }, origin, {}));
    const registered = await store.transaction((state) => registerStationInstallation(state, actor, "fictional-station",
      { challengeId: challenge.challengeId, installationId, publicKeySpki, signature: proof(challenge), confirmed: true }, origin, {}));
    const scope = getAdminTools(await store.read()).installationScopeId;
    assert.ok(scope);
    await store.close(); store = await FileStore.open(file, emptyState());
    assert.equal(getAdminTools(await store.read()).installationScopeId, scope);
    assert.deepEqual(listStationInstallations(await store.read(), actor, "fictional-station", {}).installations, [registered]);

    const query = await store.transaction((state) => createStationInstallationChallenge(state, actor, "fictional-station",
      { purpose: "query", installationId }, origin, {}));
    await store.close(); store = await FileStore.open(file, emptyState());
    const result = await store.transaction((state) => queryStationInstallation(state, actor, "fictional-station",
      { challengeId: query.challengeId, installationId, signature: proof(query) }, origin, {}));
    assert.equal(result.rraaValidationStatus, "not_validated");
    assert.equal(result.active, false);
    assert.equal(getAdminTools(await store.read()).installationChallenges.length, 0);
    const revoked = await store.transaction((state) => revokeStationInstallation(state, actor, "fictional-station", installationId,
      { revision: registered.revision, reason: "Fin de prueba ficticia" }, {}));
    await store.close(); store = await FileStore.open(file, emptyState());
    assert.deepEqual(listStationInstallations(await store.read(), actor, "fictional-station", {}).installations, [revoked]);
    const finalState = await store.read();
    assert.equal(getAdminTools(finalState).stations[0].license, "");
    assert.equal(getAdminTools(finalState).installations[0].publicKeySpki, publicKeySpki);
    assert.throws(() => createStationInstallationChallenge(finalState, actor, "fictional-station", { purpose: "query", installationId }, origin, {}),
      (error: unknown) => (error as { code?: string }).code === "INSTALLATION_REVOKED");
    await store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
