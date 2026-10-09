import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { businessDate, type State, type User } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore, FileStore } from "../src/store.js";
import { quoteRemittance, setDailyRate, setCommissionPolicy, getCommissionPolicy, openRemittanceCash, createRemittance,
  cancelRemittance, payRemittance, remittanceReports, type Currency, type CreateRemittanceInput } from "../src/remittances.js";

const now = new Date("2026-10-09T16:00:00Z");
const admin: User = { id: "demo-admin", name: "Synthetic Admin", role: "admin" };
const collector: User = { id: "demo-collector", name: "Synthetic Gestor", role: "collector", collectorId: "col-1" };
const receiver: User = { id: "synthetic-receiver", name: "Synthetic Receiver", role: "collector", collectorId: "col-2" };
const pair = { sourceCurrency: "USD" as Currency, destinationCurrency: "EUR" as Currency, amount: 10000, commissionBps: 500 };
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code: string }).code, expected); return true; };
function fixture() {
  const state = seed();
  setCommissionPolicy(state, admin, { transactionCommissionBps: 500, managerCommissionBps: 0 }, now);
  setDailyRate(state, admin, { currency: "USD", rate: "60", date: businessDate(now) }, now);
  setDailyRate(state, admin, { currency: "EUR", rate: "75", date: businessDate(now) }, now);
  openRemittanceCash(state, admin, { operatorId: collector.id, currency: "USD", openingAmount: 0 }, [collector], now);
  return state;
}
function input(state: State, destination?: number): CreateRemittanceInput {
  const quote = quoteRemittance(state, { ...pair, amount: destination ?? pair.amount, amountMode: destination === undefined ? "source" : "destination" }, now);
  return { ...pair, amount: quote.amount, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quote.quote,
    ...(destination === undefined ? {} : { requestedReceiveAmount: destination }) };
}

test("bidirectional quotes use server half-up and expose unrepresentable destination cents", () => {
  const state = fixture();
  const forward = quoteRemittance(state, pair, now);
  assert.equal(forward.amountDop, 600000); assert.equal(forward.receiveAmount, 8000);
  const inverse = quoteRemittance(state, { ...pair, amountMode: "destination", amount: 8000 }, now);
  assert.equal(inverse.amount, 10000); assert.equal(inverse.receiveAmount, 8000); assert.equal(inverse.receiveRoundingDifference, 0);
  const fractional = quoteRemittance(state, { ...pair, destinationCurrency: "DOP", amountMode: "destination", amount: 100 }, now);
  assert.equal(fractional.amount, 2); assert.equal(fractional.receiveAmount, 120); assert.equal(fractional.receiveRoundingDifference, 20);
  const negativeDelta = quoteRemittance(state, { ...pair, destinationCurrency: "DOP", amountMode: "destination", amount: 140 }, now);
  assert.equal(negativeDelta.receiveAmount, 120); assert.equal(negativeDelta.receiveRoundingDifference, -20);
  assert.throws(() => quoteRemittance(state, { ...pair, destinationCurrency: "DOP", amountMode: "destination", amount: 1 }, now), code("INVALID_AMOUNT"));
  for (const sourceCurrency of ["DOP", "USD", "EUR"] as const) for (const destinationCurrency of ["DOP", "USD", "EUR"] as const) {
    const quote = quoteRemittance(state, { sourceCurrency, destinationCurrency, amount: 600000, amountMode: "destination" }, now);
    assert.ok(Number.isSafeInteger(quote.amount)); assert.ok(Number.isSafeInteger(quote.receiveAmount));
    assert.equal(quote.requestedReceiveAmount, 600000);
  }
});

