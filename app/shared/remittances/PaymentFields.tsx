import { useState } from "react";
import { isDecimalDraft, isTextDraft } from "../inputRules";
import { restrictPaste } from "./fieldInput";
import { decimalCents, formatMoney } from "./output";
import { paymentAmounts, paymentMethodLabels, paymentMethods, type PaymentMethod, type RemittancePaymentInput } from "./payment.mjs";
import type { Currency } from "./types";

export type PaymentDraft = { method: PaymentMethod; tendered: string; reference: string; bank: string; verified: boolean };
const decimal = (cents: number) => `${BigInt(cents) / 100n}.${String(BigInt(cents) % 100n).padStart(2, "0")}`;
export function paymentDraftFor(total: number, input?: RemittancePaymentInput): PaymentDraft {
  return { method: input?.method ?? "cash", tendered: decimal(input?.tenderedAmount ?? total), reference: input?.reference ?? "", bank: input?.bank ?? "", verified: input?.verified === true };
}
export function paymentInput(total: number, draft: PaymentDraft): RemittancePaymentInput {
  const input: RemittancePaymentInput = draft.method === "cash"
    ? { method: "cash", tenderedAmount: decimalCents(draft.tendered, true) }
    : { method: draft.method, reference: draft.reference.trim(), ...(draft.bank.trim() ? { bank: draft.bank.trim() } : {}), verified: draft.verified };
  paymentAmounts(total, input);
  return input;
}

export function PaymentFields({ total, currency, value, onChange, locked = false }: {
  total: number; currency: Currency; value: PaymentDraft; onChange: (value: PaymentDraft) => void; locked?: boolean;
}) {
  const [fieldError, setFieldError] = useState("");
  const moneyDraft = (text: string) => text.length <= 17 && isDecimalDraft(text);
  const moneyMessage = "Usa solo números y un punto, con hasta dos decimales y sin separadores de miles.";
  let change: number | undefined;
  try { change = paymentAmounts(total, paymentInput(total, value)).changeAmount; } catch { /* Shown on Accept; the draft can be incomplete. */ }
  return <fieldset className="remittance-payment" disabled={locked}>
    <legend>Forma de pago</legend>
    <p className="remittance-payment-total">Total a pagar: <strong>{formatMoney(total, currency)}</strong></p>
    <label>Forma de pago<select aria-label="Forma de pago" value={value.method} onChange={(event) => { setFieldError(""); onChange({ ...value, method: event.target.value as PaymentMethod, reference: "", bank: "", verified: false }); }}>
      {paymentMethods.map((method) => <option key={method} value={method}>{paymentMethodLabels[method]}</option>)}
    </select></label>
    {value.method === "cash" ? <div className="remittance-payment-cash">
      <label>Dinero recibido ({currency})<input inputMode="decimal" autoComplete="off" maxLength={17} value={value.tendered} onPaste={(event) => restrictPaste(event, moneyDraft, () => setFieldError(moneyMessage))} onChange={(event) => { const next = event.target.value; if (!moneyDraft(next)) { setFieldError(moneyMessage); return; } setFieldError(""); onChange({ ...value, tendered: next }); }} /></label>
      <label>Devuelta ({currency})<input readOnly value={change === undefined ? "Revisa el dinero recibido" : formatMoney(change, currency)} /></label>
      <p className="remittance-help">El cambio se calcula sobre el total a pagar, incluida la comisión. En caja queda el total neto del envío.</p>
    </div> : <>
      <p className="remittance-help">Registra un pago que ya recibiste y comprobaste fuera de CyP. Este formulario no cobra una tarjeta ni realiza transferencias bancarias. No escribas números de tarjeta, claves ni códigos de seguridad.</p>
      <label>Referencia del comprobante<input maxLength={160} autoComplete="off" value={value.reference} onPaste={(event) => restrictPaste(event, (text) => isTextDraft(text, 160), () => setFieldError("La referencia admite hasta 160 caracteres, sin saltos de línea."))} onChange={(event) => { if (isTextDraft(event.target.value, 160)) { setFieldError(""); onChange({ ...value, reference: event.target.value }); } }} /></label>
      <label>Banco o proveedor (opcional)<input maxLength={160} value={value.bank} onPaste={(event) => restrictPaste(event, (text) => isTextDraft(text, 160), () => setFieldError("El banco o proveedor admite hasta 160 caracteres, sin saltos de línea."))} onChange={(event) => { if (isTextDraft(event.target.value, 160)) { setFieldError(""); onChange({ ...value, bank: event.target.value }); } }} /></label>
      <label className="remittance-payment-check"><input type="checkbox" checked={value.verified} onChange={(event) => onChange({ ...value, verified: event.target.checked })} />Comprobé que el pago fue recibido</label>
    </>}
    {fieldError && <p role="alert" className="remittance-error">{fieldError}</p>}
  </fieldset>;
}
