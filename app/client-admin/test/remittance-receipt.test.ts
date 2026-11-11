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

test("thermal and telephone receipts never print the generic app name 'Cobros y Pagos' and always place configured company header at the very top (including slogan and RNC when present)", () => {
  const demoIssuerTransfer: Transfer = { ...transfer, senderContact: { ...transfer.senderContact!, identification: "ID-SENDER-999" }, receiptIssuer: { name: "Cobros y Pagos", address: "", phone: "", email: "admin@cyp.local", logoDataUrl: "data:image/png;base64,iVBORw0KGgo=", footerNote: transfer.receiptIssuer!.footerNote } };
  const demoModel = remittanceReceipt(demoIssuerTransfer, undefined, "Operador Interno", "Cajero Ventanilla", true);
  assert.equal(demoModel.issuer.name, "", "generic app name is never treated as the company name");
  const fullHtml = receiptHtml(demoModel, { paper: "80", compact: false, output: "text" });
  for (const text of ["Fecha:", "ENV00000001", "OP-QA-123", "O&#39;Connor &lt;sender&gt;", "CL1", "Destinatario", "8095550102", "Fictional destination", "DOP 990.00", "DOP 1,000.00", "DOP 10.00", "Registrado por:", "Cajero Ventanilla", "Conserve este recibo"]) {
    assert(fullHtml.includes(text), `missing ${text}`);
  }
  for (const forbidden of ["Cobros y Pagos", "REC00000001", "admin@cyp.local", "RNC:", "Tel.:", "Pendiente de entrega", "Operador del envío", "Operador Interno", "Identificación", "ID-SENDER-999", "8095550101", "Fictional &amp; Co", "CL2"]) {
    assert(!fullHtml.includes(forbidden), `unexpected ${forbidden}`);
  }
  assert(fullHtml.indexOf("Fecha:") < fullHtml.indexOf("Remitente"), "Fecha goes at the top of the invoice body");
  assert(fullHtml.indexOf("Pago del remitente") < fullHtml.indexOf("Registrado por:"), "Registrado por goes at the bottom before the footer");
  assert(fullHtml.indexOf("Registrado por:") < fullHtml.indexOf("Conserve este recibo"), "Footer remains last");

  // Reprinting an earlier transfer saved with unconfigured default issuer (even with a logo) picks up newly configured company details, including optional slogan and RNC.
  const configuredIssuer = { name: "Inversiones Demo S.R.L.", slogan: "Servicios confiables al instante", address: "Av. 27 de Febrero, #2131, Local 12, Santiago", phone: "809-555-0222", rnc: "1-30-00100-1", email: "admin@cyp.local", footerNote: transfer.receiptIssuer!.footerNote };
  const upgraded = remittanceReceipt(demoIssuerTransfer, configuredIssuer, "Operador Interno", "Cajero Ventanilla", true);
  assert.equal(upgraded.issuer.logoDataUrl, demoIssuerTransfer.receiptIssuer!.logoDataUrl);
  const upgradedHtml = receiptHtml(upgraded, { paper: "80", compact: false, output: "text" });
  for (const text of ["Inversiones Demo S.R.L.", "Servicios confiables al instante", "Av. 27 de Febrero", "Tel.: 809-555-0222", "RNC: 1-30-00100-1"]) {
    assert(upgradedHtml.includes(text), `missing configured header ${text}`);
  }
  assert(!upgradedHtml.includes("Cobros y Pagos"));
  assert(upgradedHtml.indexOf("Inversiones Demo S.R.L.") < upgradedHtml.indexOf("Servicios confiables al instante"));
  assert(upgradedHtml.indexOf("Servicios confiables al instante") < upgradedHtml.indexOf("Av. 27 de Febrero"));
  assert(upgradedHtml.indexOf("Tel.: 809-555-0222") < upgradedHtml.indexOf("RNC: 1-30-00100-1"));
  assert(upgradedHtml.indexOf("RNC: 1-30-00100-1") < upgradedHtml.indexOf("Fecha:"));

  const model = remittanceReceipt({ ...transfer, senderContact: { ...transfer.senderContact!, identification: "ID-SENDER-999" } }, undefined, "Operador", "Cajero", true);
  const before = JSON.stringify(model);
  for (const paper of ["76", "80", "58"] as const) {
    const html = receiptHtml(model, { paper, compact: true });
    assert(html.includes(`width:${paper === "80" ? 66 : paper === "58" ? 45 : 63}mm`));
    const plainHtml = receiptHtml(model, { paper, compact: true, output: "text" });
    assert(plainHtml.includes(`width:${paper === "80" ? 72 : paper === "58" ? 48 : 70}mm`));
    for (const text of ["Empresa de prueba", "Fictional office", "Tel.: 8095550100", "Fecha", "ENV00000001", "O&#39;Connor &lt;sender&gt;", "Destinatario", "8095550102", "DOP 990.00", "DOP 1,000.00", "DOP 10.00", "Registrado por", "Cajero", "Conserve este recibo"]) assert(html.includes(text), text);
    for (const text of ["REC00000001", "RNC:", "office@example.test", "Pendiente de entrega", "Operador del envío", "Fictional &amp; Co", "Fictional destination", "Código de operación", "CL1", "CL2", "Identificación", "ID-SENDER-999", "8095550101", "Comisión del gestor", "Prueba &amp; validación"]) assert(!html.includes(text), text);
    const body = html.slice(html.indexOf("<body>"));
    assert(body.indexOf("Empresa de prueba") < body.indexOf("ENV00000001"), "configured company header goes at the very top");
  }
  assert.equal(JSON.stringify(model), before);
  assert(!receiptHtml(model, { paper: "auto", compact: false }).includes("width:70mm"));
});
test("credit card surcharge is summed into Cargo del envío and omitted as a separate line across all receipt types", () => {
  const cardTransfer: Transfer = {
    ...transfer,
    amount: 2000,
    commissionAmount: 200,
    totalAmount: 2200,
    receiveAmount: 2000,
    payment: { version: 2, method: "card", cardType: "credit", tenderedAmount: 2420, changeAmount: 0, cardSurchargeBps: 1000, cardSurchargeAmount: 220, reference: "22222222222", last4: "4444", confirmedBy: "office", confirmedAt: "2026-10-21T16:00:00.000Z" },
  };
  for (const printed of [false, true]) {
    const receipt = remittanceReceipt(cardTransfer, undefined, "Operador", "Administración", printed);
    const amountRows = receipt.sections.find((s) => s.title === "Importes del envío")!.rows;
    assert.deepEqual(amountRows.find(([label]) => label === "Cargo del envío"), ["Cargo del envío", "DOP 4.20"]);
    assert.deepEqual(amountRows.find(([label]) => label === "Total pagado por el remitente"), ["Total pagado por el remitente", "DOP 24.20"]);
    assert.equal(amountRows.some(([label]) => label === "Recargo tarjeta de crédito" || label === "Cargo adicional por tarjeta"), false);
    for (const output of ["text", "graphics"] as const) {
      for (const compact of [false, true]) {
        const html = receiptHtml(receipt, { paper: "80", compact, output });
        assert(html.includes("DOP 4.20"), `expected summed Cargo del envío in printed=${printed} output=${output} compact=${compact}`);
        assert(html.includes("DOP 24.20"));
        assert(!html.includes("Recargo tarjeta de crédito"));
        assert(!html.includes("Cargo adicional por tarjeta"));
      }
    }
  }
});
test("receipt confirmation rejects mismatched payment even when all other transfer fields match", () => {
  const expected = { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 90000, commissionBps: 1000, senderClientId: "sender", recipientClientId: "recipient", quote: transfer.quote,
    payment: { method: "cash", tenderedAmount: 100000 } };
  assert.equal(confirmedCreatedTransfer(transfer, expected, "office").id, transfer.id);
  assert.throws(() => confirmedCreatedTransfer({ ...transfer, payment: { ...transfer.payment!, changeAmount: 2000 } }, expected, "office"), /no coincide/);
  assert.throws(() => confirmedCreatedTransfer({ ...transfer, payment: undefined }, expected, "office"), /no coincide/);
  assert.throws(() => confirmedCreatedTransfer({ ...transfer, quote: { ...transfer.quote, sourceRateKind: "operative" } }, expected, "office"), /no coincide/);
});