test("calculated split uses final destination base, preserves identity, freezes configuration and cancels accrual", () => {
  const state = fixture(), ledger = structuredClone(state.movements);
  setCommissionPolicy(state, admin, { managerCommissionBps: 200 }, now);
  const transfer = createRemittance(state, collector, input(state, 8000), [], now);
  const allocation = transfer.commissionAllocation!;
  assert.equal(transfer.commissionAmount, 500); assert.equal(transfer.totalAmount, 10500);
  assert.equal(allocation.currency, "EUR"); assert.equal(allocation.baseAmount, 8000);
  assert.equal(allocation.transactionAmount, 400); assert.equal(allocation.managerAmount, 160); assert.equal(allocation.companyAmount, 240);
  assert.equal(allocation.companyAmount + allocation.managerAmount, allocation.transactionAmount);
  assert.equal(allocation.managerId, collector.id); assert.equal(allocation.managerName, collector.name);
  const report = () => remittanceReports(state, admin, { from: "2026-10-09", to: "2026-10-09", grouping: "day" });
  assert.equal(report().commissionAllocations.totals[0].managerAmount, 160);
  setCommissionPolicy(state, admin, { managerCommissionBps: 300 }, now);
  assert.deepEqual(state.remittances.transfers[0].commissionAllocation, allocation);
  cancelRemittance(state, collector, transfer.id, "Cancelación sintética", now);
  const totals = report().commissionAllocations.totals[0];
  assert.equal(totals.count, 0); assert.equal(totals.managerAmount, 0); assert.equal(totals.companyAmount, 0);
  assert.equal(totals.cancelledCount, 1); assert.equal(totals.cancelledManagerAmount, 160); assert.equal(totals.cancelledCompanyAmount, 240);
  assert.deepEqual(state.remittances.transfers[0].commissionAllocation, allocation, "cancellation retains evidence");
  assert.throws(() => cancelRemittance(state, collector, transfer.id, "Otra", now), code("TRANSFER_NOT_PENDING"));
  assert.deepEqual(state.movements, ledger, "collection ledger remains separate");
});

test("payment does not accrue twice; report groups by stable gestor ID, currency and business date", () => {
  const state = fixture(); setCommissionPolicy(state, admin, { managerCommissionBps: 200 }, now);
  const transfer = createRemittance(state, collector, input(state), [], now);
  openRemittanceCash(state, admin, { operatorId: receiver.id, currency: "EUR", openingAmount: 8000 }, [receiver], now);
  payRemittance(state, receiver, transfer.id, new Date("2026-10-09T17:00:00Z"));
  const report = remittanceReports(state, admin, { from: "2026-10-09", to: "2026-10-09", grouping: "range" });
  assert.equal(report.commissionAllocations.totals[0].count, 1); assert.equal(report.commissionAllocations.totals[0].managerAmount, 160);
  const cloned = structuredClone(state.remittances.transfers[0]); cloned.id = "another-gestor"; cloned.commissionAllocation!.managerId = "another-id";
  state.remittances.transfers.push(cloned);
  const boundary = structuredClone(cloned); boundary.id = "next-business-day"; boundary.createdAt = "2026-10-10T04:00:00Z"; state.remittances.transfers.push(boundary);
  const day = remittanceReports(state, admin, { from: "2026-10-09", to: "2026-10-09", grouping: "day" });
  assert.equal(day.commissionAllocations.totals.length, 2, "equal names never merge distinct IDs");
  assert.equal(day.commissionAllocations.details.length, 2, "business date boundary excludes following day");
  const outsider: User = { id: "outside", name: "Outside", role: "collector", collectorId: "col-3" };
  assert.deepEqual(remittanceReports(state, outsider, { from: "2026-10-09", to: "2026-10-09", grouping: "day" }).commissionAllocations, { totals: [], details: [] });
});

test("policy changes, over-allocation and manipulated inverse principal reject without cash or transfer changes", () => {
  const state = fixture(), stale = input(state);
  setCommissionPolicy(state, admin, { managerCommissionBps: 200 }, now); setCommissionPolicy(state, admin, { managerCommissionBps: 0 }, now);
  assert.throws(() => createRemittance(state, collector, stale, [], now), code("QUOTE_CHANGED"));
  const current = input(state, 8000), before = structuredClone(state.remittances);
  assert.throws(() => createRemittance(state, collector, { ...current, amount: current.amount + 1 }, [], now), code("QUOTE_CHANGED"));
  assert.throws(() => setCommissionPolicy(state, admin, { managerCommissionBps: 600 }, now), code("COMMISSION_EXCEEDS_TOTAL"));
  // An old file with an inconsistent policy also fails closed at quotation.
  state.remittances.commissionPolicy!.managerCommissionBps = 600;
  assert.throws(() => quoteRemittance(state, pair, now), code("COMMISSION_EXCEEDS_TOTAL"));
  assert.deepEqual(state.remittances.transfers, before.transfers); assert.deepEqual(state.remittances.events, before.events);
  assert.throws(() => setCommissionPolicy(state, collector, { managerCommissionBps: 100 }, now), code("FORBIDDEN"));
  for (const rate of [-1, 10001, 0.5, NaN, Infinity]) assert.throws(() => setCommissionPolicy(state, admin, { managerCommissionBps: rate }, now), code("INVALID_COMMISSION"));
});

