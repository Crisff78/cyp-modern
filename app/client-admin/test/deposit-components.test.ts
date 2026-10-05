import assert from "node:assert/strict";
import test from "node:test";
import { buildDepositComponents, confirmedDepositMatches, depositCashTotal, depositComponentsMatch,
  depositInputCents, MAX_DEPOSIT_CENTS, nonCashDepositAmount, type NonCashDepositLine } from "../src/depositComponents";

const line = (overrides: Partial<NonCashDepositLine> = {}): NonCashDepositLine => ({
  id: "synthetic-component", method: "cheque", amount: "30.00", bank: " Banco sintético ", reference: " SYN-01 ", ...overrides,
});

test("5.1 component inputs parse exact decimal cents and reject unsafe or fabricated values", () => {
  for (const [input, amount] of [["0.01", 1], ["12.34", 1234], ["12,34", 1234], [" 30.0 ", 3000],
    ["10000000.00", MAX_DEPOSIT_CENTS]] as const) assert.equal(depositInputCents(input), amount);
  for (const invalid of ["", "0", "-1", "1e3", "1.234", "1,000.00", "NaN", "Infinity", "10000000.01", "90071992547409.92"])
    assert.throws(() => depositInputCents(invalid));
});

test("5.1 builder sums one native-currency deposit exactly and preserves submitted draft objects", () => {
  const lines = [line(), line({ id: "synthetic-2", method: "bank_deposit", reference: " SYN-02 " })];
  const before = structuredClone(lines);
  const resolved = buildDepositComponents(4000, lines);
  assert.equal(resolved.amount, 10000);
  assert.equal(resolved.cashAmount, 4000);
  assert.deepEqual(resolved.components, [
    { method: "cash", amount: 4000 },
    { method: "cheque", amount: 3000, bank: "Banco sintético", reference: "SYN-01" },
    { method: "bank_deposit", amount: 3000, bank: "Banco sintético", reference: "SYN-02" },
  ]);
  assert.deepEqual(lines, before);
  assert.equal(nonCashDepositAmount(lines), 6000);
});

test("5.1 builder enforces cash range, aggregate range, bank/reference and component-count boundaries", () => {
  assert.throws(() => buildDepositComponents(0, []));
  for (const cash of [NaN, Infinity, -1, 0.1, MAX_DEPOSIT_CENTS + 1, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => buildDepositComponents(cash, []));
  assert.throws(() => buildDepositComponents(MAX_DEPOSIT_CENTS, [line({ amount: "0.01" })]));
  for (const invalid of [{ bank: "" }, { reference: " " }, { bank: "x".repeat(161) }, { reference: "x".repeat(161) }])
    assert.throws(() => buildDepositComponents(0, [line(invalid)]));
  const twenty = Array.from({ length: 20 }, (_, index) => line({ id: String(index), amount: "0.01" }));
  assert.equal(buildDepositComponents(0, twenty).components.length, 20);
  assert.throws(() => buildDepositComponents(1, twenty));
  assert.throws(() => buildDepositComponents(0, [...twenty, line({ amount: "0.01" })]));
});

test("5.1 pure bank and cash-only components preserve the correct cash target without backfilling legacy movements", () => {
  const bank = buildDepositComponents(0, [line({ method: "bank_deposit", amount: "100.00" })]);
  assert.equal(bank.amount, 10000);
  assert.equal(bank.components.length, 1);
  assert.equal(depositCashTotal({ amount: bank.amount, depositComponents: bank.components }), 0);
  const cash = buildDepositComponents(10000, []);
  assert.equal(depositCashTotal({ amount: cash.amount, depositComponents: cash.components }), 10000);
  const historical = { amount: 12345 };
  assert.equal(depositCashTotal(historical), 12345);
  assert.deepEqual(historical, { amount: 12345 });
});

test("5.1 response validation accepts exact confirmed components and rejects altered totals, actors, currency or references", () => {
  const resolved = buildDepositComponents(4000, [line(), line({ method: "bank_deposit", reference: "SYN-02" })]);
  const expected = { collectorId: "synthetic-collector", amount: resolved.amount, currency: "USD", depositComponents: resolved.components,
    denominations: [{ denominacion: 1000, cantidad: 4 }] };
  const movement = { id: "synthetic-movement", type: "deposit", collectorId: expected.collectorId,
    amount: expected.amount, currency: "USD", createdAt: "2026-10-05T02:00:00Z", depositComponents: resolved.components, denominations: expected.denominations };
  assert.equal(confirmedDepositMatches(movement, expected), true);
  for (const changed of [{ amount: 9999 }, { currency: "EUR" }, { collectorId: "other" }, { type: "office_delivery" },
    { id: "" }, { createdAt: "invalid" }, { depositComponents: undefined }, { depositComponents: [] },
    { denominations: undefined }, { denominations: [{ denominacion: 1000, cantidad: 10 }] },
    { depositComponents: resolved.components.map((component) => component.method === "cash" ? component : { ...component, reference: "other" }) }])
    assert.equal(confirmedDepositMatches({ ...movement, ...changed }, expected), false);
  assert.equal(depositComponentsMatch(resolved.components.map((component) => ({ amount: component.amount, method: component.method,
    ...(component.bank ? { reference: component.reference, bank: component.bank } : {}) })), resolved.components), true);
  assert.equal(depositComponentsMatch(resolved.components.map((component) => ({ ...component, secret: "unexpected" })), resolved.components), false);
});

test("5.1 invalid component metadata prevents automatic cash refresh amounts instead of overwriting fields", () => {
  assert.equal(nonCashDepositAmount([]), 0);
  const incomplete = [line({ reference: "" })];
  const before = structuredClone(incomplete);
  assert.throws(() => nonCashDepositAmount(incomplete));
  assert.deepEqual(incomplete, before);
});
