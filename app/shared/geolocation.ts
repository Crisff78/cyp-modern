export function validLocation(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function locationUnavailable(): string | null {
  if (!window.isSecureContext) return "Abre la aplicación por HTTPS para usar el GPS.";
  if (!navigator.geolocation) return "Este navegador no permite obtener la ubicación.";
  return null;
}

export function locationError(error: GeolocationPositionError): string {
  if (error.code === 1) return "Permiso de ubicación denegado. Actívalo para este sitio en el navegador y en los ajustes del dispositivo.";
  if (error.code === 2) return "Ubicación no disponible. Activa la ubicación del dispositivo y vuelve a intentarlo.";
  return "El GPS tardó demasiado. Acércate a un lugar con mejor señal y vuelve a intentarlo.";
}