test("FileStore reopen preserves policy, inverse intent, immutable accrual and annulment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-commission-phase234-")), path = join(directory, "state.json");
  let store: FileStore | undefined;
  try {
    store = await FileStore.open(path, fixture());
    const transfer = await store.transaction((state) => { setCommissionPolicy(state, admin, { managerCommissionBps: 200 }, now); return createRemittance(state, collector, input(state, 8000), [], now); });
    await store.close(); store = await FileStore.open(path, seed());
    assert.equal(getCommissionPolicy(await store.read()).managerCommissionBps, 200);
    const { canPay: _pay, canCancel: _cancel, ...stored } = transfer;
    assert.deepEqual((await store.read()).remittances.transfers[0], stored);
    await store.transaction((state) => cancelRemittance(state, collector, transfer.id, "Cancelación QA", now));
    await store.close(); store = await FileStore.open(path, seed());
    const reopened = (await store.read()).remittances.transfers[0];
    assert.equal(reopened.status, "cancelled"); assert.deepEqual(reopened.commissionAllocation, transfer.commissionAllocation);
    assert.equal(remittanceReports(await store.read(), admin, { from: "2026-10-09", to: "2026-10-09", grouping: "day" }).commissionAllocations.totals[0].managerAmount, 0);
  } finally { await store?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("API keeps strict schemas, guards policy, confirms destination quote and replays devengo exactly once", async () => {
  const store = new MemoryStore(seed());
  const app = await buildApp({ store, demo: true, secret: "phase234-synthetic-secret-at-least-32", origins: [], collectorUrl: "http://localhost:5174" });
  try {
    const login = async (email: string) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } })).json().token;
    const token = await login("admin@cyp.local"), collectorToken = await login("collector@cyp.local");
    const post = (url: string, payload: object, key = randomUUID(), bearer = token) => app.inject({ method: "POST", url: `/api${url}`, payload, headers: { authorization: `Bearer ${bearer}`, "idempotency-key": key } });
    const get = (url: string) => app.inject({ url: `/api${url}`, headers: { authorization: `Bearer ${token}` } });
    assert.equal((await post("/envios/politica-comisiones", { managerCommissionBps: 200 }, randomUUID(), collectorToken)).statusCode, 403);
    for (const payload of [{ managerCommissionBps: "200" }, { managerCommissionBps: 200, extra: true }, { managerCommissionBps: -1 }]) assert.equal((await post("/envios/politica-comisiones", payload)).statusCode, 400);
    assert.equal((await post("/envios/politica-comisiones", { transactionCommissionBps: 500, managerCommissionBps: 200 })).statusCode, 200);
    const date = businessDate();
    await post("/envios/tasas", { currency: "USD", rate: "60", date }); await post("/envios/tasas", { currency: "EUR", rate: "75", date });
    assert.equal((await post("/envios/cajas/abrir", { operatorId: "demo-admin", currency: "USD", openingAmount: 0 })).statusCode, 200);
    const quoteResult = await get("/envios/cotizacion?sourceCurrency=USD&destinationCurrency=EUR&amount=8000&amountMode=destination&commissionBps=500");
    assert.equal(quoteResult.statusCode, 200, quoteResult.body); const quoted = quoteResult.json();
    const body = { ...pair, amount: quoted.amount, requestedReceiveAmount: 8000, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoted.quote };
    const before = await store.read();
    assert.equal((await post("/envios", { ...body, commissionAllocation: { managerAmount: 1 } })).statusCode, 400);
    const stripped = { ...body, quote: { ...quoted.quote } }; delete stripped.quote.commissionPolicyRevision;
    assert.equal((await post("/envios", stripped)).statusCode, 409);
    assert.deepEqual(await store.read(), before);
    const key = randomUUID(); const saved = await post("/envios", body, key); assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().commissionAllocation.managerAmount, 160); assert.equal(saved.json().amountDop, 600000);
    assert.deepEqual((await post("/envios", body, key)).json(), saved.json()); assert.equal((await store.read()).remittances.transfers.length, 1);
    const cancelled = await post(`/envios/${saved.json().id}/cancelar`, { reason: "Cancelación QA" }); assert.equal(cancelled.statusCode, 200);
    const report = (await get(`/envios/reportes?from=${date}&to=${date}`)).json();
    assert.equal(report.commissionAllocations.totals[0].managerAmount, 0); assert.equal(report.commissionAllocations.totals[0].cancelledManagerAmount, 160);
    const stationBefore = await store.read();
    for (const path of ["/estaciones", "/estaciones/legacy-qa"]) {
      const result = await post(path, { name: "Manual", number: "QA", active: true }); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, "STATION_RRAA_REQUIRED");
    }
    assert.deepEqual(await store.read(), stationBefore);
  } finally { await app.close(); }
});
