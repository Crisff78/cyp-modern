import type { Currency, Quotation, ReceiveRounding, Transfer } from "./types";
import { payoutOf } from "./types";
import { formatMoney as money } from "./output";
import { formatCrossRate } from "./crossRate";
import { rateMoment } from "./suggestions";
import { allocationRows } from "./commissionOutput";
import { rateKindLabel } from "./appliedRate.mjs";

export const receiveRoundingLabels: Record<ReceiveRounding, string> = {
  none: "Sin redondear (con centavos)", normal: "Normal (al entero más cercano)", up: "Siempre hacia arriba (al entero siguiente)",
};
export const roundingHelp: Record<ReceiveRounding, string> = {
  none: "Lo que recibe la persona se paga con sus centavos.",
  normal: "Lo que recibe la persona se redondea al entero más cercano.",
  up: "Lo que recibe la persona se redondea siempre al entero siguiente.",
};

/** Presentation only: every amount and the frozen rates come from the server. */
export function QuoteDetails({ quote }: { quote: Quotation }) {
  const crossRate = formatCrossRate(quote.quote.sourceRate, quote.quote.destinationRate);
  const saved = "status" in quote;
  const calculation = quote.calculation;
  const payout = payoutOf(quote);
  const rateDate = (currency: Currency, date?: string) => currency === "DOP"
    ? "Moneda base: tasa fija de 1"
    : !date ? "Fecha de registro no disponible"
    : `${saved ? "Tasa registrada el" : "Última tasa registrada:"} ${date}${date < quote.quote.date ? " · Vigente desde ese día" : ""}`;
  // The box that was typed and the amount the calculation could reach (cents that cannot be split exactly).
  const totalAsked = calculation?.amountMode === "total" && calculation.requestedAmount !== quote.totalAmount ? calculation.requestedAmount : undefined;
  const receiveAsked = calculation?.amountMode === "destination" && calculation.requestedAmount !== payout ? calculation.requestedAmount : undefined;
  const gain = calculation?.exchangeGain;
  return <div className="remittance-quote-details" aria-label="Desglose de la cotización">
    <div className="remittance-quote-parties">
      <section className="remittance-quote-card" aria-label="Paga el remitente">
        <h3>Paga el remitente</h3>
        <dl className="remittance-summary">
          <div><dt>Principal</dt><dd>{money(quote.amount, quote.sourceCurrency)}</dd></div>
          <div><dt>Comisión ({quote.commissionBps / 100}%)</dt><dd>{money(quote.commissionAmount, quote.sourceCurrency)}</dd></div>
          <div className="remittance-total"><dt>Total que paga el remitente</dt><dd>{money(quote.totalAmount, quote.sourceCurrency)}{totalAsked !== undefined && <small role="status"> Pediste {money(totalAsked, quote.sourceCurrency)}: es el total más cercano que no lo pasa.</small>}</dd></div>
        </dl>
      </section>
      <section className="remittance-quote-card" aria-label="Recibe el destinatario">
        <h3>Recibe el destinatario</h3>
        <dl className="remittance-summary">
          {calculation && (calculation.deliveryCommissionAmount > 0 || calculation.roundingAdjustment !== 0) && <div><dt>Monto convertido</dt><dd>{money(quote.receiveAmount, quote.destinationCurrency)}</dd></div>}
          {calculation && calculation.deliveryCommissionAmount > 0 && <div><dt>Comisión de entrega · {calculation.deliveryConceptName} ({calculation.deliveryCommissionBps / 100}%)</dt><dd>− {money(calculation.deliveryCommissionAmount, quote.destinationCurrency)}</dd></div>}
          {calculation && calculation.roundingAdjustment !== 0 && <div><dt>Ajuste por redondeo</dt><dd>{calculation.roundingAdjustment > 0 ? "+ " : "− "}{money(Math.abs(calculation.roundingAdjustment), quote.destinationCurrency)}</dd></div>}
          <div className="remittance-total"><dt>Recibe el destinatario</dt><dd>{money(payout, quote.destinationCurrency)}{receiveAsked !== undefined && <small role="status"> Pediste {money(receiveAsked, quote.destinationCurrency)}. El importe real difiere por redondeo: {money(payout - receiveAsked, quote.destinationCurrency)}. Confirma el importe real antes de continuar.</small>}</dd></div>
          {!calculation && quote.requestedReceiveAmount !== undefined && <div><dt>Destino solicitado</dt><dd>{money(quote.requestedReceiveAmount, quote.destinationCurrency)}{Boolean(quote.receiveRoundingDifference) && <small role="status"> El importe real difiere por redondeo: {money(quote.receiveRoundingDifference!, quote.destinationCurrency)}. Confirma el importe real antes de continuar.</small>}</dd></div>}
        </dl>
        <p className="remittance-help">La comisión del envío la paga quien envía y no se descuenta de lo que se recibe.{calculation && calculation.deliveryCommissionAmount > 0 ? " La comisión de entrega sí se descuenta de lo que recibe la persona." : ""}</p>
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
        <div><dt>{rateKindLabel[quote.quote.sourceRateKind ?? "operative"]} · {quote.sourceCurrency}</dt><dd>1 {quote.sourceCurrency} = {quote.quote.sourceRate} DOP<small>{rateDate(quote.sourceCurrency, quote.quote.sourceRateDate)}</small></dd></div>
        <div><dt>{rateKindLabel[quote.quote.destinationRateKind ?? "operative"]} · {quote.destinationCurrency}</dt><dd>1 {quote.destinationCurrency} = {quote.quote.destinationRate} DOP<small>{rateDate(quote.destinationCurrency, quote.quote.destinationRateDate)}</small></dd></div>
        <div><dt>Tasa de origen a destino</dt><dd>1 {quote.sourceCurrency} {crossRate.approximate ? "≈" : "="} {crossRate.text} {quote.destinationCurrency}{crossRate.approximate && <small> (tasa mostrada redondeada)</small>}</dd></div>
        <div><dt>Hora de cotización</dt><dd>{rateMoment(quote.quote.quotedAt)}</dd></div>
      </dl>
      <p className="remittance-help">Compramos la moneda de origen y vendemos la de destino, pasando por pesos. Si ambas son iguales no se cambia de moneda. {roundingHelp[calculation?.receiveRounding ?? "none"]} Las tasas antiguas sin compra y venta conservan su tasa única registrada.</p>
    </section>
    {gain && <section className="remittance-quote-conversion" aria-label="Ganancia por cambio">
      <h3>Ganancia por cambio (DOP)</h3>
      <dl className="remittance-summary">
        <div><dt>Al comprar {quote.sourceCurrency}{gain.sourcePurchaseRate ? ` (venta ${gain.sourceSaleRate} − compra ${gain.sourcePurchaseRate})` : ""}</dt><dd>{money(gain.sourceAmount, "DOP")}</dd></div>
        <div><dt>Al vender {quote.destinationCurrency}{gain.destinationPurchaseRate ? ` (venta ${gain.destinationSaleRate} − compra ${gain.destinationPurchaseRate})` : ""}</dt><dd>{money(gain.destinationAmount, "DOP")}</dd></div>
        <div className="remittance-total"><dt>Gana la empresa por el cambio</dt><dd>{money(gain.totalAmount, "DOP")}</dd></div>
      </dl>
      <p className="remittance-help">Es de la empresa: el gestor cobra solo de la comisión del envío.</p>
    </section>}
    {quote.commissionAllocation && <details className="remittance-commission-details"><summary>Reparto de la comisión entre empresa y gestor</summary><dl className="remittance-summary">{allocationRows(quote.commissionAllocation, saved ? (quote as Transfer).status : undefined).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="remittance-help">Este reparto sale de la comisión ya cobrada. No es otro cargo al remitente ni un descuento al destinatario.</p></details>}
  </div>;
}
