import { isMockToken, mockApi, MockApiError } from "./mock";

const TOKEN_KEY = "cyp-admin-token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string) =>
  localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem("cyp-admin-force-mock");
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const shouldUseMock = (path: string, token: string | null) =>
  isMockToken(token) ||
  localStorage.getItem("cyp-admin-force-mock") === "true" ||
  path === "/auth/login";

const isBackendUnavailable = (status: number) =>
  status === 0 || status === 502 || status === 503 || status === 504;

function toApiError(error: unknown) {
  if (error instanceof ApiError) return error;
  if (error instanceof MockApiError)
    return new ApiError(error.message, error.status);
  return new ApiError(
    error instanceof Error
      ? error.message
      : "No pudimos completar la operación.",
    0,
  );
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  if (path.startsWith("/mock/")) {
    localStorage.setItem("cyp-admin-force-mock", "true");
    return mockApi<T>(path, options);
  }
  if (
    isMockToken(token) ||
    localStorage.getItem("cyp-admin-force-mock") === "true"
  )
    return mockApi<T>(path, options);
  const request = () =>
    fetch(`/api${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  try {
    const response = await request();
    let body;
    try {
      body = await response.json();
    } catch (error) {
      if (shouldUseMock(path, token) && isBackendUnavailable(response.status))
        return mockApi<T>(path, options);
      throw new ApiError(
        "El servidor no devolvió una respuesta válida.",
        response.status,
      );
    }
    if (!response.ok) {
      if (shouldUseMock(path, token) && isBackendUnavailable(response.status))
        return mockApi<T>(path, options);
      throw new ApiError(
        body.error?.message ?? "No pudimos completar la operación.",
        response.status,
      );
    }
    return body as T;
  } catch (error) {
    const unavailable =
      !(error instanceof ApiError) || isBackendUnavailable(error.status);
    if (unavailable) {
      try {
        return await mockApi<T>(path, options);
      } catch (mockError) {
        throw toApiError(mockError);
      }
    }
    throw error;
  }
}
export const money = (value: number) =>
  `RD$ ${new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100)}`;
export const wholeMoney = (value: number) =>
  `RD$ ${new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 }).format(value / 100)}`;
export const amountToCents = (value: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Escribe un monto válido con un máximo de dos decimales.");
  const [whole, fractional = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0)
    throw new Error("El monto debe ser mayor que cero.");
  return cents;
};
export const dateLabel = (
  date: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
) => new Date(`${date}T12:00:00`).toLocaleDateString("es-DO", options);
export const timeLabel = (date: string) =>
  new Date(date).toLocaleTimeString("es-DO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Santo_Domingo",
  });
export const statusLabel = (status: string) =>
  ({
    paid: "Completado",
    partial: "Parcial",
    pending: "Pendiente",
    cancelled: "Cancelado",
    active: "En ruta",
    offline: "Sin conexión",
    limit: "Límite alcanzado",
  })[status] ?? status;
