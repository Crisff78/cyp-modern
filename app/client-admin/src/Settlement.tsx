import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Check,
  CircleAlert,
  CircleCheck,
  LockKeyhole,
  RefreshCw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api, dateLabel, money } from "./api";
import { Avatar, Empty, HelpNote, SectionHeading } from "./components";
import type { Balance, Snapshot } from "./types";
import type { Operation } from "./Operations";

export default function Settlement({
  snapshot,
  initialCollector,
  onOperation,
  onRefresh,
}: {
  snapshot: Snapshot;
  initialCollector: string;
  onOperation: (operation: Operation) => void;
  onRefresh: () => Promise<void>;
}) {
  const [collectorId, setCollectorId] = useState(
      initialCollector || snapshot.collectors[0]?.id || "",
    ),
    [date, setDate] = useState(snapshot.businessDate),
    [preview, setPreview] = useState<Balance | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [closing, setClosing] = useState(false),
    [retry, setRetry] = useState(0);
  const closeKey = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Balance>(
      `/cuadres/preview?collectorId=${encodeURIComponent(collectorId)}&date=${date}`,
    )
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [collectorId, date, snapshot, retry]);
  const collector = snapshot.collectors.find((c) => c.id === collectorId),
    closed = snapshot.settlements.some(
      (s) => s.collectorId === collectorId && s.date === date,
    ),
    balanced = preview?.difference === 0;
  async function closeDay() {
    setClosing(true);
    setError("");
    try {
      const signature = `${collectorId}:${date}`;
      if (closeKey.current?.signature !== signature)
        closeKey.current = { signature, key: crypto.randomUUID() };
      await api("/cuadres", {
        method: "POST",
        headers: { "Idempotency-Key": closeKey.current.key },
        body: JSON.stringify({ collectorId, date }),
      });
      toast.success("Jornada cerrada. Todo está en equilibrio.");
      await onRefresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo cerrar la jornada.",
      );
    } finally {
      setClosing(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">CONTROL Y CONCILIACIÓN</div>
          <h1>
            Cuadre Diario (Arqueo)<span className="title-dot">.</span>
          </h1>
          <p>
            Controla Cobrado, Depositado, Entregado, Pagado y Dinero en Mano.
          </p>
        </div>
        <span className="date-pill">
          <ShieldCheck size={16} /> Cierre validado por el libro de movimientos
        </span>
      </div>
      <div className="settlement-layout">
        <aside className="panel settlement-select">
          <SectionHeading
            title="Preparar arqueo"
            subtitle="Selecciona cobrador y fecha de operación."
          />
          <label className="field">
            Cobrador
            <select
              value={collectorId}
              onChange={(event) => setCollectorId(event.target.value)}
            >
              {snapshot.collectors.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Fecha de operación
            <input
              type="date"
              value={date}
              max={snapshot.businessDate}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
            />
          </label>
          {collector && (
            <div className="settlement-person">
              <Avatar initials={collector.initials} />
              <div>
                <strong>{collector.name}</strong>
                <span>
                  {
                    snapshot.routes.find((r) => r.id === collector.routeId)
                      ?.name
                  }
                </span>
              </div>
            </div>
          )}
          <HelpNote>
            El arqueo utiliza los movimientos de la fecha seleccionada y valida
            los topes LimiteCobro y LimitePago del cobrador.
          </HelpNote>
          <div className="settlement-actions">
            <button
              className="btn full"
              disabled={closed || date !== snapshot.businessDate}
              onClick={() => onOperation({ type: "deposit", collectorId })}
            >
              <ArrowDownToLine size={17} />
              Registrar depósito
            </button>
            <button
              className="btn full"
              disabled={closed || date !== snapshot.businessDate}
              onClick={() => onOperation({ type: "delivery", collectorId })}
            >
              <ArrowUpFromLine size={17} />
              Entrega de dinero
            </button>
            <small>
              Los depósitos y entregas de dinero se registran en la fecha
              actual.
            </small>
          </div>
        </aside>
        <section className="panel calculator">
          <SectionHeading
            title="Cuadre Diario (Arqueo)"
            subtitle={dateLabel(date, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            action={
              <span className={`subtle-tag ${closed ? "green-text" : ""}`}>
                {closed ? (
                  <>
                    <LockKeyhole size={13} />
                    Cerrado
                  </>
                ) : (
                  "Jornada abierta"
                )}
              </span>
            }
          />
          {loading ? (
            <div className="calculator-loading" role="status">
              <RefreshCw className="spin" size={25} />
              <p>Conciliando movimientos…</p>
            </div>
          ) : error && !preview ? (
            <Empty
              title="No pudimos calcular el cuadre"
              text={error}
              action={
                <button className="btn" onClick={() => setRetry((n) => n + 1)}>
                  Volver a intentar
                </button>
              }
            />
          ) : (
            preview && (
              <>
                <div className="formula-intro">
                  <span className="formula-icon">
                    <Scale size={23} />
                  </span>
                  <div>
                    <strong>Ledger de arqueo</strong>
                    <p>
                      Cobrado - Depositado + Entregado - Pagado = Dinero en Mano
                      (Diferencia = 0).
                    </p>
                  </div>
                </div>
                <div className="ledger-equation" aria-label="Formula de cuadre">
                  <span>Cobrado</span>
                  <b>-</b>
                  <span>Depositado</span>
                  <b>+</b>
                  <span>Entregado</span>
                  <b>-</b>
                  <span>Pagado</span>
                  <b>=</b>
                  <strong>Dinero en Mano</strong>
                </div>
                <div className="formula-group">
                  <span className="formula-label">DINERO COBRADO</span>
                  <div className="formula-operands">
                    <div>
                      <span>Cobrado a clientes</span>
                      <strong>{money(preview.collected)}</strong>
                    </div>
                    <span className="formula-sign">−</span>
                    <div>
                      <span>Depositado / devuelto</span>
                      <strong>{money(preview.deposited)}</strong>
                    </div>
                  </div>
                  <div className="formula-subtotal">
                    <span>Cobros por depositar</span>
                    <strong>
                      {money(preview.collected - preview.deposited)}
                    </strong>
                  </div>
                </div>
                <div className="formula-plus">+</div>
                <div className="formula-group">
                  <span className="formula-label">DINERO PARA PAGOS</span>
                  <div className="formula-operands">
                    <div>
                      <span>Entregado por oficina</span>
                      <strong>{money(preview.officeDelivered)}</strong>
                    </div>
                    <span className="formula-sign">−</span>
                    <div>
                      <span>Pagado a clientes</span>
                      <strong>{money(preview.paidToClients)}</strong>
                    </div>
                  </div>
                  <div className="formula-subtotal">
                    <span>Entregas por pagar</span>
                    <strong>
                      {money(preview.officeDelivered - preview.paidToClients)}
                    </strong>
                  </div>
                </div>
                <div
                  className={`balance-result ${balanced ? "balanced" : "unbalanced"}`}
                >
                  <span className="balance-icon">
                    {balanced ? (
                      <CircleCheck size={28} />
                    ) : (
                      <CircleAlert size={28} />
                    )}
                  </span>
                  <div>
                    <span>
                      {balanced
                        ? "Todo está en equilibrio"
                        : "Dinero en mano pendiente"}
                    </span>
                    <strong>{money(preview.difference)}</strong>
                    <small>
                      {balanced
                        ? "Diferencia = 0. La jornada cumple con el balance requerido."
                        : "Registra depósitos, entrega de dinero o pagos antes del cierre."}
                    </small>
                  </div>
                </div>
                <div className="close-day">
                  <div>
                    <LockKeyhole size={17} />
                    <span>
                      {closed
                        ? "Esta jornada ya está cerrada."
                        : "Al cerrar, esta jornada queda bloqueada para nuevos movimientos."}
                    </span>
                  </div>
                  <button
                    className="btn primary"
                    disabled={!balanced || closed || closing}
                    onClick={closeDay}
                  >
                    {closing ? (
                      <RefreshCw className="spin" size={17} />
                    ) : closed ? (
                      <Check size={17} />
                    ) : (
                      <LockKeyhole size={17} />
                    )}{" "}
                    {closed
                      ? "Jornada cerrada"
                      : closing
                        ? "Cerrando…"
                        : "Cerrar jornada"}
                    {!closed && !closing && <ArrowRight size={16} />}
                  </button>
                </div>
              </>
            )
          )}
          {error && preview && (
            <div className="inline-error" role="alert">
              <CircleAlert size={17} />
              {error}
            </div>
          )}
        </section>
      </div>
      <section className="panel settlement-history">
        <SectionHeading
          title="Historial de cierres"
          subtitle="Jornadas conciliadas y confirmadas"
        />
        {snapshot.settlements.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cobrador</th>
                  <th>Cobrado</th>
                  <th>Depositado</th>
                  <th>Pagado</th>
                  <th>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {[...snapshot.settlements].reverse().map((s) => (
                  <tr key={s.id}>
                    <td>{dateLabel(s.date)}</td>
                    <td>
                      {
                        snapshot.collectors.find((c) => c.id === s.collectorId)
                          ?.name
                      }
                    </td>
                    <td>{money(s.collected)}</td>
                    <td>{money(s.deposited)}</td>
                    <td>{money(s.paidToClients)}</td>
                    <td className="green-text">
                      {money(s.difference)} <Check size={13} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="El primer cierre está por llegar"
            text="Cuando una jornada alcance diferencia cero, podrás cerrarla aquí."
          />
        )}
      </section>
    </>
  );
}
