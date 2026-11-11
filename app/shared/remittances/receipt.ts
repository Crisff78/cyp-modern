import type { ReceiptIssuer } from "./payment.mjs";
import { paymentLabel, totalPaidForTransfer } from "./payment.mjs";
import type { Transfer } from "./types";
import { payoutOf } from "./types";
import { escapeHtml, formatDate, formatMoney, type OutputSection } from "./output";
import { formatCrossRate } from "./crossRate";
import { thermalReceiptImages, thermalReceiptSize } from "./thermalReceipt";
import { receiptText, receiptTextColumns } from "./receiptText";
import { receiptPrintLayout } from "./receiptPaper";

const status = { pending: "Pendiente de entrega", paid: "Pagado", cancelled: "Cancelado" };
export const defaultReceiptFooter = "Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.";
export type Receipt = { reference: string; date: string; status: Transfer["status"]; issuer: ReceiptIssuer; sections: OutputSection[]; footer: string; printed?: boolean };

/**
 * Explicit customer-facing allowlist. The manager's share and the exchange gain never enter the receipt.
 * printed: reorganized customer invoice (review of 10-11-2026) — omits internal Recibo/Estado/Operador,
 * keeps Fecha + Envío + Código de operación at top, minimal sender/recipient data, aligned amounts, and Registrado por at the bottom.
 */
