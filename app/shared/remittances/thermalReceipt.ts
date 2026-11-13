import { cleanReceiptFooterNote, formatSpacedTitleLines, isPrintedHighlightRow, isRecipientPrintedReceipt, isSignatureRow, printedReceiptHeading, receiptIssuerLines, type Receipt } from "./receipt";
export { thermalReceiptSize } from "./receiptPaper";

// Draw glyphs in the browser, not with the printer's resident fonts/code page.
// Eight dots/mm matches common 203 dpi POS printers. Short image blocks can
// paginate between rows without shrinking a long receipt onto one sheet.
// Layout coordinates/font sizes are millimetres, mapped to pixels by the transform.
const dotsPerMm = 8;
type Font = { size: number; bold?: boolean; mono?: boolean };
const regular: Font = { size: 2.8 }, bold: Font = { size: 2.8, bold: true };
const fontCss = (font: Font) => `${font.bold ? "bold " : ""}${font.size}px ${font.mono ? '"Consolas", "Courier New", Courier, monospace' : "Arial, Helvetica, sans-serif"}`;
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
  const wrap = (text: string, font: Font, maxLineWidth = innerWidth) => {
    const lines: string[] = [];
    for (const paragraph of text.normalize("NFC").replace(/\r\n?/g, "\n").split("\n")) {
      let line = "";
      for (const word of paragraph.trim().split(/\s+/u)) {
        if (!word) continue;
        if (textWidth(line ? `${line} ${word}` : word, font) <= maxLineWidth) { line = line ? `${line} ${word}` : word; continue; }
        if (line) { lines.push(line); line = ""; }
        for (const character of Array.from(word)) {
          if (line && textWidth(line + character, font) > maxLineWidth) { lines.push(line); line = ""; }
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
    const lines = wrap(value, font, align === "center" ? innerWidth - 0.2 : innerWidth), lineHeight = font.size * 1.18;
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
  const dashedRule = () => block(1.4, context => {
    context.lineWidth = 0.22;
    context.setLineDash([0.9, 0.65]);
    context.beginPath();
    context.moveTo(padLeft, 0.7);
    context.lineTo(rightX, 0.7);
    context.stroke();
    context.setLineDash([]);
  }, "Separador punteado");

  if (isRecipientPrintedReceipt(receipt) && receipt.recipientVoucher) {
    const v = receipt.recipientVoucher;
    const monoFont: Font = { size: widthMm < 50 ? 2.45 : 2.85, bold: true, mono: true };
    const titleFont: Font = { size: widthMm < 50 ? 2.9 : 3.35, bold: true, mono: true };
    const safeCenterWidth = innerWidth - 0.3;
    const rawTitle = v.companyTitle.normalize("NFC").trim().toUpperCase();
    if (rawTitle) {
      const spacedLines = formatSpacedTitleLines(rawTitle, (candidate) => textWidth(candidate, titleFont) <= safeCenterWidth);
      if (spacedLines.length) {
        const lineHeight = titleFont.size * 1.22;
        block(0.3 + spacedLines.length * lineHeight + 0.35, context => {
          context.font = fontCss(titleFont); context.textAlign = "center";
          spacedLines.forEach((line, index) => context.fillText(line, centerX, 0.3 + index * lineHeight));
        }, spacedLines.join("\n"));
      } else {
        text(rawTitle, titleFont, "center", 0.15);
      }
    }
    rule();
    const monoExactOrWrap = (value: string, extra = 0) => {
      const normalized = value.normalize("NFC");
      if (!/[\r\n]/.test(normalized) && textWidth(normalized, monoFont) <= innerWidth - 0.1) {
        const lineHeight = monoFont.size * 1.2;
        block(0.15 + extra + lineHeight + 0.2, context => {
          context.font = fontCss(monoFont); context.textAlign = "left";
          context.fillText(normalized, padLeft, 0.15 + extra);
        }, normalized);
      } else {
        text(normalized, monoFont, "left", extra);
      }
    };
    monoExactOrWrap(`Envío #: ${v.envioReference}`, 0.15);
    monoExactOrWrap(`Fecha  : ${v.voucherDateTime}`);
    text(v.recipientName, monoFont, "center", 1.3);
    text(`TELÉFONO: ${v.recipientPhone}`, monoFont, "center", 0.45);
    rule();
    text(`MONTO: ${v.sentAmount}`, monoFont, "center", 0.25);
    text(`RECIBE EN ${v.destinationCurrency}:`, monoFont, "left", 0.2);
    text(v.payoutAmountNumber, monoFont, "left");
    if (v.cancelledNote) text(v.cancelledNote, monoFont, "left", 0.45);
    text(v.warningLine, monoFont, "left", 1.4);
    text(v.claimsLine, monoFont, "left", 1.0);
    await Promise.all(Array.from(output.querySelectorAll("img")).map(image => image.decode()));
    return output;
  }

  const isPrinted = Boolean(receipt.printed);
  if (!isPrinted) { text(`Recibo ${receipt.reference}`, bold); text(receipt.date); }
  const logo = receipt.issuer.logoDataUrl;
  let hasHeader = !isPrinted;
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
  if (receipt.issuer.name) { text(receipt.issuer.name, { size: isPrinted ? 3.2 : 3.3, bold: true }, "center", 0.05); hasHeader = true; }
  const issuerLines = receiptIssuerLines(receipt.issuer, isPrinted);
  if (issuerLines.length) { text(issuerLines.join("\n"), regular, "center"); hasHeader = true; }
  if (isPrinted) {
    if (hasHeader) dashedRule();
    text(printedReceiptHeading, { size: 3.15, bold: true }, "center", 0.15);
  } else if (hasHeader) {
    rule();
  }
  const spaceGap = Math.max(0.9, textWidth(" ", regular));
  const wrapAfterFirst = (paragraph: string, maxFirst: number, font: Font = regular): { first: string; rest: string[] } => {
    const words = paragraph.trim().split(/\s+/u).filter(Boolean);
    if (!words.length) return { first: "", rest: [] };
    let first = "";
    let idx = 0;
    if (maxFirst >= 6) {
      while (idx < words.length) {
        const candidate = first ? `${first} ${words[idx]}` : words[idx];
        if (textWidth(candidate, font) <= maxFirst) { first = candidate; idx++; continue; }
        if (!first && textWidth(words[idx], font) > innerWidth && maxFirst >= 12) {
          for (const character of Array.from(words[idx])) {
            if (first && textWidth(first + character, font) > maxFirst) break;
            first += character;
          }
          const remainder = Array.from(words[idx]).slice(Array.from(first).length).join("");
          if (remainder) words[idx] = remainder; else idx++;
        }
        break;
      }
    }
    const remaining = words.slice(idx).join(" ");
    return { first, rest: remaining ? wrap(remaining, font) : [] };
  };
  const renderLabeledText = (labelText: string, valueText: string, labelFont: Font, valueFont: Font, topExtra = 0) => {
    const rowGap = Math.max(0.9, textWidth(" ", valueFont));
    const labelWidth = textWidth(labelText, labelFont), valueX = padLeft + labelWidth + rowGap;
    const baseHeight = valueFont.size > regular.size ? 3.85 : 3.55;
    if (!/[\r\n]/.test(valueText) && labelWidth <= innerWidth && valueX - padLeft + textWidth(valueText, valueFont) <= innerWidth) {
      block(topExtra + baseHeight, context => {
        const y = 0.15 + topExtra;
        context.font = fontCss(labelFont); context.fillText(labelText, padLeft, y);
        if (valueText) { context.font = fontCss(valueFont); context.fillText(valueText, valueX, y); }
      }, `${labelText} ${valueText}`);
    } else if (labelWidth > innerWidth) {
      text(labelText, labelFont, "left", topExtra);
      text(valueText, valueFont, "left");
    } else {
      const paragraphs = valueText.replace(/\r\n?/g, "\n").split("\n");
      const { first, rest } = wrapAfterFirst(paragraphs[0] ?? "", innerWidth - (valueX - padLeft), valueFont);
      const extraLines = [...rest];
      for (const paragraph of paragraphs.slice(1)) extraLines.push(...wrap(paragraph, valueFont));
      const totalLines = 1 + extraLines.length, lineHeight = valueFont.size * 1.18;
      for (let start = 0; start < totalLines; start += 10) {
        const end = Math.min(totalLines, start + 10), count = end - start, chunkExtra = start === 0 ? topExtra : 0;
        block(0.15 + chunkExtra + count * lineHeight + 0.2, context => {
          for (let offset = 0; offset < count; offset++) {
            const lineIndex = start + offset, y = 0.15 + chunkExtra + offset * lineHeight;
            if (lineIndex === 0) {
              context.font = fontCss(labelFont); context.fillText(labelText, padLeft, y);
              if (first) { context.font = fontCss(valueFont); context.fillText(first, valueX, y); }
            } else {
              const lineText = extraLines[lineIndex - 1];
              if (lineText) { context.font = fontCss(valueFont); context.fillText(lineText, padLeft, y); }
            }
          }
        }, start === 0 ? [first ? `${labelText} ${first}` : labelText, ...extraLines.slice(0, count - 1)].join("\n") : extraLines.slice(start - 1, end - 1).join("\n"));
      }
    }
  };
  let renderedSections = 0;
  for (const section of receipt.sections) {
    if (!section.rows.length) continue;
    const hasSignature = section.rows.some(([l, v]) => isSignatureRow(l, v));
    let pendingTop = isPrinted ? (renderedSections === 0 ? 0.15 : hasSignature ? 3.2 : 2.1) : 0;
    renderedSections++;
    if (section.title) {
      text(section.title, isPrinted ? regular : { size: 3.0, bold: true }, "left", isPrinted ? pendingTop : 0.1);
      pendingTop = 0;
    }
    for (const [rawLabel, rawValue] of section.rows) {
      const topExtra = pendingTop;
      pendingTop = 0;
      if (isSignatureRow(rawLabel, rawValue)) {
        const sigLabel = `${String(rawLabel).normalize("NFC")}:`, topY = 0.15 + topExtra;
        const sigLabelWidth = textWidth(sigLabel, regular), lineStartX = padLeft + sigLabelWidth + spaceGap, lineEndX = Math.max(lineStartX + 12, rightX - 3.5);
        block(topY + 3.45, context => {
          context.font = fontCss(regular);
          context.fillText(sigLabel, padLeft, topY);
          context.lineWidth = 0.22;
          const lineY = topY + regular.size * 0.98;
          context.beginPath();
          context.moveTo(lineStartX, lineY);
          context.lineTo(lineEndX, lineY);
          context.stroke();
        }, `${sigLabel} ________________________`);
        continue;
      }
      const label = `${String(rawLabel).normalize("NFC")}:`, value = String(rawValue).normalize("NFC");
      const highlight = isPrinted && isPrintedHighlightRow(rawLabel);
      const rowSize = isPrinted && String(rawLabel) === "Envío" ? 3.1 : regular.size;
      const labelFont: Font = isPrinted ? { size: rowSize, bold: highlight } : bold;
      const valueFont: Font = isPrinted ? { size: rowSize, bold: highlight } : regular;
      renderLabeledText(label, value, labelFont, valueFont, topExtra);
    }
    if (!isPrinted) rule();
  }
  if (isPrinted) {
    const cleanFooter = cleanReceiptFooterNote(receipt.footer);
    if (cleanFooter) renderLabeledText("Nota:", cleanFooter, bold, regular, 0);
  } else if (receipt.footer.trim()) {
    text(receipt.footer, { size: 2.65 }, "left", 0.05);
  }
  await Promise.all(Array.from(output.querySelectorAll("img")).map(image => image.decode()));
  return output;
}
