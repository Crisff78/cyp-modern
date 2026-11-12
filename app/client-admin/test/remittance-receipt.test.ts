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

test("thermal and telephone receipts never print the generic app name 'Cobros y Pagos' and render the exact customer receipt format", () => {
  const demoIssuerTransfer: Transfer = { ...transfer, senderContact: { ...transfer.senderContact!, identification: "ID-SENDER-999" }, receiptIssuer: { name: "Cobros y Pagos", address: "", phone: "", email: "admin@cyp.local", logoDataUrl: "data:image/png;base64,iVBORw0KGgo=", footerNote: transfer.receiptIssuer!.footerNote } };
  const demoModel = remittanceReceipt(demoIssuerTransfer, undefined, "Operador Interno", "Cajero Ventanilla", true);
  assert.equal(demoModel.issuer.name, "", "generic app name is never treated as the company name");
  const fullHtml = receiptHtml(demoModel, { paper: "80", compact: false, output: "text" });
  for (const text of ["RECIBO DE ENVIO", "Fecha: 21/10/26 12:00 p.m.", "Envío: ENV00000001", "Cód. Operación: OP-QA-123", "Remitente: O&#39;Connor &lt;sender&gt;", "Código del Cliente: CL1", "Destinatario: Destinatario", "Teléfono: 8095550102", "Dirección: Fictional destination", "Importes del envío", "Monto a enviar: DOP 900.00", "DOP 990.00", "Recibe el destinatario: DOP 900.00", "Forma pago del remitente: Efectivo", "Recibido por: ________________________", "Registrado por: Cajero Ventanilla", "Nota: Conserve este recibo."]) {
    assert(fullHtml.includes(text), `missing ${text}`);
  }
  for (const forbidden of ["Cobros y Pagos", "REC00000001", "admin@cyp.local", "RNC:", "Tel.", "Pendiente de entrega", "Operador del envío", "Operador Interno", "Identificación", "ID-SENDER-999", "8095550101", "Fictional &amp; Co", "CL2", "Cargo del envío", "Dinero recibido", "Devuelta", "Nombre:", "----------------------------------------"]) {
    assert(!fullHtml.includes(forbidden), `unexpected ${forbidden}`);
  }
  assert(fullHtml.indexOf("RECIBO DE ENVIO") < fullHtml.indexOf("Fecha:"), "RECIBO DE ENVIO heading precedes Fecha");
  assert(fullHtml.indexOf("Fecha:") < fullHtml.indexOf("Remitente:"), "Fecha goes at the top of the invoice body");
  assert(fullHtml.indexOf("Forma pago del remitente:") < fullHtml.indexOf("Recibido por:"), "Recibido por signature line precedes Registrado por");
  assert(fullHtml.indexOf("Recibido por:") < fullHtml.indexOf("Registrado por:"), "Registrado por goes at the bottom before Nota");
  assert(fullHtml.indexOf("Registrado por:") < fullHtml.indexOf("Nota: Conserve este recibo"), "Nota footer remains last");

  // Reprinting an earlier transfer saved with unconfigured default issuer (even with a logo) picks up newly configured company details, combining Tel. and RNC on one line.
  const configuredIssuer = { name: "Inversiones Demo S.R.L.", slogan: "Servicios confiables al instante", address: "Av. 27 de Febrero, #2131, Local 12, Santiago", phone: "809-555-0222", rnc: "1-30-00100-1", email: "admin@cyp.local", footerNote: transfer.receiptIssuer!.footerNote };
  const upgraded = remittanceReceipt(demoIssuerTransfer, configuredIssuer, "Operador Interno", "Cajero Ventanilla", true);
  assert.equal(upgraded.issuer.logoDataUrl, demoIssuerTransfer.receiptIssuer!.logoDataUrl);
  const upgradedHtml = receiptHtml(upgraded, { paper: "80", compact: false, output: "text" });
  for (const text of ["Inversiones Demo S.R.L.", "Servicios confiables al instante", "Av. 27 de Febrero", "Tel. 809-555-0222 / RNC: 1-30-00100-1", "----------------------------------------", "RECIBO DE ENVIO"]) {
    assert(upgradedHtml.includes(text), `missing configured header ${text}`);
  }
  assert.equal((upgradedHtml.match(/-{40}/g) ?? []).length, 1, "only the dashed header line is drawn; internal divider lines are removed");
  assert(!upgradedHtml.includes("Cobros y Pagos"));
  assert(upgradedHtml.indexOf("Inversiones Demo S.R.L.") < upgradedHtml.indexOf("Servicios confiables al instante"));
  assert(upgradedHtml.indexOf("Servicios confiables al instante") < upgradedHtml.indexOf("Av. 27 de Febrero"));
  assert(upgradedHtml.indexOf("Tel. 809-555-0222 / RNC: 1-30-00100-1") < upgradedHtml.indexOf("----------------------------------------"));
  assert(upgradedHtml.indexOf("----------------------------------------") < upgradedHtml.indexOf("RECIBO DE ENVIO"));
  assert(upgradedHtml.indexOf("RECIBO DE ENVIO") < upgradedHtml.indexOf("Fecha:"));

  const model = remittanceReceipt({ ...transfer, senderContact: { ...transfer.senderContact!, identification: "ID-SENDER-999" } }, undefined, "Operador", "Cajero", true);
  const before = JSON.stringify(model);
  for (const paper of ["76", "80", "58"] as const) {
    const html = receiptHtml(model, { paper, compact: true });
    assert(html.includes(`width:${paper === "80" ? 66 : paper === "58" ? 45 : 63}mm`));
    const plainHtml = receiptHtml(model, { paper, compact: true, output: "text" });
    assert(plainHtml.includes(`width:${paper === "80" ? 72 : paper === "58" ? 48 : 70}mm`));
    for (const text of ["Empresa de prueba", "Fictional office", "Tel. 8095550100", "RECIBO DE ENVIO", "Fecha", "ENV00000001", "Remitente", "O&#39;Connor &lt;sender&gt;", "Destinatario", "8095550102", "DOP 990.00", "Forma pago del remitente", "Efectivo", "Registrado por", "Cajero", "<strong>Nota:</strong>", "Conserve este recibo"]) assert(html.includes(text), text);
    for (const text of ["REC00000001", "RNC:", "office@example.test", "Pendiente de entrega", "Operador del envío", "Fictional &amp; Co", "Fictional destination", "Cód. Operación", "CL1", "CL2", "Identificación", "ID-SENDER-999", "8095550101", "Comisión del gestor", "Prueba &amp; validación", "Recibido por", "Cargo del envío"]) assert(!html.includes(text), text);
    const body = html.slice(html.indexOf("<body>"));
    assert(body.indexOf("Empresa de prueba") < body.indexOf("RECIBO DE ENVIO"), "configured company header goes at the very top");
    assert(body.indexOf("RECIBO DE ENVIO") < body.indexOf("ENV00000001"), "RECIBO DE ENVIO sits right below the header");
  }
  assert.equal(JSON.stringify(model), before);
  assert(!receiptHtml(model, { paper: "auto", compact: false }).includes("width:70mm"));
});
test("credit card surcharge is summed into Cargo del envío on consultation view and reflected in Total pagado with TC payment code on printed receipts", () => {
  const cardTransfer: Transfer = {
    ...transfer,
    amount: 2000,
    commissionAmount: 200,
    totalAmount: 2200,
    receiveAmount: 2000,
    payment: { version: 2, method: "card", cardType: "credit", tenderedAmount: 2420, changeAmount: 0, cardSurchargeBps: 1000, cardSurchargeAmount: 220, reference: "22222222222", last4: "4444", confirmedBy: "office", confirmedAt: "2026-10-21T16:00:00.000Z" },
  };
  const screenReceipt = remittanceReceipt(cardTransfer, undefined, "Operador", "Administración", false);
  const screenAmounts = screenReceipt.sections.find((s) => s.title === "Importes del envío")!.rows;
  assert.deepEqual(screenAmounts.find(([label]) => label === "Cargo del envío"), ["Cargo del envío", "DOP 4.20"]);
  assert.deepEqual(screenAmounts.find(([label]) => label === "Total pagado por el remitente"), ["Total pagado por el remitente", "DOP 24.20"]);
  assert.equal(screenAmounts.some(([label]) => label === "Recargo tarjeta de crédito" || label === "Cargo adicional por tarjeta"), false);

  const printedReceipt = remittanceReceipt(cardTransfer, undefined, "Operador", "Administración", true);
  const printedAmounts = printedReceipt.sections.find((s) => s.title === "Importes del envío")!.rows;
  assert.deepEqual(printedAmounts, [
    ["Monto a enviar", "DOP 20.00"],
    ["Total pagado por el remitente", "DOP 24.20"],
    ["Recibe el destinatario", "DOP 20.00"],
  ]);
  for (const output of ["text", "graphics"] as const) {
    for (const compact of [false, true]) {
      const html = receiptHtml(printedReceipt, { paper: "80", compact, output });
      assert(html.includes("DOP 20.00"));
      assert(html.includes("DOP 24.20"));
      assert(html.includes("Forma pago del remitente"));
      assert(/\bTC\b/.test(html), `expected TC payment code in output=${output} compact=${compact}`);
      if (!compact) assert(html.includes("Recibido por"));
      for (const forbidden of ["Cargo del envío", "Recargo tarjeta de crédito", "Cargo adicional por tarjeta", "4444", "22222222222"]) {
        assert(!html.includes(forbidden), `unexpected ${forbidden} in output=${output} compact=${compact}`);
      }
    }
  }
});

