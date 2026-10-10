import test from "node:test";
import assert from "node:assert/strict";
import { currentOperationalWeek } from "../../shared/operationalWeek";
import { confirmedRateResponse } from "../../shared/remittances/rateResponse";
import { printSections } from "../../shared/remittances/output";
import { settlementBalances, settlementRows } from "../src/settlementCurrencies";
import type { Balance, Snapshot } from "../src/types";

test("operational week starts Monday in Santo Domingo, including UTC midnight and year boundaries", () => {
  assert.deepEqual(currentOperationalWeek(new Date("2026-10-12T03:59:59Z")), { from: "2026-10-05", to: "2026-10-11" });
  assert.deepEqual(currentOperationalWeek(new Date("2026-10-12T04:00:00Z")), { from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(currentOperationalWeek(new Date("2026-01-01T12:00:00Z")), { from: "2025-12-29", to: "2026-01-04" });
});

const balance = (collected: number, difference = 0): Balance => ({ collected, deposited: collected - difference, officeDelivered: 0, paidToClients: 0, difference });
test("settlement rows preserve each currency and legacy DOP without summing or mutation", () => {
  const records: Snapshot["settlements"] = [{ id: "qa-close", collectorId: "qa-collector", date: "2026-10-09", status: "closed", closedAt: "2026-10-09T18:00:00Z", ...balance(10000), totalsByCurrency: { DOP: balance(10000), USD: balance(1000), EUR: balance(500) } }];
  const before = JSON.stringify(records);
  const rows = settlementRows(records);
  assert.deepEqual(rows.map(({ currency, collected, id }) => ({ currency, collected, id })), [
    { currency: "DOP", collected: 10000, id: "qa-close.DOP" }, { currency: "USD", collected: 1000, id: "qa-close.USD" }, { currency: "EUR", collected: 500, id: "qa-close.EUR" },
  ]);
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(settlementBalances(balance(200)), [{ currency: "DOP", balance: balance(200) }]);
  assert.equal(settlementBalances({ ...balance(0), totalsByCurrency: { DOP: balance(0), USD: balance(1000, 500) } }).every(({ balance }) => balance.difference === 0), false);
});

test("commercial rate confirmation keeps the key when buy or sell was not saved exactly", () => {
  const expected = { currency: "USD" as const, date: "2026-10-09", rate: "60", purchaseRate: "59.25", saleRate: "61.75" };
  const saved = { id: "qa-rate", ...expected, rate: "60.000000", purchaseRate: "59.250000", saleRate: "61.750000" };
  assert.equal(confirmedRateResponse(saved, expected), saved);
  for (const purchaseRate of [undefined, "60", "invalid", "59.250001"]) assert.throws(() => confirmedRateResponse({ ...saved, purchaseRate }, expected));
  assert.throws(() => confirmedRateResponse({ ...saved, saleRate: "61.750001" }, expected));
  assert.equal(confirmedRateResponse({ id: "legacy", currency: "USD", date: expected.date, rate: "60" }, { currency: "USD", date: expected.date, rate: "60" }).id, "legacy");
});

test("printed configured footer is text, cannot execute HTML, and does not add a blank note", (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let html = "";
  const popup = { opener: {}, document: { write: (value: string) => { html = value; }, close() {} }, focus() {}, print() {} };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { open: () => popup, setTimeout: () => 0 } });
  t.after(() => original ? Object.defineProperty(globalThis, "window", original) : Reflect.deleteProperty(globalThis, "window"));
  printSections("Recibo ficticio", [], "CyP", { footerNote: '<img src=x onerror=alert(1)>\nSegunda línea' });
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!html.includes("<img"));
  assert.equal(popup.opener, null);
  printSections("Recibo ficticio", []);
  assert.ok(!html.includes("<footer>"));
});
