import { useEffect, useState } from "react";
import { RemittanceDialog } from "./RemittanceDialog";
import { cashActivityLabels, type CashActivity, type CashActivityKind } from "./cashActivity.mjs";
import { formatMoney } from "./output";
import type { StrictApi } from "./strictApi";
const formatDate = (date: string) => new Intl.DateTimeFormat("es-DO", {dateStyle:"short",timeStyle:"medium",timeZone:"America/Santo_Domingo"}).format(new Date(date));

export function CashActivityDialog({ cashId, initialKind = "all", api, onClose }: {
  cashId: string; initialKind?: CashActivityKind | "all"; api: StrictApi; onClose: () => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [data, setData] = useState<CashActivity>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(undefined);
    void api<CashActivity>(`/envios/cajas/${encodeURIComponent(cashId)}/movimientos`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudo cargar el detalle de esta caja."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, cashId, revision]);
  const rows = data?.entries.filter(row => kind === "all" || row.kind === kind) ?? [];
  return <RemittanceDialog title="Movimientos de la caja de remesas" wide onClose={onClose}>
    {data && <>
      <p><strong>{data.cash.operatorName} · {data.cash.currency}</strong> · {data.cash.date} · {data.cash.status === "open" ? "Abierta" : "Cerrada"}</p>
      <p className="remittance-help">Apertura: {formatDate(data.cash.openedAt)} · Registrada por {data.cash.openedBy}. Efectivo inicial: <strong>{formatMoney(data.cash.openingAmount, data.cash.currency)}</strong>.</p>
      {data.cash.closedAt && <p className="remittance-help">Cierre: {formatDate(data.cash.closedAt)} · Registrado por {data.cash.closedBy ?? "Usuario no disponible"}.</p>}
    </>}
    <div className="remittance-cash-activity-filters">
      <label>Tipo de movimiento<select aria-label="Tipo de movimiento" value={kind} onChange={event => setKind(event.target.value as CashActivityKind | "all")}>
        <option value="all">Todos los movimientos</option>
        {Object.entries(cashActivityLabels).map(([key, label]) => <option key={key} value={key}>{label}{data ? ` (${data.groups[key as CashActivityKind].count})` : ""}</option>)}
      </select></label>
      <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refrescar detalle</button>
    </div>
    {loading && <p role="status">Cargando movimientos…</p>}
    {error && <p role="alert" className="remittance-error">{error}</p>}
    {data && <>
      <p className="remittance-help">Horas de República Dominicana. Las entradas y salidas son de efectivo. Los pagos por tarjeta, transferencia o depósito se detallan con su importe de operación y no suman billetes a esta caja.</p>
      <div className="remittance-table-wrap remittance-cash-activity-table" tabIndex={0} role="region" aria-label="Detalle de movimientos" aria-busy={loading}>
        <table className="remittance-table"><thead><tr><th>Fecha y hora</th><th>Movimiento</th><th>Referencia / comprobante</th><th>Entrada</th><th>Salida</th><th>Registrado por</th><th>Nota / motivo</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td>{formatDate(row.createdAt)}</td><td>{cashActivityLabels[row.kind]}{row.payment && <small>{row.payment}</small>}{row.operationAmount !== undefined && row.operationAmount !== row.amount && <small>Importe de la operación: {formatMoney(row.operationAmount, data.cash.currency)}.{row.amount === 0 ? " Sin movimiento de efectivo." : ""}</small>}</td>
            <td>{row.reference ?? "—"}{row.receiptReference && <small>{row.receiptReference}</small>}</td>
            <td>{row.direction === "in" ? formatMoney(row.amount, data.cash.currency) : "—"}</td><td>{row.direction === "out" ? formatMoney(row.amount, data.cash.currency) : "—"}</td>
            <td>{row.recordedBy}</td><td>{row.note || "—"}</td>
          </tr>)}{!rows.length && <tr><td colSpan={7}>No hay movimientos de este tipo en esta caja.</td></tr>}</tbody>
        </table>
      </div>
      <p role="status">{rows.length} movimiento(s){kind !== "all" ? ` · Total de efectivo: ${formatMoney(data.groups[kind].amount, data.cash.currency)}` : ""}</p>
      <dl className="remittance-summary" aria-label="Resumen del detalle de caja">
        <div><dt>Efectivo esperado para el cuadre</dt><dd>{formatMoney(data.totals.expected, data.cash.currency)}</dd></div>
        {data.cash.countedAmount !== undefined && <div><dt>Contado al cierre</dt><dd>{formatMoney(data.cash.countedAmount, data.cash.currency)}</dd></div>}
        {data.totals.carry !== undefined && <><div><dt>Retirado al cierre</dt><dd>{formatMoney(data.totals.discharged, data.cash.currency)}</dd></div><div><dt>Saldo que pasa a la siguiente apertura</dt><dd>{formatMoney(data.totals.carry, data.cash.currency)}</dd></div></>}
      </dl>
    </>}
    <div className="remittance-actions"><button type="button" onClick={onClose}>Cerrar</button></div>
  </RemittanceDialog>;
}
