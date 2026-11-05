export type ReceiptPrintOptions = { paper: "auto" | "76" | "80" | "58"; compact: boolean; output?: "graphics" | "text" };
export function ReceiptPrintControls({ value, onChange }: { value: ReceiptPrintOptions; onChange: (value: ReceiptPrintOptions) => void }) {
  return <div className="remittance-panel"><label>Papel de impresión<select aria-label="Papel de impresión" value={value.paper} onChange={(event) => {
    const paper = event.target.value;
    if (paper === "auto" || paper === "76" || paper === "80" || paper === "58") onChange({ ...value, paper });
  }}><option value="auto">Papel normal (Carta / A4)</option><option value="76">Térmico 76 mm</option><option value="80">Térmico 3 pulgadas (80 mm)</option><option value="58">Térmico 58 mm</option></select></label>
    <label>Formato de impresión<select aria-label="Formato de impresión" value={value.output ?? "graphics"} onChange={event=>{const output=event.target.value;if(output==="text"||output==="graphics")onChange({...value,output});}}><option value="text">Solo texto (compatible con genérica)</option><option value="graphics">Con diseño (impresora gráfica)</option></select></label>
    <label className="remittance-payment-check"><input type="checkbox" checked={value.compact} onChange={(event) => onChange({ ...value, compact: event.target.checked })} />Recibo resumido para envío telefónico</label>
    <p className="remittance-help">Selecciona el mismo papel en el diálogo de impresión. Para «Generic / Text Only» usa «Solo texto»: conserva columnas, espacios y saltos de línea. Si las tildes salen como símbolos, hay que ajustar la tabla de caracteres de la impresora y el controlador; el navegador no puede cambiarla. «Con diseño» conserva los acentos como imagen y necesita un controlador gráfico.</p>
  </div>;
}
