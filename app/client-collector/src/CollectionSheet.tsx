import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Check,
  Delete,
  LoaderCircle,
  LockKeyhole,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, getToken, money } from "./api";
import type { Operation } from "./types";
import { browserPaymentIntents, confirmedPaymentReceipt, intentStorageKey, type IntentScope, type PaymentIntent } from "./services/paymentIntents";
import { isMockToken, mockLedgerId } from "./mock";
import { assertCentsLimit, isDecimalDraft, isIntegerDraft } from "../../shared/inputRules";
import { decimalCents } from "../../shared/remittances/output";

const denominations = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];
const maximumAmount = 1_000_000_000;
export function CollectionSheet({
  actorId,
  operation,
  online,
  onClose,
  onSuccess,
}: {
  actorId: string;
  operation: Operation;
  online: boolean;
  onClose: () => void;
  onSuccess: (token: string) => void;
}) {
  const [mockScope] = useState(() => {
    try { return isMockToken(getToken()) ? mockLedgerId : null; } catch { return null; }
  });
  const scope = useMemo<IntentScope>(() => ({ actorId: mockScope ? `${mockScope}:${actorId}` : actorId, kind: operation.kind, entityId: operation.id }),
    [actorId, operation.kind, operation.id, mockScope]);
  const [initial] = useState(() => {
    try {
      if (sessionStorage.getItem(`cyp-attempt-${operation.kind}-${operation.id}`))
        throw new Error("Existe una referencia pendiente de una versión anterior. Consulta su recibo con la oficina antes de registrar otra operación.");
      return { attempt: browserPaymentIntents().read(scope), error: "" };
    } catch (error) {
      return { attempt: null, error: error instanceof Error ? error.message : "No se pudo leer la referencia guardada." };
    }
  });
  const [attempt, setAttempt] = useState<PaymentIntent | null>(initial.attempt);
  const [value, setValue] = useState(
    attempt
      ? (attempt.amount / 100).toFixed(2)
      : (operation.outstanding / 100).toFixed(2),
  );
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial.error);
  const inFlight = useRef(false);
  const newConfirmedKey = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const synchronize = (event: StorageEvent) => {
      if (event.key !== null && event.key !== intentStorageKey(scope)) return;
      try {
        const stored = browserPaymentIntents().read(scope);
        newConfirmedKey.current = undefined;
        // Deletion in another tab never proves that a known attempt did not commit.
        setAttempt((current) => stored ?? current);
        if (stored) setValue((stored.amount / 100).toFixed(2));
      } catch (error) { setError(error instanceof Error ? error.message : "No se pudo leer la referencia guardada."); }
    };
    window.addEventListener("storage", synchronize);
    return () => { mounted.current = false; window.removeEventListener("storage", synchronize); };
  }, [scope]);
  const [breakdown, setBreakdown] = useState(false);
  const [bills, setBills] = useState<Record<number, number>>({});
  const amount = useMemo(() => {
    try { return assertCentsLimit(decimalCents(value, true), "El importe", maximumAmount); }
    catch { return null; }
  }, [value]);
  const breakdownTotal = useMemo(
    () =>
      Object.entries(bills).reduce(
        (sum, [bill, count]) => sum + Number(bill) * count * 100,
        0,
      ),
    [bills],
  );
  const collecting = operation.kind === "collection";
  const Icon = collecting ? ArrowDownLeft : ArrowUpRight;
  const validAttempt = !!attempt && Number.isSafeInteger(attempt.amount) && attempt.amount > 0 && attempt.amount <= maximumAmount;
  const valid =
    amount !== null &&
    amount > 0 &&
    amount <= operation.outstanding &&
    (!breakdown || breakdownTotal === amount);

  function keyPress(key: string) {
    if (attempt || busy) return;
    setError("");
    if (key === "delete") {
      setValue(replace ? "" : value.slice(0, -1));
      setReplace(false);
      return;
    }
    const next = replace ? (key === "." ? "0." : key) : `${value}${key}`;
    if (isDecimalDraft(next, { wholeDigits: 8 })) {
      setValue(next);
      setReplace(false);
    }
  }

  async function confirm(beginAnother = false) {
    if (inFlight.current || !online || (attempt ? !validAttempt : !valid)) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const previousConfirmedKey = attempt?.status === "confirmed" ? attempt.key : undefined;
    try {
      const authorizedToken = getToken();
      if (sessionStorage.getItem(`cyp-attempt-${operation.kind}-${operation.id}`))
        throw new Error("Existe una referencia pendiente de una versión anterior. Consulta su recibo con la oficina antes de registrar otra operación.");
      const result = await browserPaymentIntents().confirm<{ receipt: { token: string } }>(
        scope, amount ?? 0,
        async (active) => {
          assertCentsLimit(active.amount, "El importe guardado", maximumAmount);
          if (active.amount <= 0) throw new Error("La referencia guardada no contiene un importe válido.");
          if (!mounted.current || getToken() !== authorizedToken)
            throw new ApiError("La sesión cambió. Vuelve a entrar con la cuenta original para resolver esta referencia.", 401);
          setAttempt(active);
          setValue((active.amount / 100).toFixed(2));
          return api(collecting ? "/cobros" : "/pagos", {
            method: "POST", headers: { "Idempotency-Key": active.key },
            body: JSON.stringify({ [collecting ? "chargeId" : "payoutId"]: operation.id, amount: active.amount }),
          });
        },
        (response, active) => confirmedPaymentReceipt(response, active, !!mockScope),
        (err) => err instanceof ApiError && err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status),
        beginAnother,
        newConfirmedKey.current,
        attempt,
      );
      if (!mounted.current) return;
      if (getToken() !== authorizedToken)
        throw new ApiError("La sesión cambió. El recibo se conserva para la cuenta original; vuelve a entrar para consultarlo.", 401);
      if (beginAnother) {
        newConfirmedKey.current = previousConfirmedKey;
        setAttempt(null);
        setValue((operation.outstanding / 100).toFixed(2));
        setReplace(true);
        setBreakdown(false);
        setBills({});
        return;
      }
      toast.success(
        collecting
          ? "Cobro registrado correctamente"
          : "Pago registrado correctamente",
      );
      onSuccess(result.receipt.token);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "No pudimos registrar la operación.";
      if (mounted.current) {
        setError(message);
        newConfirmedKey.current = undefined;
        try {
          const stored = browserPaymentIntents().read(scope);
          setAttempt(stored);
          if (stored) setValue((stored.amount / 100).toFixed(2));
        } catch { /* Keep the last known reference visible. */ }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content
          className="sheet collection-sheet"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <div className="sheet-handle" />
          <div className="sheet-heading">
            <span className={`action-icon ${collecting ? "green" : "blue"}`}>
              <Icon size={23} />
            </span>
            <div>
              <Dialog.Title>
                {collecting ? "Registrar cobro" : "Entregar pago"}
              </Dialog.Title>
              <Dialog.Description>
                {operation.clientName} · {operation.concept}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                className="icon-button"
                aria-label="Cerrar"
                disabled={busy}
              >
                <X size={22} />
              </button>
            </Dialog.Close>
          </div>
          <div className="amount-entry">
            <label htmlFor="collection-amount">
              {collecting ? "Importe recibido" : "Importe entregado"}
            </label>
            <div>
              <span>RD$</span>
              <input
                id="collection-amount"
                inputMode="decimal"
                maxLength={11}
                value={value}
                readOnly={!!attempt || busy}
                onFocus={() => setReplace(true)}
                onChange={(e) => {
                  if (isDecimalDraft(e.target.value, { wholeDigits: 8 })) {
                    setValue(e.target.value);
                    setReplace(false);
                  }
                }}
                aria-describedby="amount-help"
              />
            </div>
            <p id="amount-help">
              Saldo pendiente <strong>{money(operation.outstanding)}</strong>
            </p>
          </div>
          {!attempt && (
            <div className="keypad" aria-label="Teclado de importe">
              {[
                "1",
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "8",
                "9",
                ".",
                "0",
                "delete",
              ].map((key) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => keyPress(key)}
                  disabled={busy}
                  aria-label={
                    key === "delete"
                      ? "Borrar último dígito"
                      : key === "."
                        ? "Separador decimal"
                        : key
                  }
                >
                  {key === "delete" ? <Delete size={24} /> : key}
                </button>
              ))}
            </div>
          )}
          {attempt && (
            <p className="info-note">
              <LockKeyhole size={18} />
              {attempt.status === "confirmed"
                ? "Esta operación ya fue confirmada. Consulta el recibo original antes de registrar dinero nuevo."
                : "Este intento conserva el mismo importe y referencia. Reintentar consulta o registra una sola operación."}
            </p>
          )}
          <button
            className="breakdown-toggle"
            type="button"
            aria-expanded={breakdown}
            onClick={() => setBreakdown(!breakdown)}
            disabled={busy || !!attempt}
          >
            <Banknote size={19} />
            {breakdown
              ? "Ocultar desglose de efectivo"
              : "Agregar desglose de efectivo"}
            <span>Opcional</span>
          </button>
          {breakdown && (
            <div className="breakdown-grid">
              {denominations.map((bill) => (
                <label key={bill}>
                  <span>RD$ {bill.toLocaleString("es-DO")}</span>
                  <input
                    aria-label={`Cantidad de ${bill} pesos`}
                    inputMode="numeric"
                    type="text"
                    pattern="[0-9]*"
                    maxLength={String(Math.floor(maximumAmount / (bill * 100))).length}
                    value={bills[bill] || ""}
                    disabled={busy || !!attempt}
                    onChange={(e) => {
                      const maximum = Math.floor(maximumAmount / (bill * 100));
                      const count = e.target.value;
                      if (isIntegerDraft(count, String(maximum).length) && Number(count) <= maximum)
                        setBills({ ...bills, [bill]: Number(count) });
                    }}
                  />
                </label>
              ))}
              <p
                className={
                  breakdownTotal === amount ? "success-text" : "warning-text"
                }
              >
                Total contado: {money(breakdownTotal)}
                {breakdownTotal !== amount &&
                  " · Debe coincidir con el importe."}
              </p>
            </div>
          )}
          {!online && (
            <p className="inline-error" role="status">
              Sin conexión. Los movimientos se habilitarán al reconectar.
            </p>
          )}
          {amount !== null && amount > operation.outstanding && (
            <p className="inline-error">
              El importe supera el saldo pendiente.
            </p>
          )}
          {(amount === null || (attempt && !validAttempt)) && value && (
            <p className="inline-error">
              Escribe un importe válido, con hasta dos decimales y un máximo de RD$ 10,000,000.00.
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary confirm-payment"
            disabled={busy || !online || (attempt ? !validAttempt : !valid)}
            onClick={() => void confirm()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={21} />
            ) : (
              <Check size={21} />
            )}{" "}
            {busy
              ? "Confirmando…"
              : attempt
                ? attempt.status === "confirmed" ? "Consultar recibo original" : "Reintentar con la misma referencia"
                : `Confirmar ${collecting ? "cobro" : "pago"}`}{" "}
            {!attempt && <strong>{money(amount || 0)}</strong>}
          </button>
          {attempt?.status === "confirmed" && (
            <button className="secondary" disabled={busy || !online || !validAttempt} onClick={() => void confirm(true)}>
              Registrar otro {collecting ? "cobro" : "pago"} con dinero nuevo
            </button>
          )}
          <p className="sheet-footnote">
            El recibo se genera al confirmar el registro.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
