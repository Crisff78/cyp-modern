import assert from "node:assert/strict";
import test from "node:test";
import { isPhoneDraft, isRemittanceDocumentDraft, isTextDraft, validatePhone, validateRemittanceClientName, validateRemittanceDocument } from "../../shared/inputRules";
import { isMoneyDraft } from "../../shared/remittances/moneyInput";
import { decimalCents } from "../../shared/remittances/output";
import { isPaymentTextDraft, paymentAmounts } from "../../shared/remittances/payment.mjs";

test("all remittance money fields have the same exact decimal and safe-cent boundaries", () => {
  for (const value of ["", ".", "0", "0.", "0.00", "0001.25", "90071992547409.91"]) assert.equal(isMoneyDraft(value), true, value);
  for (const value of ["1e3", "0x10", "-2", "+2", "1,25", "1 000", "2.001", "１２", "1\n", " 1", "1\u200b", "90071992547409.92", "99999999999999", "1".repeat(18), "0".repeat(18)]) assert.equal(isMoneyDraft(value), false, value);
  assert.equal(decimalCents("90071992547409.91"), Number.MAX_SAFE_INTEGER);
  assert.throws(() => decimalCents("90071992547409.92"));
});

test("payment references keep alphanumeric banking data but reject controls and invisible separators", () => {
  for (const value of ["", "0001-REF/2026.10", "Banco O'Connor & Hijos #2", "Ref: (A)_B+2", "a".repeat(160)]) assert.equal(isPaymentTextDraft(value), true, value);
  for (const value of ["REF\n001", "REF\t001", "REF\u2028001", "REF\u2029001", "REF\u200b001", "REF\u202e001", "a".repeat(161)]) {
    assert.equal(isPaymentTextDraft(value), false, value);
    assert.throws(() => paymentAmounts(100, { method: "transfer", reference: value, verified: true }));
  }
});

test("remittance phone drafts restrict typing while final validation requires a complete phone", () => {
  for (const value of ["", "+", "(", "+1 (809) 555-0101", "  +509 4123 4567  ", "123456789012345"]) assert.equal(isPhoneDraft(value), true, value);
  for (const value of ["abc", "12345678 ext 2", "809/555/0101", "+1.809.555.0101", "12+345678", "++12345678", "1234567890123456", "1234\t5678", "１2345678", "0".repeat(41)]) assert.equal(isPhoneDraft(value), false, value);
  for (const value of ["+", "1234567", "()--"]) assert.throws(() => validatePhone(value));
  validatePhone("+1 (809) 555-0101");
});

test("document input keeps leading zeroes and international letters without accepting arbitrary symbols", () => {
  for (const value of ["", "001-0001234-5", "AB 001234", "PAS/001.23", "Ñ-001"]) assert.equal(isRemittanceDocumentDraft(value), true, value);
  for (const value of ["A;SELECT 1", "A<script>", "A'001", "A\n001", "A\u0000001", "1".repeat(81)]) assert.equal(isRemittanceDocumentDraft(value), false, value);
  for (const value of ["", " -- / . "]) assert.throws(() => validateRemittanceDocument(value));
  validateRemittanceDocument("001-0001234-5");
});

test("client names and text preserve legitimate punctuation, Unicode and multiline notes", () => {
  for (const name of ["José O'Connor & Hijos #2", "Ana María", "Bicentenario 2000", "李明", "Cafe\u0301"]) validateRemittanceClientName(name);
  for (const value of ["", "12345", "!?---", "Ana\u0000María"]) assert.throws(() => validateRemittanceClientName(value));
  assert.equal(isTextDraft("Av. Núñez #12 / local (B)", 240), true);
  assert.equal(isTextDraft("Nota: O'Connor; saldo < 100\nSegunda línea\tDetalle", 500, true), true);
  assert.equal(isTextDraft("Nota\u0000oculta", 500, true), false);
  assert.equal(isTextDraft("Primera\nSegunda", 160), false);
  assert.equal(isTextDraft("a".repeat(501), 500, true), false);
});
