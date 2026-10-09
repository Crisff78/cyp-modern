import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed } from "../src/seed.js";
import { buildApp } from "../src/app.js";
import { MemoryStore, FileStore } from "../src/store.js";
import { businessDate, type User } from "../src/domain.js";
import { getCommissionPolicy, setCommissionPolicy, quoteRemittance, createRemittance,
  setDailyRate, openRemittanceCash, cancelRemittance, remittanceReports } from "../src/remittances.js";

const at = new Date("2026-10-09T16:00:00Z");
const admin: User = { id: "demo-admin", name: "Synthetic Admin", role: "admin" };
const collector: User = { id: "demo-collector", name: "Synthetic Collector", role: "collector", collectorId: "col-1" };
const pair = { sourceCurrency: "USD" as const, destinationCurrency: "EUR" as const, amount: 10000 };
const rate = { transactionCommissionBps: 500, managerCommissionBps: 200 };
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code: string }).code, expected); return true; };
function fixture() {
  const state = seed();
  setDailyRate(state, admin, { currency: "USD", rate: "60", date: businessDate(at) }, at);
  setDailyRate(state, admin, { currency: "EUR", rate: "75", date: businessDate(at) }, at);
  openRemittanceCash(state, admin, { operatorId: collector.id, currency: "USD", openingAmount: 0 }, [collector], at);
  return state;
}

test("central commissions default to zero and quotes take the saved rate without a manual input", () => {
  const state = fixture();
  assert.deepEqual(getCommissionPolicy(state), { revision: "default", transactionCommissionBps: 0, managerCommissionBps: 0 });
  assert.equal(quoteRemittance(state, pair, at).commissionAmount, 0);
  const policy = setCommissionPolicy(state, admin, rate, at);
  const quoted = quoteRemittance(state, pair, at);
  assert.equal(quoted.commissionBps, 500); assert.equal(quoted.commissionAmount, 500);
  assert.equal(quoted.commissionAllocation.managerAmount, 160); assert.equal(quoted.commissionAllocation.companyAmount, 240);
  assert.equal(quoted.quote.commissionPolicyRevision, policy.revision);
  assert.equal(setCommissionPolicy(state, admin, rate, at).revision, policy.revision, "no-op preserves revision");
  assert.equal(setCommissionPolicy(state, admin, { managerCommissionBps: 100 }, at).transactionCommissionBps, 500, "legacy policy update preserves the total rate");
});

test("manual overrides and invalid policy rates reject without writing money or configuration", () => {
  const state = fixture(); setCommissionPolicy(state, admin, rate, at);
  const before = structuredClone(state);
  for (const commissionBps of [0, 499, 501, 10000]) {
    assert.throws(() => quoteRemittance(state, { ...pair, commissionBps }, at), code("COMMISSION_POLICY_MISMATCH"));
    assert.deepEqual(state, before);
  }
  assert.equal(quoteRemittance(state, { ...pair, commissionBps: 500 }, at).commissionBps, 500);
  for (const transactionCommissionBps of [-1, 10001, 0.5, NaN, Infinity])
    assert.throws(() => setCommissionPolicy(state, admin, { ...rate, transactionCommissionBps }, at), code("INVALID_COMMISSION"));
  assert.throws(() => setCommissionPolicy(state, admin, { transactionCommissionBps: 100, managerCommissionBps: 200 }, at), code("COMMISSION_EXCEEDS_TOTAL"));
  assert.throws(() => setCommissionPolicy(state, collector, rate, at), code("FORBIDDEN"));
  assert.deepEqual(state, before);
});

test("legacy manager-only configuration is readable but cannot invent a total rate", () => {
  const state = fixture();
  state.remittances.commissionPolicy = JSON.parse('{"revision":"synthetic-legacy-policy","managerCommissionBps":2800}');
  const before = structuredClone(state);
  assert.equal(getCommissionPolicy(state).transactionCommissionBps, 0);
  assert.throws(() => quoteRemittance(state, pair, at), code("COMMISSION_EXCEEDS_TOTAL"));
  assert.deepEqual(state, before);
});

test("changing the total rate invalidates a quote and preserves saved accrual through cancellation", () => {
  const state = fixture(); setCommissionPolicy(state, admin, rate, at);
  const quote = quoteRemittance(state, pair, at).quote;
  const input = { ...pair, senderClientId: "cli-1", recipientClientId: "cli-5", quote };
  const saved = createRemittance(state, collector, input, [], at);
  setCommissionPolicy(state, admin, { ...rate, transactionCommissionBps: 600 }, at);
  assert.throws(() => createRemittance(state, collector, input, [], at), code("QUOTE_CHANGED"));
  setCommissionPolicy(state, admin, rate, at);
  assert.throws(() => createRemittance(state, collector, input, [], at), code("QUOTE_CHANGED"), "A-B-A also invalidates");
  assert.equal(state.remittances.transfers[0].commissionBps, 500);
  assert.deepEqual(state.remittances.transfers[0].commissionAllocation, saved.commissionAllocation);
  cancelRemittance(state, collector, saved.id, "Synthetic cancellation", at);
  const report = remittanceReports(state, admin, { from: businessDate(at), to: businessDate(at), grouping: "range" });
  assert.equal(report.commissionAllocations.totals[0].managerAmount, 0);
  assert.equal(report.commissionAllocations.totals[0].cancelledManagerAmount, 160);
});

