import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { buildApp } from "../src/app.js";
import { businessDate, type User } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { effectiveAccess } from "../../shared/access.mjs";
import { MemoryStore } from "../src/store.js";
import { readRemittances, saveRemittances } from "../src/remittance-store.js";
import { createRemittance, openRemittanceCash, quoteRemittance, remittanceSnapshot, setCommissionPolicy, setDailyRate } from "../src/remittances.js";

const friday = new Date("2026-10-16T16:00:00Z"), saturday = new Date("2026-10-17T16:00:00Z"), today = new Date("2026-10-21T16:00:00Z");
const admin: User = { id: "demo-admin", name: "Synthetic office", role: "admin" };
const collector: User = { id: "demo-collector", name: "Synthetic collector", role: "collector", collectorId: "col-1" };
const input = { sourceCurrency: "USD" as const, destinationCurrency: "EUR" as const, amount: 100000 };
const errorCode = (code: string) => (error: unknown) => { assert.equal((error as { code: string }).code, code); return true; };
function fixture() {
  const state = seed();
  setDailyRate(state, admin, { currency: "USD", rate: "60", date: businessDate(friday) }, friday);
  setDailyRate(state, admin, { currency: "EUR", rate: "75", date: businessDate(saturday) }, saturday);
  setCommissionPolicy(state, admin, { transactionCommissionBps: 1000, managerCommissionBps: 500 }, today);
  return state;
}

test("latest effective rates carry over multiple days independently by currency with exact DOP bridge and commission split", () => {
  const state = fixture(), before = structuredClone(state);
  const quote = quoteRemittance(state, input, today);
  assert.equal(quote.quote.date, "2026-10-21"); assert.equal(quote.quote.sourceRateDate, "2026-10-16"); assert.equal(quote.quote.destinationRateDate, "2026-10-17");
  assert.equal(quote.quote.sourceRate, "60.000000"); assert.equal(quote.quote.destinationRate, "75.000000");
  assert.equal(quote.amountDop, 6000000); assert.equal(quote.receiveAmount, 80000);
  assert.equal(quote.commissionAmount, 10000); assert.equal(quote.totalAmount, 110000);
  // The manager takes 50% of the commission (the former 5% of a 10% commission), in the sender's currency.
  assert.equal(quote.commissionAllocation.currency, "USD");
  assert.equal(quote.commissionAllocation.transactionAmount, 10000); assert.equal(quote.commissionAllocation.managerAmount, 5000); assert.equal(quote.commissionAllocation.companyAmount, 5000);
  assert.deepEqual(state, before, "quoting does not manufacture today's rates or mutate historical rows");
  const inverse = quoteRemittance(state, { ...input, amount: 80000, amountMode: "destination" }, today);
  assert.equal(inverse.amount, 100000); assert.equal(inverse.receiveAmount, 80000); assert.equal(inverse.receiveRoundingDifference, 0);
});

test("future rates never override the latest effective rate or serve as an invented fallback", () => {
  const state = fixture(), future = new Date("2026-10-22T16:00:00Z");
  setDailyRate(state, admin, { currency: "USD", rate: "99", date: businessDate(future) }, future);
  assert.equal(quoteRemittance(state, input, today).quote.sourceRate, "60.000000");
  state.remittances.rates = state.remittances.rates.filter((rate) => rate.currency !== "USD" || rate.date === businessDate(future));
  assert.throws(() => quoteRemittance(state, input, today), errorCode("RATE_MISSING"));
  state.remittances.rates = [];
  assert.equal(quoteRemittance(state, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 100 }, today).receiveAmount, 100);
  assert.throws(() => quoteRemittance(state, { sourceCurrency: "DOP", destinationCurrency: "EUR", amount: 100 }, today), errorCode("RATE_MISSING"));
});

test("DOP bridge is displayed in cents without double-rounding the foreign-currency payout", () => {
  const state = fixture();
  setDailyRate(state, admin, { currency: "USD", rate: "1.4", date: businessDate(friday) }, friday);
  setDailyRate(state, admin, { currency: "EUR", rate: "2.5", date: businessDate(saturday) }, saturday);
  const quoted = quoteRemittance(state, { ...input, amount: 1 }, today);
  assert.equal(quoted.amountDop, 1); assert.equal(quoted.receiveAmount, 1, "1 source cent × 1.4 / 2.5 rounds to 1 destination cent; rounding the bridge first would incorrectly produce zero");
  const inverse = quoteRemittance(state, { ...input, amount: 1, amountMode: "destination" }, today);
  assert.equal(inverse.amount, 2); assert.equal(inverse.receiveAmount, 1);
});

test("collector snapshot supplies carried-forward rates without disclosing future rates or management history", () => {
  const state = fixture(), future = new Date("2026-10-22T16:00:00Z");
  setDailyRate(state, admin, { currency: "USD", rate: "99", date: businessDate(future) }, future);
  const limited: User = { ...collector, access: effectiveAccess("collector", { permissionMode: "custom", permissionIds: [1, 2], remittancePermissions: ["remittances.view", "remittances.create"] }) };
  const snapshot = remittanceSnapshot(state, limited, [admin, limited], today);
  assert.deepEqual(snapshot.rates.map(({ currency, date }) => [currency, date]), [["DOP", "2026-10-21"], ["EUR", "2026-10-17"], ["USD", "2026-10-16"]]);
  assert.equal(snapshot.rateHistory.length, 0); assert.ok(snapshot.rates.every((rate) => !("updatedBy" in rate)));
  assert.ok(remittanceSnapshot(state, admin, [admin, collector], today).rates.some((rate) => rate.date === "2026-10-22"));
});