export function remittanceReceipt(transfer: Transfer, fallback?: ReceiptIssuer, operator = "—", registeredBy = transfer.registeredBy === transfer.sendingUserId ? operator : "—", printed = false): Receipt {
  const rawIssuer = transfer.receiptIssuer ?? fallback ?? { name: "Cobros y Pagos", address: "", phone: "", email: "", footerNote: defaultReceiptFooter };
  const cleanEmail = rawIssuer.email && !/\.local$/i.test(rawIssuer.email.trim()) ? rawIssuer.email.trim() : "";
  const cleanName = printed && rawIssuer.name.trim().toLowerCase() === "cobros y pagos" ? "" : rawIssuer.name;
  const issuer: ReceiptIssuer = { ...rawIssuer, name: cleanName, email: cleanEmail };
  const date = formatDate(transfer.createdAt);
  const party = (side: "sender" | "recipient", title: string): OutputSection => {
    const contact = transfer[`${side}Contact`];
    if (printed) {
      return side === "sender"
        ? { title, columns: ["Dato", "Valor"], rows: [["Nombre", contact?.name ?? "Contacto histórico no registrado"], ["Código del cliente", contact?.code || "No registrado"]] }
        : { title, columns: ["Dato", "Valor"], rows: [["Nombre", contact?.name ?? "Contacto histórico no registrado"], ["Teléfono", contact?.phone || contact?.cellular || "No registrado"], ["Dirección", contact?.address || "No registrada"]] };
    }
    return { title, columns: ["Dato", "Valor"], rows: [["Nombre", contact?.name ?? "Contacto histórico no registrado"],
      ["Código del cliente", contact?.code || "No registrado"], ["Identificación", contact?.identification || "No registrada"], ["Teléfono", contact?.phone || contact?.cellular || "No registrado"],
      ["Dirección", contact?.address || "No registrada"]] };
  };
  const cross = formatCrossRate(transfer.quote.sourceRate, transfer.quote.destinationRate);
  const rateLabel = (side: "source" | "destination") => {
    const kind = transfer.quote[`${side}RateKind`];
    return kind === "purchase" ? "Compra" : kind === "sale" ? "Venta" : "Tasa registrada";
  };
  const rates: (string | number)[][] = [
    [`${rateLabel("source")} · ${transfer.sourceCurrency}`, `1 ${transfer.sourceCurrency} = ${transfer.quote.sourceRate} DOP`],
    [`${rateLabel("destination")} · ${transfer.destinationCurrency}`, `1 ${transfer.destinationCurrency} = ${transfer.quote.destinationRate} DOP`],
    ["Conversión", `1 ${transfer.sourceCurrency} ${cross.approximate ? "≈" : "="} ${cross.text} ${transfer.destinationCurrency}${cross.approximate ? " (tasa mostrada redondeada)" : ""}`],
    ["Fecha de tasa de origen", transfer.quote.sourceRateDate ?? "No registrada"], ["Fecha de tasa de destino", transfer.quote.destinationRateDate ?? "No registrada"],
  ];
  const payment = transfer.payment;
  const calculation = transfer.calculation;
  const delivery = calculation && calculation.deliveryCommissionAmount > 0 ? calculation : undefined;
  const amounts: (string | number)[][] = printed ? [
    ["Monto a enviar", formatMoney(transfer.amount, transfer.sourceCurrency)],
    ["Cargo del envío", formatMoney(transfer.commissionAmount, transfer.sourceCurrency)],
    ...(payment?.cardSurchargeAmount ? [[payment.version === 3 ? "Cargo adicional por tarjeta" : "Recargo tarjeta de crédito", formatMoney(payment.cardSurchargeAmount, transfer.sourceCurrency)]] : []),
    ["Total pagado por el remitente", formatMoney(totalPaidForTransfer(transfer), transfer.sourceCurrency)],
    ...(delivery ? [["Cargo de entrega", formatMoney(delivery.deliveryCommissionAmount, transfer.destinationCurrency)]] : []),
    ["Recibe el destinatario", formatMoney(payoutOf(transfer), transfer.destinationCurrency)],
  ] : [
    ["Monto a enviar", formatMoney(transfer.amount, transfer.sourceCurrency)],
    ...(transfer.amountDop === undefined ? [] : [["Equivalente del principal en pesos", formatMoney(transfer.amountDop, "DOP")]]),
    ["Cargo del envío", formatMoney(transfer.commissionAmount, transfer.sourceCurrency)],
    ...(payment?.cardSurchargeAmount ? [[payment.version === 3 ? "Cargo adicional por tarjeta" : "Recargo tarjeta de crédito", formatMoney(payment.cardSurchargeAmount, transfer.sourceCurrency)]] : []),
    ["Total pagado por el remitente", formatMoney(totalPaidForTransfer(transfer), transfer.sourceCurrency)],
    ...(calculation && (delivery || calculation.roundingAdjustment) ? [["Monto convertido", formatMoney(transfer.receiveAmount, transfer.destinationCurrency)]] : []),
    ...(delivery ? [[`Cargo de entrega · ${delivery.deliveryConceptName}`, formatMoney(delivery.deliveryCommissionAmount, transfer.destinationCurrency)]] : []),
    ...(calculation?.roundingAdjustment ? [["Ajuste por redondeo", formatMoney(calculation.roundingAdjustment, transfer.destinationCurrency)]] : []),
    ["Recibe el destinatario", formatMoney(payoutOf(transfer), transfer.destinationCurrency)],
    ...(transfer.requestedReceiveAmount === undefined ? [] : [["Importe solicitado en destino", formatMoney(transfer.requestedReceiveAmount, transfer.destinationCurrency)]]),
    ...(transfer.receiveRoundingDifference ? [["Ajuste por redondeo", formatMoney(transfer.receiveRoundingDifference, transfer.destinationCurrency)]] : []),
  ];
  const paymentRows: (string | number)[][] = payment ? [["Forma de pago", paymentLabel(payment)],
    ...(payment.method === "cash" ? [["Dinero recibido", formatMoney(payment.tenderedAmount, transfer.sourceCurrency)], ["Devuelta", formatMoney(payment.changeAmount, transfer.sourceCurrency)]]
      : [["Referencia del comprobante", payment.reference ?? "—"], ...(payment.last4 ? [["Tarjeta", `•••• ${payment.last4}`]] : []), ...(payment.bank ? [["Banco o proveedor", payment.bank]] : [])])]
    : [["Forma de pago", "No registrada en esta operación histórica"]];
  return { reference: transfer.reciboReference, date, status: transfer.status, issuer, footer: issuer.footerNote || defaultReceiptFooter, printed,
    sections: printed ? [
      { title: "", columns: ["Dato", "Valor"], rows: [["Fecha", date], ["Envío", transfer.envioReference], ["Código de operación", transfer.operatingCode]] },
      party("sender", "Remitente"), party("recipient", "Destinatario"),
      { title: "Importes del envío", columns: ["Dato", "Valor"], rows: amounts },
      { title: "Pago del remitente", columns: ["Dato", "Valor"], rows: paymentRows },
      ...(transfer.paidAt ? [{ title: "Entrega al destinatario", columns: ["Dato", "Valor"], rows: [["Fecha de entrega", formatDate(transfer.paidAt)]] }] : []),
      ...(transfer.cancelledAt ? [{ title: "Cancelación", columns: ["Dato", "Valor"], rows: [["Fecha", formatDate(transfer.cancelledAt)], ["Motivo", transfer.cancelReason || "—"], ...(transfer.refund ? [["Referencia de devolución", transfer.refund.reference]] : [])] }] : []),
      ...(transfer.note ? [{ title: "Nota", columns: ["Dato", "Valor"], rows: [["Nota de la operación", transfer.note]] }] : []),
      { title: "", columns: ["Dato", "Valor"], rows: [["Registrado por", registeredBy]] },
    ] : [
      { title: "Registro del recibo", columns: ["Dato", "Valor"], rows: [["Envío", transfer.envioReference], ["Código de operación", transfer.operatingCode], ["Estado", status[transfer.status]], ["Operador del envío", operator], ["Registrado por", registeredBy]] },
      party("sender", "Remitente"), party("recipient", "Destinatario"),
      { title: "Importes del envío", columns: ["Dato", "Valor"], rows: amounts },
      { title: "Pago del remitente", columns: ["Dato", "Valor"], rows: paymentRows },
      { title: "Tasas aplicadas al registrar el envío", columns: ["Dato", "Valor"], rows: rates },
      ...(transfer.paidAt ? [{ title: "Entrega al destinatario", columns: ["Dato", "Valor"], rows: [["Fecha de entrega", formatDate(transfer.paidAt)]] }] : []),
      ...(transfer.cancelledAt ? [{ title: "Cancelación", columns: ["Dato", "Valor"], rows: [["Fecha", formatDate(transfer.cancelledAt)], ["Motivo", transfer.cancelReason || "—"], ...(transfer.refund ? [["Referencia de devolución", transfer.refund.reference]] : [])] }] : []),
      ...(transfer.note ? [{ title: "Nota", columns: ["Dato", "Valor"], rows: [["Nota de la operación", transfer.note]] }] : []),
    ] };
}

