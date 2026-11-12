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
export const printedReceiptHeading = "RECIBO DE ENVIO";
export const signatureLineToken = "____________________________";
export const isSignatureRow = (label: unknown, value: unknown) => String(label) === "Recibido por" && String(value) === signatureLineToken;
export const isPrintedHighlightRow = (label: unknown) => {
  const key = String(label);
  return key === "Envío" || key === "Remitente" || key === "Destinatario" || key === "Recibe el destinatario";
};
export const cleanReceiptFooterNote = (footer: string) => footer.trim().replace(/^nota:\s*/i, "");
export const isSheetVoucherPaper = (paper?: string) => paper === "a4" || paper === "letter";
export const sheetVoucherWarningText = "Es importante que revise su recibo para asegurar que el número de teléfono esté correcto!";
export type SheetReceiptVoucher = {
  companyTitle: string;
  envioReference: string;
  voucherDateTime: string;
  recipientName: string;
  recipientPhone: string;
  sentAmount: string;
  destinationCurrency: string;
  payoutAmountNumber: string;
  warningLine: string;
  claimsLine: string;
  cancelledNote?: string;
};
export type Receipt = { reference: string; date: string; status: Transfer["status"]; issuer: ReceiptIssuer; sections: OutputSection[]; footer: string; printed?: boolean; sheetVoucher?: SheetReceiptVoucher };

export const isGenericAppIssuerName = (name?: string) => !name?.trim() || /^cobros y pagos$/i.test(name.trim());
export const receiptCompanyName = (issuer: ReceiptIssuer) => isGenericAppIssuerName(issuer.name) ? "" : issuer.name.trim();

const isUnconfiguredIssuer = (issuer?: ReceiptIssuer) => Boolean(
  issuer && isGenericAppIssuerName(issuer.name) &&
  ![issuer.slogan, issuer.address, issuer.phone, issuer.rnc].some((value) => value?.trim()),
);

export function formatPrintedDate(value?: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santo_Domingo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(parsed);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const period = /^p/i.test(get("dayPeriod")) ? "p.m." : "a.m.";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")} ${period}`;
}

export function formatSheetVoucherDateTime(value?: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Santo_Domingo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} |${get("hour")}:${get("minute")}:${get("second")}`;
}

export function formatAmountNumber(cents: number): string {
  const exact = BigInt(cents);
  const absolute = exact < 0n ? -exact : exact;
  const whole = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 }).format(absolute / 100n);
  return `${exact < 0n ? "-" : ""}${whole}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function sheetVoucherClaimsLine(issuer: ReceiptIssuer): string {
  const cleanPhone = (issuer.phone ?? "").trim().replace(/^tel\.?:\s*/i, "").trim();
  return cleanPhone
    ? `PARA RECLAMACIONES FAVOR COMUNICARSE A ${cleanPhone}`
    : "PARA RECLAMACIONES FAVOR COMUNICARSE CON LA OFICINA";
}

export function printedPaymentMethod(payment?: Transfer["payment"]): string {
  if (!payment) return "No registrada";
  if (payment.method === "card") {
    if (payment.cardType === "credit") return "TC";
    if (payment.cardType === "debit") return "TD";
    return "Tarjeta";
  }
  return paymentLabel(payment);
}

/** Ordered company header lines below the company name: Eslogan (if set), Dirección, Tel. + RNC combined on printed receipts, and non-.local email on consultation view. */
export function receiptIssuerLines(issuer: ReceiptIssuer, printed = false): string[] {
  const slogan = issuer.slogan?.trim() ?? "";
  const address = issuer.address?.trim() ?? "";
  const rawPhone = issuer.phone?.trim() ?? "";
  const rawRnc = issuer.rnc?.trim() ?? "";
  if (printed) {
    const phone = rawPhone ? (/^tel/i.test(rawPhone) ? rawPhone.replace(/^tel\.?:\s*/i, "Tel. ") : `Tel. ${rawPhone}`) : "";
    const rnc = rawRnc ? (/^rnc\b/i.test(rawRnc) ? rawRnc : `RNC: ${rawRnc}`) : "";
    const phoneAndRnc = [phone, rnc].filter(Boolean).join(" / ");
    return [slogan, address, phoneAndRnc].filter(Boolean);
  }
  const phone = rawPhone ? (/^tel/i.test(rawPhone) ? rawPhone : `Tel.: ${rawPhone}`) : "";
  const rnc = rawRnc ? (/^rnc\b/i.test(rawRnc) ? rawRnc : `RNC: ${rawRnc}`) : "";
  const email = issuer.email && !/\.local$/i.test(issuer.email.trim()) ? issuer.email.trim() : "";
  return [slogan, address, phone, rnc, email].filter(Boolean);
}

