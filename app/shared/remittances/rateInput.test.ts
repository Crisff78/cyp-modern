import assert from "node:assert/strict";
import test from "node:test";
import { confirmedRateInput, rateInputDraft, RATE_INPUT_MAX_LENGTH } from "./rateInput";

test("rate inputs retain an excess character so typing cannot turn invalid precision into a valid rate", () => {
  assert.equal(RATE_INPUT_MAX_LENGTH, 20);
  const typed = "999999999999.9999999".slice(0, RATE_INPUT_MAX_LENGTH);
  assert.equal(rateInputDraft(typed), "999999999999.9999999");
  assert.throws(() => confirmedRateInput(typed), /máximo de 19 caracteres/i);
});

test("rate draft handles a pasted comma decimal and each typed character", () => {
  assert.equal(rateInputDraft("60,50"), "60.50");
  let draft = "";
  for (const character of "60,50") draft = rateInputDraft(draft + character);
  assert.equal(draft, "60.50");
  assert.equal(confirmedRateInput(draft), "60.50");
});

test("rate draft retains empty and incomplete decimal input for editing", () => {
  for (const value of ["", ".", ".5", "1.", "0.", "60.123456"])
    assert.equal(rateInputDraft(value), value);
  assert.equal(rateInputDraft(","), ".");
  assert.equal(rateInputDraft(",5"), ".5");
  assert.equal(rateInputDraft("1,"), "1.");
});

test("invalid rate drafts stay visible instead of discarding characters", () => {
  for (const value of ["60,50,1", "60.50.1", ".5.", "..5", "1..", "1,234.56", "1.234,56", "1,000,000", "1 000", "abc,50", "+60,50", "60,50 ", "60\t,50", "1e3", "60.1234567"])
    assert.equal(rateInputDraft(value), value);
});

test("confirmation accepts positive dot or comma decimals and shorthand", () => {
  for (const [value, expected] of [["60,50", "60.50"], ["60.50", "60.50"], [".5", "0.5"], [",5", "0.5"], ["1.", "1"], ["1,", "1"], ["1", "1"], ["1.000000", "1.000000"], ["00060.1", "00060.1"]])
    assert.equal(confirmedRateInput(value), expected);
});

test("confirmation preserves the exact smallest and largest supported rates", () => {
  for (const value of ["0.000001", "0.005000", "999999999999.999999", "999999999999.000001"])
    assert.equal(confirmedRateInput(value), value);
  assert.equal(confirmedRateInput("999999999999,999999"), "999999999999.999999");
});

test("confirmation rejects empty, zero, signed, textual and grouped input", () => {
  for (const value of ["", ".", ",", "0", "0.", "0,", "000.000000", "-1", "+1", "1e3", "NaN", "Infinity", "60abc", "abc,50", "1,234.56", "1.234,56", "1,000,000", "1 000", "60,50,1", "60.50.1", ".5.", "..5", "1.."])
    assert.throws(() => confirmedRateInput(value), /tasa positiva/i, value);
});

test("confirmation rejects spaces and controls without trimming or removing them", () => {
  for (const value of [" 60.50", "60.50 ", "60 .50", "60\t.50", "60.50\n", "60.50\r", "60\u0000.50", "60\u007f.50", "60\u2028.50", "60\u00a0.50"])
    assert.throws(() => confirmedRateInput(value), /tasa positiva/i, value);
});

test("confirmation rejects excess precision, whole digits and total length", () => {
  for (const value of ["0.0000001", "60.1234567", "60,1234567", "1000000000000", "1000000000000.1"])
    assert.throws(() => confirmedRateInput(value), /tasa positiva/i, value);
  for (const value of ["999999999999.9999999", "00000000000000000001", "12345678901234567890"])
    assert.throws(() => confirmedRateInput(value), /máximo de 19 caracteres/i, value);
});
