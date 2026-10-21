import test from "node:test";
import assert from "node:assert/strict";
import { remittanceReceipt, receiptHtml } from "../../shared/remittances/receipt";
import type { Transfer } from "../../shared/remittances/types";
import { confirmedCreatedTransfer } from "../../shared/remittances/createdTransferResponse";

const transfer: Transfer = {
  id: "qa-send", sequence: 1, envioReference: "ENV00000001", reciboReference: "REC00000001", operatingCode: "OP-QA-123",
  senderClientId: "sender", recipientClientId: "recipient", sendingUserId: "office", registeredBy: "office", status: "pending", canPay: true, canCancel: true,
  createdAt: "2026-10-21T16:00:00.000Z", note: "Prueba & validación", sourceCurrency: "DOP", destinationCurrency: "DOP",
  amount: 90000, commissionBps: 1000, commissionAmount: 9000, totalAmount: 99000, receiveAmount: 90000,
  quote: { date: "2026-10-21", sourceRate: "1.000000", destinationRate: "1.000000", sourceRateKind: "base", destinationRateKind: "base" },
  senderContact: { id: "sender", code: "CL1", name: "O'Connor <sender>", identification: "QA-1", phone: "8095550101", cellular: "", address: "Fictional & Co" },
  recipientContact: { id: "recipient", code: "CL2", name: "Destinatario", phone: "8095550102", cellular: "", address: "Fictional destination" },
  receiptIssuer: { name: "Empresa de prueba", address: "Fictional office", phone: "8095550100", email: "office@example.test", footerNote: "Conserve este recibo.\nPresente su referencia para consultas." },
  payment: { version: 1, method: "cash", tenderedAmount: 100000, changeAmount: 1000, confirmedBy: "office", confirmedAt: "2026-10-21T16:00:00.000Z" },
  commissionAllocation: { version: 1, currency: "DOP", policyRevision: "qa", managerCommissionBps: 500, baseAmount: 90000, transactionAmount: 9000, companyAmount: 4500, managerAmount: 4500 },
};
test("customer receipt contains identifiers first, frozen parties, rates, payment, tender/change and company footer without internal commissions", () => {
  const model = remittanceReceipt(transfer, { ...transfer.receiptIssuer!, name: "Changed later" }, "Operador"), html = receiptHtml(model);
  assert.equal(model.issuer.name, "Empresa de prueba"); assert.ok(html.indexOf("REC00000001") < html.indexOf("Empresa de prueba"));
  for (const text of ["ENV00000001", "OP-QA-123", "O&#39;Connor &lt;sender&gt;", "QA-1", "8095550101", "Total pagado", "DOP 990.00", "DOP 1,000.00", "Devuelta", "DOP 10.00", "Efectivo", "1.000000", "Conserve este recibo"]) assert.ok(html.includes(text), text);
  for (const forbidden of ["Comisión", "comisión", "companyAmount", "managerAmount", "commissionAllocation"]) assert.equal(html.includes(forbidden), false, forbidden);
  assert.equal(html.includes("<sender>"), false); assert.equal(html.includes("<script"), false);
});
test("bank receipt shows its method/reference, no cash change and no card credentials; legacy method remains unknown", () => {
  for (const method of ["card", "transfer", "deposit"] as const) {
    const html = receiptHtml(remittanceReceipt({ ...transfer, payment: { ...transfer.payment!, method, tenderedAmount: 99000, changeAmount: 0, reference: "QA-BANK-123", bank: "Fictional bank" } }));
    assert.ok(html.includes("QA-BANK-123")); assert.ok(html.includes("Fictional bank")); assert.equal(html.includes("Devuelta"), false);
  }
  const { payment: _, receiptIssuer: _issuer, ...legacy } = transfer;
  const html = receiptHtml(remittanceReceipt(legacy));
  assert.ok(html.includes("No registrada en esta operación histórica")); assert.equal(html.includes("Dinero recibido"), false);
});
test("receipt confirmation rejects mismatched payment even when all other transfer fields match", () => {
  const expected = { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 90000, commissionBps: 1000, senderClientId: "sender", recipientClientId: "recipient", quote: transfer.quote,
    payment: { method: "cash", tenderedAmount: 100000 } };
  assert.equal(confirmedCreatedTransfer(transfer, expected, "office").id, transfer.id);
  assert.throws(() => confirmedCreatedTransfer({ ...transfer, payment: { ...transfer.payment!, changeAmount: 2000 } }, expected, "office"), /no coincide/);
  assert.throws(() => confirmedCreatedTransfer({ ...transfer, payment: undefined }, expected, "office"), /no coincide/);
  assert.throws(() => confirmedCreatedTransfer({ ...transfer, quote: { ...transfer.quote, sourceRateKind: "operative" } }, expected, "office"), /no coincide/);
});
