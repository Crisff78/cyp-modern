export type MapStopInput = {
  id: string;
  order: number;
  client_name: string;
  lat: number;
  lng: number;
  amount_due: number;
  status: string;
  obligated: boolean;
};

export type MapCollectorInput = {
  id: string;
  name: string;
  phone: string;
  lat: number;
  lng: number;
  cash_in_hand: number;
  collection_limit: number;
  payout_limit: number;
  last_ping: string;
};

export type MapMarker = {
  id: string;
  type: "collector" | "stop" | "zone" | "route";
  label: string;
  lat: number;
  lng: number;
  order?: number;
  status: "collected" | "pending" | "late" | "collector";
  color: "emerald" | "amber" | "rose" | "slate";
  amountDue?: number;
  obligated?: boolean;
  clientName?: string;
  popupTitle: string;
  popupSubtitle: string;
};

export type MapPolyline = {
  id: string;
  points: { lat: number; lng: number }[];
};

export type AdaptedMap = {
  title: string;
  center: { lat: number; lng: number };
  markers: MapMarker[];
  route: MapPolyline;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
};

export type MarkerCallbacks = {
  onOpenClient?: (marker: MapMarker) => void;
  onOpenCollection?: (marker: MapMarker) => void;
  onFocus?: (marker: MapMarker) => void;
};

const markerStatus = (stop: MapStopInput): MapMarker["status"] => {
  if (stop.status === "paid") return "collected";
  if (stop.obligated || stop.status === "partial" || stop.status === "late")
    return "late";
  return "pending";
};

const markerColor = (status: MapMarker["status"]): MapMarker["color"] =>
  status === "collected"
    ? "emerald"
    : status === "late"
      ? "rose"
      : status === "pending"
        ? "amber"
        : "slate";

const centroid = (points: { lat: number; lng: number }[]) => {
  if (!points.length) return { lat: 0, lng: 0 };
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
};

const bounds = (points: { lat: number; lng: number }[]) => {
  const usable = points.length ? points : [{ lat: 0, lng: 0 }];
  return {
    minLat: Math.min(...usable.map((point) => point.lat)),
    maxLat: Math.max(...usable.map((point) => point.lat)),
    minLng: Math.min(...usable.map((point) => point.lng)),
    maxLng: Math.max(...usable.map((point) => point.lng)),
  };
};

const stopMarker = (stop: MapStopInput): MapMarker => {
  const status = markerStatus(stop);
  return {
    id: stop.id,
    type: "stop",
    label: String(stop.order),
    lat: stop.lat,
    lng: stop.lng,
    order: stop.order,
    status,
    color: markerColor(status),
    amountDue: stop.amount_due,
    obligated: stop.obligated,
    clientName: stop.client_name,
    popupTitle: `${stop.order}. ${stop.client_name}`,
    popupSubtitle: `${stop.obligated ? "Obligado a cobrar" : "Cobro regular"} · ${stop.status}`,
  };
};

export function transformCollectorToMap(
  collector: MapCollectorInput,
  stops: MapStopInput[],
): AdaptedMap {
  const orderedStops = [...stops].sort((a, b) => a.order - b.order);
  const markers: MapMarker[] = [
    {
      id: collector.id,
      type: "collector",
      label: collector.name,
      lat: collector.lat,
      lng: collector.lng,
      status: "collector",
      color: "slate",
      popupTitle: collector.name,
      popupSubtitle: `En mano RD$ ${collector.cash_in_hand.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`,
    },
    ...orderedStops.map(stopMarker),
  ];
  const points = markers.map((marker) => ({
    lat: marker.lat,
    lng: marker.lng,
  }));
  return {
    title: collector.name,
    center: centroid(points),
    markers,
    route: {
      id: `route-${collector.id}`,
      points: [
        { lat: collector.lat, lng: collector.lng },
        ...orderedStops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
      ],
    },
    bounds: bounds(points),
  };
}

export function transformZoneToMap(
  zoneName: string,
  clients: MapStopInput[],
): AdaptedMap {
  const markers = clients.map(stopMarker);
  const points = markers.map((marker) => ({
    lat: marker.lat,
    lng: marker.lng,
  }));
  return {
    title: zoneName,
    center: centroid(points),
    markers,
    route: { id: `zone-${zoneName}`, points },
    bounds: bounds(points),
  };
}

export function transformRouteToMap(
  routeName: string,
  stops: MapStopInput[],
): AdaptedMap {
  const ordered = [...stops].sort((a, b) => a.order - b.order);
  const markers = ordered.map(stopMarker);
  const points = markers.map((marker) => ({
    lat: marker.lat,
    lng: marker.lng,
  }));
  return {
    title: routeName,
    center: centroid(points),
    markers,
    route: { id: `route-${routeName}`, points },
    bounds: bounds(points),
  };
}

export function dispatchMarkerClick(
  marker: MapMarker,
  callbacks: MarkerCallbacks,
) {
  callbacks.onFocus?.(marker);
  if (marker.type === "stop") {
    if (marker.status === "pending" || marker.status === "late")
      callbacks.onOpenCollection?.(marker);
    callbacks.onOpenClient?.(marker);
  }
}
