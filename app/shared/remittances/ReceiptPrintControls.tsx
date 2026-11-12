import { receiptPaperLabels, receiptPrintLayout, thermalReceiptSize, type ReceiptPaper, type ReceiptPrintOptions } from "./receiptPaper";
import { cleanReceiptFooterNote, isPrintedHighlightRow, isSheetVoucherPaper, isSignatureRow, printedReceiptHeading, receiptIssuerLines, receiptSections, type Receipt } from "./receipt";
import { receiptText } from "./receiptText";
export type { ReceiptPrintOptions } from "./receiptPaper";

function ReceiptPrintPreview({ receipt, options }: { receipt: Receipt; options: ReceiptPrintOptions }) {
  let layout: ReturnType<typeof receiptPrintLayout> | undefined;
  let validationError = "";
  try { layout = receiptPrintLayout(options); }
  catch (failure) { validationError = failure instanceof Error ? failure.message : "Ajusta las medidas del papel para ver la vista previa."; }
  if (!layout) return <div className="remittance-print-preview-stage"><p className="remittance-help">{validationError}</p></div>;

  const sections = receiptSections(receipt, options.compact);
  const thermal = thermalReceiptSize(options.paper);
  const sheetVoucherMode = Boolean(receipt.printed && receipt.sheetVoucher && isSheetVoucherPaper(options.paper));
  const badge = `${receiptPaperLabels[options.paper]}${options.compact ? " · Envío telefónico" : ""}`;
  if ((options.output ?? "graphics") === "text") {
    const formatted = receiptText({ ...receipt, sections }, layout.textColumns, sheetVoucherMode, Boolean(options.compact));
    return <div className="remittance-print-preview-stage">
      <div className="remittance-print-preview-caption"><strong>Vista previa de impresión</strong><span>{badge} · {layout.textColumns} col.</span></div>
      <div className="remittance-print-preview-scroll">
        <pre className={`remittance-print-preview-sheet remittance-print-preview-text${thermal ? " is-thermal" : ""}${sheetVoucherMode ? " is-sheet-voucher" : ""}`}
          aria-label="Vista previa del recibo para imprimir">{formatted}</pre>
      </div>
    </div>;
  }
  if (sheetVoucherMode && receipt.sheetVoucher) {
    const v = receipt.sheetVoucher;
    const compact = Boolean(options.compact);
    const previewWidthPx = layout.widthMm ? Math.round(layout.widthMm * 96 / 25.4) : 520;
    return <div className="remittance-print-preview-stage">
      <div className="remittance-print-preview-caption"><strong>Vista previa de impresión</strong><span>{badge}</span></div>
      <div className="remittance-print-preview-scroll">
        <div className="remittance-print-preview-sheet remittance-print-preview-sheet-voucher"
          style={{ width: `${previewWidthPx}px`, maxWidth: "100%" }}
          aria-label="Vista previa del recibo para imprimir">
          <div className="remittance-sheet-voucher-header">
            {v.companyTitle && <div className="remittance-sheet-voucher-company">{v.companyTitle}</div>}
            {v.issuerLines.map((line, index) => <div key={index} className="remittance-sheet-voucher-issuer-line">{line}</div>)}
            <div className="remittance-sheet-voucher-doc-title">{v.docHeading}</div>
          </div>
          <div className="remittance-sheet-voucher-meta">
            <div>Envío #: {v.envioReference}</div>
            <div>{"Fecha  : "}{v.voucherDateTime}</div>
            {!compact && <div>Cód. Operación: {v.operatingCode}</div>}
          </div>
          <div className="remittance-sheet-voucher-sender">
            <div>Remitente: {v.senderName}</div>
            {!compact && <div>Código del Cliente: {v.senderCode}</div>}
          </div>
          <div className="remittance-sheet-voucher-recipient">
            <div className="remittance-sheet-voucher-recipient-line">DESTINATARIO: {v.recipientName}</div>
            <div className="remittance-sheet-voucher-recipient-line">TELÉFONO: {v.recipientPhone}</div>
            {!compact && <div className="remittance-sheet-voucher-recipient-line">DIRECCIÓN: {v.recipientAddress}</div>}
          </div>
          <div className="remittance-sheet-voucher-amounts">
            <div className="remittance-sheet-voucher-monto">MONTO A ENVIAR: {v.sentAmount}</div>
            <div>Total pagado por el remitente: {v.totalPaidAmount}</div>
            {v.deliveryFeeAmount && <div>Cargo de entrega: {v.deliveryFeeAmount}</div>}
            <div>RECIBE EN {v.destinationCurrency}:</div>
            <div>{v.payoutAmountNumber}</div>
            <div className="remittance-sheet-voucher-payment">Forma pago del remitente: {v.paymentMethod}</div>
            {v.cancelledNote && <div className="remittance-sheet-voucher-cancelled">{v.cancelledNote}</div>}
          </div>
          <div className="remittance-sheet-voucher-signoff">
            {!compact && <div className="remittance-sheet-voucher-signature"><span>Recibido por: </span><span className="remittance-sheet-voucher-signature-line" aria-hidden="true" /></div>}
            <div>Registrado por: {v.registeredBy}</div>
          </div>
          <div className="remittance-sheet-voucher-notice">{v.warningLine}</div>
          {v.footerNote && <div className="remittance-sheet-voucher-note">Nota: {v.footerNote}</div>}
          <div className="remittance-sheet-voucher-claims">{v.claimsLine}</div>
        </div>
      </div>
    </div>;
  }
  const { issuer } = receipt;
  const isPrinted = Boolean(receipt.printed);
  const validLogo = issuer.logoDataUrl && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(issuer.logoDataUrl) && issuer.logoDataUrl.length <= 24576 ? issuer.logoDataUrl : "";
  const issuerLines = receiptIssuerLines(issuer, isPrinted);
  const hasHeader = Boolean(validLogo || issuer.name || issuerLines.length);
  const graphicWidthMm = thermal ? thermal.graphicWidthMm : layout.widthMm;
  const previewWidthPx = graphicWidthMm ? Math.round(graphicWidthMm * 96 / 25.4) : 520;
  const cleanFooter = cleanReceiptFooterNote(receipt.footer);
  return <div className="remittance-print-preview-stage">
    <div className="remittance-print-preview-caption"><strong>Vista previa de impresión</strong><span>{badge}</span></div>
    <div className="remittance-print-preview-scroll">
      <div className={`remittance-print-preview-sheet remittance-print-preview-graphic${thermal ? " is-thermal" : ""}${options.compact ? " is-compact" : ""}${isPrinted ? " is-printed" : ""}`}
        style={{ width: `${previewWidthPx}px`, maxWidth: "100%" }}
        aria-label="Vista previa del recibo para imprimir">
        {!isPrinted && <div className="remittance-preview-ref"><span>Recibo {receipt.reference}</span><span>{receipt.date}</span></div>}
        {hasHeader && <div className="remittance-preview-header">
          {validLogo && <img alt="" src={validLogo} />}
          {issuer.name && <div className="remittance-preview-company">{issuer.name}</div>}
          {issuerLines.map((line, index) => <div key={index} className="remittance-preview-company-line">{line}</div>)}
        </div>}
        {isPrinted && <div className="remittance-preview-doc-title">{printedReceiptHeading}</div>}
        {sections.map((section, sectionIndex) => <div key={`${section.title}-${sectionIndex}`} className={`remittance-preview-block${section.title ? "" : " is-meta"}`}>
          {section.title && <div className="remittance-preview-title">{section.title}</div>}
          {section.rows.map(([label, val], rowIndex) => {
            if (isSignatureRow(label, val)) {
              return <div key={`${String(label)}-${rowIndex}`} className="remittance-preview-row is-signature">
                <span className="remittance-preview-label">{label}:</span>{" "}
                <span className="remittance-preview-signature-line" aria-hidden="true" />
              </div>;
            }
            const highlight = isPrinted && isPrintedHighlightRow(label);
            return <div key={`${String(label)}-${rowIndex}`} className={`remittance-preview-row${highlight ? " is-highlight" : ""}${label === "Envío" ? " is-envio" : ""}`}>
              <span className="remittance-preview-label">{label}:</span>{" "}
              <span className="remittance-preview-value">{val}</span>
            </div>;
          })}
        </div>)}
        {cleanFooter && <div className="remittance-preview-footer">{isPrinted ? <><strong>Nota:</strong> {cleanFooter}</> : receipt.footer}</div>}
      </div>
    </div>
  </div>;
}

