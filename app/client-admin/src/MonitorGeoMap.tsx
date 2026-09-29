import { useCallback, useEffect, useState } from "react";
import { GeoMap, type GeoPoint } from "./GeoMap";
import { remittancesApi } from "./remittancesApi";
import { validLocation } from "../../shared/geolocation";

type MapData = { collector: { id: string; name: string; lat: number | null; lng: number | null; last_ping: string | null }; stops: { id: string; client_name: string; lat: number; lng: number; status: string }[]; missingLocationCount?: number };
export function MonitorGeoMap({ entityType, entityId }: { entityType: "collector" | "route" | "zone"; entityId: string }) {
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await remittancesApi<MapData>(`/monitoring/${entityType}/${encodeURIComponent(entityId)}/map-data`)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudieron obtener las ubicaciones."); }
    finally { setLoading(false); }
  }, [entityType, entityId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const points: GeoPoint[] = data?.stops.filter((stop) => validLocation(stop.lat, stop.lng)).map((stop) => ({ id: stop.id, lat: stop.lat, lng: stop.lng, label: stop.client_name, kind: stop.status === "paid" ? "paid" : "pending" })) ?? [];
  if (data && validLocation(data.collector.lat, data.collector.lng)) points.push({ id: data.collector.id, lat: data.collector.lat!, lng: data.collector.lng!, label: data.collector.name, kind: "operator", detail: data.collector.last_ping ? `Último envío: ${new Date(data.collector.last_ping).toLocaleString("es-DO")}` : "Sin envío GPS confirmado" });
  return <div><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Cargando…" : "Actualizar ubicaciones"}</button>{error && <p role="alert">{error}</p>}<GeoMap points={points} />{data && <p className="geo-map-summary">{data.missingLocationCount ?? 0} cliente(s) sin GPS registrado. {validLocation(data.collector.lat, data.collector.lng) ? `Último envío del cobrador: ${data.collector.last_ping ? new Date(data.collector.last_ping).toLocaleString("es-DO") : "sin fecha"}.` : "El cobrador todavía no ha compartido su ubicación."}</p>}</div>;
}
