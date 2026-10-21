import type { ReceiptIssuer } from "./payment.mjs";
import { paymentMethodLabels } from "./payment.mjs";
import type { Transfer } from "./types";
import { escapeHtml, formatDate, formatMoney, type OutputSection } from "./output";
import { formatCrossRate } from "./crossRate";

const status = { pending: "Pendiente de entrega", paid: "Pagado", cancelled: "Cancelado" };
export const defaultReceiptFooter = "Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.";
export type Receipt = { reference: string; date: string; status: Transfer["status"]; issuer: ReceiptIssuer; sections: OutputSection[]; footer: string };

/** Explicit customer-facing allowlist. Internal commission amounts and allocations never enter the receipt. */
export function remittanceReceipt(transfer: Transfer, fallback?: ReceiptIssuer, operator = "—", registeredBy = transfer.registeredBy === transfer.sendingUserId ? operator : "—"): Receipt {
  const issuer = transfer.receiptIssuer ?? fallback ?? { name: "Cobros y Pagos", address: "", phone: "", email: "", footerNote: defaultReceiptFooter };
  const party = (side: "sender" | "recipient", title: string): OutputSection => {
    const contact = transfer[`${side}Contact`];
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
  return { reference: transfer.reciboReference, date: formatDate(transfer.createdAt), status: transfer.status, issuer, footer: issuer.footerNote || defaultReceiptFooter,
    sections: [
      { title: "Registro del recibo", columns: ["Dato", "Valor"], rows: [["Envío", transfer.envioReference], ["Estado", status[transfer.status]], ["Operador del envío", operator], ["Registrado por", registeredBy]] },
      party("sender", "Remitente"), party("recipient", "Destinatario"),
      { title: "Importes del envío", columns: ["Dato", "Valor"], rows: [["Monto a enviar", formatMoney(transfer.amount, transfer.sourceCurrency)],
        ...(transfer.amountDop === undefined ? [] : [["Equivalente del principal en pesos", formatMoney(transfer.amountDop, "DOP")]]),
        ["Total pagado por el remitente", formatMoney(transfer.totalAmount, transfer.sourceCurrency)],
        ["Recibe el destinatario", formatMoney(transfer.receiveAmount, transfer.destinationCurrency)],
        ...(transfer.requestedReceiveAmount === undefined ? [] : [["Importe solicitado en destino", formatMoney(transfer.requestedReceiveAmount, transfer.destinationCurrency)]]),
        ...(transfer.receiveRoundingDifference ? [["Ajuste por redondeo", formatMoney(transfer.receiveRoundingDifference, transfer.destinationCurrency)]] : [])] },
      { title: "Pago del remitente", columns: ["Dato", "Valor"], rows: payment ? [["Forma de pago", paymentMethodLabels[payment.method]],
        ...(payment.method === "cash" ? [["Dinero recibido", formatMoney(payment.tenderedAmount, transfer.sourceCurrency)], ["Devuelta", formatMoney(payment.changeAmount, transfer.sourceCurrency)]]
          : [["Referencia del comprobante", payment.reference ?? "—"], ...(payment.bank ? [["Banco o proveedor", payment.bank]] : [])])]
        : [["Forma de pago", "No registrada en esta operación histórica"]] },
      { title: "Tasas aplicadas al registrar el envío", columns: ["Dato", "Valor"], rows: rates },
      ...(transfer.paidAt ? [{ title: "Entrega al destinatario", columns: ["Dato", "Valor"], rows: [["Fecha de entrega", formatDate(transfer.paidAt)]] }] : []),
      ...(transfer.cancelledAt ? [{ title: "Cancelación", columns: ["Dato", "Valor"], rows: [["Fecha", formatDate(transfer.cancelledAt)], ["Motivo", transfer.cancelReason || "—"], ...(transfer.refund ? [["Referencia de devolución", transfer.refund.reference]] : [])] }] : []),
      ...(transfer.note ? [{ title: "Nota", columns: ["Dato", "Valor"], rows: [["Nota de la operación", transfer.note]] }] : []),
    ] };
}

export function receiptHtml(receipt: Receipt) {
  const { issuer } = receipt;
  const logo = issuer.logoDataUrl && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(issuer.logoDataUrl) && issuer.logoDataUrl.length <= 24576 ? `<img alt="" src="${escapeHtml(issuer.logoDataUrl)}">` : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(receipt.reference)}</title><style>
    @page{size:auto;margin:12mm}*{box-sizing:border-box}body{font:13px Arial,sans-serif;color:#132b29;margin:0 auto;max-width:660px}header{text-align:center;border-bottom:2px solid #31534e;padding:10px 0}header img{max-width:130px;max-height:65px}h1{font-size:19px}h2{font-size:14px;border-bottom:1px solid #bbb;padding-bottom:4px}p{margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere}.ref{display:flex;justify-content:space-between;gap:12px;padding:12px 0;font-weight:bold}section{break-inside:avoid}dl{margin:8px 0}dl>div{display:flex;justify-content:space-between;gap:14px;padding:4px 0;border-bottom:1px solid #eee}dt{flex:1}dd{margin:0;text-align:right;flex:1;overflow-wrap:anywhere;white-space:pre-wrap}footer{border-top:2px solid #31534e;margin-top:16px;padding-top:12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
    </style></head><body><div class="ref"><span>Recibo ${escapeHtml(receipt.reference)}</span><span>${escapeHtml(receipt.date)}</span></div><header>${logo}<h1>${escapeHtml(issuer.name)}</h1>${[issuer.address, issuer.phone, issuer.email].filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</header>${receipt.sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2><dl>${section.rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></section>`).join("")}<footer>${escapeHtml(receipt.footer)}</footer></body></html>`;
}
export function printRemittanceReceipt(receipt: Receipt) {
  const popup = window.open("", "_blank", "width=780,height=820");
  if (!popup) throw new Error("Permite abrir la ventana de impresión para este sitio.");
  popup.opener = null; popup.document.write(receiptHtml(receipt)); popup.document.close();
  const print = () => { if (!popup.closed) { popup.focus(); popup.print(); } };
  const images = Array.from(popup.document.images).filter((img) => !img.complete);
  if (!images.length) window.setTimeout(print, 150);
  else void Promise.all(images.map((img) => new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); }))).then(print);
}