export function receiptSections(receipt: Receipt, compact: boolean) {
  return compact ? receipt.sections.filter((section) => section.title !== "Nota" && !section.title.startsWith("Tasas aplicadas")).map((section) => ({ ...section,
    rows: section.title === "" ? section.rows.filter(([label]) => label === "Fecha" || label === "Envío" || label === "Registrado por")
      : section.title === "Registro del recibo" ? section.rows.filter(([label]) => label === "Envío" || label === "Estado")
      : section.title === "Remitente" || section.title === "Destinatario" ? section.rows.filter(([label]) => label === "Nombre" || label === "Teléfono") : section.rows,
  })).filter((section) => section.rows.length > 0) : receipt.sections;
}
export function receiptHtml(receipt: Receipt, options: import("./ReceiptPrintControls").ReceiptPrintOptions = { paper: "auto", compact: false }) {
  const layout = receiptPrintLayout(options);
  const thermal = thermalReceiptSize(options.paper);
  const sections = receiptSections(receipt, options.compact);
  const docTitle = String(receipt.printed ? (sections[0]?.rows.find(([label]) => label === "Envío")?.[1] ?? receipt.reference) : receipt.reference);
  if (options.output === "text") {
    const columns = receiptTextColumns(options.paper, options), narrowThermal = options.paper === "51" || options.paper === "58", fontSize = narrowThermal ? 9.5 : thermal ? 10 : 12;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title><style>@page{size:${layout.pageSize};margin:${layout.marginMm}mm}*{box-sizing:border-box}html{margin:0;padding:0;background:#e2e8f0}body{margin:0;padding:0;width:100%;color:#000;background:#fff;${layout.widthMm === undefined ? "" : `max-width:${layout.widthMm}mm;`}}@media screen{body{box-shadow:0 2px 10px rgba(15,23,42,.12)}}@media print{html,body{background:#fff;box-shadow:none}}pre{font:${fontSize}px/1.45 "Courier New",Courier,monospace;letter-spacing:0;white-space:pre-wrap;margin:0;padding:0;tab-size:2}</style></head><body><pre aria-label="Recibo en formato de texto">${escapeHtml(receiptText({...receipt,sections},columns))}</pre></body></html>`;
  }
  const { issuer } = receipt;
  const logo = issuer.logoDataUrl && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(issuer.logoDataUrl) && issuer.logoDataUrl.length <= 24576 ? `<img alt="" src="${escapeHtml(issuer.logoDataUrl)}">` : "";
  const issuerLines = [issuer.address, issuer.phone, issuer.email].filter(Boolean);
  const hasHeader = Boolean(logo || issuer.name || issuerLines.length);
  const headerHtml = hasHeader ? `<header>${logo}${issuer.name ? `<h1>${escapeHtml(issuer.name)}</h1>` : ""}${issuerLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</header>` : "";
  const refHtml = receipt.printed ? "" : `<div class="ref"><span>Recibo ${escapeHtml(receipt.reference)}</span><span>${escapeHtml(receipt.date)}</span></div>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title><style>
    @page{size:${layout.pageSize};margin:${layout.marginMm}mm}*{box-sizing:border-box}html{margin:0;padding:0;background:#e2e8f0}body{font:13px Arial,sans-serif;color:#000;background:#fff;margin:0;padding:0;width:100%;${layout.widthMm === undefined ? "max-width:100%;" : `max-width:${layout.widthMm}mm;`}}@media screen{body{box-shadow:0 2px 10px rgba(15,23,42,.12)}}header{text-align:center;border-bottom:2px solid #31534e;padding:10px 0}header img{max-width:130px;max-height:65px}h1{font-size:19px;margin:4px 0}h2{font-size:14px;border-bottom:1px solid #bbb;padding-bottom:4px;break-after:avoid}p{margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere}.ref{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;padding:12px 0;font-weight:bold;overflow-wrap:anywhere}section{break-inside:auto}.receipt-meta-block{padding:4px 0;border-bottom:1px solid #bbb}.receipt-meta-block:last-child{border-bottom:0;border-top:1px solid #bbb;margin-top:8px}dl{margin:8px 0}dl>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 14px;padding:4px 0;border-bottom:1px solid #eee;break-inside:avoid}.receipt-meta-block dl{margin:2px 0}.receipt-meta-block dl>div:last-child{border-bottom:0}dt{flex:1 1 130px;min-width:0;overflow-wrap:anywhere}dd{margin:0;text-align:right;flex:1 1 130px;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}footer{border-top:2px solid #31534e;margin-top:12px;padding-top:10px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
    ${thermal ? `body{font-size:11px}h1{font-size:15px}h2{font-size:12px}.ref{flex-direction:column;gap:3px}header img{max-width:40mm}dl>div{gap:4px}footer{font-size:10px}` : ""}
    ${layout.landscape && (layout.widthMm ?? 200) >= 180 ? ".receipt-sections{columns:2;column-gap:8mm}" : ""}
    ${options.compact ? "header{padding:5px 0}section h2{margin:6px 0}dl{margin:3px 0}dl>div{padding:2px 0}footer{margin-top:8px;padding-top:6px}" : ""}
    @media print{html,body{background:#fff;box-shadow:none}.thermal-print-help{display:none!important}}.thermal-image-output{margin:0;padding:0;width:100%}
    </style></head><body>${refHtml}${headerHtml}<main class="receipt-sections">${sections.filter((s) => s.rows.length > 0).map((section) => `<section${section.title ? "" : ' class="receipt-meta-block"'}>${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ""}<dl>${section.rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}: </dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></section>`).join("")}</main><footer>${escapeHtml(receipt.footer)}</footer></body></html>`;
}
export function printRemittanceReceipt(receipt: Receipt, options?: import("./ReceiptPrintControls").ReceiptPrintOptions) {
  const thermal = thermalReceiptSize(options?.paper);
  const html = receiptHtml(receipt, options);
  const popup = window.open("", "_blank", thermal ? "width=440,height=780" : "width=780,height=820");
  if (!popup) throw new Error("Permite abrir la ventana de impresión para este sitio.");
  popup.opener = null; popup.document.write(html); popup.document.close();
  const print = () => { if (!popup.closed) { popup.focus(); popup.print(); } };
  if (options?.output === "text") { window.setTimeout(print,150); return; }
  if (thermal) {
    const compact = options?.compact ?? false;
    const preparing = popup.document.createElement("p"); preparing.className = "thermal-print-help";
    preparing.textContent = "Preparando vista previa del recibo…";
    popup.document.body.replaceChildren(preparing);
    void thermalReceiptImages(popup.document, {...receipt, sections: receiptSections(receipt, compact)}, thermal.widthMm, compact).then(content => {
      if (popup.closed) return;
      const help = popup.document.createElement("p"); help.className = "thermal-print-help";
      help.textContent = "Recibo preparado como imagen para conservar acentos y formato. Selecciona el papel térmico y el controlador de tu impresora.";
      popup.document.body.replaceChildren(help, content); print();
    }).catch(() => {
      if (popup.closed) return;
      const message = popup.document.createElement("p"); message.setAttribute("role", "alert");
      message.textContent = "No se pudo preparar el recibo para impresión. Cierra esta ventana y vuelve a intentarlo.";
      popup.document.body.replaceChildren(message);
    });
    return;
  }
  const images = Array.from(popup.document.images).filter((img) => !img.complete);
  if (!images.length) window.setTimeout(print, 150);
  else void Promise.all(images.map((img) => new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); }))).then(print);
}
