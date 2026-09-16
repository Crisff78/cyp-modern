import { useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  LoaderCircle,
  Repeat2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { amountToCents, api, money } from "./api";
import { HelpNote, Modal } from "./components";
import type { Snapshot } from "./types";

export type Operation = {
  type: "charge" | "recurring" | "payout" | "deposit" | "delivery";
  clientIds?: string[];
  collectorId?: string;
};
export default function OperationModal({
  operation,
  snapshot,
  onClose,
  onComplete,
}: {
  operation: Operation | null;
  snapshot: Snapshot;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  if (!operation) return null;
  return (
    <OperationForm
      key={`${operation.type}-${operation.collectorId ?? ""}-${operation.clientIds?.join(",") ?? ""}`}
      operation={operation}
      snapshot={snapshot}
      onClose={onClose}
      onComplete={onComplete}
    />
  );
}
function OperationForm({
  operation,
  snapshot,
  onClose,
  onComplete,
}: {
  operation: Operation;
  snapshot: Snapshot;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [clientId, setClientId] = useState(snapshot.clients[0]?.id ?? ""),
    [collectorId, setCollectorId] = useState(
      operation.collectorId ?? snapshot.collectors[0]?.id ?? "",
    ),
    [concept, setConcept] = useState(""),
    [amount, setAmount] = useState(""),
    [dueDate, setDueDate] = useState(snapshot.businessDate),
    [required, setRequired] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const type = operation.type,
    office = type === "deposit" || type === "delivery",
    recurring = type === "recurring";
  const titles = {
    charge: "Registrar cargo",
    recurring: "Generar cargos recurrentes",
    payout: "Registrar descargo / remesa",
    deposit: "Registrar depósito",
    delivery: "Entrega de dinero al cobrador",
  };
  const descriptions = {
    charge: "Cargo simple para un cliente, servicio o concepto específico.",
    recurring:
      "Genera cargos mensuales fijos para varios clientes en una sola acción.",
    payout: "Ticket u orden de pago al beneficiario para ejecutar en ruta.",
    deposit:
      "Confirma el efectivo cobrado que el cobrador depositó o devolvió.",
    delivery:
      "Efectivo inicial entregado al cobrador para realizar pagos en calle.",
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const cents = amountToCents(amount);
      const body = JSON.stringify(
        office
          ? { collectorId, amount: cents }
          : type === "payout"
            ? { clientId, collectorId, concept: concept.trim(), amount: cents }
            : recurring
              ? {
                  clientIds: operation.clientIds,
                  service: concept.trim(),
                  amount: cents,
                  dueDate,
                  required,
                }
              : {
                  clientId,
                  service: concept.trim(),
                  amount: cents,
                  dueDate,
                  required,
                },
      );
      if (!attempt.current || attempt.current.body !== body)
        attempt.current = { body, key: crypto.randomUUID() };
      setBusy(true);
      await api(
        {
          charge: "/cargos",
          recurring: "/cargos/recurrentes",
          payout: "/descargos",
          deposit: "/depositos",
          delivery: "/entregas",
        }[type],
        {
          method: "POST",
          body,
          headers: { "Idempotency-Key": attempt.current.key },
        },
      );
      toast.success(
        recurring
          ? `${operation.clientIds?.length ?? 0} cargos creados correctamente`
          : "Operación registrada correctamente",
      );
      await onComplete();
      onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No pudimos guardar la operación. Inténtalo de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={titles[type]}
      description={descriptions[type]}
    >
      <form className="operation-form" onSubmit={submit}>
        {recurring && (
          <div className="recurring-summary">
            <Repeat2 size={20} />
            <div>
              <strong>
                {operation.clientIds?.length ?? 0} clientes seleccionados
              </strong>
              <span>
                Se creará un cargo recurrente independiente por cliente.
              </span>
            </div>
          </div>
        )}
        {!office && !recurring && (
          <label className="field">
            Cliente
            <select
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              required
            >
              {snapshot.clients.map((client) => (
                <option value={client.id} key={client.id}>
                  {client.name} · {client.code}
                </option>
              ))}
            </select>
          </label>
        )}
        {(office || type === "payout") && (
          <label className="field">
            Cobrador responsable
            <select
              value={collectorId}
              onChange={(event) => setCollectorId(event.target.value)}
              required
            >
              {snapshot.collectors.map((collector) => (
                <option value={collector.id} key={collector.id}>
                  {collector.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!office && (
          <label className="field">
            Concepto
            <input
              required
              minLength={2}
              maxLength={120}
              value={concept}
              onChange={(event) => setConcept(event.target.value)}
              placeholder={
                type === "payout"
                  ? "Ej. Remesa autorizada / pago a beneficiario"
                  : "Ej. Tarifa eléctrica mensual"
              }
            />
          </label>
        )}
        <div className="form-grid">
          <label className="field">
            {recurring ? "Monto fijo por cliente" : "Monto"} (RD$)
            <div className="currency-field">
              <span>RD$</span>
              <input
                required
                inputMode="decimal"
                type="number"
                min="0.01"
                max="100000000"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
              />
            </div>
          </label>
          {(type === "charge" || recurring) && (
            <label className="field">
              Fecha de vencimiento
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                required
              />
            </label>
          )}
        </div>
        {(type === "charge" || recurring) && (
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
            />
            <span>
              <strong>Obligado a cobrar</strong>
              <small>
                Destaca este servicio o concepto como obligatorio en la ruta.
              </small>
            </span>
          </label>
        )}
        {recurring && amount && Number(amount) > 0 && (
          <div className="form-total">
            <span>Total a generar</span>
            <strong>
              {money(
                Math.round(Number(amount) * 100) *
                  (operation.clientIds?.length ?? 0),
              )}
            </strong>
          </div>
        )}
        <HelpNote>
          {office
            ? "El saldo, LimiteCobro y LimitePago del cobrador se validan antes de registrar el movimiento."
            : type === "payout"
              ? "El descargo no mueve efectivo hasta que el cobrador confirme el pago al beneficiario."
              : "Los importes impactan el Cuadre Diario (Arqueo): Cobrado - Depositado + Entregado - Pagado."}
        </HelpNote>
        {error && (
          <div className="inline-error" role="alert">
            <CircleAlert size={17} />
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="btn primary"
            type="submit"
            disabled={busy || (recurring && !operation.clientIds?.length)}
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : type === "payout" ? (
              <ShieldCheck size={17} />
            ) : (
              <Check size={17} />
            )}{" "}
            {busy
              ? "Guardando…"
              : recurring
                ? "Generar cargos"
                : type === "payout"
                  ? "Autorizar pago"
                  : "Confirmar operación"}
            {!busy && <ArrowRight size={15} />}
          </button>
        </div>
      </form>
    </Modal>
  );
}
