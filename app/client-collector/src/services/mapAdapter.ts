export type RouteStopInput = {
  id: string;
  order: number;
  clientName: string;
  lat: number;
  lng: number;
  amountDue: number;
  status: "pending" | "paid" | "partial" | "late" | string;
  obligated?: boolean;
  delayReason?: string;
};

export type RouteMarker = RouteStopInput & {
  color: "emerald" | "amber" | "rose";
  popupTitle: string;
  popupSubtitle: string;
};

export type AdaptedRouteMap = {
  center: { lat: number; lng: number };
  markers: RouteMarker[];
  waypoints: { lat: number; lng: number }[];
};

const centroid = (points: { lat: number; lng: number }[]) => {
  if (!points.length) return { lat: 0, lng: 0 };
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
};

export function transformRouteToMap(stops: RouteStopInput[]): AdaptedRouteMap {
  const ordered = [...stops].sort((a, b) => a.order - b.order);
  const markers = ordered.map((stop) => {
    const late =
      stop.status === "late" || Boolean(stop.delayReason) || stop.obligated;
    const color = stop.status === "paid" ? "emerald" : late ? "rose" : "amber";
    return {
      ...stop,
      color,
      popupTitle: `${stop.order}. ${stop.clientName}`,
      popupSubtitle:
        stop.delayReason ??
        (stop.status === "paid"
          ? "Completado"
          : late
            ? "Atraso / obligado"
            : "Pendiente"),
    } satisfies RouteMarker;
  });
  const waypoints = markers.map((marker) => ({
    lat: marker.lat,
    lng: marker.lng,
  }));
  return { center: centroid(waypoints), markers, waypoints };
}