test("A4 and Carta printed receipts adapt all customer receipt data into the full-sheet voucher layout without altering thermal rolls", () => {
  const sheetTransfer: Transfer = {
    ...transfer,
    envioReference: "ENV00000064",
    createdAt: "2026-09-01T15:58:10.000Z",
    sourceCurrency: "USD",
    destinationCurrency: "DOP",
    amount: 100000,
    commissionBps: 500,
    commissionAmount: 5000,
    totalAmount: 105000,
    receiveAmount: 6400000,
    quote: { date: "2026-09-01", sourceRate: "64.000000", destinationRate: "1.000000", sourceRateKind: "purchase", destinationRateKind: "base" },
    recipientContact: { id: "recipient", code: "CL2", name: "Colmado La Esquina", phone: "8095550100", cellular: "", address: "Calle El Conde 24" },
    receiptIssuer: {
      name: "Inversiones Demo S.R.L.",
      slogan: "Tu aliado en cobros, pagos y envíos",
      address: "Av. 27 de Febrero #2131, Local 12, Santiago",
      phone: "Tel.: 809-555-0222",
      rnc: "1-30-00100-1",
      email: "admin@cyp.local",
      logoDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      footerNote: "Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.",
    },
    payment: { version: 2, method: "card", cardType: "credit", tenderedAmount: 113400, changeAmount: 0, cardSurchargeBps: 800, cardSurchargeAmount: 8400, reference: "999999", last4: "4444", confirmedBy: "office", confirmedAt: "2026-09-01T15:58:10.000Z" },
  };
  const model = remittanceReceipt(sheetTransfer, undefined, "Operador", "Administración", true);
  for (const paper of ["a4", "letter"] as const) {
    for (const output of ["graphics", "text"] as const) {
      for (const compact of [false, true]) {
        const html = receiptHtml(model, { paper, compact, output });
        assert(html.includes(paper === "a4" ? "size:210mm 297mm" : "size:215.9mm 279.4mm"));
        if (output === "graphics") assert(html.includes("Inversiones Demo S.R.L."));
        else assert(html.includes("I N V E R S I O N E S   D E M O   S . R . L ."));
        for (const required of [
          "Tu aliado en cobros, pagos y envíos",
          "Av. 27 de Febrero #2131, Local 12, Santiago",
          "Tel. 809-555-0222 / RNC: 1-30-00100-1",
          "RECIBO DE ENVIO",
          "Envío #: ENV00000064",
          "Fecha  : 01-09-2026 |11:58:10",
          "Remitente: O&#39;Connor &lt;sender&gt;",
          "DESTINATARIO: Colmado La Esquina",
          "TELÉFONO: 8095550100",
          "MONTO A ENVIAR: USD 1,000.00",
          "Total pagado por el remitente: USD 1,134.00",
          "RECIBE EN DOP:",
          "64,000.00",
          "Forma pago del remitente: TC",
          "Registrado por: Administración",
          "Nota: Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.",
        ]) {
          assert(html.includes(required), `missing "${required}" in paper=${paper} output=${output} compact=${compact}`);
        }
        if (!compact) {
          for (const detail of ["Cód. Operación: OP-QA-123", "Código del Cliente: CL1", "DIRECCIÓN: Calle El Conde 24", "Recibido por:"]) {
            assert(html.includes(detail), `missing "${detail}" in full mode paper=${paper} output=${output}`);
          }
        } else {
          for (const omitted of ["Cód. Operación:", "Código del Cliente:", "DIRECCIÓN:", "Recibido por:"]) {
            assert(!html.includes(omitted), `unexpected "${omitted}" in compact mode paper=${paper} output=${output}`);
          }
        }
        for (const forbidden of [
          "<img",
          "admin@cyp.local",
          "REC00000001",
          "Operador Interno",
          "Cargo del envío",
          "Recargo tarjeta de crédito",
          "4444",
          "999999",
          "Es importante que revise su recibo",
          "PARA RECLAMACIONES FAVOR COMUNICARSE",
        ]) {
          assert(!html.includes(forbidden), `unexpected "${forbidden}" in paper=${paper} output=${output} compact=${compact}`);
        }
        assert(html.indexOf("RECIBO DE ENVIO") < html.indexOf("Envío #: ENV00000064"));
        assert(html.indexOf("Envío #: ENV00000064") < html.indexOf("Fecha  : 01-09-2026 |11:58:10"));
        assert(html.indexOf("Fecha  : 01-09-2026 |11:58:10") < html.indexOf("Remitente:"));
        assert(html.indexOf("Remitente:") < html.indexOf("DESTINATARIO: Colmado La Esquina"));
        assert(html.indexOf("DESTINATARIO: Colmado La Esquina") < html.indexOf("TELÉFONO: 8095550100"));
        assert(html.indexOf("TELÉFONO: 8095550100") < html.indexOf("MONTO A ENVIAR: USD 1,000.00"));
        assert(html.indexOf("MONTO A ENVIAR: USD 1,000.00") < html.indexOf("Total pagado por el remitente: USD 1,134.00"));
        assert(html.indexOf("Total pagado por el remitente: USD 1,134.00") < html.indexOf("RECIBE EN DOP:"));
        assert(html.indexOf("64,000.00") < html.indexOf("Forma pago del remitente: TC"));
        assert(html.indexOf("Forma pago del remitente: TC") < html.indexOf("Registrado por: Administración"));
        assert(html.indexOf("Registrado por: Administración") < html.indexOf("Nota: Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío."));
      }
    }
  }

  // Unconfigured app name is omitted and cancellation banner is included when transfer is cancelled.
  const cancelledNoPhone = remittanceReceipt({
    ...sheetTransfer,
    status: "cancelled",
    cancelledAt: "2026-09-01T17:00:00.000Z",
    cancelReason: "Error en teléfono",
    receiptIssuer: { ...sheetTransfer.receiptIssuer!, name: "Cobros y Pagos", phone: "" },
  }, undefined, "Operador", "Administración", true);
  const cancelledHtml = receiptHtml(cancelledNoPhone, { paper: "a4", compact: false, output: "graphics" });
  assert(!cancelledHtml.includes("Cobros y Pagos"));
  assert(cancelledHtml.includes("CANCELADO:"));
  assert(cancelledHtml.includes("Error en teléfono"));
  assert(cancelledHtml.includes("Nota: Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío."));
  assert(!cancelledHtml.includes("PARA RECLAMACIONES FAVOR COMUNICARSE"));

  // Thermal 80mm continues rendering the POS80 customer receipt with logo, RECIBO DE ENVIO and signature line.
  const thermalHtml = receiptHtml(model, { paper: "80", compact: false, output: "graphics" });
  assert(thermalHtml.includes("<img"));
  assert(thermalHtml.includes("RECIBO DE ENVIO"));
  assert(thermalHtml.includes("Recibido por"));
});
test("receipt confirmation rejects mismatched payment even when all other transfer fields match", () => {
  const expected = { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 90000, commissionBps: 1000, senderClientId: "sender", recipientClientId: "recipient", quote: transfer.quote,
    payment: { method: "cash", tenderedAmount: 100000 } };
  assert.equal(confirmedCreatedTransfer(transfer, expected, "office").id, transfer.id);
  assert.throws(() => confirmedCreatedTransfer({ ...transfer, payment: { ...transfer.payment!, changeAmount: 2000 } }, expected, "office"), /no coincide/);
  assert.throws(() => confirmedCreatedTransfer({ ...transfer, payment: undefined }, expected, "office"), /no coincide/);
  assert.throws(() => confirmedCreatedTransfer({ ...transfer, quote: { ...transfer.quote, sourceRateKind: "operative" } }, expected, "office"), /no coincide/);
});
