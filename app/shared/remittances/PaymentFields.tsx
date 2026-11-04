import { MoneyInput } from "../MoneyInput";
import { restrictPaste } from "./fieldInput";
import { decimalCents, formatMoney } from "./output";
import { isMoneyDraft, MONEY_INPUT_MESSAGE } from "./moneyInput";
import { cardPaymentCharge, isCardholderNameDraft, isCardLast4Draft, isPaymentTextDraft, paymentAmounts, type CardType, type PaymentMethod, type RemittancePaymentInput } from "./payment.mjs";
import type { Currency } from "./types";

type PaymentField = "tendered" | "reference" | "bank" | "cardholderName" | "last4";
export type PaymentDraft = { method: PaymentMethod; cardType?: CardType; cardholderName: string; last4: string; tendered: string; reference: string; bank: string; verified: boolean; entryErrors?: Partial<Record<PaymentField, string>> };
const decimal = (cents: number) => `${BigInt(cents) / 100n}.${String(BigInt(cents) % 100n).padStart(2, "0")}`;
export function paymentDraftFor(total: number, input?: RemittancePaymentInput): PaymentDraft {
  return { method: input?.method ?? "cash", cardType: input?.cardType, cardholderName: input?.cardholderName ?? "", last4: input?.last4 ?? "", tendered: decimal(input?.tenderedAmount ?? total), reference: input?.reference ?? "", bank: input?.bank ?? "", verified: input?.verified === true };
}
export function paymentInput(total: number, draft: PaymentDraft, creditCardCommissionBps = 0): RemittancePaymentInput {
  const fields: PaymentField[] = draft.method === "cash" ? ["tendered"] : draft.method === "card" && draft.cardType === "credit" ? ["reference", "bank", "cardholderName", "last4"] : ["reference", "bank"];
  const error = fields.map((field) => draft.entryErrors?.[field]).find(Boolean);
  if (error) throw new Error(`Corrige el campo señalado. ${error}`);
  if (draft.method === "cash" && !isMoneyDraft(draft.tendered)) throw new Error(MONEY_INPUT_MESSAGE);
  if (draft.method !== "cash" && (!isPaymentTextDraft(draft.reference) || !isPaymentTextDraft(draft.bank))) throw new Error("La referencia y el banco admiten hasta 160 caracteres en una sola línea, sin caracteres de control ni marcas invisibles.");
  const input: RemittancePaymentInput = draft.method === "cash"
    ? { method: "cash", tenderedAmount: decimalCents(draft.tendered, true) }
    : { method: draft.method, reference: draft.reference.trim(), ...(draft.bank.trim() ? { bank: draft.bank.trim() } : {}), verified: draft.verified,
      ...(draft.method === "card" ? { ...(draft.cardType ? { cardType: draft.cardType } : {}), ...(draft.cardType === "credit" ? { cardholderName: draft.cardholderName.trim(), last4: draft.last4 } : {}) } : {}) };
  paymentAmounts(total, input, creditCardCommissionBps);
  return input;
}

