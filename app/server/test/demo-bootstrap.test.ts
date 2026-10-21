import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { enrichPublicDemo } from "../src/demo-scenarios.js";
import { enrichCollectorDemo } from "../src/demo-collector-scenarios.js";
import { DEMO_CASHIER_EMAIL, enrichCashierDemo } from "../src/demo-cashier-scenarios.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";
import { normalizeDemoCollectorLabel, seed, seedPublicDemo } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import { emptyState, verifyPassword, type State } from "../src/domain.js";
import { roleRemittancePermissions } from "../../shared/access.mjs";

const now = new Date("2026-10-09T20:00:00.000Z");
const markerId = "__demo_seed__:public-v2";

function existingFictionalState(transactionCommissionBps: number, managerCommissionBps = 0) {
  const state = seed();
  state.clients[0].code = "QA-EXISTING-001";
  state.clients[0].note = "Existing fictional client edited before bootstrap.";
  state.banks.push({ id: "qa-existing-bank", name: "Fictional existing bank", active: true });
  state.accounts.push({ id: "qa-existing-account", name: "Fictional existing operator", email: "qa.existing",
    role: "admin", salt: "synthetic-not-an-authentication-salt", passwordHash: "synthetic-not-a-password-hash",
    credentialVersion: 1, status: "active", createdAt: now.toISOString(), updatedAt: now.toISOString() });
  state.remittances.commissionPolicy = { revision: "qa-existing-policy", transactionCommissionBps, managerCommissionBps,
    updatedBy: "qa-existing-account", updatedAt: now.toISOString() };
  return state;
}

function assertExistingRowsPreserved(before: State, after: State) {
  for (const [name, rows] of Object.entries(before)) {
    if (!Array.isArray(rows)) continue;
    const saved = after[name as keyof State] as Array<{ id: string }>;
    for (const row of rows) assert.deepEqual(saved.find((candidate) => candidate.id === row.id), row, `${name}: ${row.id}`);
  }
  assert.deepEqual(after.remittances.commissionPolicy, before.remittances.commissionPolicy);
}

// Mirrors the PostgreSQL foreign keys of migration 018, which MemoryStore does not enforce:
// a rate or a quote that names a revision needs that exact revision in the saved history.
function assertRateRevisionsSaved(state: State) {
  const history = state.remittances.rateHistory ?? [];
  const saved = (id: string, currency: string, date: string, rate: string) =>
    history.some((row) => row.id === id && row.currency === currency && row.date === date && row.rate === rate);
  for (const rate of state.remittances.rates)
    if (rate.changeId) assert.ok(saved(rate.changeId, rate.currency, rate.date, rate.rate), `rate ${rate.currency} ${rate.date}`);
  for (const transfer of state.remittances.transfers) {
    const { quote } = transfer;
    if (quote.sourceRateChangeId)
      assert.ok(saved(quote.sourceRateChangeId, transfer.sourceCurrency, quote.date, quote.sourceRate), `${transfer.envioReference} source`);
    if (quote.destinationRateChangeId)
      assert.ok(saved(quote.destinationRateChangeId, transfer.destinationCurrency, quote.date, quote.destinationRate), `${transfer.envioReference} destination`);
  }
}

test("public demo bootstraps without its V2 marker at the active zero commission and preserves existing data", async () => {
  const initial = existingFictionalState(0);
  assert.equal(initial.idempotency.some((row) => row.id === markerId), false);
  const store = new MemoryStore(initial);
  try {
    const manifest = await store.transaction((state) => enrichPublicDemo(state, now));
    assert.equal(manifest?.counts["remittances.transfers"], 18);
    assert.deepEqual(manifest?.omittedRemittanceDates, []);
    const saved = await store.read();
    assertExistingRowsPreserved(initial, saved);
    assert.equal(saved.idempotency.filter((row) => row.id === markerId).length, 1);
    const addedRevisions = manifest?.counts["remittances.rateHistory"] ?? 0;
    assert.ok(addedRevisions > 0);
    assert.equal(saved.remittances.rateHistory?.length, (initial.remittances.rateHistory ?? []).length + addedRevisions);
    assertRateRevisionsSaved(saved);
    for (const transfer of saved.remittances.transfers) {
      assert.equal(transfer.commissionBps, 0);
      assert.equal(transfer.commissionAmount, 0);
      assert.equal(transfer.quote.commissionPolicyRevision, "qa-existing-policy");
      assert.equal(transfer.commissionAllocation?.transactionAmount, 0);
    }
    assert.equal(await store.transaction((state) => enrichPublicDemo(state, new Date("2026-10-10T20:00:00.000Z"))), undefined);
    assert.deepEqual(await store.read(), saved);
  } finally { await store.close(); }
});

test("public demo examples use the configured commission pair without overwriting the central policy", async () => {
  const initial = existingFictionalState(250, 100);
  const store = new MemoryStore(initial);
  try {
    await store.transaction((state) => enrichPublicDemo(state, now));
    const saved = await store.read();
    assertExistingRowsPreserved(initial, saved);
    assert.equal(saved.remittances.transfers.length, 18);
    assertRateRevisionsSaved(saved);
    for (const transfer of saved.remittances.transfers) {
      assert.equal(transfer.commissionBps, 250);
      assert.equal(transfer.commissionAllocation?.managerCommissionBps, 100);
      assert.equal(transfer.quote.commissionPolicyRevision, "qa-existing-policy");
    }
  } finally { await store.close(); }
});

