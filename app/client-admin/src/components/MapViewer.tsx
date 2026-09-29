import { useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

export type MapViewerType = "cobrador" | "ruta" | "zona";

export const MOCK_MAP_SESSION_TOKEN = "123e4567-e89b-12d3-a456-426614174000";
const FALLBACK_MAPS_ORIGIN = "http://localhost:5174";

export function normalizeMapSessionToken(sessionToken: string): string | null {
  const normalized = sessionToken.trim().replace(/[-{}]/g, "");
  return /^[0-9a-fA-F]{32}$/.test(normalized) ? normalized.toLowerCase() : null;
}

function getMapsOrigin(): URL {
  const configuredOrigin = import.meta.env.VITE_MAPS_ORIGIN || FALLBACK_MAPS_ORIGIN;
  try {
    const parsed = new URL(configuredOrigin);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed;
  } catch {
    // An invalid local configuration uses the documented development fallback.
  }
  return new URL(FALLBACK_MAPS_ORIGIN);
}

function buildMapUrl(type: MapViewerType, entityId: string | number, origin: URL): string {
  const idParameter = type === "cobrador" ? "idCobrador" : type === "ruta" ? "idRuta" : "idZona";
  const url = new URL(`/maps/${type}`, origin.origin);
  url.searchParams.set(idParameter, String(entityId));
  url.searchParams.set("mode", "cobros");
  url.searchParams.set("live", "true");
  return url.toString();
}

export type MapViewerProps = Readonly<{
  type: MapViewerType;
  entityId: string | number;
  sessionToken?: string;
}>;

export default function MapViewer({
  type,
  entityId,
  sessionToken = MOCK_MAP_SESSION_TOKEN,
}: MapViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const mapsOrigin = useMemo(getMapsOrigin, []);
  const normalizedToken = normalizeMapSessionToken(sessionToken);
  const src = useMemo(
    () => buildMapUrl(type, entityId, mapsOrigin),
    [type, entityId, mapsOrigin],
  );

  const handleLoad = () => {
    setLoaded(true);
    if (!normalizedToken) {
      setTokenError("No se pudo validar la sesión de CobranzaMapas.");
      return;
    }
    setTokenError("");
    iframeRef.current?.contentWindow?.postMessage(
      {
        action: "SET_SESSION",
        payload: { idSesion: normalizedToken },
      },
      mapsOrigin.origin,
    );
  };

  return (
    <div className="map-viewer" aria-busy={!loaded}>
      <iframe
        ref={iframeRef}
        title={`Mapa de ${type} ${String(entityId)}`}
        src={src}
        width="100%"
        height="100%"
        style={{ border: "none", minHeight: "500px" }}
        allow="geolocation"
        onLoad={handleLoad}
      />
      {!loaded && (
        <div className="map-viewer-loading" role="status">
          <LoaderCircle size={18} className="map-viewer-spinner" />
          Cargando mapa...
        </div>
      )}
      {tokenError && <div className="map-viewer-error" role="alert">{tokenError}</div>}
    </div>
  );
}
