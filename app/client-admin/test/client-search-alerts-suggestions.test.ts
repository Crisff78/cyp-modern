import test from "node:test";
import assert from "node:assert/strict";
import { matchesClientSearch, copyPhoneIntoEmptyFields, clientCodeFromPhone } from "../src/clientSearch.js";
import { unconfirmedCollectionBalances, recentMovementReceipts } from "../src/collectionAlerts.js";
import type { Movement } from "../src/types.js";

test("client search accepts notes, exact codes, accents and formatted international phones", () => {
  const client = { code: "HT-42", name: "José", phone: "+509 (41) 23-4567", cellular: "", note: "Entrega en Haití" };
  for (const query of ["ht-42", "jose", "haiti", "+509 41 23", "50941234567"]) assert.equal(matchesClientSearch(client, query), true);
  assert.equal(matchesClientSearch(client, "missing"), false);
});
test("a shared phone finds both distinct clients without changing codes or identity", () => {
  const clients = Object.freeze([Object.freeze({ code: "A", name: "Primero", phone: "50912345678" }), Object.freeze({ code: "B", name: "Segundo", phone: "50912345678" })]);
  assert.deepEqual(clients.filter((client) => matchesClientSearch(client, "+509 12345678")).map((client) => client.code), ["A", "B"]);
});
test("client lookup normalizes a Haiti phone stored only in a note without joining independent numbers", () => {
  const client = Object.freeze({ id: "synthetic-client", code: "MANUAL-01", phone: "", cellular: "", note: "Contacto Haití: +509 (41) 23-4567. Entrega mañana." });
  for (const query of ["50941234567", "+509 41 23 4567", "41234567", "haiti"])
    assert.equal(matchesClientSearch(client, query), true, query);
  for (const note of ["12345678 y 87654321", "12345678, 87654321", "12345678; 87654321", "12345678 / 87654321", "12345678\n87654321", "12345678 87654321"])
    assert.equal(matchesClientSearch({ ...client, note }, "56788765"), false, note);
  const twoPhones = { ...client, note: "+509 41234567 / +509 87654321" };
  assert.equal(matchesClientSearch(twoPhones, "50941234567"), true);
  assert.equal(matchesClientSearch(twoPhones, "50987654321"), true);
  assert.equal(matchesClientSearch({ ...client, note: "1234567 - 7654321" }, "45677654"), false);
  assert.equal(client.id, "synthetic-client");
  assert.equal(client.code, "MANUAL-01");
});
test("an explicit phone code accepts international formatting and rejects incomplete or non-phone input", () => {
  assert.equal(clientCodeFromPhone(" +509 (41) 23-4567 "), "+50941234567");
  assert.equal(clientCodeFromPhone("(809) 555-1234"), "8095551234");
  assert.equal(clientCodeFromPhone("41234567"), "41234567");
  for (const phone of ["", "123456", "1234567890123456", "tel: 41234567", "+509+41234567", "41234567\n87654321", "HT-42"])
    assert.throws(() => clientCodeFromPhone(phone));
  const draft = Object.freeze({ id: "separate-real-id", code: "MANUAL-01", identification: "SYN-DOC", phone: "+509 41234567", cellular: "", note: "" });
  const selectedCode = clientCodeFromPhone(draft.phone);
  assert.equal(selectedCode, "+50941234567");
  assert.equal(draft.id, "separate-real-id");
  assert.equal(draft.identification, "SYN-DOC");
  assert.equal(draft.code, "MANUAL-01");
});
test("explicit phone copy completes only empty fields and preserves entered notes exactly", () => {
  const original = Object.freeze({ phone: "+509 12345678", cellular: "809-123", note: "  Mantener nota  ", preferredCurrency: "EUR" });
  assert.deepEqual(copyPhoneIntoEmptyFields(original), original);
  assert.deepEqual(copyPhoneIntoEmptyFields({ ...original, cellular: "", note: "" }), { ...original, cellular: original.phone, note: original.phone });
  assert.deepEqual(copyPhoneIntoEmptyFields({ ...original, phone: "" }), { ...original, phone: "" });
});
const movement = (id: string, type: Movement["type"], amount: number, extra: Partial<Movement> = {}): Movement => ({ id, type, amount, collectorId: "collector-a", currency: "DOP", createdAt: "2026-10-05T05:00:00Z", ...extra });
test("collection alert excludes advances/payments and awaits actual deposit acceptance", () => {
  const rows = [movement("c", "collection", 1000), movement("d", "deposit", 300, { acceptedAt: "2026-10-05T06:00:00Z" }), movement("pending", "deposit", 700), movement("adv", "office_delivery", 5000), movement("pay", "payout", 5000)];
  assert.deepEqual(unconfirmedCollectionBalances(rows), [{ collectorId: "collector-a", currency: "DOP", amount: 700n }]);
  assert.deepEqual(unconfirmedCollectionBalances(rows.map((row) => row.id === "pending" ? { ...row, acceptedAt: "2026-10-05T06:00:01Z" } : row)), []);
});
test("alert balances keep collectors and currencies separate and ignore cancellations", () => {
  const rows = [movement("dop", "collection", 100), movement("usd", "collection", 300, { currency: "USD" }), movement("other", "collection", 500, { collectorId: "collector-b", currency: "EUR" }), movement("cancel", "collection", 1000, { cancelledAt: "2026-10-05T06:00:00Z" }), movement("deposit-cancel", "deposit", 100, { acceptedAt: "2026-10-05T06:00:00Z", cancelledAt: "2026-10-05T07:00:00Z" })];
  assert.deepEqual(unconfirmedCollectionBalances(rows).map((row) => [row.collectorId, row.currency, row.amount]), [["collector-a", "DOP", 100n], ["collector-a", "USD", 300n], ["collector-b", "EUR", 500n]]);
});
test("alert aggregation keeps exact cents beyond the safe aggregate number range", () => {
  assert.equal(unconfirmedCollectionBalances([movement("a", "collection", Number.MAX_SAFE_INTEGER), movement("b", "collection", Number.MAX_SAFE_INTEGER)])[0].amount, 18014398509481982n);
  assert.throws(() => unconfirmedCollectionBalances([movement("bad", "collection", Number.MAX_SAFE_INTEGER + 1)]));
});
test("latest receipts require confirmed token, ignore revoked/invalid rows and never mutate input", () => {
  const rows = Object.freeze([movement("old", "collection", 100, { receiptToken: "receipt-old" }), movement("new", "payout", 100, { receiptToken: "receipt-new", createdAt: "2026-10-05T07:00:00Z" }), movement("revoked", "collection", 100, { receiptToken: "receipt-revoked", receiptRevoked: true }), movement("invalid", "collection", 100, { receiptToken: "receipt-invalid", createdAt: "not-a-time" }), movement("no-token", "collection", 100)]);
  assert.deepEqual(recentMovementReceipts(rows).map((row) => row.id), ["new", "old"]);
  assert.deepEqual(rows.map((row) => row.id), ["old", "new", "revoked", "invalid", "no-token"]);
});
