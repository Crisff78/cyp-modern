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
  const padLeft = 0.25, padRight = 0.35, innerWidth = widthMm - padLeft - padRight, centerX = padLeft + innerWidth / 2, rightX = widthMm - padRight;
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
    const lines = wrap(value, font), lineHeight = font.size * 1.18;
    for (let start = 0; start < lines.length; start += 10) {
      const group = lines.slice(start, start + 10), topPad = 0.15 + (start === 0 ? extra : 0);
      block(topPad + group.length * lineHeight + 0.2, context => {
        context.font = fontCss(font); context.textAlign = align;
        const x = align === "center" ? centerX : align === "right" ? rightX : padLeft;
        group.forEach((line, index) => context.fillText(line, x, topPad + index * lineHeight));
      }, group.join("\n"));
    }
  };
  const rule = () => block(1, context => { context.lineWidth = 0.2; context.beginPath(); context.moveTo(padLeft, 0.5); context.lineTo(rightX, 0.5); context.stroke(); }, "Separador");

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
      let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
      try {
        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = sw; cropCanvas.height = sh;
        const cropCtx = cropCanvas.getContext("2d");
        if (cropCtx) {
          cropCtx.drawImage(image, 0, 0);
          const pixels = cropCtx.getImageData(0, 0, sw, sh).data;
          const isInk = (offset: number) => pixels[offset + 3] >= 16 && (pixels[offset] < 248 || pixels[offset + 1] < 248 || pixels[offset + 2] < 248);
          let top = sh, bottom = -1, left = sw, right = -1;
          for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (isInk((y * sw + x) * 4)) {
            if (y < top) top = y;
            if (y > bottom) bottom = y;
            if (x < left) left = x;
            if (x > right) right = x;
          }
          if (bottom >= top && right >= left) { sx = left; sy = top; sw = right - left + 1; sh = bottom - top + 1; }
        }
      } catch { /* fallback to natural image bounds */ }
      const scale = Math.min(Math.min(38, innerWidth) / sw, (compact ? 9 : 11) / sh), width = sw * scale, height = sh * scale;
      block(height + 0.5, context => context.drawImage(image, sx, sy, sw, sh, padLeft + (innerWidth - width) / 2, 0.25, width, height), "Logo de la empresa");
      hasHeader = true;
    }
  }
  if (receipt.issuer.name) { text(receipt.issuer.name, { size: 3.3, bold: true }, "center", 0.05); hasHeader = true; }
  const issuerLines = receiptIssuerLines(receipt.issuer, Boolean(receipt.printed));
  if (issuerLines.length) { text(issuerLines.join("\n"), regular, "center"); hasHeader = true; }
  if (hasHeader) rule();
  const spaceGap = Math.max(0.9, textWidth(" ", regular));
  const wrapAfterFirst = (paragraph: string, maxFirst: number): { first: string; rest: string[] } => {
    const words = paragraph.trim().split(/\s+/u).filter(Boolean);
    if (!words.length) return { first: "", rest: [] };
    let first = "";
    let idx = 0;
    if (maxFirst >= 6) {
      while (idx < words.length) {
        const candidate = first ? `${first} ${words[idx]}` : words[idx];
        if (textWidth(candidate, regular) <= maxFirst) { first = candidate; idx++; continue; }
        if (!first && textWidth(words[idx], regular) > innerWidth && maxFirst >= 12) {
          for (const character of Array.from(words[idx])) {
            if (first && textWidth(first + character, regular) > maxFirst) break;
            first += character;
          }
          const remainder = Array.from(words[idx]).slice(Array.from(first).length).join("");
          if (remainder) words[idx] = remainder; else idx++;
        }
        break;
      }
    }
    const remaining = words.slice(idx).join(" ");
    return { first, rest: remaining ? wrap(remaining, regular) : [] };
  };
  for (const section of receipt.sections) {
    if (!section.rows.length) continue;
    if (section.title) text(section.title, { size: 3.0, bold: true }, "left", 0.1);
    for (const [rawLabel, rawValue] of section.rows) {
      const label = `${String(rawLabel).normalize("NFC")}:`, value = String(rawValue).normalize("NFC");
      const labelWidth = textWidth(label, bold), valueX = padLeft + labelWidth + spaceGap;
      if (!/[\r\n]/.test(value) && labelWidth <= innerWidth && valueX - padLeft + textWidth(value, regular) <= innerWidth) {
        block(3.55, context => {
          context.font = fontCss(bold); context.fillText(label, padLeft, 0.15);
          if (value) { context.font = fontCss(regular); context.fillText(value, valueX, 0.15); }
        }, `${label} ${value}`);
      } else if (labelWidth > innerWidth) {
        text(label, bold);
        text(value, regular, "left");
      } else {
        const paragraphs = value.replace(/\r\n?/g, "\n").split("\n");
        const { first, rest } = wrapAfterFirst(paragraphs[0] ?? "", innerWidth - (valueX - padLeft));
        const extraLines = [...rest];
        for (const paragraph of paragraphs.slice(1)) extraLines.push(...wrap(paragraph, regular));
        const totalLines = 1 + extraLines.length, lineHeight = regular.size * 1.18;
        for (let start = 0; start < totalLines; start += 10) {
          const end = Math.min(totalLines, start + 10), count = end - start;
          block(0.15 + count * lineHeight + 0.2, context => {
            for (let offset = 0; offset < count; offset++) {
              const lineIndex = start + offset, y = 0.15 + offset * lineHeight;
              if (lineIndex === 0) {
                context.font = fontCss(bold); context.fillText(label, padLeft, y);
                if (first) { context.font = fontCss(regular); context.fillText(first, valueX, y); }
              } else {
                const lineText = extraLines[lineIndex - 1];
                if (lineText) { context.font = fontCss(regular); context.fillText(lineText, padLeft, y); }
              }
            }
          }, start === 0 ? [first ? `${label} ${first}` : label, ...extraLines.slice(0, count - 1)].join("\n") : extraLines.slice(start - 1, end - 1).join("\n"));
        }
      }
    }
    rule();
  }
  if (receipt.footer.trim()) text(receipt.footer, { size: 2.65 }, "left", 0.05);
  await Promise.all(Array.from(output.querySelectorAll("img")).map(image => image.decode()));
  return output;
}
