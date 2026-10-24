import { restrictPaste } from "./fieldInput";
import { decimalCents, formatMoney } from "./output";
import { isMoneyDraft, MONEY_INPUT_MAX_LENGTH, MONEY_INPUT_MESSAGE, MONEY_INPUT_PATTERN } from "./moneyInput";
import { formatMoneyInput } from "../inputRules";
import { isPaymentTextDraft, paymentAmounts, paymentMethodLabels, paymentMethods, type PaymentMethod, type RemittancePaymentInput } from "./payment.mjs";
import type { Currency } from "./types";

type PaymentField = "tendered" | "reference" | "bank";
export type PaymentDraft = { method: PaymentMethod; tendered: string; reference: string; bank: string; verified: boolean; entryErrors?: Partial<Record<PaymentField, string>> };
const decimal = (cents: number) => `${BigInt(cents) / 100n}.${String(BigInt(cents) % 100n).padStart(2, "0")}`;
export function paymentDraftFor(total: number, input?: RemittancePaymentInput): PaymentDraft {
  return { method: input?.method ?? "cash", tendered: decimal(input?.tenderedAmount ?? total), reference: input?.reference ?? "", bank: input?.bank ?? "", verified: input?.verified === true };
}
export function paymentInput(total: number, draft: PaymentDraft): RemittancePaymentInput {
  const error = (draft.method === "cash" ? [draft.entryErrors?.tendered] : [draft.entryErrors?.reference, draft.entryErrors?.bank]).find(Boolean);
  if (error) throw new Error(`Corrige el campo señalado. ${error}`);
  if (draft.method === "cash" && !isMoneyDraft(draft.tendered)) throw new Error(MONEY_INPUT_MESSAGE);
  if (draft.method !== "cash" && (!isPaymentTextDraft(draft.reference) || !isPaymentTextDraft(draft.bank))) throw new Error("La referencia y el banco admiten hasta 160 caracteres en una sola línea, sin caracteres de control ni marcas invisibles.");
  const input: RemittancePaymentInput = draft.method === "cash"
    ? { method: "cash", tenderedAmount: decimalCents(draft.tendered, true) }
    : { method: draft.method, reference: draft.reference.trim(), ...(draft.bank.trim() ? { bank: draft.bank.trim() } : {}), verified: draft.verified };
  paymentAmounts(total, input);
  return input;
}

export function PaymentFields({ total, currency, value, onChange, locked = false }: {
  total: number; currency: Currency; value: PaymentDraft; onChange: (value: PaymentDraft) => void; locked?: boolean;
}) {
  const textMessage = "Usa hasta 160 caracteres en una sola línea, sin caracteres de control ni marcas invisibles.";
  const reject = (field: PaymentField, message: string) => onChange({ ...value, entryErrors: { ...value.entryErrors, [field]: message } });
  const update = (field: PaymentField, next: string) => onChange({ ...value, [field]: next, entryErrors: { ...value.entryErrors, [field]: undefined } });
  const fieldError = Object.values(value.entryErrors ?? {}).find(Boolean);
  let change: number | undefined;
  try { change = paymentAmounts(total, paymentInput(total, value)).changeAmount; } catch { /* Shown on Accept; the draft can be incomplete. */ }
  return <fieldset className="remittance-payment" disabled={locked}>
    <legend>Forma de pago</legend>
    <p className="remittance-payment-total">Total a pagar: <strong>{formatMoney(total, currency)}</strong></p>
    <label>Forma de pago<select aria-label="Forma de pago" value={value.method} onChange={(event) => onChange({ ...value, method: event.target.value as PaymentMethod, reference: "", bank: "", verified: false, entryErrors: {} })}>
      {paymentMethods.map((method) => <option key={method} value={method}>{paymentMethodLabels[method]}</option>)}
    </select></label>
    {value.method === "cash" ? <div className="remittance-payment-cash">
      <label>Dinero recibido ({currency})<input inputMode="decimal" autoComplete="off" pattern={MONEY_INPUT_PATTERN} title={MONEY_INPUT_MESSAGE} maxLength={MONEY_INPUT_MAX_LENGTH} value={value.tendered} onBlur={() => { if (!value.entryErrors?.tendered && isMoneyDraft(value.tendered) && formatMoneyInput(value.tendered) !== value.tendered) update("tendered", formatMoneyInput(value.tendered)); }} aria-invalid={Boolean(value.entryErrors?.tendered) || undefined} onPaste={(event) => restrictPaste(event, isMoneyDraft, () => reject("tendered", MONEY_INPUT_MESSAGE))} onChange={(event) => { const next = event.target.value; if (!isMoneyDraft(next)) { reject("tendered", MONEY_INPUT_MESSAGE); return; } update("tendered", next); }} /></label>
      <label>Devuelta ({currency})<input readOnly value={change === undefined ? "Revisa el dinero recibido" : formatMoney(change, currency)} /></label>
      <p className="remittance-help">El cambio se calcula sobre el total a pagar, incluida la comisión. En caja queda el total neto del envío.</p>
    </div> : <>
      <p className="remittance-help">Registra un pago que ya recibiste y comprobaste fuera de CyP. Este formulario no cobra una tarjeta ni realiza transferencias bancarias. No escribas números de tarjeta, claves ni códigos de seguridad.</p>
      <label>Referencia del comprobante<input maxLength={160} inputMode="text" title={textMessage} autoComplete="off" value={value.reference} aria-invalid={Boolean(value.entryErrors?.reference) || undefined} onPaste={(event) => restrictPaste(event, isPaymentTextDraft, () => reject("reference", textMessage))} onChange={(event) => { const next = event.target.value; if (!isPaymentTextDraft(next)) { reject("reference", textMessage); return; } update("reference", next); }} /></label>
      <label>Banco o proveedor (opcional)<input maxLength={160} inputMode="text" title={textMessage} value={value.bank} aria-invalid={Boolean(value.entryErrors?.bank) || undefined} onPaste={(event) => restrictPaste(event, isPaymentTextDraft, () => reject("bank", textMessage))} onChange={(event) => { const next = event.target.value; if (!isPaymentTextDraft(next)) { reject("bank", textMessage); return; } update("bank", next); }} /></label>
      <label className="remittance-payment-check"><input type="checkbox" checked={value.verified} onChange={(event) => onChange({ ...value, verified: event.target.checked })} />Comprobé que el pago fue recibido</label>
    </>}
    {fieldError && <p role="alert" className="remittance-error">{fieldError}</p>}
  </fieldset>;
}
