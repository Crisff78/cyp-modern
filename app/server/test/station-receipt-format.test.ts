import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { hashPassword, type State } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { stationInstallationScope } from "../src/station-installations.js";
import type { StationInstallationRef } from "../src/station-installation-protocol.js";
import { MemoryStore, PostgresStore } from "../src/store.js";

const company = "receipt-test-company";
const stationA = "receipt-test-a", stationB = "receipt-test-b";
const refA = { stationId: stationA, installationId: `CYP-INST-${"a".repeat(64)}` };
const refB = { stationId: stationB, installationId: `CYP-INST-${"b".repeat(64)}` };

function addStations(state: State) {
  const scopeId = stationInstallationScope(state, { rraaClientId: company }, true)!;
  for (const ref of [refA, refB]) {
    state.adminTools.stations.push({ id: ref.stationId, number: ref.stationId, name: ref.stationId, active: true,
      group: "", description: "", type: "", version: "", license: "", deviceId: "",
      ...(ref === refA ? { recipientReceiptFormat: "haiti" as const } : {}) });
    state.adminTools.installations.push({ ...ref, scopeId, algorithm: "ECDSA-P256-SHA256", publicKeySpki: "a".repeat(122),
      status: "active", registeredAt: new Date().toISOString(), registeredBy: "receipt-qa", revision: randomUUID() });
  }
}

test("the authenticated print lookup discloses one format for the active installation in this company", async (t) => {
  const state = seed(), at = new Date().toISOString(), password = "Synthetic-receipt-lab!";
  addStations(state);
  state.accounts.push({ id: "receipt-supervisor", name: "QA supervisor", email: "receipt@example.invalid",
    role: "supervisor", status: "active", credentialVersion: 0, createdAt: at, updatedAt: at, ...hashPassword(password) });
  const store = new MemoryStore(state);
  const app = await buildApp({ store, secret: "synthetic-receipt-lab-of-at-least-32-characters", demo: true,
    origins: [], collectorUrl: "http://localhost:5174", rraa: { clientId: company, async validate() { throw Error("Unexpected RRAA request"); } } });
  t.after(() => app.close());
  const login = async (email: string, password: string) => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().token as string;
  };
  const lookup = (installations: StationInstallationRef[], token?: string) => app.inject({
    method: "POST", url: "/api/envios/formato-recepcion", payload: { installations },
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const admin = await login("admin", "Demo-CyP-2026!"), collector = await login("collector@cyp.local", "Demo-CyP-2026!");
  const supervisor = await login("receipt@example.invalid", password);
  assert.equal((await lookup([refA])).statusCode, 401);
  for (const token of [admin, collector, supervisor]) assert.deepEqual((await lookup([refA], token)).json(), { recipientReceiptFormat: "haiti" });
  for (const refs of [[], [refB], [refA, refB], [{ ...refA, stationId: stationB }]]) {
    assert.deepEqual((await lookup(refs, collector)).json(), { recipientReceiptFormat: "common" });
  }
  assert.deepEqual((await lookup([refA, refA], collector)).json(), { recipientReceiptFormat: "haiti" });
  assert.equal((await lookup([{ ...refA, installationId: "invalid" }], collector)).statusCode, 400);
  await store.transaction((s) => { s.adminTools.stations.find((row) => row.id === stationA)!.active = false; });
  assert.deepEqual((await lookup([refA], collector)).json(), { recipientReceiptFormat: "common" });
  await store.transaction((s) => {
    s.adminTools.stations.find((row) => row.id === stationA)!.active = true;
    s.adminTools.installations[0].scopeId = stationInstallationScope(s, { rraaClientId: "other-company" })!;
  });
  assert.deepEqual((await lookup([refA], collector)).json(), { recipientReceiptFormat: "common" });
  await store.transaction((s) => {
    s.adminTools.installations[0].scopeId = stationInstallationScope(s, { rraaClientId: company })!;
    s.adminTools.installations[0].status = "revoked";
  });
  assert.deepEqual((await lookup([refA], collector)).json(), { recipientReceiptFormat: "common" });
  await store.transaction((s) => { delete s.adminTools.installationScopeId; });
  assert.deepEqual((await lookup([refA], collector)).json(), { recipientReceiptFormat: "common" });
  assert.equal((await store.read()).adminTools.installationScopeId, undefined);
  const permissions = async (keys: NonNullable<State["accounts"][number]["remittancePermissions"]>) => store.transaction((s) => {
    Object.assign(s.accounts.find((account) => account.id === "receipt-supervisor")!, { permissionMode: "custom", permissionIds: [1], remittancePermissions: keys });
  });
  for (const key of ["remittances.receipts", "remittances.view"] as const) {
    await permissions([key]);
    assert.equal((await lookup([], supervisor)).statusCode, 200);
  }
  await permissions(["remittances.reports"]);
  assert.equal((await lookup([], supervisor)).statusCode, 403);
});

const qaUrl = process.env.CYP_RECEIPT_FORMAT_TEST_DATABASE_URL;
test("migration 054 preserves the historical station and the scoped PostgreSQL lookup survives reopening", { skip: !qaUrl }, async (t) => {
  const target = new URL(qaUrl!);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55584");
  assert.equal(target.pathname, "/cyp_receipt_qa"); assert.equal(target.username, "cyp_receipt_qa");
  assert.equal(target.search, ""); assert.equal(target.hash, "");
  const sql = new pg.Client({ connectionString: target.toString() }), store = new PostgresStore(target.toString());
  await sql.connect(); t.after(() => sql.end()); t.after(() => store.close());
  const historical = await sql.query("SELECT recipient_receipt_format,license FROM pcp_stations WHERE id='historical-receipt-qa'");
  assert.deepEqual(historical.rows, [{ recipient_receipt_format: "common", license: "QA-LEGACY-LICENSE" }]);
  assert.equal((await store.read()).clients.length, 0);
  await assert.rejects(sql.query("UPDATE pcp_stations SET recipient_receipt_format='invalid' WHERE id='historical-receipt-qa'"), { code: "23514" });
  await store.transaction(addStations);
  const reopened = new PostgresStore(target.toString());
  t.after(() => reopened.close());
  assert.equal((await reopened.read()).adminTools.stations.find((row) => row.id === stationA)?.recipientReceiptFormat, "haiti");
  assert.deepEqual(await reopened.readStationReceiptFormats([refA, refA], company), ["haiti"]);
  assert.deepEqual((await reopened.readStationReceiptFormats([refA, refB], company)).sort(), ["common", "haiti"]);
  assert.deepEqual(await reopened.readStationReceiptFormats([refA], "other-company"), []);
  assert.deepEqual(await reopened.readStationReceiptFormats([{ ...refA, stationId: stationB }], company), []);
  await reopened.transaction((state) => { state.adminTools.stations.find((row) => row.id === stationA)!.active = false; });
  assert.deepEqual(await reopened.readStationReceiptFormats([refA], company), []);
  await reopened.transaction((state) => {
    state.adminTools.stations.find((row) => row.id === stationA)!.active = true;
    const row = state.adminTools.installations.find((registration) => registration.stationId === stationA)!;
    Object.assign(row, { status: "revoked", revokedAt: new Date().toISOString(), revokedBy: "receipt-qa", revocationReason: "QA", revision: randomUUID() });
  });
  assert.deepEqual(await reopened.readStationReceiptFormats([refA], company), []);
});
