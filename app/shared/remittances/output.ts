import { encodeCsvCell } from "../csv";

export const formatMoney = (cents: number, currency: string) => {
  const exact = BigInt(cents);
  const absolute = exact < 0n ? -exact : exact;
  const whole = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 }).format(absolute / 100n);
  return `${currency} ${exact < 0n ? "-" : ""}${whole}.${String(absolute % 100n).padStart(2, "0")}`;
};
export const formatDate = (value?: string) => value ? new Intl.DateTimeFormat("es-DO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santo_Domingo" }).format(new Date(value)) : "—";
export const decimalCents = (value: string, allowZero = false) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error("Escribe un importe con un máximo de dos decimales.");
  const [whole, fraction = ""] = value.trim().split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < 0n || (!allowZero && result === 0n)) throw new Error("El importe está fuera del rango permitido.");
  return Number(result);
};
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
export type OutputSection = { title: string; columns: string[]; rows: (string | number)[][] };
export function printSections(title: string, sections: OutputSection[], subtitle = "CyP · Envíos de Dinero", options: { footerNote?: string } = {}) {
  const popup = window.open("", "_blank", "width=1000,height=750");
  if (!popup) throw new Error("Permite abrir la ventana de impresión para este sitio.");
  popup.opener = null;
  popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:13px Arial,sans-serif;color:#172033;margin:24px}h1{font-size:21px}h2{font-size:16px;margin-top:24px}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ccd4e0;padding:7px;text-align:left;overflow-wrap:anywhere}th{background:#e7edf5}thead{display:table-header-group}tr{break-inside:avoid}footer{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:18px}@page{size:landscape;margin:12mm}</style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p>${sections.map((section) => `<h2>${escapeHtml(section.title)}</h2><table><thead><tr>${section.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${section.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`).join("")}${options.footerNote ? `<footer>${escapeHtml(options.footerNote)}</footer>` : ""}</body></html>`);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 250);
}
export function exportSections(filename: string, sections: OutputSection[]) {
  const cell = (value: unknown) => encodeCsvCell(value, ";", true);
  const content = sections.flatMap((section) => [[section.title], section.columns, ...section.rows, []]).map((row) => row.map(cell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = `${filename}.csv`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
