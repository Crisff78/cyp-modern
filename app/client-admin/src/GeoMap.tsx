import { useEffect, useRef, useState } from "react";
import { circleMarker, latLngBounds, layerGroup, map as createMap, tileLayer, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { validLocation } from "../../shared/geolocation";
import "./geo-map.css";

export type GeoPoint = { id: string; lat: number; lng: number; label: string; detail?: string; kind?: "operator" | "paid" | "pending" };

/** Shared by both clients; uses the admin's existing Leaflet dependency. */
export function GeoMap({ points, label = "Mapa de ubicaciones registradas", onPick }: { points: GeoPoint[]; label?: string; onPick?: (lat: number, lng: number) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [tileError, setTileError] = useState(false);
  const signature = JSON.stringify(points.filter((point) => validLocation(point.lat, point.lng)));
  useEffect(() => {
    if (!container.current) return;
    const map = createMap(container.current, { scrollWheelZoom: false }).setView([18.5, -69.9], 7);
    mapRef.current = map;
    const tiles = tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 19, referrerPolicy: "strict-origin-when-cross-origin" }).addTo(map);
    tiles.on("tileerror", () => setTileError(true));
    tiles.on("load", () => setTileError(false));
    map.on("click", (event) => pickRef.current?.(event.latlng.lat, event.latlng.lng));
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(container.current);
    return () => { resize.disconnect(); map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const entries: GeoPoint[] = JSON.parse(signature);
    const group = layerGroup().addTo(map);
    for (const point of entries) {
      const popup = document.createElement("div");
      const heading = document.createElement("strong");
      heading.textContent = point.label;
      popup.append(heading);
      if (point.detail) { const detail = document.createElement("p"); detail.textContent = point.detail; popup.append(detail); }
      const link = document.createElement("a");
      link.href = `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`;
      link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Cómo llegar"; popup.append(link);
      const tooltip = document.createElement("span");
      tooltip.textContent = point.label;
      circleMarker([point.lat, point.lng], { radius: point.kind === "operator" ? 10 : 8, color: "#fff", weight: 2, fillColor: point.kind === "operator" ? "#1769aa" : point.kind === "paid" ? "#16815e" : "#bd6b12", fillOpacity: 1 }).bindPopup(popup).bindTooltip(tooltip).addTo(group);
    }
    if (entries.length) map.fitBounds(latLngBounds(entries.map((point) => [point.lat, point.lng])), { padding: [35, 35], maxZoom: 16 });
    return () => { group.remove(); };
  }, [signature]);
  return <div className="geo-map"><div ref={container} className="geo-map-canvas" role="region" aria-label={label} />{tileError && <p role="status">No se pudo cargar el mapa base. Las coordenadas registradas siguen disponibles.</p>}{points.length === 0 && <p role="status">Sin ubicaciones registradas para mostrar.</p>}</div>;
}
