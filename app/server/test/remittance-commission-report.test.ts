import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import type { User } from "../src/domain.js";
import type { Remittance } from "../src/remittances.js";
import { consolidatedCommissionReport, type CommissionReportInput } from "../src/remittance-commission-report.js";

const admin: User = { id: "demo-admin", name: "Admin", role: "admin" };
const defaults: CommissionReportInput = { from: "2026-10-09", to: "2026-10-09", grouping: "range", groupBy: "managerCurrency", status: "all" };
function transfer(id: string, status: Remittance["status"] = "pending", managerId = "gestor-1", currency: "EUR" | "USD" = "EUR"): Remittance {
  return { id, sequence: 1, envioReference: `ENV-${id}`, reciboReference: `REC-${id}`, operatingCode: `QA-${id}`,
    senderClientId: "cli-1", recipientClientId: "cli-5", sendingUserId: managerId, registeredBy: admin.id, sourceCurrency: "USD", destinationCurrency: currency,
    amount: 10000, commissionBps: 500, commissionAmount: 500, totalAmount: 10500, receiveAmount: 8000,
    quote: { date: "2026-10-09", sourceRate: "60.000000", destinationRate: "75.000000" }, note: "Synthetic report only", status, createdAt: "2026-10-09T12:00:00Z",
    commissionAllocation: { version: 1, currency, policyRevision: "qa-policy", managerCommissionBps: 200, baseAmount: 8000, transactionAmount: 400, companyAmount: 240, managerAmount: 160, managerId, managerName: "Gestor homónimo" } };
}
function fixture() {
  const state = seed();
  state.remittances.transfers = [transfer("pending"), transfer("paid", "paid"), transfer("cancelled", "cancelled"), transfer("other", "pending", "gestor-2"), transfer("usd", "pending", "gestor-1", "USD")];
  return state;
}
test("consolidation separates IDs/currencies and excludes cancelled amounts from all three live totals", () => {
  const state = fixture(), before = structuredClone(state);
  const report = consolidatedCommissionReport(state, admin, defaults);
  assert.equal(report.groups.length, 3, "Homonyms are grouped by stable ID");
  const eur = report.currencyTotals.find((row) => row.currency === "EUR")!;
  assert.deepEqual([eur.count, eur.cancelledCount, eur.transactionAmount, eur.companyAmount, eur.managerAmount], [3, 1, 1200, 720, 480]);
  assert.deepEqual([eur.cancelledTransactionAmount, eur.cancelledCompanyAmount, eur.cancelledManagerAmount], [400, 240, 160]);
  assert.equal(report.currencyTotals.find((row) => row.currency === "USD")!.managerAmount, 160);
  assert.equal(report.details.find((row) => row.id === "cancelled")!.managerAmount, 160, "Immutable evidence retained for audit");
  for (const total of report.currencyTotals) assert.equal(total.transactionAmount, total.companyAmount + total.managerAmount);
  assert.deepEqual(state, before, "Report is read-only");
});
test("status/manager/currency filters apply before totals, including zero balances for cancelled-only", () => {
  const state = fixture();
  for (const [status, count, cancelled] of [["all", 4, 1], ["active", 4, 0], ["pending", 3, 0], ["paid", 1, 0], ["cancelled", 0, 1]] as const) {
    const report = consolidatedCommissionReport(state, admin, { ...defaults, status });
    assert.equal(report.currencyTotals.reduce((sum, row) => sum + row.count, 0), count);
    assert.equal(report.currencyTotals.reduce((sum, row) => sum + row.cancelledCount, 0), cancelled);
    assert.ok(report.details.every((row) => status === "all" || (status === "active" ? row.status !== "cancelled" : row.status === status)));
  }
  const chosen = consolidatedCommissionReport(state, admin, { ...defaults, managerId: "gestor-2", currency: "EUR" });
  assert.equal(chosen.details.length, 1); assert.equal(chosen.groups[0].managerAmount, 160);
  const cancelled = consolidatedCommissionReport(state, admin, { ...defaults, status: "cancelled" });
  assert.deepEqual(cancelled.groups.map(({ transactionAmount, companyAmount, managerAmount }) => [transactionAmount, companyAmount, managerAmount]), [[0, 0, 0]]);
  assert.deepEqual(consolidatedCommissionReport(state, admin, { ...defaults, managerId: "unknown" }).currencyTotals, []);
});
test("business date boundaries, daily/currency grouping and legacy exclusion never recalculate historical shares", () => {
  const state = fixture();
  const boundary = transfer("boundary"); boundary.createdAt = "2026-10-10T03:59:59Z";
  const next = transfer("next"); next.createdAt = "2026-10-10T04:00:00Z";
  const legacy = transfer("legacy"); delete legacy.commissionAllocation; state.remittances.transfers.push(boundary, next, legacy);
  state.remittances.commissionPolicy = { revision: "changed", managerCommissionBps: 9900 };
  const day = consolidatedCommissionReport(state, admin, { ...defaults, grouping: "day", groupBy: "currency" });
  assert.equal(day.excludedLegacyCount, 1); assert.ok(day.details.some((row) => row.id === "boundary")); assert.ok(!day.details.some((row) => row.id === "next"));
  assert.equal(day.groups.length, 2); assert.ok(day.groups.every((row) => row.managerId === undefined && row.date === "2026-10-09"));
  const range = consolidatedCommissionReport(state, admin, { ...defaults, to: "2026-10-10", grouping: "day" });
  assert.equal(range.currencyTotals.find((row) => row.currency === "EUR")!.managerAmount, 800);
  assert.throws(() => consolidatedCommissionReport(state, admin, { ...defaults, from: "2026-10-10" }), /fecha inicial/);
});
test("exact BigInt sums reject unsafe totals atomically and respect receipt/outgoing visibility", () => {
  const state = fixture(), outsider: User = { id: "outsider", name: "Outsider", role: "collector", collectorId: "col-3" };
  assert.deepEqual(consolidatedCommissionReport(state, outsider, defaults).currencyTotals, []);
  const maximum = transfer("maximum"); Object.assign(maximum.commissionAllocation!, { transactionAmount: Number.MAX_SAFE_INTEGER, companyAmount: Number.MAX_SAFE_INTEGER, managerAmount: 0 });
  const extra = transfer("extra"); Object.assign(extra.commissionAllocation!, { transactionAmount: 1, companyAmount: 1, managerAmount: 0 });
  state.remittances.transfers = [maximum]; assert.equal(consolidatedCommissionReport(state, admin, defaults).currencyTotals[0].companyAmount, Number.MAX_SAFE_INTEGER);
  state.remittances.transfers.push(extra); const before = structuredClone(state);
  assert.throws(() => consolidatedCommissionReport(state, admin, defaults), (error: unknown) => (error as { code: string }).code === "MONEY_RANGE");
  assert.deepEqual(state, before);
});
test("consolidated API validates filters, preserves access scope and performs no financial writes", async () => {
  const store = new MemoryStore(fixture());
  const app = await buildApp({ store, demo: true, secret: "phase5-synthetic-report-secret-32", origins: [], collectorUrl: "http://localhost:5174" });
  try {
    const login = async (email: string) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } })).json().token;
    const token = await login("admin@cyp.local");
    const get = (query: string, bearer = token) => app.inject({ url: `/api/envios/reportes/comisiones?${query}`, headers: { authorization: `Bearer ${bearer}` } });
    const base = "from=2026-10-09&to=2026-10-09", before = await store.read();
    assert.equal((await app.inject({ url: `/api/envios/reportes/comisiones?${base}` })).statusCode, 401);
    for (const suffix of ["status=bad", "currency=HTG", "groupBy=manager", "grouping=bad", "managerId=", "unknown=1"]) assert.equal((await get(`${base}&${suffix}`)).statusCode, 400, suffix);
    assert.equal((await get("from=2026-10-10&to=2026-10-09")).statusCode, 400);
    const report = await get(`${base}&groupBy=currency&status=cancelled`); assert.equal(report.statusCode, 200, report.body);
    assert.equal(report.json().currencyTotals[0].managerAmount, 0); assert.equal(report.json().currencyTotals[0].cancelledManagerAmount, 160);
    assert.deepEqual(await store.read(), before);
    const collectorToken = await login("collector@cyp.local");
    const scoped = await get(`${base}&managerId=gestor-2&currency=EUR`, collectorToken); assert.equal(scoped.statusCode, 200);
    assert.equal(scoped.json().details.length, 1, "Existing sender-route scope is preserved; manager filter grants no extra rights");
  } finally { await app.close(); }
});
