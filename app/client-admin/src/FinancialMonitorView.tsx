import { useEffect, useRef, useState } from "react";
import { MapPinned, RefreshCw } from "lucide-react";
import type { Snapshot } from "./types";
import { LegacyDialog, handleKeyboardActivation } from "./LegacyConnectedUi";
import { MonitorGeoMap } from "./MonitorGeoMap";
import { currencyCode, nativeMoney } from "./adminFinance";
import { monitorLedger, type MonitorMetrics } from "./monitorLedger";
export default function FinancialMonitorView({ page, snapshot, refreshing, onRefresh }: Readonly<{ page: "monitorCollectors" | "monitorZones" | "monitorRoutes"; snapshot: Snapshot; refreshing: boolean; onRefresh: () => void }>) {
  const entityLabel = page === "monitorCollectors" ? "Cobrador" : page === "monitorZones" ? "Zona" : "Ruta";
  const [auto, setAuto] = useState(() => page === "monitorCollectors");
  const [seconds, setSeconds] = useState("60");
  const [remaining, setRemaining] = useState(60);
  const [currency, setCurrency] = useState("Peso Dominicano");
  const [selectedRow, setSelectedRow] = useState<ReturnType<typeof monitorLedger>[number] | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  const refreshSeconds = Math.max(1, Number(seconds) || 60);
  const rows = monitorLedger(page, snapshot, currencyCode(currency));
  const totals = rows.reduce<MonitorMetrics>((total, row) => ({
    collectionLimit: total.collectionLimit + row.metrics.collectionLimit,
    payoutLimit: total.payoutLimit + row.metrics.payoutLimit,
    collected: total.collected + row.metrics.collected,
    deposited: total.deposited + row.metrics.deposited,
    delivered: total.delivered + row.metrics.delivered,
    paid: total.paid + row.metrics.paid,
    difference: total.difference + row.metrics.difference,
  }), { collectionLimit: 0, payoutLimit: 0, collected: 0, deposited: 0, delivered: 0, paid: 0, difference: 0 });

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    setRemaining(refreshSeconds);
  }, [refreshSeconds]);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          if (document.visibilityState === "visible" && navigator.onLine)
            onRefreshRef.current();
          return refreshSeconds;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [auto, refreshSeconds]);

  const refresh = () => {
    setRemaining(refreshSeconds);
    onRefresh();
  };
  const handleMonitoreoClick = () => {
    if (selectedRow) setMapOpen(true);
  };
  return <div className="collector-monitor-mdi">
    <div className="collector-monitor-topbar">
      <div className="collector-monitor-controls">
        <label className="collector-monitor-auto"><input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} />Auto.</label>
        <input className="collector-monitor-seconds" aria-label="Tiempo de refresco en segundos" type="number" min="1" max="3600" value={seconds} onChange={(event) => setSeconds(event.target.value)} />
        <label htmlFor="collector-monitor-currency">Moneda:</label>
        <select id="collector-monitor-currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
          <option>Peso Dominicano</option><option>Dólar Americano</option><option>Euro</option>
        </select>
      </div>
      <div className="collector-monitor-actions">
        <button type="button" disabled={!selectedRow} onClick={handleMonitoreoClick}><MapPinned size={14} />Monitoreo</button>
        <button type="button" disabled={refreshing} onClick={refresh}><RefreshCw size={14} className={refreshing ? "spin" : undefined} />Refrescar</button>
      </div>
    </div>
    {page !== "monitorCollectors" && <p className="catalog-scope-note">Los cobros y pagos se agrupan por el cliente. Los depósitos, entregas, devoluciones y límites del cobrador aparecen una sola vez en «Caja sin ruta/zona».</p>}
    <div className="collector-monitor-grid-scroll">
      <div className="collector-monitor-grid-content">
        <table className="collector-monitor-table">
          <colgroup><col className="monitor-collector-name-column" /><col span={7} /></colgroup>
          <thead><tr><th>{entityLabel}</th><th>Límite de cobro</th><th>Límite de pago</th><th>Cobrado</th><th>Depositado</th><th>Entregado</th><th>Pagado</th><th>Diferencia</th></tr></thead>
          <tbody>{rows.map((row) => {
            const selected = selectedRow?.entityId === row.entityId && selectedRow.entityType === row.entityType;
            return <tr key={`${row.entityType}:${row.entityId}`} className={selected ? "selected-row" : undefined} aria-selected={selected} role="button" tabIndex={0} onClick={() => setSelectedRow(row)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedRow(row))}>
              <td>{row.name}</td>{(["collectionLimit","payoutLimit","collected","deposited","delivered","paid","difference"] as const).map((key) => <td key={key}>{key === "difference" && row.returned > 0 ? <span title={`Incluye ${nativeMoney(row.returned, currencyCode(currency))} devuelto y conciliado en Cuadres Diarios.`}>{nativeMoney(row.metrics[key], currencyCode(currency))}</span> : nativeMoney(row.metrics[key], currencyCode(currency))}</td>)}
            </tr>;
          })}</tbody>
        </table>
        <div className="collector-monitor-footer-grid">
          <div className="collector-monitor-page-controls">
            <button type="button" disabled aria-label="Primera página">|&lt;&lt;</button><button type="button" disabled aria-label="Página anterior">&lt;</button><span>Página [ 1 ] de 1</span><button type="button" disabled aria-label="Página siguiente">&gt;</button><button type="button" disabled aria-label="Última página">&gt;&gt;|</button>
            <button type="button" className="monitor-footer-refresh" title="Refrescar" onClick={refresh}><RefreshCw size={12} /></button>
            <span className="monitor-countdown">{auto ? `Faltan: ${remaining} seg(s)` : "Auto. pausado"}</span>
          </div>
          {[totals.collectionLimit, totals.payoutLimit, totals.collected, totals.deposited, totals.delivered, totals.paid, totals.difference].map((amount, index) => <span className="collector-monitor-total" key={`monitor-total-${index}`}>{nativeMoney(amount, currencyCode(currency))}</span>)}
        </div>
      </div>
    </div>
    {mapOpen && selectedRow && <LegacyDialog title={`Mapa de Monitoreo - ${selectedRow.name}`} onClose={() => setMapOpen(false)} className="collector-monitor-map-dialog">
      <MonitorGeoMap entityType={selectedRow.entityType} entityId={selectedRow.entityId} />
    </LegacyDialog>}
  </div>;
}
