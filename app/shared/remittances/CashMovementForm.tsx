import { useEffect, useId, useState, type FormEvent } from "react";
import { MoneyInput } from "../MoneyInput";
import { isTextDraft, validateText } from "../inputRules";
import { decimalCents, formatMoney } from "./output";
import { isMoneyDraft, MONEY_INPUT_MESSAGE } from "./moneyInput";
import type { Cash } from "./types";

export type CashMovementReview = { cash: Cash; kind: "add" | "withdraw"; amount: number; note: string };

/** Each submission is a new physical cash movement, never an edit of the day's accumulated total. */
export function CashMovementForm({ cash, kind, disabled, resetToken, onReview }: {
  cash: Cash; kind: CashMovementReview["kind"]; disabled: boolean; resetToken?: string;
  onReview: (movement: CashMovementReview) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [invalidMoney, setInvalidMoney] = useState(false);
  const errorId = useId();
  const withdraw = kind === "withdraw";
  useEffect(() => { setAmount(""); setNote(""); setError(""); setInvalidMoney(false); }, [resetToken]);
  function review(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    try {
      if (invalidMoney || !isMoneyDraft(amount)) throw new Error(MONEY_INPUT_MESSAGE);
      const value = decimalCents(amount, true);
      if (value <= 0) throw new Error("El importe debe ser mayor que cero.");
      if (withdraw && value > cash.expected) throw new Error("El retiro no puede superar el efectivo esperado de la caja.");
      if (!withdraw && value > Number.MAX_SAFE_INTEGER - cash.expected) throw new Error("El importe supera el saldo máximo permitido.");
      validateText(note, withdraw ? "El destinatario y motivo del retiro" : "La nota", 500, { required: withdraw });
      setError(""); onReview({ cash, kind, amount: value, note: note.trim() });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Revisa el importe y el motivo."); }
  }
  return <form className="remittance-cash-movement" aria-label={withdraw ? "Registrar retiro de efectivo" : "Registrar entrega adicional"} onSubmit={review}>
    <fieldset disabled={disabled}>
      <label>{withdraw ? "Dinero retirado" : "Dinero adicional recibido"} ({cash.currency})
        <MoneyInput required value={amount} title={MONEY_INPUT_MESSAGE} aria-invalid={invalidMoney || undefined}
          aria-describedby={error ? errorId : undefined} onInvalidEntry={() => { setInvalidMoney(true); setError(MONEY_INPUT_MESSAGE); }}
          onValueChange={(value) => { setAmount(value); setInvalidMoney(false); setError(""); }} />
      </label>
      <label>{withdraw ? "Entregado a / motivo" : "Nota de la entrega (opcional)"}
        <input required={withdraw} maxLength={500} value={note} onChange={(event) => {
          if (!isTextDraft(event.target.value, 500)) return;
          setNote(event.target.value); setError("");
        }} />
      </label>
      <p className="remittance-help">{withdraw
        ? `Efectivo que devuelve al encargado. Disponible: ${formatMoney(cash.expected, cash.currency)}.`
        : "Dinero nuevo que le entrega el encargado. Se suma al saldo sin cambiar el efectivo inicial."}</p>
      {error && <p className="remittance-error" role="alert" id={errorId}>{error}</p>}
      <button type="submit" className={withdraw ? "remittance-danger" : "remittance-primary"}>{withdraw ? "Revisar retiro" : "Revisar entrega"}</button>
    </fieldset>
  </form>;
}