/**
 * Explicit customer-facing allowlist. The manager's share and the exchange gain never enter the receipt.
 * printed: customer invoice layout — company header at the very top with dashed separator and RECIBO DE ENVIO,
 * followed by Fecha / Envío / Cód. Operación, Remitente, Destinatario, Importes del envío, Forma pago del remitente,
 * Recibido por signature line, Registrado por and Nota footer without internal divider lines.
 */
export function remittanceReceipt(transfer: Transfer, fallback?: ReceiptIssuer, operator = "—", registeredBy = transfer.registeredBy === transfer.sendingUserId ? operator : "—", printed = false): Receipt {
  const rawIssuer = (transfer.receiptIssuer && (!isUnconfiguredIssuer(transfer.receiptIssuer) || !fallback || isUnconfiguredIssuer(fallback)))
    ? transfer.receiptIssuer
    : (fallback ?? transfer.receiptIssuer ?? { name: "", address: "", phone: "", email: "", footerNote: defaultReceiptFooter });
  const cleanEmail = rawIssuer.email && !/\.local$/i.test(rawIssuer.email.trim()) ? rawIssuer.email.trim() : "";
  const logoDataUrl = rawIssuer.logoDataUrl || transfer.receiptIssuer?.logoDataUrl;
  const issuer: ReceiptIssuer = {
    ...rawIssuer,
    name: receiptCompanyName(rawIssuer),
    email: cleanEmail,
    ...(logoDataUrl ? { logoDataUrl } : {}),
    footerNote: transfer.receiptIssuer?.footerNote || rawIssuer.footerNote || defaultReceiptFooter,
  };
  const date = printed ? formatPrintedDate(transfer.createdAt) : formatDate(transfer.createdAt);
  const party = (side: "sender" | "recipient", title: string): OutputSection => {
    const contact = transfer[`${side}Contact`];
    if (printed) {
      return side === "sender"
        ? { title: "", columns: ["Dato", "Valor"], rows: [["Remitente", contact?.name ?? "Contacto histórico no registrado"], ["Código del Cliente", contact?.code || "No registrado"]] }
        : { title: "", columns: ["Dato", "Valor"], rows: [["Destinatario", contact?.name ?? "Contacto histórico no registrado"], ["Teléfono", contact?.phone || contact?.cellular || "No registrado"], ["Dirección", contact?.address || "No registrada"]] };
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
  const shippingCharge = Number(BigInt(transfer.commissionAmount) + BigInt(payment?.cardSurchargeAmount ?? 0));
  const amounts: (string | number)[][] = printed ? [
    ["Monto a enviar", formatMoney(transfer.amount, transfer.sourceCurrency)],
    ["Total pagado por el remitente", formatMoney(totalPaidForTransfer(transfer), transfer.sourceCurrency)],
    ...(delivery ? [["Cargo de entrega", formatMoney(delivery.deliveryCommissionAmount, transfer.destinationCurrency)]] : []),
    ["Recibe el destinatario", formatMoney(payoutOf(transfer), transfer.destinationCurrency)],
  ] : [
    ["Monto a enviar", formatMoney(transfer.amount, transfer.sourceCurrency)],
    ...(transfer.amountDop === undefined ? [] : [["Equivalente del principal en pesos", formatMoney(transfer.amountDop, "DOP")]]),
    ["Cargo del envío", formatMoney(shippingCharge, transfer.sourceCurrency)],
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
  const sheetVoucher: SheetReceiptVoucher | undefined = printed ? {
    companyTitle: issuer.name,
    envioReference: transfer.envioReference,
    voucherDateTime: formatSheetVoucherDateTime(transfer.createdAt),
    recipientName: transfer.recipientContact?.name ?? "Contacto histórico no registrado",
    recipientPhone: transfer.recipientContact?.phone || transfer.recipientContact?.cellular || "No registrado",
    sentAmount: formatMoney(transfer.amount, transfer.sourceCurrency),
    destinationCurrency: transfer.destinationCurrency,
    payoutAmountNumber: formatAmountNumber(payoutOf(transfer)),
    warningLine: sheetVoucherWarningText,
    claimsLine: sheetVoucherClaimsLine(issuer),
    ...(transfer.cancelledAt ? { cancelledNote: `CANCELADO: ${formatPrintedDate(transfer.cancelledAt)} · Motivo: ${transfer.cancelReason || "—"}` } : {}),
  } : undefined;
  return { reference: transfer.reciboReference, date, status: transfer.status, issuer, footer: issuer.footerNote || defaultReceiptFooter, printed, ...(sheetVoucher ? { sheetVoucher } : {}),
    sections: printed ? [
      { title: "", columns: ["Dato", "Valor"], rows: [["Fecha", date], ["Envío", transfer.envioReference], ["Cód. Operación", transfer.operatingCode]] },
      party("sender", "Remitente"), party("recipient", "Destinatario"),
      { title: "Importes del envío", columns: ["Dato", "Valor"], rows: amounts },
      { title: "", columns: ["Dato", "Valor"], rows: [["Forma pago del remitente", printedPaymentMethod(payment)]] },
      ...(transfer.cancelledAt ? [{ title: "Cancelación", columns: ["Dato", "Valor"], rows: [["Fecha", formatPrintedDate(transfer.cancelledAt)], ["Motivo", transfer.cancelReason || "—"], ...(transfer.refund ? [["Referencia de devolución", transfer.refund.reference]] : [])] }] : []),
      { title: "", columns: ["Dato", "Valor"], rows: [["Recibido por", signatureLineToken]] },
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
    rows: section.title === "" ? section.rows.filter(([label]) => label === "Fecha" || label === "Envío" || label === "Remitente" || label === "Destinatario" || label === "Teléfono" || label === "Forma pago del remitente" || label === "Registrado por")
      : section.title === "Registro del recibo" ? section.rows.filter(([label]) => label === "Envío" || label === "Estado")
      : section.title === "Remitente" || section.title === "Destinatario" ? section.rows.filter(([label]) => label === "Nombre" || label === "Teléfono") : section.rows,
  })).filter((section) => section.rows.length > 0) : receipt.sections;
}
export function receiptHtml(receipt: Receipt, options: import("./ReceiptPrintControls").ReceiptPrintOptions = { paper: "auto", compact: false }) {
  const layout = receiptPrintLayout(options);
  const thermal = thermalReceiptSize(options.paper);
  const sections = receiptSections(receipt, options.compact);
  const sheetVoucherMode = Boolean(receipt.printed && receipt.sheetVoucher && isSheetVoucherPaper(options.paper));
  const docTitle = String(receipt.printed ? (receipt.sheetVoucher?.envioReference ?? sections[0]?.rows.find(([label]) => label === "Envío")?.[1] ?? receipt.reference) : receipt.reference);
  if (options.output === "text") {
    const columns = receiptTextColumns(options.paper, options), narrowThermal = options.paper === "51" || options.paper === "58", fontSize = narrowThermal ? 9.5 : thermal ? 10 : 12;
    const preFont = sheetVoucherMode ? `700 ${fontSize}px/1.45 "Consolas","Courier New",Courier,monospace` : `${fontSize}px/1.45 "Courier New",Courier,monospace`;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title><style>@page{size:${layout.pageSize};margin:${layout.marginMm}mm}*{box-sizing:border-box}html{margin:0;padding:0;background:#e2e8f0}body{margin:0;padding:0;width:100%;color:#000;background:#fff;${layout.widthMm === undefined ? "" : `max-width:${layout.widthMm}mm;`}}@media screen{body{box-shadow:0 2px 10px rgba(15,23,42,.12)}}@media print{html,body{background:#fff;box-shadow:none}}pre{font:${preFont};letter-spacing:0;white-space:pre-wrap;margin:0;padding:0;tab-size:2}</style></head><body><pre aria-label="Recibo en formato de texto">${escapeHtml(receiptText({...receipt,sections},columns,sheetVoucherMode))}</pre></body></html>`;
  }
  if (sheetVoucherMode && receipt.sheetVoucher) {
    const v = receipt.sheetVoucher;
    const graphicWidthMm = layout.widthMm;
    const titleHtml = v.companyTitle ? `<h1 class="sheet-voucher-company">${escapeHtml(v.companyTitle)}</h1>` : "";
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title><style>
      @page{size:${layout.pageSize};margin:${layout.marginMm}mm}*{box-sizing:border-box}html{margin:0;padding:0;background:#e2e8f0}body{font:700 18px/1.38 "Consolas","Courier New",Courier,monospace;color:#000;background:#fff;margin:0;padding:4px 0 0;width:100%;${graphicWidthMm === undefined ? "max-width:100%;" : `max-width:${graphicWidthMm}mm;`}}@media screen{body{box-shadow:0 2px 10px rgba(15,23,42,.12);padding:12px 16px}}@media print{html,body{background:#fff;box-shadow:none;padding:4px 0 0}}
      .sheet-voucher-header{border-bottom:1.5px solid #000;padding:2px 0 14px;margin-bottom:6px;text-align:center}
      .sheet-voucher-company{margin:0;font-size:26px;line-height:1.2;font-weight:700;text-transform:uppercase;letter-spacing:0.28em;padding-left:0.28em;overflow-wrap:anywhere}
      .sheet-voucher-meta{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
      .sheet-voucher-recipient{text-align:center;border-bottom:1.5px solid #000;padding:16px 0 6px;margin-bottom:6px;overflow-wrap:anywhere}
      .sheet-voucher-recipient-name{margin:0 0 12px}
      .sheet-voucher-recipient-phone{margin:0}
      .sheet-voucher-amounts{margin:0 0 18px;overflow-wrap:anywhere}
      .sheet-voucher-monto{text-align:center;margin:0 0 6px}
      .sheet-voucher-payout{margin:0;white-space:pre-wrap}
      .sheet-voucher-cancelled{margin:10px 0 0;white-space:pre-wrap}
      .sheet-voucher-notice{margin:18px 0 16px;white-space:pre-wrap;overflow-wrap:anywhere}
      .sheet-voucher-claims{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
    </style></head><body><main class="sheet-voucher"><header class="sheet-voucher-header">${titleHtml}</header><div class="sheet-voucher-meta"><div>Envío #: ${escapeHtml(v.envioReference)}</div><div>Fecha  : ${escapeHtml(v.voucherDateTime)}</div></div><section class="sheet-voucher-recipient"><div class="sheet-voucher-recipient-name">${escapeHtml(v.recipientName)}</div><div class="sheet-voucher-recipient-phone">TELÉFONO: ${escapeHtml(v.recipientPhone)}</div></section><section class="sheet-voucher-amounts"><div class="sheet-voucher-monto">MONTO: ${escapeHtml(v.sentAmount)}</div><div class="sheet-voucher-payout"><div>RECIBE EN ${escapeHtml(v.destinationCurrency)}:</div><div>${escapeHtml(v.payoutAmountNumber)}</div></div>${v.cancelledNote ? `<div class="sheet-voucher-cancelled">${escapeHtml(v.cancelledNote)}</div>` : ""}</section><p class="sheet-voucher-notice">${escapeHtml(v.warningLine)}</p><p class="sheet-voucher-claims">${escapeHtml(v.claimsLine)}</p></main></body></html>`;
  }
  const { issuer } = receipt;
  const isPrinted = Boolean(receipt.printed);
  const graphicWidthMm = thermal ? thermal.graphicWidthMm : layout.widthMm;
  const logo = issuer.logoDataUrl && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(issuer.logoDataUrl) && issuer.logoDataUrl.length <= 24576 ? `<img alt="" src="${escapeHtml(issuer.logoDataUrl)}">` : "";
  const issuerLines = receiptIssuerLines(issuer, isPrinted);
  const hasHeader = Boolean(logo || issuer.name || issuerLines.length);
  const headerHtml = hasHeader ? `<header>${logo}${issuer.name ? `<h1>${escapeHtml(issuer.name)}</h1>` : ""}${issuerLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</header>` : "";
  const refHtml = isPrinted ? `<div class="receipt-doc-title">${escapeHtml(printedReceiptHeading)}</div>` : `<div class="ref"><span>Recibo ${escapeHtml(receipt.reference)}</span><span>${escapeHtml(receipt.date)}</span></div>`;
  const cleanFooter = cleanReceiptFooterNote(receipt.footer);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title><style>
    @page{size:${layout.pageSize};margin:${layout.marginMm}mm}*{box-sizing:border-box}html{margin:0;padding:0;background:#e2e8f0}body{font:12.5px/1.28 Arial,sans-serif;color:#000;background:#fff;margin:0;padding:0;width:100%;${graphicWidthMm === undefined ? "max-width:100%;" : `max-width:${graphicWidthMm}mm;`}}@media screen{body{box-shadow:0 2px 10px rgba(15,23,42,.12)}}header{text-align:center;border-bottom:${isPrinted ? "1px dashed #000" : "1.5px solid #31534e"};padding:4px 0}header img{max-width:120px;max-height:48px;display:block;margin:0 auto 2px}h1{font-size:15px;margin:2px 0}.receipt-doc-title{text-align:center;font-weight:700;font-size:13.5px;margin:4px 0 2px}h2{font-size:${isPrinted ? "12.5px" : "13px"};font-weight:${isPrinted ? "400" : "700"};margin:${isPrinted ? "0" : "4px 0 2px"};border-bottom:${isPrinted ? "0" : "1px solid #bbb"};padding-bottom:${isPrinted ? "0" : "2px"};break-after:avoid}p{margin:1px 0;white-space:pre-wrap;overflow-wrap:anywhere}.ref{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:4px 0;font-weight:bold;overflow-wrap:anywhere}section{break-inside:auto}${isPrinted ? "section+section{margin-top:8px}" : ".receipt-meta-block{padding:2px 0;border-bottom:1px solid #bbb}.receipt-meta-block:last-child{border-bottom:0;border-top:1px solid #bbb;margin-top:3px}"}dl{margin:${isPrinted ? "0" : "2px 0"}}dl>div{padding:${isPrinted ? "1px 0" : "1.5px 0"};border-bottom:${isPrinted ? "0" : "1px solid #eee"};break-inside:avoid;text-align:left;overflow-wrap:anywhere}dt{display:inline;font-weight:${isPrinted ? "400" : "700"}}dd{display:inline;margin:0;text-align:left;overflow-wrap:anywhere;white-space:pre-wrap}.receipt-row-highlight dt,.receipt-row-highlight dd{font-weight:700}.receipt-row-envio dt,.receipt-row-envio dd{font-size:1.06em}.receipt-signature-row{padding-top:6px}.receipt-signature-line{display:inline-block;width:62%;min-width:96px;border-bottom:1px solid #000;height:0.85em;vertical-align:baseline}footer{border-top:${isPrinted ? "0" : "1.5px solid #31534e"};margin-top:${isPrinted ? "1px" : "4px"};padding-top:${isPrinted ? "0" : "4px"};white-space:pre-wrap;overflow-wrap:anywhere;font-size:${isPrinted ? "12px" : "11px"}}
    ${thermal ? `body{font-size:11px;line-height:1.22}header{padding:2px 0}h1{font-size:13px;margin:1px 0}.receipt-doc-title{font-size:12px;margin:2px 0 1px}h2{font-size:${isPrinted ? "11px" : "11.5px"};margin:${isPrinted ? "0" : "2px 0 1px"}}.ref{flex-direction:column;gap:1px;padding:2px 0}header img{max-width:36mm;max-height:11mm}${isPrinted ? "section+section{margin-top:6px}" : ""}footer{font-size:${isPrinted ? "11px" : "10px"}}` : ""}
    ${layout.landscape && (layout.widthMm ?? 200) >= 180 ? ".receipt-sections{columns:2;column-gap:8mm}" : ""}
    ${options.compact ? "header{padding:2px 0}section+section{margin-top:4px}" : ""}
    @media print{html,body{background:#fff;box-shadow:none}.thermal-print-help{display:none!important}}.thermal-image-output{margin:0;padding:0;width:100%}
    </style></head><body>${isPrinted ? `${headerHtml}${refHtml}` : `${refHtml}${headerHtml}`}<main class="receipt-sections">${sections.filter((s) => s.rows.length > 0).map((section) => `<section${section.title ? "" : ' class="receipt-meta-block"'}>${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ""}<dl>${section.rows.map(([label, value]) => {
      if (isSignatureRow(label, value)) return `<div class="receipt-signature-row"><dt>${escapeHtml(label)}: </dt><dd><span class="receipt-signature-line" aria-hidden="true"></span></dd></div>`;
      const rowClass = isPrinted && isPrintedHighlightRow(label) ? ` class="receipt-row-highlight${label === "Envío" ? " receipt-row-envio" : ""}"` : "";
      return `<div${rowClass}><dt>${escapeHtml(label)}: </dt><dd>${escapeHtml(value)}</dd></div>`;
    }).join("")}</dl></section>`).join("")}</main>${cleanFooter ? `<footer>${isPrinted ? `<strong>Nota:</strong> ${escapeHtml(cleanFooter)}` : escapeHtml(receipt.footer)}</footer>` : ""}</body></html>`;
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
    void thermalReceiptImages(popup.document, {...receipt, sections: receiptSections(receipt, compact)}, thermal.graphicWidthMm, compact).then(content => {
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
