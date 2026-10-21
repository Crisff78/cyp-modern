import test from "node:test";
import assert from "node:assert/strict";
import { effectiveRate, quoteStillCurrent } from "./quoteRates";
import type { Quotation, Rate, RemittanceSnapshot } from "./types";

const rates: Rate[] = [
  { id: "usd-old", currency: "USD", rate: "59", date: "2026-10-18", changeId: "u0" },
  { id: "usd", currency: "USD", rate: "60", date: "2026-10-20", changeId: "u1" },
  { id: "eur", currency: "EUR", rate: "75", date: "2026-10-19", changeId: "e1" },
  { id: "future", currency: "USD", rate: "999", date: "2026-10-22", changeId: "u2" },
];
const quote: Quotation = {
  sourceCurrency: "USD", destinationCurrency: "EUR", amount: 10000, commissionBps: 0, commissionAmount: 0, totalAmount: 10000, receiveAmount: 8000,
  quote: { date: "2026-10-21", sourceRate: "60.000000", destinationRate: "75.000000", sourceRateDate: "2026-10-20", destinationRateDate: "2026-10-19", sourceRateChangeId: "u1", destinationRateChangeId: "e1" },
};
const snapshot = { businessDate: "2026-10-21", rates } as RemittanceSnapshot;

test("refresh retains prior-day rates per currency and ignores future registrations", () => {
  assert.equal(effectiveRate(rates, "USD", snapshot.businessDate)?.id, "usd");
  assert.equal(effectiveRate(rates, "EUR", snapshot.businessDate)?.id, "eur");
  assert.equal(quoteStillCurrent(quote, snapshot), true);
  assert.equal(quoteStillCurrent(quote, { ...snapshot, businessDate: "2026-10-22" }), false);
});

test("refresh retires a quote when value, date, revision, policy or availability changes", () => {
  for (const change of [
    { rate: "61" }, { changeId: "new-revision" }, { date: "2026-10-21" },
  ]) assert.equal(quoteStillCurrent(quote, { ...snapshot, rates: rates.map((rate) => rate.id === "usd" ? { ...rate, ...change } : rate) }), false);
  assert.equal(quoteStillCurrent(quote, { ...snapshot, rates: [] }), false);
  assert.equal(quoteStillCurrent(quote, { ...snapshot, commissionPolicy: { revision: "new", transactionCommissionBps: 0, managerCommissionBps: 0 } }), false);
  const legacy = { ...quote, quote: { date: quote.quote.date, sourceRate: "60", destinationRate: "75" } };
  assert.equal(quoteStillCurrent(legacy, { ...snapshot, rates: rates.map(({ changeId: _changeId, ...rate }) => rate) }), true);
  assert.equal(quoteStillCurrent(legacy, { ...snapshot, rates: rates.filter((rate) => rate.currency === "EUR") }), false);
});
