export type ReceiptPaper = "auto" | "58" | "80";

export function ReceiptPaperSelect({ value, onChange, className }: Readonly<{
  value: ReceiptPaper; onChange: (value: ReceiptPaper) => void; className?: string;
}>) {
  return <label className={className}>Papel de impresión
    <select aria-label="Papel de impresión" value={value} onChange={(event) => {
      const paper = event.target.value;
      if (paper === "auto" || paper === "58" || paper === "80") onChange(paper);
    }}>
      <option value="auto">Papel de la impresora (A4 / Carta / otro)</option>
      <option value="58">Térmico 58 mm</option>
      <option value="80">Térmico 80 mm</option>
    </select>
  </label>;
}
