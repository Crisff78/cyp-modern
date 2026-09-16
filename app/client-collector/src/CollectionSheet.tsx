import { useMemo, useState } from "react";
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
import { api, ApiError, money } from "./api";
import type { Operation } from "./types";

type Attempt = { key: string; amount: number };
const denominations = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];
export function CollectionSheet({
  operation,
  online,
  onClose,
  onSuccess,
}: {
  operation: Operation;
  online: boolean;
  onClose: () => void;
  onSuccess: (token: string) => void;
}) {
  const storageKey = `cyp-attempt-${operation.kind}-${operation.id}`;
  const [attempt, setAttempt] = useState<Attempt | null>(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem(storageKey) ?? "null",
      ) as Attempt | null;
    } catch {
      return null;
    }
  });
  const [value, setValue] = useState(
    attempt
      ? (attempt.amount / 100).toFixed(2)
      : (operation.outstanding / 100).toFixed(2),
  );
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [breakdown, setBreakdown] = useState(false);
  const [bills, setBills] = useState<Record<number, number>>({});
  const amount = Math.round(Number(value || "0") * 100);
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
  const valid =
    Number.isSafeInteger(amount) &&
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
    if (/^\d{0,8}(\.\d{0,2})?$/.test(next)) {
      setValue(next);
      setReplace(false);
    }
  }

  async function confirm() {
    if (busy || !online || (!valid && !attempt)) return;
    setBusy(true);
    setError("");
    const active = attempt ?? { key: crypto.randomUUID(), amount };
    sessionStorage.setItem(storageKey, JSON.stringify(active));
    setAttempt(active);
    try {
      const result = await api<{ receipt: { token: string } }>(
        collecting ? "/cobros" : "/pagos",
        {
          method: "POST",
          headers: { "Idempotency-Key": active.key },
          body: JSON.stringify({
            [collecting ? "chargeId" : "payoutId"]: operation.id,
            amount: active.amount,
          }),
        },
      );
      sessionStorage.removeItem(storageKey);
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
      setError(message);
      if (
        err instanceof ApiError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 408
      ) {
        sessionStorage.removeItem(storageKey);
        setAttempt(null);
      }
    } finally {
      setBusy(false);
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
                value={value}
                readOnly={!!attempt || busy}
                onFocus={() => setReplace(true)}
                onChange={(e) => {
                  if (/^\d{0,8}(\.\d{0,2})?$/.test(e.target.value)) {
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
              Este intento conserva el mismo importe y referencia. Reintentar
              consulta o registra una sola operación.
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
                    type="number"
                    min="0"
                    step="1"
                    value={bills[bill] || ""}
                    disabled={busy || !!attempt}
                    onChange={(e) =>
                      setBills({
                        ...bills,
                        [bill]: Math.max(0, Math.floor(Number(e.target.value))),
                      })
                    }
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
          {amount > operation.outstanding && (
            <p className="inline-error">
              El importe supera el saldo pendiente.
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary confirm-payment"
            disabled={busy || !online || (!valid && !attempt)}
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
                ? "Reintentar con la misma referencia"
                : `Confirmar ${collecting ? "cobro" : "pago"}`}{" "}
            {!attempt && <strong>{money(amount || 0)}</strong>}
          </button>
          <p className="sheet-footnote">
            El recibo se genera al confirmar el registro.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
