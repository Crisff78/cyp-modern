import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CircleCheck,
  CircleDollarSign,
  Download,
  MapPinned,
  RefreshCw,
  Scale,
  Users,
  Wallet,
} from "lucide-react";
import { money, wholeMoney, dateLabel } from "./api";
import {
  ActivityList,
  Avatar,
  Badge,
  CollectorMap,
  SectionHeading,
  Sparkline,
} from "./components";
import type { Collector, Page, Snapshot } from "./types";

export function exportCsv(filename: string, rows: (string | number)[][]) {
  const safe = (value: string | number) => {
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const blob = new Blob(
    ["\uFEFF", rows.map((row) => row.map(safe).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8;" },
  );
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
export default function Dashboard({
  snapshot,
  navigate,
  onCollector,
  refreshing,
  onRefresh,
}: {
  snapshot: Snapshot;
  navigate: (page: Page) => void;
  onCollector: (collector: Collector) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const totals = snapshot.totals;
  const history = snapshot.history.slice(-7);
  const max =
    Math.max(...history.map((d) => Math.max(d.collected, d.paid)), 1) * 1.12;
  const outstanding = snapshot.charges.filter(
    (c) => c.status !== "paid" && c.status !== "cancelled",
  );
  const required = outstanding.filter((c) => c.required).length;
  const metrics = [
    {
      label: "Recaudado hoy",
      value: wholeMoney(totals.collected),
      subtitle: `${snapshot.movements.filter((m) => m.type === "collection").length} cobros registrados`,
      icon: ArrowDownLeft,
      values: history.map((h) => h.collected),
      trend: "Ingresos de la jornada",
      color: "emerald",
    },
    {
      label: "Descargos / remesas",
      value: wholeMoney(totals.paid),
      subtitle: "Pagados a beneficiarios",
      icon: ArrowUpRight,
      values: history.map((h) => h.paid),
      trend: "Salidas confirmadas",
      color: "slate",
    },
    {
      label: "Cobradores en ruta",
      value: String(totals.activeCollectors).padStart(2, "0"),
      subtitle: `de ${snapshot.collectors.length} en tu equipo`,
      icon: Users,
      values: [1, 1, 2, 1, 2, totals.activeCollectors],
      trend: "Conexión de campo",
      color: "slate",
    },
    {
      label: "Dinero en mano",
      value: wholeMoney(totals.difference),
      subtitle:
        totals.difference === 0
          ? "La operación está en equilibrio"
          : "Efectivo por conciliar",
      icon: Scale,
      values: [0, 2, 1, 4, 2, totals.difference ? 3 : 0],
      trend:
        totals.difference === 0
          ? "Sin diferencias"
          : "Revisar antes del cierre",
      color: totals.difference === 0 ? "emerald" : "amber",
    },
  ];
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">MONITORES Y REPORTES</div>
          <h1>
            Monitor de cobradores en ruta<span className="title-dot">.</span>
          </h1>
          <p>Estado operativo de cobradores, zonas, cargos y cuadre diario.</p>
        </div>
        <div className="page-actions">
          <button
            className="icon-button bordered"
            aria-label="Actualizar datos"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={17} className={refreshing ? "spin" : ""} />
          </button>
          <span className="date-pill">
            <CalendarDays size={16} />
            {dateLabel(snapshot.businessDate, {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
          <button
            className="btn"
            onClick={() =>
              exportCsv(`cyp-resumen-${snapshot.businessDate}.csv`, [
                [
                  "Fecha",
                  "Cobrado",
                  "Pagado",
                  "Depositado",
                  "Entregado por oficina",
                  "Diferencia",
                ],
                [
                  snapshot.businessDate,
                  totals.collected / 100,
                  totals.paid / 100,
                  totals.deposited / 100,
                  totals.officeDelivered / 100,
                  totals.difference / 100,
                ],
              ])
            }
          >
            <Download size={16} />
            <span>Exportar</span>
          </button>
        </div>
      </div>
      <div className="kpi-grid">
        {metrics.map((metric, index) => (
          <article
            className={`kpi-card kpi-${metric.color}`}
            key={metric.label}
          >
            <div className="kpi-top">
              <span>{metric.label}</span>
              <span className="kpi-icon">
                <metric.icon size={18} />
              </span>
            </div>
            <div className="kpi-main">
              <strong>{metric.value}</strong>
              <Sparkline values={metric.values} color={metric.color} />
            </div>
            <div className="kpi-foot">
              <span
                className={index === 3 && totals.difference ? "amber-text" : ""}
              >
                {metric.subtitle}
              </span>
              {index === 2 && <span className="tiny-live" />}
            </div>
          </article>
        ))}
      </div>
      <div className="dashboard-main-grid">
        <section className="panel cashflow-panel">
          <SectionHeading
            title="El pulso de tu operación"
            subtitle="Cobros y descargos de los últimos 7 días"
            action={<span className="subtle-tag">Esta semana</span>}
          />
          <div className="chart-summary">
            <div>
              <span>Total recaudado</span>
              <strong>
                {money(history.reduce((sum, day) => sum + day.collected, 0))}
              </strong>
            </div>
            <div className="chart-legend">
              <span>
                <i className="green-dot" />
                Cobros
              </span>
              <span>
                <i className="pale-dot" />
                Descargos
              </span>
            </div>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label={`Cobros y pagos de los últimos ${history.length} días. Total cobrado ${money(history.reduce((sum, d) => sum + d.collected, 0))}.`}
          >
            <div className="chart-y-labels">
              {[1, 0.75, 0.5, 0.25, 0].map((x) => (
                <span key={x}>
                  {new Intl.NumberFormat("es-DO", {
                    notation: "compact",
                    maximumFractionDigits: 0,
                  }).format((max * x) / 100)}
                </span>
              ))}
            </div>
            <div className="chart-plot">
              <div className="chart-gridlines">
                {[0, 1, 2, 3, 4].map((line) => (
                  <i key={line} />
                ))}
              </div>
              <div className="chart-bars">
                {history.map((day, index) => (
                  <div className="chart-day" key={`${day.label}-${index}`}>
                    <div
                      className="bar-pair"
                      tabIndex={0}
                      aria-label={`${day.label}: cobros ${money(day.collected)}, pagos ${money(day.paid)}`}
                    >
                      <div
                        className={`bar bar-collected ${index === history.length - 1 ? "bar-current" : ""}`}
                        style={{
                          height: `${Math.max((day.collected / max) * 100, 1)}%`,
                        }}
                      />
                      <div
                        className="bar bar-paid"
                        style={{
                          height: `${Math.max((day.paid / max) * 100, 1)}%`,
                        }}
                      />
                      <div className="chart-tooltip">
                        <strong>{day.label}</strong>
                        <span>Cobros: {money(day.collected)}</span>
                        <span>Pagos: {money(day.paid)}</span>
                      </div>
                    </div>
                    <span
                      className={
                        index === history.length - 1 ? "current-label" : ""
                      }
                    >
                      {day.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="chart-bottom">
            <CircleCheck size={15} />
            <span>Solo movimientos confirmados</span>
            <button className="text-button" onClick={() => navigate("reports")}>
              Ver movimientos
              <ArrowRight size={14} />
            </button>
          </div>
        </section>
        <section className="panel map-panel">
          <SectionHeading
            title="Monitoreo de Cobradores en Ruta"
            subtitle="Slot preparado para integrar un mapa externo de seguimiento"
            action={
              <span className="live-label">
                <span className="live-dot" />
                EN RUTA
              </span>
            }
          />
          <div className="monitoring-map-slot">
            <CollectorMap
              collectors={snapshot.collectors}
              onSelect={onCollector}
            />
          </div>
          <div className="map-footer">
            <div className="avatar-stack">
              {snapshot.collectors.map((collector, index) => (
                <Avatar
                  initials={collector.initials}
                  index={index}
                  key={collector.id}
                />
              ))}
            </div>
            <span>
              <strong>{totals.activeCollectors} cobradores</strong> activos
            </span>
            <button
              className="text-button"
              onClick={() => navigate("routesZones")}
            >
              Ver rutas
              <ArrowUpRight size={15} />
            </button>
          </div>
        </section>
      </div>
      <div className="dashboard-bottom-grid">
        <section className="panel team-panel">
          <SectionHeading
            title="Cobradores de hoy"
            subtitle="Límite de cobro, límite de pago y efectivo en mano"
            action={
              <button
                className="text-button"
                onClick={() => navigate("routesZones")}
              >
                Ver todos
                <ArrowRight size={14} />
              </button>
            }
          />
          <div className="table-scroll">
            <table className="team-table">
              <thead>
                <tr>
                  <th>Cobrador</th>
                  <th>Ruta asignada</th>
                  <th>Estado</th>
                  <th className="align-right">Efectivo en mano</th>
                  <th aria-label="Detalle" />
                </tr>
              </thead>
              <tbody>
                {snapshot.collectors.map((collector, index) => (
                  <tr key={collector.id}>
                    <td>
                      <button
                        className="person-link"
                        onClick={() => onCollector(collector)}
                      >
                        <Avatar initials={collector.initials} index={index} />
                        <span>
                          <strong>{collector.name}</strong>
                          <small>
                            {
                              snapshot.clients.filter(
                                (c) => c.routeId === collector.routeId,
                              ).length
                            }{" "}
                            clientes asignados
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className="route-label">
                        <MapPinned size={13} />
                        {
                          snapshot.routes.find(
                            (r) => r.id === collector.routeId,
                          )?.name
                        }
                      </span>
                    </td>
                    <td>
                      <Badge status={collector.status} />
                    </td>
                    <td className="align-right amount-cell">
                      {money(collector.cashInHand)}
                    </td>
                    <td>
                      <button
                        className="icon-button small"
                        onClick={() => onCollector(collector)}
                        aria-label={`Ver detalle de ${collector.name}`}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="team-foot">
            <span>
              <span className="live-dot" />
              Sincronización automática cada 30 s
            </span>
            <span>Hora de Santo Domingo</span>
          </div>
        </section>
        <section className="panel recent-panel">
          <SectionHeading
            title="Última actividad"
            action={
              <button
                className="icon-button small"
                aria-label="Ver toda la actividad"
                onClick={() => navigate("reports")}
              >
                <ArrowUpRight size={18} />
              </button>
            }
          />
          <ActivityList snapshot={snapshot} limit={4} />
          <button className="activity-all" onClick={() => navigate("reports")}>
            Ver todos los movimientos
            <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <div className="dashboard-note">
        <div className="note-icon">
          <CircleDollarSign size={22} />
        </div>
        <div>
          <strong>Cada cobro cuenta. Cada cierre, en equilibrio.</strong>
          <span>
            {required
              ? `${required} cargos obligatorios están pendientes de cobro. Mantén a tu equipo al día.`
              : "Revisa los cargos pendientes y prepara la próxima jornada."}
          </span>
        </div>
        <button className="text-button" onClick={() => navigate("charges")}>
          Gestionar cargos
          <ArrowRight size={16} />
        </button>
        <Wallet className="note-decoration" size={92} />
      </div>
    </>
  );
}