export function ReceiptPrintControls({ value, onChange, receipt }: { value: ReceiptPrintOptions; onChange: (value: ReceiptPrintOptions) => void; receipt?: Receipt }) {
  return <div className="remittance-panel remittance-print-controls-panel">
    <div className="remittance-print-controls-grid">
      <label>Papel de impresión<select aria-label="Papel de impresión" value={value.paper} onChange={(event) => {
        const paper = event.target.value;
        if (Object.hasOwn(receiptPaperLabels, paper)) onChange({ ...value, paper: paper as ReceiptPaper, orientation: "auto" });
      }}>{(["80", "76", "58", "51", "102", "auto", "letter", "a4", "8x4", "8x11", "custom"] as ReceiptPaper[]).map(paper => <option key={paper} value={paper}>{receiptPaperLabels[paper]}</option>)}</select></label>
      <label>Formato de impresión<select aria-label="Formato de impresión" value={value.output ?? "graphics"} onChange={event => { const output = event.target.value; if (output === "text" || output === "graphics") onChange({ ...value, output }); }}><option value="text">Solo texto (compatible con genérica)</option><option value="graphics">Con diseño (impresora gráfica)</option></select></label>
      <label>Orientación<select aria-label="Orientación" disabled={Boolean(thermalReceiptSize(value.paper))} value={thermalReceiptSize(value.paper) ? "portrait" : value.orientation ?? "auto"} onChange={event => {
        const orientation = event.target.value; if (orientation === "auto" || orientation === "portrait" || orientation === "landscape") onChange({ ...value, orientation });
      }}><option value="auto">Según el papel de la impresora</option><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></label>
      <label className="remittance-payment-check"><input type="checkbox" checked={value.compact} onChange={(event) => onChange({ ...value, compact: event.target.checked })} />Recibo resumido para envío telefónico</label>
    </div>
    {value.paper === "custom" && <div className="remittance-payment-cash">
      <label>Ancho del papel (mm)<input type="number" inputMode="decimal" min={50} max={320} step="0.1" value={value.customWidthMm ?? 210} onChange={event => onChange({ ...value, customWidthMm: event.target.value === "" ? "" : event.target.valueAsNumber })} /></label>
      <label>Alto del papel (mm)<input type="number" inputMode="decimal" min={50} max={600} step="0.1" value={value.customHeightMm ?? 297} onChange={event => onChange({ ...value, customHeightMm: event.target.value === "" ? "" : event.target.valueAsNumber })} /></label>
    </div>}
    {receipt && <ReceiptPrintPreview receipt={receipt} options={value} />}
    <p className="remittance-help">Para POS80-01 V6 USB usa «Rollo térmico de 3 pulgadas (80 mm · POS80)» y el papel de 80 mm en el diálogo del navegador, a escala 100% y sin márgenes adicionales.</p>
  </div>;
}
