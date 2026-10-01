export type StrictApi = <T>(path: string, options?: RequestInit) => Promise<T>;

export class StrictApiError extends Error {
  constructor(message: string, public status = 0, public uncertain = false, public code?: string) {
    super(message);
    this.name = "StrictApiError";
  }
}

export const operationKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
};

/** Financial requests never fall back to simulated data. Pending keys live only in memory. */
export function createStrictApi(getToken: () => string | null, isDemo: () => boolean): StrictApi {
  type Attempt = { body: string; key: string; inFlight?: Promise<unknown> };
  // A payload identifies a retry only while it is the current intent for this
  // endpoint. Returning to an earlier payload starts a new operation.
  const attempts = new Map<string, Attempt>();
  return async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    if (isDemo()) throw new StrictApiError("Esta acción requiere una sesión conectada. Sal del modo de demostración e inicia sesión con tu cuenta.", 400);
    const token = getToken();
    if (!token) throw new StrictApiError("Tu sesión terminó. Inicia sesión para continuar.", 401);
    if (!navigator.onLine) throw new StrictApiError("Sin conexión. Conservamos el formulario; vuelve a intentarlo cuando tengas Internet.");
    const mutation = options.method !== undefined && options.method.toUpperCase() !== "GET";
    const scope = `${token}\n${options.method?.toUpperCase()}\n${path}`;
    const body = String(options.body ?? "");
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (options.body) headers.set("Content-Type", "application/json");
    let attempt: Attempt | undefined;
    if (mutation) {
      if (headers.has("Idempotency-Key")) {
        // Explicit keys belong to the caller's request lifecycle. A new caller
        // owned operation also retires any automatic intent for this endpoint.
        attempts.delete(scope);
      } else {
        const previous = attempts.get(scope);
        attempt = previous?.body === body ? previous : { body, key: operationKey() };
        attempts.set(scope, attempt);
        headers.set("Idempotency-Key", attempt.key);
        if (attempt.inFlight) return await attempt.inFlight as T;
      }
    }
    const current = () => !attempt || attempts.get(scope) === attempt;
    const superseded = () => new StrictApiError("Esta solicitud fue sustituida por datos nuevos. Guarda los datos actuales para confirmar su resultado.", 0, false, "REQUEST_SUPERSEDED");
    const release = () => { if (attempt && current()) attempts.delete(scope); };
    const send = async (): Promise<T> => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(`/api${path}`, { ...options, headers, cache: "no-store", signal: options.signal ?? controller.signal });
        const data = await response.json().catch(() => null);
        if (!current()) throw superseded();
        if (!response.ok) {
          const uncertain = mutation && response.status >= 500;
          if (!uncertain) release();
          throw new StrictApiError(data?.error?.message ?? `No se pudo completar la operación (${response.status}).`, response.status, uncertain, data?.error?.code);
        }
        if (data === null) throw new StrictApiError("La API no devolvió una respuesta válida. Consulta el listado y reintenta con los mismos datos.", response.status, mutation);
        release();
        return data as T;
      } catch (error) {
        if (!current() && !(error instanceof StrictApiError)) throw superseded();
        if (error instanceof StrictApiError) throw error;
        throw new StrictApiError(mutation
          ? "No pudimos confirmar el resultado. Conservamos los datos: reintenta esta misma operación para consultar su resultado sin duplicarla."
          : "No pudimos conectar con la API. Vuelve a intentar cargar los datos.", 0, mutation);
      } finally {
        window.clearTimeout(timer);
      }
    };
    const request = send();
    if (attempt) attempt.inFlight = request;
    try { return await request; }
    finally { if (attempt?.inFlight === request) attempt.inFlight = undefined; }
  };
}
