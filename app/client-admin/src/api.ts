import { isMockToken, mockApi } from "./mock";
import { createStrictApi, StrictApiError } from "../../shared/remittances/strictApi";

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
    public uncertain?: boolean,
    public code?: string,
  ) {
    super(message);
  }
}
const strictMutationApi = createStrictApi(getToken, () => isMockToken(getToken()));
const strictMutationPaths = new Set([
  "/configuracion",
  "/depositos",
  "/cargos/importar",
  "/descargos/importar",
]);
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  if (isMockToken(token)) return mockApi<T>(path, options);
  if (path.startsWith("/mock/")) throw new ApiError("Esta acción todavía no está disponible en la versión conectada. No se guardaron cambios.", 501);
  if (options.method?.toUpperCase() === "POST" && (
    strictMutationPaths.has(path) || /^\/depositos\/[^/]+\/(aceptar|cancelar)$/.test(path)
  )) {
    try {
      return await strictMutationApi<T>(path, options);
    } catch (error) {
      if (error instanceof StrictApiError)
        throw new ApiError(error.message, error.status, error.uncertain, error.code);
      throw error;
    }
  }
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
      throw new ApiError(
        "El servidor no devolvió una respuesta válida.",
        response.status,
      );
    }
    if (!response.ok) {
      throw new ApiError(
        body.error?.message ?? "No pudimos completar la operación.",
        response.status,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("No se pudo conectar con el servidor. Conserva los datos y comprueba el resultado antes de repetir una operación.", 0);
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
