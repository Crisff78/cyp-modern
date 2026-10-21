import type { Currency, Quotation, Transfer } from "./types";
import { formatMoney as money } from "./output";
import { formatCrossRate } from "./crossRate";
import { rateMoment } from "./suggestions";
import { allocationRows } from "./commissionOutput";

/** Presentation only: every amount and the frozen rates come from the server. */
export function QuoteDetails({ quote }: { quote: Quotation }) {
  const crossRate = formatCrossRate(quote.quote.sourceRate, quote.quote.destinationRate);
  const saved = "status" in quote;
  const rateDate = (currency: Currency, date?: string) => currency === "DOP"
    ? "Moneda base: tasa fija de 1"
    : !date ? "Fecha de registro no disponible"
    : `${saved ? "Tasa registrada el" : "Última tasa registrada:"} ${date}${date < quote.quote.date ? " · Vigente desde ese día" : ""}`;
  return <div className="remittance-quote-details" aria-label="Desglose de la cotización">
    <div className="remittance-quote-parties">
      <section className="remittance-quote-card" aria-label="Paga el remitente">
        <h3>Paga el remitente</h3>
        <dl className="remittance-summary">
          <div><dt>Principal</dt><dd>{money(quote.amount, quote.sourceCurrency)}</dd></div>
          <div><dt>Comisión ({quote.commissionBps / 100}%)</dt><dd>{money(quote.commissionAmount, quote.sourceCurrency)}</dd></div>
          <div className="remittance-total"><dt>Total que paga el remitente</dt><dd>{money(quote.totalAmount, quote.sourceCurrency)}</dd></div>
        </dl>
      </section>
      <section className="remittance-quote-card" aria-label="Recibe el destinatario">
        <h3>Recibe el destinatario</h3>
        <dl className="remittance-summary">
          <div className="remittance-total"><dt>Recibe el destinatario</dt><dd>{money(quote.receiveAmount, quote.destinationCurrency)}</dd></div>
          {quote.requestedReceiveAmount !== undefined && <div><dt>Destino solicitado</dt><dd>{money(quote.requestedReceiveAmount, quote.destinationCurrency)}{Boolean(quote.receiveRoundingDifference) && <small role="status"> El importe real difiere por redondeo: {money(quote.receiveRoundingDifference!, quote.destinationCurrency)}. Confirma el importe real antes de continuar.</small>}</dd></div>}
        </dl>
        <p className="remittance-help">La comisión se paga en origen; no se descuenta del monto a recibir.</p>
      </section>
    </div>
    <section className="remittance-quote-conversion" aria-label="Conversión por pesos dominicanos">
      <h3>Conversión por pesos dominicanos</h3>
      <ol className="remittance-conversion-steps">
        <li><span>Principal en origen</span><strong>{money(quote.amount, quote.sourceCurrency)}</strong></li>
        <li><span>Equivalente del principal en DOP</span><strong>{quote.amountDop === undefined ? "No disponible para esta operación" : money(quote.amountDop, "DOP")}</strong></li>
        <li><span>Monto en destino</span><strong>{money(quote.receiveAmount, quote.destinationCurrency)}</strong></li>
      </ol>
      <dl className="remittance-summary remittance-quote-rates">
        <div><dt>Valor de 1 {quote.sourceCurrency} en pesos</dt><dd>1 {quote.sourceCurrency} = {quote.quote.sourceRate} DOP<small>{rateDate(quote.sourceCurrency, quote.quote.sourceRateDate)}</small></dd></div>
        <div><dt>Valor de 1 {quote.destinationCurrency} en pesos</dt><dd>1 {quote.destinationCurrency} = {quote.quote.destinationRate} DOP<small>{rateDate(quote.destinationCurrency, quote.quote.destinationRateDate)}</small></dd></div>
        <div><dt>Tasa de origen a destino</dt><dd>1 {quote.sourceCurrency} {crossRate.approximate ? "≈" : "="} {crossRate.text} {quote.destinationCurrency}{crossRate.approximate && <small> (tasa mostrada redondeada)</small>}</dd></div>
        <div><dt>Hora de cotización</dt><dd>{rateMoment(quote.quote.quotedAt)}</dd></div>
      </dl>
      <p className="remittance-help">El principal se multiplica por la tasa de origen y se divide entre la tasa de destino. El equivalente en pesos es informativo; los importes finales se redondean a centavos.</p>
    </section>
    {quote.commissionAllocation && <details className="remittance-commission-details"><summary>Reparto de la comisión entre empresa y gestor</summary><dl className="remittance-summary">{allocationRows(quote.commissionAllocation, saved ? (quote as Transfer).status : undefined).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="remittance-help">Este reparto sale de la comisión ya cobrada. No es otro cargo al remitente ni un descuento al destinatario.</p></details>}
  </div>;
}
