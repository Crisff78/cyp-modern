import type { Receipt } from "./receipt";

export function RemittanceReceipt({ receipt }: { receipt: Receipt }) {
  const { issuer } = receipt;
  return <article className="remittance-customer-receipt" aria-label="Recibo del envío de dinero">
    <div className="remittance-receipt-reference"><strong>Recibo {receipt.reference}</strong><time>{receipt.date}</time></div>
    <p><span className={`remittance-status ${receipt.status}`}>{receipt.status === "paid" ? "Pagado" : receipt.status === "cancelled" ? "Cancelado" : "Pendiente de entrega"}</span></p>
    <header className="remittance-receipt-company">
      {issuer.logoDataUrl && <img alt="Logo de la empresa" src={issuer.logoDataUrl} />}
      <h2>{issuer.name}</h2>{[issuer.address, issuer.phone, issuer.email].filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
    </header>
    <div className="remittance-receipt-sections">{receipt.sections.map((section) => <section key={section.title}><h3>{section.title}</h3><dl className="remittance-summary">{section.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>)}</div>
    <footer>{receipt.footer}</footer>
  </article>;
}
