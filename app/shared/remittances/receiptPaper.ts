export const receiptPaperLabels = {
  auto: "Automático · papel elegido en la impresora", "51": "Rollo de 2 pulgadas (51 mm)", "58": "Rollo térmico de 58 mm",
  "76": "Rollo de 76 mm (impacto / matricial)", "80": "Rollo térmico de 3 pulgadas (80 mm)", "102": "Rollo de 4 pulgadas (102 mm)",
  letter: "Carta (8½ × 11 pulgadas)", a4: "A4", "8x4": "Hoja de 8 × 4 pulgadas", "8x11": "Hoja de 8 × 11 pulgadas", custom: "Medidas personalizadas",
} as const;
export type ReceiptPaper = keyof typeof receiptPaperLabels;
export type PrintedReceiptAudience = "sender" | "recipient";
export const printedReceiptAudienceLabels: Record<PrintedReceiptAudience, string> = {
  sender: "Para quien envía (comprobante de envío)",
  recipient: "Para quien recibe (comprobante de recepción)",
};
// What the recipient is given: the common voucher, or the one used for Haiti.
export type RecipientReceiptFormat = "common" | "haiti";
export const recipientReceiptFormatLabels: Record<RecipientReceiptFormat, string> = { common: "Común", haiti: "Haití" };
export type ReceiptPrintOptions = { paper: ReceiptPaper; compact: boolean;
  orientation?: "auto" | "portrait" | "landscape"; customWidthMm?: number | ""; customHeightMm?: number | "";
  audience?: PrintedReceiptAudience; recipientFormat?: RecipientReceiptFormat };

const RECEIPT_PRINT_STORAGE_KEY = "cyp.remittances.receiptPrintOptions";
export const defaultReceiptPrintOptions: ReceiptPrintOptions = { paper: "80", compact: false };

export function readSavedReceiptPrintOptions(): ReceiptPrintOptions {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(RECEIPT_PRINT_STORAGE_KEY);
    if (!raw) return defaultReceiptPrintOptions;
    const parsed = JSON.parse(raw) as Partial<ReceiptPrintOptions>;
    const paper = typeof parsed.paper === "string" && Object.hasOwn(receiptPaperLabels, parsed.paper) ? parsed.paper as ReceiptPaper : defaultReceiptPrintOptions.paper;
    const orientation = parsed.orientation === "auto" || parsed.orientation === "portrait" || parsed.orientation === "landscape" ? parsed.orientation : undefined;
    const customWidthMm = typeof parsed.customWidthMm === "number" && Number.isFinite(parsed.customWidthMm) && parsed.customWidthMm >= 50 && parsed.customWidthMm <= 320 ? parsed.customWidthMm : undefined;
    const customHeightMm = typeof parsed.customHeightMm === "number" && Number.isFinite(parsed.customHeightMm) && parsed.customHeightMm >= 50 && parsed.customHeightMm <= 600 ? parsed.customHeightMm : undefined;
    const recipientFormat = parsed.recipientFormat === "haiti" ? "haiti" as const : undefined;
    return { paper, compact: Boolean(parsed.compact), ...(orientation ? { orientation } : {}), ...(customWidthMm ? { customWidthMm } : {}), ...(customHeightMm ? { customHeightMm } : {}),
      ...(recipientFormat ? { recipientFormat } : {}) };
  } catch {
    return defaultReceiptPrintOptions;
  }
}

export function saveReceiptPrintOptions(options: ReceiptPrintOptions) {
  try {
    const { audience: _audience, ...persisted } = options;
    if (typeof localStorage !== "undefined") localStorage.setItem(RECEIPT_PRINT_STORAGE_KEY, JSON.stringify(persisted));
  } catch { /* ignore storage quota / private mode */ }
}

/**
 * widthMm is the printable width of the roll, without the hardware edge margins (e.g. POS80-01 V6 USB reports 72.1 mm on an 80 mm roll).
 * graphicWidthMm is the width drawn: right up to the physical printhead window (~67.4 mm from GDI x=0 on POS80-01 V6 USB) without clipping.
 */
export function thermalReceiptSize(paper?: string) {
  if (paper === "80") return {widthMm:72, graphicWidthMm:66, marginMm:0};
  if (paper === "76") return {widthMm:70, graphicWidthMm:63, marginMm:0};
  if (paper === "58") return {widthMm:48, graphicWidthMm:45, marginMm:0};
  if (paper === "51") return {widthMm:45, graphicWidthMm:42, marginMm:0};
  if (paper === "102") return {widthMm:96, graphicWidthMm:92, marginMm:0};
  return undefined;
}

/** Use a known paper, never an unchecked string in print CSS. The native dialog still selects the actual printer. */
export function receiptPrintLayout(options: ReceiptPrintOptions) {
  if (!Object.hasOwn(receiptPaperLabels, options.paper)) throw new Error("Selecciona un tamaño de papel válido.");
  if (options.orientation !== undefined && !["auto", "portrait", "landscape"].includes(options.orientation)) throw new Error("Selecciona una orientación válida.");
  const thermal = thermalReceiptSize(options.paper);
  if (thermal) return {pageSize:"auto", marginMm:thermal.marginMm, widthMm:thermal.widthMm, thermal:true, landscape:false};
  if (options.paper === "auto") return {pageSize:options.orientation && options.orientation !== "auto" ? options.orientation : "auto",
    marginMm:8, widthMm:undefined, thermal:false, landscape:options.orientation === "landscape"};
  let [width, height] = options.paper === "letter" ? [215.9,279.4] : options.paper === "a4" ? [210,297]
    : options.paper === "8x4" ? [203.2,101.6] : options.paper === "8x11" ? [203.2,279.4] : [options.customWidthMm ?? 210, options.customHeightMm ?? 297];
  if (typeof width !== "number" || !Number.isFinite(width) || width < 50 || width > 320) throw new Error("El ancho del papel debe estar entre 50 y 320 mm.");
  if (typeof height !== "number" || !Number.isFinite(height) || height < 50 || height > 600) throw new Error("El alto del papel debe estar entre 50 y 600 mm.");
  if (options.orientation === "portrait") [width,height] = [Math.min(width,height),Math.max(width,height)];
  if (options.orientation === "landscape") [width,height] = [Math.max(width,height),Math.min(width,height)];
  const marginMm = Math.min(width, height) < 120 ? 4 : 8;
  const widthMm = Math.round((width - marginMm * 2) * 100) / 100;
  // Do not shrink the type to fit: narrower sheets wrap into more lines/pages.
  return {pageSize:`${width}mm ${height}mm`, marginMm, widthMm, thermal:false, landscape:width > height};
}
