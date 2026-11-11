import { receiptIssuerLines, type Receipt } from "./receipt";
export { thermalReceiptSize } from "./receiptPaper";

// Draw glyphs in the browser, not with the printer's resident fonts/code page.
// Eight dots/mm matches common 203 dpi POS printers. Short image blocks can
// paginate between rows without shrinking a long receipt onto one sheet.
// Layout coordinates/font sizes are millimetres, mapped to pixels by the transform.
const dotsPerMm = 8;
type Font = { size: number; bold?: boolean };
const regular: Font = { size: 2.8 }, bold: Font = { size: 2.8, bold: true };
const fontCss = (font: Font) => `${font.bold ? "bold " : ""}${font.size}px Arial, Helvetica, sans-serif`;
export async function thermalReceiptImages(document: Document, receipt: Receipt, widthMm: number, compact = false) {
  if (!Number.isFinite(widthMm) || widthMm < 40 || widthMm > 102) throw new Error("Tamaño de recibo no válido.");
  const padLeft = 0.5, padRight = 1, innerWidth = widthMm - padLeft - padRight, centerX = padLeft + innerWidth / 2, rightX = widthMm - padRight;
  await document.fonts?.ready;
  const probe = document.createElement("canvas"), measure = probe.getContext("2d");
  if (!measure) throw new Error("El navegador no puede preparar la impresión gráfica.");
  const output = document.createElement("main");
  output.className = "thermal-image-output";
  output.setAttribute("aria-label", "Recibo para impresión térmica");
  const textWidth = (text: string, font: Font) => { measure.font = fontCss(font); return measure.measureText(text).width; };
  const wrap = (text: string, font: Font) => {
    const lines: string[] = [];
    for (const paragraph of text.normalize("NFC").replace(/\r\n?/g, "\n").split("\n")) {
      let line = "";
      for (const word of paragraph.trim().split(/\s+/u)) {
        if (!word) continue;
        if (textWidth(line ? `${line} ${word}` : word, font) <= innerWidth) { line = line ? `${line} ${word}` : word; continue; }
        if (line) { lines.push(line); line = ""; }
        for (const character of Array.from(word)) {
          if (line && textWidth(line + character, font) > innerWidth) { lines.push(line); line = ""; }
          line += character;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const block = (heightMm: number, draw: (context: CanvasRenderingContext2D) => void, alternative: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(widthMm * dotsPerMm); canvas.height = Math.ceil(heightMm * dotsPerMm);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("El navegador no puede preparar la impresión gráfica.");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(dotsPerMm, dotsPerMm); context.fillStyle = "#000"; context.strokeStyle = "#000"; context.textBaseline = "top";
    draw(context);
    const image = document.createElement("img");
    image.alt = alternative; image.width = canvas.width; image.height = canvas.height;
    image.style.cssText = `display:block;width:${widthMm}mm;height:auto;max-width:100%;break-inside:avoid;page-break-inside:avoid;`;
    image.src = canvas.toDataURL("image/png");
    output.append(image);
  };
  const text = (value: string, font: Font = regular, align: "left" | "center" | "right" = "left", extra = 0) => {
    const lines = wrap(value, font), lineHeight = font.size * 1.45;
    for (let start = 0; start < lines.length; start += 10) {
      const group = lines.slice(start, start + 10);
      block(group.length * lineHeight + 1.2 + (start === 0 ? extra : 0), context => {
        context.font = fontCss(font); context.textAlign = align;
        const x = align === "center" ? centerX : align === "right" ? rightX : padLeft;
        group.forEach((line, index) => context.fillText(line, x, 0.6 + (start === 0 ? extra : 0) + index * lineHeight));
      }, group.join("\n"));
    }
  };
  const rule = () => block(2.4, context => { context.lineWidth = 0.2; context.beginPath(); context.moveTo(padLeft, 1.2); context.lineTo(rightX, 1.2); context.stroke(); }, "Separador");

  block(6, () => {}, "Margen superior");
  if (!receipt.printed) { text(`Recibo ${receipt.reference}`, bold); text(receipt.date); }
  const logo = receipt.issuer.logoDataUrl;
  let hasHeader = !receipt.printed;
  if (logo && logo.length <= 24576 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo)) {
    const image = document.createElement("img");
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 3000);
      image.onload = image.onerror = () => { clearTimeout(timer); resolve(); }; image.src = logo;
    });
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      const scale = Math.min(Math.min(38, innerWidth) / image.naturalWidth, 16 / image.naturalHeight), width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      block(height + 2, context => context.drawImage(image, padLeft + (innerWidth - width) / 2, 1, width, height), "Logo de la empresa");
      hasHeader = true;
    }
  }
  if (receipt.issuer.name) { text(receipt.issuer.name, { size: 3.6, bold: true }, "center", 0.8); hasHeader = true; }
  for (const line of receiptIssuerLines(receipt.issuer, Boolean(receipt.printed))) { text(line, regular, "center"); hasHeader = true; }
  if (hasHeader) rule();
  for (const section of receipt.sections) {
    if (!section.rows.length) continue;
    if (section.title) text(section.title, {size: 3.1, bold: true}, "left", compact ? 1 : 1.8);
    for (const [rawLabel, rawValue] of section.rows) {
      const label = `${String(rawLabel).normalize("NFC")}:`, value = String(rawValue).normalize("NFC");
      const valueWidth = textWidth(value, regular), gap = 4;
      if (!/[\r\n]/.test(value) && textWidth(label, bold) + gap + valueWidth <= innerWidth) {
        block(5.6, context => {
          context.font = fontCss(bold); context.fillText(label, padLeft, 0.8);
          context.font = fontCss(regular); context.textAlign = "right"; context.fillText(value, rightX, 0.8);
        }, `${label} ${value}`);
      } else {
        text(label, bold);
        const wrapped = wrap(value, regular);
        text(value, regular, wrapped.length === 1 ? "right" : "left");
      }
    }
    rule();
  }
  text(receipt.footer, {size: 2.65});
  block(3, () => {}, "Margen inferior");
  await Promise.all(Array.from(output.querySelectorAll("img")).map(image => image.decode()));
  return output;
}
