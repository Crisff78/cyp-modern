import { receiptPaperLabels, thermalReceiptSize, type ReceiptPaper, type ReceiptPrintOptions } from "./receiptPaper";
export type { ReceiptPrintOptions } from "./receiptPaper";
export function ReceiptPrintControls({ value, onChange }: { value: ReceiptPrintOptions; onChange: (value: ReceiptPrintOptions) => void }) {
  return <div className="remittance-panel"><label>Papel de impresión<select aria-label="Papel de impresión" value={value.paper} onChange={(event) => {
    const paper = event.target.value;
    if (Object.hasOwn(receiptPaperLabels, paper)) onChange({ ...value, paper: paper as ReceiptPaper, orientation:"auto" });
  }}>{(["auto", ...Object.keys(receiptPaperLabels).filter(paper => paper !== "auto")] as ReceiptPaper[]).map(paper => <option key={paper} value={paper}>{receiptPaperLabels[paper]}</option>)}</select></label>
    <label>Orientación<select aria-label="Orientación" disabled={Boolean(thermalReceiptSize(value.paper))} value={thermalReceiptSize(value.paper) ? "portrait" : value.orientation ?? "auto"} onChange={event => {
      const orientation=event.target.value; if (orientation === "auto" || orientation === "portrait" || orientation === "landscape") onChange({...value,orientation});
    }}><option value="auto">Según el papel de la impresora</option><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></label>
    {value.paper === "custom" && <div className="remittance-payment-cash">
      <label>Ancho del papel (mm)<input type="number" inputMode="decimal" min={50} max={320} step="0.1" value={value.customWidthMm ?? 210} onChange={event => onChange({...value, customWidthMm:event.target.value === "" ? "" : event.target.valueAsNumber})} /></label>
      <label>Alto del papel (mm)<input type="number" inputMode="decimal" min={50} max={600} step="0.1" value={value.customHeightMm ?? 297} onChange={event => onChange({...value, customHeightMm:event.target.value === "" ? "" : event.target.valueAsNumber})} /></label>
    </div>}
    <label>Formato de impresión<select aria-label="Formato de impresión" value={value.output ?? "graphics"} onChange={event=>{const output=event.target.value;if(output==="text"||output==="graphics")onChange({...value,output});}}><option value="text">Solo texto (compatible con genérica)</option><option value="graphics">Con diseño (impresora gráfica)</option></select></label>
    <label className="remittance-payment-check"><input type="checkbox" checked={value.compact} onChange={(event) => onChange({ ...value, compact: event.target.checked })} />Recibo resumido para envío telefónico</label>
    <p className="remittance-help">El recibo se distribuye para el papel y la orientación elegidos. En el diálogo de impresión selecciona el mismo tamaño en tu impresora. «Automático» usa el área de página disponible; no identifica la impresora ni sus medidas. Los rollos se imprimen en vertical y continúan en el papel o en más páginas, sin reducir toda la letra.</p>
    <p className="remittance-help">Para «Generic / Text Only» usa «Solo texto»: conserva columnas, espacios y saltos de línea. Si las tildes salen como símbolos, hay que ajustar la tabla de caracteres de la impresora y el controlador. «Con diseño» conserva los acentos como imagen en los rollos y necesita un controlador gráfico.</p>
  </div>;
}
