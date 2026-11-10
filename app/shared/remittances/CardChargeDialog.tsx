import { useRef, useState } from "react";
import { MoneyInput } from "../MoneyInput";
import { RemittanceDialog } from "./RemittanceDialog";
import { decimalCents, formatMoney } from "./output";
import { isMoneyDraft, MONEY_INPUT_MESSAGE } from "./moneyInput";
import { cardPaymentCharge, type CardType } from "./payment.mjs";
import type { Currency } from "./types";

export function CardChargeDialog({ total, currency, cardType, initialAmount, locked, onAccept, onClose }: {
  total: number; currency: Currency; cardType: CardType; initialAmount: number; locked: boolean;
  onAccept: (amount: number) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(`${BigInt(initialAmount) / 100n}.${String(BigInt(initialAmount) % 100n).padStart(2, "0")}`);
  const [error, setError] = useState("");
  const replaceOnFirstClick = useRef(true);
  let amount: number | undefined, finalTotal: number | undefined;
  try {
    if (!/[0-9]/.test(draft) || !isMoneyDraft(draft)) throw new Error(MONEY_INPUT_MESSAGE);
    amount = decimalCents(draft, true);
    finalTotal = cardPaymentCharge(total, cardType, 0, amount).totalAmount;
  } catch { /* A blank, invalid or overflowing draft cannot be accepted. */ }
  return <RemittanceDialog title="Cargo adicional por tarjeta" locked={locked} onClose={onClose}>
    <p>Tarjeta de {cardType === "credit" ? "crédito" : "débito"}. Escribe el cargo de este pago; usa 0 si no corresponde.</p>
    <p>Importe total anterior: <strong>{formatMoney(total, currency)}</strong></p>
    <label>Cargo adicional ({currency})<MoneyInput data-autofocus value={draft} disabled={locked} autoComplete="off"
      onFocus={event => { replaceOnFirstClick.current = true; event.currentTarget.select(); }}
      onMouseDown={event => {
        // Opening the dialog already focuses this field. Its first click/tap must also
        // replace the preset, while subsequent clicks still allow ordinary cursor edits.
        if (event.button === 0 && (replaceOnFirstClick.current || document.activeElement !== event.currentTarget)) {
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.select();
          replaceOnFirstClick.current = false;
        }
      }}
      aria-invalid={Boolean(error) || finalTotal === undefined || undefined}
      onInvalidEntry={() => setError(MONEY_INPUT_MESSAGE)}
      onValueChange={next => { replaceOnFirstClick.current = false; setDraft(next); setError(""); }} /></label>
    <p className="remittance-payment-total">Total a pagar: <strong>{finalTotal === undefined ? "Revisa el cargo" : formatMoney(finalTotal, currency)}</strong></p>
    {(error || finalTotal === undefined) && <p role="alert" className="remittance-error">{error || "Escribe un cargo válido. El total debe estar dentro del importe permitido."}</p>}
    <div className="remittance-actions">
      <button type="button" disabled={locked} onClick={onClose}>Cancelar</button>
      <button type="button" className="remittance-primary" disabled={locked || Boolean(error) || finalTotal === undefined} onClick={() => {
        if (amount !== undefined && finalTotal !== undefined && !error) onAccept(amount);
      }}>Aceptar cargo</button>
    </div>
  </RemittanceDialog>;
}
