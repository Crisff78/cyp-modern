import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichPublicDemo } from "../src/demo-scenarios.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import type { State } from "../src/domain.js";

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
