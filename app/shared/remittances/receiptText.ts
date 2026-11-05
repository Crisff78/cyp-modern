import type { Receipt } from "./receipt";

/** Literal spaces/newlines survive text-only drivers; accents remain Unicode, never transliterated. */
export function receiptText(receipt: Receipt, columns: number) {
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
        if (line) {result.push(line);line="";}
        for (const character of Array.from(word)) {if(length(line)===width){result.push(line);line="";}line+=character;}
      }
      result.push(line);
    }
    return result;
  };
  const lines: string[] = [], add = (value: string) => lines.push(...wrap(value,columns)), rule = () => lines.push("-".repeat(columns));
  add(`Recibo: ${receipt.reference}`);add(`Fecha: ${receipt.date}`);lines.push("");
  add(receipt.issuer.name);
  for(const line of [receipt.issuer.address,receipt.issuer.phone,receipt.issuer.email]) if(line)add(line);
  for(const section of receipt.sections){
    rule();add(section.title);lines.push("");
    for(const [rawLabel,rawValue] of section.rows){
      const label=`${clean(rawLabel)}:`,value=clean(rawValue);
      if(!/[\r\n]/.test(label+value)&&length(label)+2+length(value)<=columns)
        lines.push(label+" ".repeat(columns-length(label)-length(value))+value);
      else {add(label);for(const line of wrap(value,columns-2))lines.push(`  ${line}`);}
    }
    lines.push("");
  }
  rule();add(receipt.footer);
  return lines.join("\n")+"\n";
}
export const receiptTextColumns = (paper?: string) => paper==="80"?40:paper==="76"?38:paper==="58"?26:72;
