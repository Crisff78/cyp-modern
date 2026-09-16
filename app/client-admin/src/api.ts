const TOKEN_KEY = "cyp-admin-token";
export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (token: string) =>
  sessionStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...options.headers,
    },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      "El servidor no devolvió una respuesta válida.",
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      body.error?.message ?? "No pudimos completar la operación.",
      response.status,
    );
  return body as T;
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