/** An overflowing/incomplete preview must not crash the window; saving still validates strictly. */
export function previewPaymentCharge(total: number, value: PaymentDraft, bps = 0) {
  try { return cardPaymentCharge(total, value.method === "card" ? value.cardType : undefined, bps); }
  catch { return undefined; }
}
export function PaymentFields({ total, currency, creditCardCommissionBps = 0, value, onChange, locked = false }: {
  total: number; currency: Currency; creditCardCommissionBps?: number; value: PaymentDraft; onChange: (value: PaymentDraft) => void; locked?: boolean;
}) {
  const textMessage = "Usa hasta 160 caracteres en una sola línea, sin caracteres de control ni marcas invisibles.";
  const reject = (field: PaymentField, message: string) => onChange({ ...value, entryErrors: { ...value.entryErrors, [field]: message } });
  const update = (field: PaymentField, next: string) => onChange({ ...value, [field]: next, entryErrors: { ...value.entryErrors, [field]: undefined } });
  const charge = previewPaymentCharge(total, value, creditCardCommissionBps);
  const choice = value.method === "card" ? value.cardType ?? "card" : value.method;
  const fieldError = Object.values(value.entryErrors ?? {}).find(Boolean);
  let change: number | undefined;
  try { change = paymentAmounts(total, paymentInput(total, value, creditCardCommissionBps), creditCardCommissionBps).changeAmount; } catch { /* Shown on Accept; the draft can be incomplete. */ }
  return <fieldset className="remittance-payment" disabled={locked}>
    <legend>Forma de pago</legend>
    <p className="remittance-payment-total">Total a pagar: <strong>{charge ? formatMoney(charge.totalAmount, currency) : "Revisa el recargo"}</strong></p>
    {value.method === "card" && value.cardType === "credit" && <p>Recargo por tarjeta de crédito: <strong>{charge ? formatMoney(charge.cardSurchargeAmount, currency) : "Fuera del rango permitido"}</strong></p>}
    <label>Forma de pago<select aria-label="Forma de pago" value={choice} onChange={(event) => {
      const next = event.target.value;
      onChange({ ...value, method: next === "credit" || next === "debit" ? "card" : next as PaymentMethod, cardType: next === "credit" || next === "debit" ? next : undefined, cardholderName: "", last4: "", reference: "", bank: "", verified: false, entryErrors: {} });
    }}>
      <option value="cash">Efectivo</option><option value="credit">Tarjeta de crédito</option><option value="debit">Tarjeta de débito</option><option value="transfer">Transferencia</option><option value="deposit">Depósito</option>
      {choice === "card" && <option value="card">Tarjeta (registro anterior)</option>}
    </select></label>
    {value.method === "cash" ? <div className="remittance-payment-cash">
      <label>Dinero recibido ({currency})<MoneyInput  autoComplete="off" title={MONEY_INPUT_MESSAGE} value={value.tendered} aria-invalid={Boolean(value.entryErrors?.tendered) || undefined} onValueChange={(nextValue) => { const next = nextValue; if (!isMoneyDraft(next)) { reject("tendered", MONEY_INPUT_MESSAGE); return; } update("tendered", next); }} onInvalidEntry={() => reject("tendered", MONEY_INPUT_MESSAGE)} /></label>
      <label>Devuelta ({currency})<input readOnly value={change === undefined ? "Revisa el dinero recibido" : formatMoney(change, currency)} /></label>
      <p className="remittance-help">El cambio se calcula sobre el total a pagar, incluida la comisión. En caja queda el total neto del envío.</p>
    </div> : <>
      <p className="remittance-help">Registra un pago ya recibido y comprobado fuera de CyP. CyP no cobra tarjetas ni verifica fondos bancarios. No escribas el número completo, vencimiento, código de seguridad ni claves en ningún campo.</p>
      {value.method === "card" && value.cardType === "credit" && <div className="remittance-payment-cash">
        <label>Nombre del titular<input autoComplete="off" maxLength={120} value={value.cardholderName} aria-invalid={Boolean(value.entryErrors?.cardholderName) || undefined} onPaste={(event) => restrictPaste(event, isCardholderNameDraft, () => reject("cardholderName", "Usa hasta 120 caracteres en una sola línea."))} onChange={(event) => { if (!isCardholderNameDraft(event.target.value)) { reject("cardholderName", "Usa hasta 120 caracteres en una sola línea."); return; } update("cardholderName", event.target.value); }} /></label>
        <label>Últimos 4 dígitos<input inputMode="numeric" autoComplete="off" maxLength={4} value={value.last4} aria-invalid={Boolean(value.entryErrors?.last4) || undefined} title="Escribe solo los últimos 4 dígitos." onPaste={(event) => restrictPaste(event, isCardLast4Draft, () => reject("last4", "Escribe solo los últimos 4 dígitos."))} onChange={(event) => { if (!isCardLast4Draft(event.target.value)) { reject("last4", "Escribe solo los últimos 4 dígitos."); return; } update("last4", event.target.value); }} /></label>
      </div>}
      <label>Referencia del comprobante<input maxLength={160} inputMode="text" title={textMessage} autoComplete="off" value={value.reference} aria-invalid={Boolean(value.entryErrors?.reference) || undefined} onPaste={(event) => restrictPaste(event, isPaymentTextDraft, () => reject("reference", textMessage))} onChange={(event) => { const next = event.target.value; if (!isPaymentTextDraft(next)) { reject("reference", textMessage); return; } update("reference", next); }} /></label>
      <label>Banco o proveedor (opcional)<input maxLength={160} inputMode="text" title={textMessage} value={value.bank} aria-invalid={Boolean(value.entryErrors?.bank) || undefined} onPaste={(event) => restrictPaste(event, isPaymentTextDraft, () => reject("bank", textMessage))} onChange={(event) => { const next = event.target.value; if (!isPaymentTextDraft(next)) { reject("bank", textMessage); return; } update("bank", next); }} /></label>
      <label className="remittance-payment-check"><input type="checkbox" checked={value.verified} onChange={(event) => onChange({ ...value, verified: event.target.checked })} />Comprobé que el pago fue recibido</label>
    </>}
    {!charge && <p role="alert" className="remittance-error">El total con recargo excede el importe permitido. Vuelve al formulario y revisa el monto.</p>}
    {fieldError && <p role="alert" className="remittance-error">{fieldError}</p>}
  </fieldset>;
}
