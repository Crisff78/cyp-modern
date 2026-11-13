import { cleanReceiptFooterNote, formatSpacedTitleLines, isPrintedSignoffSection, isRecipientPrintedReceipt, isSignatureRow, printedReceiptHeading, receiptIssuerLines, type Receipt } from "./receipt";
import { receiptPrintLayout, type ReceiptPrintOptions } from "./receiptPaper";

/** Literal spaces/newlines survive text-only drivers; accents remain Unicode, never transliterated. */
export function receiptText(receipt: Receipt, columns: number, dividePrintedBlocks = false) {
  if (!Number.isInteger(columns) || columns < 20 || columns > 100) throw new Error("Ancho de texto no válido.");
  const clean = (value: unknown) => String(value).normalize("NFC").replace(/\r\n?/g,"\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,"")
    .replace(/[\u00a0\u202f]/g," ").replace(/\u2022/g,"*").replace(/\u2014/g,"-");
  const length = (value: string) => Array.from(value).length;
  const wrap = (value: string, width: number) => {
    const result: string[] = [];
    for (const paragraph of clean(value).split("\n")) {
      let line = "";
      for (const word of paragraph.trim().split(/\s+/u)) {
        if (!word) continue;
        if (length(line ? `${line} ${word}` : word) <= width) {line = line ? `${line} ${word}` : word;continue;}
        if (line && (length(word) <= width || length(line) + 1 >= width)) {result.push(line);line="";}
        else if (line) line += " ";
        for (const character of Array.from(word)) {if(length(line)===width){result.push(line);line="";}line+=character;}
      }
      result.push(line);
    }
    return result;
  };
  const lines: string[] = [], add = (value: string) => lines.push(...wrap(value,columns)), rule = () => lines.push("-".repeat(columns));
  const center = (value: string) => { for (const line of wrap(value, columns)) lines.push(" ".repeat(Math.max(0, Math.floor((columns - length(line)) / 2))) + line); };
  if (isRecipientPrintedReceipt(receipt) && receipt.recipientVoucher) {
    const v = receipt.recipientVoucher;
    const rawTitle = clean(v.companyTitle).trim().toUpperCase();
    if (rawTitle) {
      const spacedLines = formatSpacedTitleLines(rawTitle, (candidate) => length(candidate) <= columns);
      if (spacedLines.length) {
        for (const spaced of spacedLines) lines.push(" ".repeat(Math.max(0, Math.floor((columns - length(spaced)) / 2))) + spaced);
      } else {
        center(rawTitle);
      }
    }
    rule();
    const pushExactOrWrap = (value: string) => {
      const normalized = clean(value);
      if (!normalized.includes("\n") && length(normalized) <= columns) lines.push(normalized);
      else add(normalized);
    };
    pushExactOrWrap(`Envío #: ${v.envioReference}`);
    pushExactOrWrap(`Fecha  : ${v.voucherDateTime}`);
    lines.push("");
    center(v.recipientName);
    lines.push("");
    center(`TELÉFONO: ${v.recipientPhone}`);
    rule();
    center(`MONTO: ${v.sentAmount}`);
    add(`RECIBE EN ${v.destinationCurrency}:`);
    add(v.payoutAmountNumber);
    if (v.cancelledNote) add(v.cancelledNote);
    lines.push("");
    add(v.warningLine);
    lines.push("");
    add(v.claimsLine);
    return lines.join("\n") + "\n";
  }
  const issuerLines = [receipt.issuer.name, ...receiptIssuerLines(receipt.issuer, Boolean(receipt.printed))].filter((line): line is string => Boolean(line && clean(line).trim()));
  if (receipt.printed) {
    if (issuerLines.length) {
      for (const line of issuerLines) center(line);
      rule();
    }
    center(printedReceiptHeading);
  } else {
    add(`Recibo: ${receipt.reference}`);add(`Fecha: ${receipt.date}`);lines.push("");
    for (const line of issuerLines) add(line);
  }
  let renderedSections = 0;
  let prevWasDivided = false;
  for(const section of receipt.sections){
    if (!section.rows.length) continue;
    if (receipt.printed) {
      if (renderedSections > 0 && !prevWasDivided) lines.push("");
      renderedSections++;
      if (section.title) add(section.title);
    } else {
      if (lines.length) rule();
      if (section.title) { add(section.title); lines.push(""); }
    }
    for(const [rawLabel,rawValue] of section.rows){
      if (isSignatureRow(rawLabel, rawValue)) {
        const sigPrefix = `${clean(rawLabel)}: `;
        lines.push(sigPrefix + "_".repeat(Math.max(8, Math.min(34, columns - length(sigPrefix) - 2))));
        continue;
      }
      const label=`${clean(rawLabel)}:`,value=clean(rawValue).trim();
      if(!value) add(label);
      else if(!/[\r\n]/.test(`${label} ${value}`)&&length(label)+1+length(value)<=columns)
        lines.push(`${label} ${value}`);
      else if(/^[A-Z]{3} -?[0-9][0-9.,]*$/u.test(value)&&length(value)<=columns){
        add(label);
        add(value);
      } else {
        const [first="",...rest]=value.split("\n");
        add(first?`${label} ${first}`:label);
        for(const paragraph of rest) add(paragraph);
      }
    }
    if (receipt.printed && dividePrintedBlocks && !isPrintedSignoffSection(section)) {
      rule();
      prevWasDivided = true;
    } else {
      prevWasDivided = false;
      if (!receipt.printed && section.title) lines.push("");
    }
  }
  if (receipt.printed) {
    const cleanFooter = cleanReceiptFooterNote(receipt.footer);
    if (cleanFooter) add(`Nota: ${cleanFooter}`);
  } else {
    rule();add(receipt.footer);
  }
  return lines.join("\n")+"\n";
}
export const receiptTextColumns = (paper?: string, options?: ReceiptPrintOptions) => receiptPrintLayout(options ?? {paper:(paper ?? "auto") as ReceiptPrintOptions["paper"],compact:false}).textColumns;