test("FileStore reopens the central rate without recalculating historical transfers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-central-commission-"));
  const path = join(directory, "state.json"); let store: FileStore | undefined;
  try {
    store = await FileStore.open(path, fixture());
    const saved = await store.transaction((state) => {
      setCommissionPolicy(state, admin, rate, at);
      return createRemittance(state, collector, { ...pair, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoteRemittance(state, pair, at).quote }, [], at);
    });
    await store.transaction((state) => setCommissionPolicy(state, admin, { ...rate, transactionCommissionBps: 600 }, at));
    await store.close(); store = await FileStore.open(path, seed());
    const state = await store.read();
    assert.equal(getCommissionPolicy(state).transactionCommissionBps, 600);
    assert.equal(state.remittances.transfers[0].commissionBps, 500);
    assert.deepEqual(state.remittances.transfers[0].commissionAllocation, saved.commissionAllocation);
  } finally { await store?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("API central policy is strict, admin-only, automatic on quote/create and idempotent after a rate change", async () => {
  const store = new MemoryStore(seed());
  const app = await buildApp({ store, demo: true, secret: "central-commission-synthetic-secret-32", origins: [], collectorUrl: "/collector/" });
  try {
    const login = async (email: string) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } })).json().token;
    const adminToken = await login("admin@cyp.local"), token = await login("collector@cyp.local");
    const post = (path: string, payload: object, bearer = adminToken, key = randomUUID()) => app.inject({ method: "POST", url: `/api${path}`, payload,
      headers: { authorization: `Bearer ${bearer}`, "idempotency-key": key } });
    const get = (path: string, bearer = token) => app.inject({ url: `/api${path}`, headers: { authorization: `Bearer ${bearer}` } });
    const before = await store.read();
    assert.equal((await post("/envios/politica-comisiones", rate, token)).statusCode, 403);
    for (const invalid of [{ ...rate, transactionCommissionBps: "500" }, { ...rate, extra: true }, { ...rate, transactionCommissionBps: -1 },
      { ...rate, transactionCommissionBps: 0.5 }, { ...rate, transactionCommissionBps: "0; DROP TABLE users" }])
      assert.equal((await post("/envios/politica-comisiones", invalid)).statusCode, 400);
    assert.equal((await post("/envios/politica-comisiones", { ...rate, transactionCommissionBps: 100 })).statusCode, 422);
    assert.deepEqual(await store.read(), before, "rejected requests are atomic");
    const policyKey = randomUUID(); const policy = await post("/envios/politica-comisiones", rate, adminToken, policyKey);
    assert.equal(policy.statusCode, 200); assert.equal(policy.json().transactionCommissionBps, 500);
    assert.deepEqual((await post("/envios/politica-comisiones", rate, adminToken, policyKey)).json(), policy.json());
    const date = businessDate();
    for (const [currency, value] of [["USD", "60"], ["EUR", "75"]]) await post("/envios/tasas", { currency, rate: value, date });
    await post("/envios/cajas/abrir", { operatorId: collector.id, currency: "USD", openingAmount: 0 });
    assert.equal((await get("/envios/snapshot")).json().commissionPolicy.transactionCommissionBps, 500);
    const path = "/envios/cotizacion?sourceCurrency=USD&destinationCurrency=EUR&amount=10000";
    const quoted = await get(path); assert.equal(quoted.statusCode, 200, quoted.body);
    assert.equal(quoted.json().commissionBps, 500);
    const quoteBefore = await store.read();
    for (const manual of ["0", "499", "10000"]) assert.equal((await get(`${path}&commissionBps=${manual}`)).statusCode, 409);
    for (const invalid of ["1e2", "-1", "1.5", "%20", "500x"]) assert.equal((await get(`${path}&commissionBps=${invalid}`)).statusCode, 400);
    assert.deepEqual(await store.read(), quoteBefore);
    const body = { ...pair, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoted.json().quote };
    assert.equal((await post("/envios", { ...body, commissionBps: 0 }, token)).statusCode, 409);
    assert.equal((await post("/envios", { ...body, commissionBps: "500" }, token)).statusCode, 400);
    const key = randomUUID(); const saved = await post("/envios", body, token, key);
    assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().commissionAmount, 500);
    assert.equal(saved.json().commissionAllocation.companyAmount, 240); assert.equal(saved.json().commissionAllocation.managerAmount, 160);
    await post("/envios/politica-comisiones", { ...rate, transactionCommissionBps: 600 });
    assert.deepEqual((await post("/envios", body, token, key)).json(), saved.json(), "lost response retry retains original commission");
    assert.equal((await post("/envios", body, token)).statusCode, 409);
    const state = await store.read(); assert.equal(state.remittances.transfers.length, 1);
    assert.equal(state.remittances.events.filter((event) => event.type === "sent").length, 1);
    assert.equal((await get(path)).json().commissionBps, 600);
  } finally { await app.close(); }
});
