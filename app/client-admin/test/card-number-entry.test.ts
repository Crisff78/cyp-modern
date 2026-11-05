import test from "node:test";
import assert from "node:assert/strict";
import { cardNumberCaret, cardNumberDigits, formatCardNumber, maskedCardNumber } from "../../shared/remittances/cardNumberEntry";

test("entry accepts sixteen ASCII digits with four-digit grouping and never coerces hostile text", () => {
  for (const value of ["", "4", "4111111111110042", "4111 1111 1111 0042"]) assert.notEqual(cardNumberDigits(value), undefined);
  for (const value of ["41111111111100421", "4111 1111 1111 00421", "4111-1111-1111-0042", "4111a1111", "4111\n1111", "４１１１", "4111\u200b1111", "+4111", "4e15", "x".repeat(1000)]) assert.equal(cardNumberDigits(value), undefined);
  assert.equal(formatCardNumber("4111111111110042"), "4111 1111 1111 0042");
  assert.equal(formatCardNumber("41111"), "4111 1");
  assert.equal(cardNumberCaret("4111 1111", 5), 6);
  assert.equal(maskedCardNumber("0042"), "•••• •••• •••• 0042");
  assert.equal(maskedCardNumber("4111111111110042"), "", "a restored value can never expose an entire number");
});
