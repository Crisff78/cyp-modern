import { useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Inbox,
  LoaderCircle,
  MapPin,
  X,
} from "lucide-react";
import {
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { divIcon, latLngBounds } from "leaflet";
import { money, statusLabel, timeLabel } from "./api";
import type { Collector, Snapshot } from "./types";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">
        <ArrowUpRight size={21} />
        <ArrowDownLeft size={21} />
      </span>
      {!compact && (
        <span className="brand-word">
          cyp<span>COBROS Y PAGOS</span>
        </span>
      )}
    </div>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  sheet = false,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  sheet?: boolean;
  className?: string;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={`${sheet ? "sheet" : "dialog"} ${className}`}
        >
          <div className="dialog-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description ?? "Consulta el detalle y gestiona tu operación."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Cerrar">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Empty({
  title = "Todo despejado por aquí",
  text = "No hay registros que coincidan con tu búsqueda.",
  action,
}: {
  title?: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Inbox size={27} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Loading({
  label = "Actualizando tu operación…",
}: {
  label?: string;
}) {
  return (
    <div className="page-loading" role="status">
      <div className="loading-message">
        <LoaderCircle size={18} className="spin" />
        {label}
      </div>
      <div className="skeleton-row">
        {[1, 2, 3, 4].map((key) => (
          <div className="skeleton skeleton-card" key={key} />
        ))}
      </div>
      <div className="skeleton skeleton-chart" />
      <div className="skeleton skeleton-table" />
    </div>
  );
}
export function Badge({
  status,
  children,
}: {
  status?: string;
  children?: ReactNode;
}) {
  return (
    <span className={`badge ${status ?? "neutral"}`}>
      <span className="badge-dot" />
      {children ?? statusLabel(status ?? "")}
    </span>
  );
}
export function Avatar({
  name,
  initials,
  index = 0,
  size = "",
}: {
  name?: string;
  initials?: string;
  index?: number;
  size?: string;
}) {
  return (
    <span className={`avatar avatar-${index % 4} ${size}`} aria-hidden="true">
      {initials ??
        name
          ?.split(" ")
          .map((word) => word[0])
          .slice(0, 2)
          .join("")}
    </span>
  );
}
export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function Sparkline({
  values,
  color = "emerald",
}: {
  values: number[];
  color?: string;
}) {
  const max = Math.max(...values, 1),
    min = Math.min(...values, 0),
    range = max - min || 1;
  const points = values
    .map(
      (value, index) =>
        `${(index * 96) / Math.max(values.length - 1, 1)},${28 - ((value - min) / range) * 23}`,
    )
    .join(" ");
  return (
    <svg
      className={`sparkline ${color}`}
      viewBox="0 0 100 32"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function FitMap({ collectors }: { collectors: Collector[] }) {
  const map = useMap();
  useEffect(() => {
    const coordinates = collectors
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
      .map((c) => [c.lat, c.lng] as [number, number]);
    if (coordinates.length)
      map.fitBounds(latLngBounds(coordinates), {
        padding: [58, 58],
        maxZoom: 13,
      });
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, collectors]);
  return null;
}
export function CollectorMap({
  collectors,
  onSelect,
  large = false,
}: {
  collectors: Collector[];
  onSelect: (collector: Collector) => void;
  large?: boolean;
}) {
  const [tileError, setTileError] = useState(false);
  return (
    <div className={`collector-map ${large ? "large-map" : ""}`}>
      <MapContainer
        center={[18.48, -69.93]}
        zoom={12}
        scrollWheelZoom={false}
        attributionControl
        zoomControl={large}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          eventHandlers={{
            tileerror: () => setTileError(true),
            tileload: () => setTileError(false),
          }}
        />
        <FitMap collectors={collectors} />
        {collectors
          .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
          .map((collector, index) => (
            <Marker
              key={collector.id}
              position={[collector.lat, collector.lng]}
              icon={divIcon({
                className: "",
                html: `<div class="map-pin map-pin-${collector.status} color-${index % 3}"><span>${collector.initials.replace(/[^A-ZÁÉÍÓÚÑ]/gi, "")}</span><i></i></div>`,
                iconSize: [43, 51],
                iconAnchor: [21, 47],
              })}
              eventHandlers={{ click: () => onSelect(collector) }}
            >
              <Tooltip direction="top" offset={[0, -42]}>
                {collector.name} · {statusLabel(collector.status)}
              </Tooltip>
            </Marker>
          ))}
      </MapContainer>
      <span className="map-location">
        <MapPin size={12} /> Santo Domingo
      </span>
      {tileError && (
        <span className="map-error">
          Mapa base sin conexión · las ubicaciones siguen disponibles
        </span>
      )}
      <div className="map-key">
        <span>
          <i className="green-dot" />
          En ruta
        </span>
        <span>
          <i className="gray-dot" />
          Sin conexión
        </span>
        <span>
          <i className="amber-dot" />
          En límite
        </span>
      </div>
    </div>
  );
}
export function ActivityList({
  snapshot,
  limit = 5,
}: {
  snapshot: Snapshot;
  limit?: number;
}) {
  const movements = [...snapshot.movements]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  const labels = {
    collection: "Cobro recibido",
    payout: "Pago a cliente",
    deposit: "Depósito registrado",
    office_delivery: "Entrega de oficina",
  };
  return movements.length ? (
    <div className="activity-list">
      {movements.map((movement) => (
        <div className="activity-item" key={movement.id}>
          <span
            className={`activity-symbol ${movement.type === "collection" || movement.type === "deposit" ? "in" : "out"}`}
          >
            {movement.type === "collection" || movement.type === "deposit" ? (
              <ArrowDownLeft size={18} />
            ) : (
              <ArrowUpRight size={18} />
            )}
          </span>
          <div className="activity-info">
            <strong>{labels[movement.type]}</strong>
            <span>
              {snapshot.clients.find((c) => c.id === movement.clientId)?.name ??
                snapshot.collectors.find((c) => c.id === movement.collectorId)
                  ?.name ??
                "Operación"}
            </span>
          </div>
          <div className="activity-value">
            <strong>{money(movement.amount)}</strong>
            <span>{timeLabel(movement.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <Empty
      title="Tu jornada comienza aquí"
      text="Los movimientos registrados aparecerán en tiempo real."
    />
  );
}
export function CollectorDrawer({
  collector,
  snapshot,
  onClose,
  onSettle,
}: {
  collector: Collector | null;
  snapshot: Snapshot;
  onClose: () => void;
  onSettle: (id: string) => void;
}) {
  if (!collector) return null;
  const route = snapshot.routes.find((route) => route.id === collector.routeId);
  const movements = snapshot.movements.filter(
    (movement) => movement.collectorId === collector.id,
  );
  const collected = movements
    .filter((m) => m.type === "collection")
    .reduce((s, m) => s + m.amount, 0);
  const deposited = movements
    .filter((m) => m.type === "deposit")
    .reduce((s, m) => s + m.amount, 0);
  const delivered = movements
    .filter((m) => m.type === "office_delivery")
    .reduce((s, m) => s + m.amount, 0);
  const paid = movements
    .filter((m) => m.type === "payout")
    .reduce((s, m) => s + m.amount, 0);
  return (
    <Modal
      open={!!collector}
      onClose={onClose}
      title="Detalle del cobrador"
      description="Una vista completa de su jornada."
      sheet
    >
      <div className="collector-profile">
        <Avatar initials={collector.initials} size="avatar-xl" />
        <h2>{collector.name}</h2>
        <p>
          {route?.name} · {route?.sector}
        </p>
        <Badge status={collector.status} />
      </div>
      <div className="cash-feature">
        <span>Efectivo en mano</span>
        <strong>{money(collector.cashInHand)}</strong>
        <small>
          Actualizado:{" "}
          {new Date(collector.lastSeen).toLocaleString("es-DO", {
            timeZone: "America/Santo_Domingo",
          })}
        </small>
      </div>
      <div className="detail-block">
        <h3>Control de exposición</h3>
        {[
          {
            label: "Cobros por depositar",
            amount: collected - deposited,
            max: collector.collectionLimit,
          },
          {
            label: "Entregas por pagar",
            amount: delivered - paid,
            max: collector.payoutLimit,
          },
        ].map((item) => (
          <div className="limit-row" key={item.label}>
            <div>
              <span>{item.label}</span>
              <strong>{money(item.amount)}</strong>
            </div>
            <div className="meter">
              <span
                style={{
                  width: `${Math.min(100, (item.amount / Math.max(item.max, 1)) * 100)}%`,
                }}
              />
            </div>
            <small>Límite autorizado: {money(item.max)}</small>
          </div>
        ))}
      </div>
      <div className="detail-block">
        <h3>Últimos movimientos</h3>
        <ActivityList snapshot={{ ...snapshot, movements }} limit={5} />
      </div>
      <button
        className="btn primary full"
        onClick={() => onSettle(collector.id)}
      >
        Ir al cuadre diario
        <ChevronRight size={17} />
      </button>
    </Modal>
  );
}
export function HelpNote({ children }: { children: ReactNode }) {
  return (
    <div className="help-note">
      <CircleHelp size={17} />
      <span>{children}</span>
    </div>
  );
}
export function CheckMark() {
  return (
    <span className="success-check">
      <Check size={18} />
    </span>
  );
}
