import { MoneyInput } from "../MoneyInput";
import { restrictPaste } from "./fieldInput";
import { decimalCents, formatMoney } from "./output";
import { isMoneyDraft, MONEY_INPUT_MESSAGE } from "./moneyInput";
import { cardPaymentCharge, isCardholderNameDraft, isPaymentTextDraft, paymentAmounts, type CardType, type PaymentMethod, type RemittancePaymentInput } from "./payment.mjs";
import { CardNumberInput } from "./CardNumberInput";
import { CARD_NUMBER_MESSAGE } from "./cardNumberEntry";
import { TemporaryCardField } from "./TemporaryCardField";
import type { Currency } from "./types";

type PaymentField = "tendered" | "reference" | "bank" | "cardholderName" | "last4" | "expiry" | "cvv";
const paymentBanks = ["Banreservas", "Banco Popular", "BHD", "Scotiabank", "Banco Santa Cruz", "APAP", "Asociación Cibao", "Banesco", "Banco Promerica"];
export type PaymentDraft = { method: PaymentMethod; cardType?: CardType; cardholderName: string; last4: string; tendered: string; reference: string; bank: string; verified: boolean; entryErrors?: Partial<Record<PaymentField, string>> };
const decimal = (cents: number) => `${BigInt(cents) / 100n}.${String(BigInt(cents) % 100n).padStart(2, "0")}`;
export function paymentDraftFor(total: number, input?: RemittancePaymentInput): PaymentDraft {
  return { method: input?.method ?? "cash", cardType: input?.cardType, cardholderName: input?.cardholderName ?? "", last4: input?.last4 ?? "", tendered: decimal(input?.tenderedAmount ?? total), reference: input?.reference ?? "", bank: input?.bank ?? "", verified: input?.verified === true };
}
export function paymentInput(total: number, draft: PaymentDraft, creditCardCommissionBps = 0): RemittancePaymentInput {
  const fields: PaymentField[] = draft.method === "cash" ? ["tendered"] : draft.method === "card" && draft.cardType === "credit" ? ["reference", "bank", "cardholderName", "last4", "expiry", "cvv"] : ["reference", "bank"];
  const error = fields.map((field) => draft.entryErrors?.[field]).find(Boolean);
  if (error) throw new Error(`Corrige el campo señalado. ${error}`);
  if (draft.method === "card" && draft.cardType === "credit" && (!isCardholderNameDraft(draft.cardholderName) || !/\p{L}/u.test(draft.cardholderName))) throw new Error("Escribe el nombre del titular.");
  if (draft.method === "card" && draft.cardType === "credit" && !/^[0-9]{4}$/.test(draft.last4)) throw new Error(CARD_NUMBER_MESSAGE);
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
export function PaymentFields({ total, currency, creditCardCommissionBps = 0, value, onChange, locked = false, cardStorage }: {
  cardStorage?: import("./cardArchive.mjs").CardStorageInfo;
  total: number; currency: Currency; creditCardCommissionBps?: number; value: PaymentDraft; onChange: (value: PaymentDraft) => void; locked?: boolean;
}) {
  const textMessage = "Usa hasta 160 caracteres en una sola línea, sin caracteres de control ni marcas invisibles.";
  const reject = (field: PaymentField, message: string) => onChange({ ...value, entryErrors: { ...value.entryErrors, [field]: message } });
  const update = (field: PaymentField, next: string) => onChange({ ...value, [field]: next, entryErrors: { ...value.entryErrors, [field]: undefined } });
  const bankField = <label>Banco o proveedor (opcional)<select aria-label="Banco o proveedor (opcional)" value={value.bank} onChange={(event) => update("bank", event.target.value)}>
    <option value="">Selecciona un banco</option>
    {paymentBanks.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
    {value.bank && !paymentBanks.includes(value.bank) && <option value={value.bank}>{value.bank} (registro anterior)</option>}
  </select></label>;
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
      <p className="remittance-help">Registra un pago ya recibido y comprobado fuera de CyP. CyP no cobra tarjetas ni verifica fondos bancarios. No escribas claves ni datos de tarjeta en referencias o notas.</p>
      {value.method === "card" && value.cardType === "credit" && bankField}
      {value.method === "card" && value.cardType === "credit" && <div className="remittance-payment-cash">
        <label>Nombre del titular<input autoComplete="off" maxLength={120} value={value.cardholderName} aria-invalid={Boolean(value.entryErrors?.cardholderName) || undefined} onPaste={(event) => restrictPaste(event, isCardholderNameDraft, () => reject("cardholderName", "Usa solo letras, espacios, tildes, guiones o apóstrofes (máximo 120)."))} onChange={(event) => { if (!isCardholderNameDraft(event.target.value)) { reject("cardholderName", "Usa solo letras, espacios, tildes, guiones o apóstrofes (máximo 120)."); return; } update("cardholderName", event.target.value); }} /></label>
        <label>Número de tarjeta (16 dígitos)<CardNumberInput last4={value.last4} locked={locked} invalid={Boolean(value.entryErrors?.last4)} onInvalid={() => reject("last4", CARD_NUMBER_MESSAGE)} onLast4Change={(last4, error) => onChange({ ...value, last4, verified: false, entryErrors: { ...value.entryErrors, last4: error } })} /></label>
      </div>}
      {value.method === "card" && value.cardType === "credit" && <fieldset><legend>{cardStorage?.enabled ? "Archivo cifrado de tarjeta" : "Captura temporal de prueba (opcional)"}</legend>
        <p className="remittance-help">{cardStorage?.enabled ? `El número completo y el vencimiento se guardarán cifrados durante ${cardStorage.retentionDays} días. El CVV no se envía ni se guarda. Estos datos no autorizan un cobro.` : "El guardado de la tarjeta completa no está activado: solo se conservan los últimos cuatro dígitos. Usa datos ficticios en vencimiento y CVV; ambos se borran y no se guardan."}</p>
        <div className="remittance-payment-cash">{(cardStorage?.enabled ? ["expiry"] as const : ["expiry", "cvv"] as const).map((field) => <TemporaryCardField key={field} kind={field} locked={locked} onValidityChange={(error, cleared) => onChange({ ...value, entryErrors: cleared ? { ...value.entryErrors, expiry: undefined, cvv: undefined } : { ...value.entryErrors, [field]: error } })} />)}</div>
      </fieldset>}
      {value.method === "card" && value.cardType === "credit" && <p className="remittance-help">Revisa los 16 dígitos antes de guardar. {cardStorage?.enabled ? "En los recibos y consultas solo se muestran los últimos cuatro." : "Al guardar se conservan solo los últimos cuatro, también en el recibo."} El número se oculta si abandonas esta página.</p>}
      <label>Referencia del comprobante<input maxLength={160} inputMode="text" title={textMessage} autoComplete="off" value={value.reference} aria-invalid={Boolean(value.entryErrors?.reference) || undefined} onPaste={(event) => restrictPaste(event, isPaymentTextDraft, () => reject("reference", textMessage))} onChange={(event) => { const next = event.target.value; if (!isPaymentTextDraft(next)) { reject("reference", textMessage); return; } update("reference", next); }} /></label>
      {!(value.method === "card" && value.cardType === "credit") && bankField}
      <label className="remittance-payment-check"><input type="checkbox" checked={value.verified} onChange={(event) => onChange({ ...value, verified: event.target.checked })} />Comprobé que el pago fue recibido</label>
    </>}
    {!charge && <p role="alert" className="remittance-error">El total con recargo excede el importe permitido. Vuelve al formulario y revisa el monto.</p>}
    {fieldError && <p role="alert" className="remittance-error">{fieldError}</p>}
  </fieldset>;
}