test("new effective rates invalidate stale quotes even at the same price; saved transfers keep their original rates and dates", () => {
  const state = fixture(); openRemittanceCash(state, admin, { operatorId: admin.id, currency: "USD", openingAmount: 0 }, [], today);
  const quote = quoteRemittance(state, input, today), body = { ...input, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quote.quote };
  const saved = createRemittance(state, admin, body, [], today), frozen = structuredClone(saved);
  setDailyRate(state, admin, { currency: "USD", rate: "60", date: businessDate(today) }, today);
  assert.throws(() => createRemittance(state, admin, body, [], today), errorCode("QUOTE_CHANGED"));
  const current = quoteRemittance(state, input, today);
  assert.throws(() => createRemittance(state, admin, { ...body, quote: { ...current.quote, destinationRateDate: "2026-10-21" } }, [], today), errorCode("QUOTE_CHANGED"));
  assert.deepEqual(state.remittances.transfers[0].quote, frozen.quote); assert.equal(state.remittances.transfers[0].receiveAmount, frozen.receiveAmount);
  const legacyRequest = { ...current.quote }; delete legacyRequest.sourceRateDate; delete legacyRequest.destinationRateDate;
  assert.equal(createRemittance(state, admin, { ...body, quote: legacyRequest }, [], today).quote.sourceRateDate, businessDate(today));
});

test("legacy rate dates and DOP dates are frozen in SQL as bound values and restored without guessing unknown history", async () => {
  const state = fixture(), before = structuredClone(state.remittances);
  state.remittances.rates = state.remittances.rates.map(({ changeId: _id, updatedAt: _at, updatedBy: _by, ...rate }) => rate);
  openRemittanceCash(state, admin, { operatorId: admin.id, currency: "USD", openingAmount: 0 }, [], today);
  const quote = quoteRemittance(state, input, today), saved = createRemittance(state, admin, { ...input, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quote.quote }, [], today);
  assert.equal(saved.quote.sourceRateChangeId, undefined); assert.equal(saved.quote.sourceRateDate, "2026-10-16");
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const connection = { query: async (sql: string, values?: unknown[]) => { calls.push({ sql, values }); return { rows: [] }; } } as unknown as pg.PoolClient;
  await saveRemittances(connection, state.remittances, before);
  const insert = calls.find(({ sql }) => sql.startsWith("INSERT INTO remittance_transfers"))!;
  assert.match(insert.sql, /source_rate_date,destination_rate_date/); assert.deepEqual(insert.values?.slice(30, 32), ["2026-10-16", "2026-10-17"]);
  const dbRows = [{ id: saved.id, sequence: saved.sequence, amount: saved.amount, receiveAmount: saved.receiveAmount, quoteDate: saved.quote.date,
    sourceRate: saved.quote.sourceRate, destinationRate: saved.quote.destinationRate, sourceRateDate: "2026-10-16", destinationRateDate: "2026-10-17" },
    { id: "legacy-unknown", quoteDate: "2020-01-01", sourceRate: "60.000000", destinationRate: "75.000000", sourceRateDate: null, destinationRateDate: null }];
  const reader = { query: async (sql: string) => ({ rows: sql.includes("FROM remittance_transfers t") ? dbRows : [] }) } as unknown as pg.PoolClient;
  const read = await readRemittances(reader);
  assert.equal(read.transfers[0].quote.sourceRateDate, saved.quote.sourceRateDate); assert.equal(read.transfers[0].quote.destinationRateDate, saved.quote.destinationRateDate);
  assert.equal(read.transfers[1].quote.sourceRateDate, undefined); assert.equal(read.transfers[1].quote.destinationRateDate, undefined);
});

test("API accepts carried-forward quote dates, validates their format and recomputes effective dates when saving", async (t) => {
  const at = new Date(), older = new Date(at.getTime() - 2 * 86400000), state = seed();
  setDailyRate(state, admin, { currency: "USD", rate: "60", date: businessDate(older) }, older);
  setDailyRate(state, admin, { currency: "EUR", rate: "75", date: businessDate(older) }, older);
  openRemittanceCash(state, admin, { operatorId: admin.id, currency: "USD", openingAmount: 0 }, [], at);
  const store = new MemoryStore(state), app = await buildApp({ store, demo: true, secret: "synthetic-effective-rate-secret-at-least-32", origins: [] });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200, login.body); const authorization = `Bearer ${login.json().token}`;
  const response = await app.inject({ url: "/api/envios/cotizacion?sourceCurrency=USD&destinationCurrency=EUR&amount=100000", headers: { authorization } });
  assert.equal(response.statusCode, 200, response.body); const quote = response.json(); assert.equal(quote.quote.sourceRateDate, businessDate(older));
  const body = { ...input, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quote.quote };
  const post = (payload: unknown) => app.inject({ method: "POST", url: "/api/envios", payload, headers: { authorization, "idempotency-key": randomUUID() } });
  const invalid = await post({ ...body, quote: { ...body.quote, sourceRateDate: "21/10/2026" } }); assert.equal(invalid.statusCode, 400, invalid.body);
  const changed = await post({ ...body, quote: { ...body.quote, sourceRateDate: businessDate(at) } }); assert.equal(changed.statusCode, 409, changed.body);
  const created = await post(body); assert.equal(created.statusCode, 200, created.body); assert.equal(created.json().quote.sourceRateDate, businessDate(older));
  assert.equal(created.json().receiveAmount, 80000); assert.equal((await store.read()).remittances.transfers.length, 1);
});
