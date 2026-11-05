export type ReceiptPrintOptions = { paper: "auto" | "76" | "80" | "58"; compact: boolean };
export function ReceiptPrintControls({ value, onChange }: { value: ReceiptPrintOptions; onChange: (value: ReceiptPrintOptions) => void }) {
  return <div className="remittance-panel"><label>Papel de impresión<select aria-label="Papel de impresión" value={value.paper} onChange={(event) => {
    const paper = event.target.value;
    if (paper === "auto" || paper === "76" || paper === "80" || paper === "58") onChange({ ...value, paper });
  }}><option value="auto">Papel normal (Carta / A4)</option><option value="76">Térmico 76 mm</option><option value="80">Térmico 3 pulgadas (80 mm)</option><option value="58">Térmico 58 mm</option></select></label>
    <label className="remittance-payment-check"><input type="checkbox" checked={value.compact} onChange={(event) => onChange({ ...value, compact: event.target.checked })} />Recibo resumido para envío telefónico</label>
    <p className="remittance-help">Selecciona también ese tamaño de papel en el diálogo de impresión. La impresión térmica conserva acentos y separación como imagen: usa el controlador del fabricante, no «Generic / Text Only». El resumen conserva referencia, fecha, nombres, teléfonos, importes, pago y pie de la empresa.</p>
  </div>;
}
