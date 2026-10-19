import assert from "node:assert/strict";
import test from "node:test";
import { changedRecipientPhone, confirmedCreatedTransfer } from "./createdTransferResponse";
import { StrictApiError } from "./strictApi";
import type { NewRemittanceClient, Transfer } from "./types";

const quote = { date: "2026-10-19", sourceRate: "1.000000", destinationRate: "1.000000" };
const draft: NewRemittanceClient = { name: "Destinatario nuevo sintético", identification: "QA-W1-1", phone: "8095550101", address: "", routeId: "route-1", preferredCurrency: "DOP" };
const body = (extra: Record<string, unknown> = {}) => ({ senderClientId: "cli-1", newRecipientClient: draft, sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 10000, commissionBps: 0, quote, note: "", ...extra });
// The answer of the API for that body, with the phone it froze in the copy of the recipient.
const saved = (phone: string): Transfer => ({
  id: "transfer-1", sequence: 1, envioReference: "ENV00000001", reciboReference: "REC00000001", operatingCode: "A1B2C3", senderClientId: "cli-1", recipientClientId: "cli-new",
  sendingUserId: "desk", registeredBy: "desk", sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 10000, commissionBps: 0, commissionAmount: 0, totalAmount: 10000, receiveAmount: 10000,
  quote, note: "", status: "pending", createdAt: "2026-10-19T12:00:00.000Z", canPay: false, canCancel: true,
  recipientContact: { id: "cli-new", code: "CL-0009", name: draft.name, identification: draft.identification, phone, cellular: "", address: "" },
});

test("the recipient phone of one transfer is new only when its digits change, as the server compares it", () => {
  assert.equal(changedRecipientPhone("809-555-0101", "8095550101"), "", "other separators are the same phone");
  assert.equal(changedRecipientPhone("(809) 555 0101", "809-555-0101"), "");
  assert.equal(changedRecipientPhone(" 809-555-0199 ", "8095550101"), "809-555-0199");
  assert.equal(changedRecipientPhone("809-555-0199", ""), "809-555-0199", "a record without phone takes the written one");
  assert.equal(changedRecipientPhone("", "8095550101"), "");
});

test("a new recipient saved with its own phone is confirmed although the phone was rewritten with other separators", () => {
  assert.equal(confirmedCreatedTransfer(saved("8095550101"), body({ recipientPhone: "809-555-0101" }), "desk").id, "transfer-1");
  assert.equal(confirmedCreatedTransfer(saved("809-555-0199"), body({ recipientPhone: "809-555-0199" }), "desk").id, "transfer-1", "other digits: the copy carries the written phone");
  assert.equal(confirmedCreatedTransfer(saved("809-555-0199"), body({ newRecipientClient: { ...draft, phone: "" }, recipientPhone: "809-555-0199" }), "desk").id, "transfer-1");
});

test("an answer 200 that does not match is final: it names the saved reference and does not ask for a retry", () => {
  for (const [answer, expected] of [[saved("8095550101"), body({ recipientPhone: "809-555-0199" })], [{ ...saved("8095550101"), registeredBy: "otra-cuenta" }, body()]] as const) {
    assert.throws(() => confirmedCreatedTransfer(answer, expected, "desk"), (failure: unknown) => {
      assert.ok(failure instanceof StrictApiError);
      assert.deepEqual([failure.status, failure.uncertain, failure.code], [200, false, "REMITTANCE_CONFIRMATION_INVALID"]);
      assert.match(failure.message, /ENV00000001/); assert.doesNotMatch(failure.message, /reintenta/);
      return true;
    });
  }
  assert.throws(() => confirmedCreatedTransfer(null, body(), "desk"), (failure: unknown) => failure instanceof StrictApiError && !/ENV/.test(failure.message));
});
