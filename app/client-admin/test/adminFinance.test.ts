import test from "node:test";
import assert from "node:assert/strict";
import { businessDate, businessTimestamp, collectionCash, currencyCode, currencyName, decimalProductCents, financeMatches, nativeMoney, nativeTotals, obligationReceived } from "../src/adminFinance.ts";

test("CYP-QA-023/038: Dominican midnight and date labels are independent of browser timezone", () => {
  const previous = process.env.TZ;
  try {
    let label = "";
    for (const timezone of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
      process.env.TZ = timezone;
      assert.equal(businessDate("2026-09-30T02:30:00.000Z"), "2026-09-29");
      assert.equal(businessDate("2026-09-30T04:00:00.000Z"), "2026-09-30");
      const formatted = businessTimestamp("2026-09-30T02:30:00.000Z");
      if (label) assert.equal(formatted, label); else label = formatted;
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  assert.equal(businessDate("2026-09-30"), "2026-09-30");
  assert.equal(businessDate("invalid"), "");
});

test("CYP-QA-019/039: inclusive date limits and native currency filter", () => {
  assert.equal(financeMatches("2026-09-29", "USD", "2026-09-29", "2026-09-30", "Dólar Americano"), true);
  assert.equal(financeMatches("2026-09-30", "USD", "2026-09-29", "2026-09-30", "Dólar Americano"), true);
  assert.equal(financeMatches("2026-09-28", "USD", "2026-09-29", "2026-09-30", "Dólar Americano"), false);
  assert.equal(financeMatches("2026-10-01", "USD", "2026-09-29", "2026-09-30", "Dólar Americano"), false);
  assert.equal(financeMatches("2026-09-30", "DOP", "", "", "Dólar Americano"), false);
  assert.equal(financeMatches("2026-09-30", "EUR", "", "", "No definido"), true);
  assert.equal(financeMatches("", "DOP", "2026-09-01", "", "Peso Dominicano"), false);
  assert.equal(financeMatches("", "DOP", "", "", "Peso Dominicano"), true);
});

test("CYP-QA-039: only explicit supported currency aliases map to a code", () => {
  for (const value of [undefined, "DOP", "Peso Dominicano", "Peso Dominicano (DOP)"]) assert.equal(currencyCode(value), "DOP");
  for (const value of ["USD", "Dólar Americano", "Dólar Estadounidense"]) assert.equal(currencyCode(value), "USD");
  for (const value of ["EUR", "Euro"]) assert.equal(currencyCode(value), "EUR");
  for (const value of ["x-euro", "dolar-falso", "unknown", "No definida"]) assert.equal(currencyCode(value), "");
  assert.equal(currencyName("USD"), "Dólar Americano");
});

test("CYP-QA-039: native amounts preserve the last cent at the safe integer boundary", () => {
  for (const [code, prefix] of [["DOP", "RD$"], ["USD", "US$"], ["EUR", "€"]]) {
    assert.equal(nativeMoney(Number.MAX_SAFE_INTEGER, code), `${prefix} 90,071,992,547,409.91`);
    assert.equal(nativeMoney(-Number.MAX_SAFE_INTEGER, code), `${prefix} -90,071,992,547,409.91`);
    assert.equal(nativeMoney(0, code), `${prefix} 0.00`);
    assert.equal(nativeMoney(101, code), `${prefix} 1.01`);
  }
  assert.throws(() => nativeMoney(Number.MAX_SAFE_INTEGER + 1, "USD"), /rango seguro/);
  assert.throws(() => nativeMoney(0.1, "USD"), /rango seguro/);
});

test("CYP-QA-026/039: deposit refresh uses collection funds only, with native currencies", () => {
  const entries = [
    { collectorId: "a", type: "collection", amount: 12345, currency: "DOP" },
    { collectorId: "a", type: "deposit", amount: 11000, currency: "DOP" },
    { collectorId: "a", type: "office_delivery", amount: 6000, currency: "DOP" },
    { collectorId: "a", type: "payout", amount: 2000, currency: "DOP" },
    { collectorId: "a", type: "collection", amount: 90000, currency: "USD" },
    { collectorId: "a", type: "collection", amount: 50000, currency: "DOP", cancelledAt: "2026-09-30T12:00:00Z" },
    { collectorId: "b", type: "collection", amount: 70000, currency: "DOP" },
  ];
  assert.equal(collectionCash(entries, "a", "DOP"), 1345);
  assert.equal(collectionCash(entries, "a", "USD"), 90000);
  assert.equal(collectionCash(entries, "a", "EUR"), 0);
});

test("CYP-QA-039: combined views retain separate totals without conversion", () => {
  assert.equal(nativeTotals([{ amount: 10000, currency: "DOP" }, { amount: 20000, currency: "USD" }, { amount: 30000, currency: "EUR" }]), "RD$ 100.00 · US$ 200.00 · € 300.00");
  assert.equal(nativeTotals([{ amount: Number.MAX_SAFE_INTEGER, currency: "USD" }, { amount: 1, currency: "USD" }]), "US$ 90,071,992,547,409.92");
  assert.equal(nativeTotals([{ amount: 10000, currency: "USD" }, { amount: -4000, currency: "Dólar Americano" }]), "US$ 60.00");
  assert.equal(nativeTotals([], "USD"), "US$ 0.00");
});

test("CYP-QA-020/032/039: price times quantity rounds once using exact decimal arithmetic", () => {
  assert.equal(decimalProductCents("19.75", "1.00"), 1975);
  assert.equal(decimalProductCents("0.10", "10.53"), 105);
  assert.equal(decimalProductCents("0.01", "1.50"), 2);
  assert.equal(decimalProductCents("90071992547409.91", "1.00"), Number.MAX_SAFE_INTEGER);
  assert.throws(() => decimalProductCents("90071992547409.92", "1.00"), /rango seguro/);
  assert.throws(() => decimalProductCents("1.001", "1"), /máximo de dos decimales/);
  assert.throws(() => decimalProductCents("1e2", "1"), /válidos/);
  assert.throws(() => decimalProductCents("1", "0"), /positivo/);
});

test("CYP-QA-039: ambiguous old aggregates stay in their ledger currency", () => {
  assert.deepEqual(obligationReceived({ currency: "USD", collected: 5000, currencyConflict: true, collectedByCurrency: { DOP: 5000, USD: 0, EUR: 0 } }), [{ currency: "DOP", amount: 5000 }]);
  assert.equal(nativeTotals(obligationReceived({ currency: "USD", collected: 5000, currencyConflict: true, collectedByCurrency: { DOP: 5000, USD: 0, EUR: 0 } })), "RD$ 50.00");
  assert.deepEqual(obligationReceived({ currency: "EUR", paid: 1000 }), [{ currency: "EUR", amount: 1000 }]);
});