test("an existing public V2 marker leaves every saved field and commercial configuration unchanged", async () => {
  const initial = existingFictionalState(0);
  initial.idempotency.push({ id: markerId, fingerprint: "public-v2", createdAt: now.toISOString(),
    response: { version: "public-v2", counts: { fictional: 1 } } });
  const store = new MemoryStore(initial);
  try {
    assert.equal(await store.transaction((state) => enrichPublicDemo(state, now)), undefined);
    assert.deepEqual(await store.read(), initial);
  } finally { await store.close(); }
});

test("first public start on an empty database saves the rate revisions its examples reference", async () => {
  const store = new MemoryStore(emptyState());
  try {
    // Same sequence as the public-demo branch of openStore() in src/index.ts.
    const demoInitial = seedPublicDemo();
    const seededRevisions = (demoInitial.remittances.rateHistory ?? []).length;
    await store.transaction((state) => {
      if (state.collectors.length === 0) Object.assign(state, demoInitial);
      normalizeDemoCollectorLabel(state, true);
      enrichCashierDemo(state);
      enrichPublicDemo(state);
      enrichCollectorDemo(state);
    });
    const saved = await store.read();
    assert.equal(saved.idempotency.filter((row) => row.id.startsWith("__demo_seed__:")).length, 3);
    // The earlier demo dates must contribute revisions of their own, beyond today's seed.
    assert.ok((saved.remittances.rateHistory ?? []).length > seededRevisions);
    assertRateRevisionsSaved(saved);
    await store.transaction((state) => { enrichCashierDemo(state); enrichPublicDemo(state); enrichCollectorDemo(state); });
    assert.deepEqual(await store.read(), saved);
  } finally { await store.close(); }
});

test("demo mode adds the practice Cajero once, in its role profile, and never restores it after edits", async () => {
  const store = new MemoryStore(seed());
  try {
    await store.transaction((state) => enrichCashierDemo(state, now));
    const saved = await store.read(), cashiers = saved.accounts.filter((row) => row.email === DEMO_CASHIER_EMAIL);
    assert.equal(cashiers.length, 1);
    const [cashier] = cashiers;
    assert.equal(cashier.id, "demo-cashier"); assert.equal(cashier.name, "Cajero de práctica");
    assert.equal(cashier.role, "cashier"); assert.equal(cashier.status, "active"); assert.equal(cashier.collectorId, undefined);
    assert.equal(cashier.permissionMode, "role"); assert.equal(cashier.permissionRevision, 0);
    assert.equal(cashier.permissionIds, undefined); assert.equal(cashier.remittancePermissions, undefined);
    assert.ok(verifyPassword(DEMO_PASSWORD, cashier.salt, cashier.passwordHash));
    assert.equal(saved.idempotency.filter((row) => row.id === "__demo_seed__:cashier-v1").length, 1);
    // A disabled or deleted practice account stays as the demo left it.
    await store.transaction((state) => { state.accounts.find((row) => row.id === "demo-cashier")!.status = "disabled"; });
    const edited = await store.read();
    await store.transaction((state) => enrichCashierDemo(state));
    assert.deepEqual(await store.read(), edited);
    await store.transaction((state) => { state.accounts = state.accounts.filter((row) => row.id !== "demo-cashier"); });
    const deleted = await store.read();
    await store.transaction((state) => enrichCashierDemo(state));
    assert.deepEqual(await store.read(), deleted);
  } finally { await store.close(); }
  // An account that already uses the address is never duplicated.
  const taken = seed();
  taken.accounts.push({ id: "qa-existing-cashier", name: "Cuenta existente", email: DEMO_CASHIER_EMAIL.toUpperCase(), role: "client",
    salt: "synthetic-not-an-authentication-salt", passwordHash: "synthetic-not-a-password-hash", credentialVersion: 1,
    status: "active", createdAt: now.toISOString(), updatedAt: now.toISOString() });
  const kept = new MemoryStore(taken);
  try {
    await kept.transaction((state) => enrichCashierDemo(state, now));
    assert.deepEqual((await kept.read()).accounts, taken.accounts);
  } finally { await kept.close(); }
});

test("the practice Cajero logs in with the demo credentials and works only from its role profile", async () => {
  const state = seed();
  enrichCashierDemo(state, now);
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-demo-cashier-secret-at-least-32-chars", origins: [], collectorUrl: "http://localhost:5174" });
  try {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: DEMO_CASHIER_EMAIL, password: DEMO_PASSWORD } });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(login.json().user.role, "cashier"); assert.equal(login.json().user.access.mode, "role");
    const headers = { authorization: `Bearer ${login.json().token}` };
    assert.deepEqual((await app.inject({ url: "/api/auth/me", headers })).json(), { id: "demo-cashier", name: "Cajero de práctica", role: "cashier",
      access: { mode: "role", revision: 0, legacy: [1, 2], remittances: roleRemittancePermissions("cashier") } });
    assert.equal((await app.inject({ url: "/api/envios/snapshot", headers })).statusCode, 200);
    assert.equal((await app.inject({ url: "/api/clientes", headers })).statusCode, 403);
  } finally { await app.close(); }
});
