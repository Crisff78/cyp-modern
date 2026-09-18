import { isMockToken, mockApi, MockApiError } from "./mock";

const TOKEN_KEY = "cyp-collector-token";
export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null) =>
  token
    ? sessionStorage.setItem(TOKEN_KEY, token)
    : sessionStorage.removeItem(TOKEN_KEY);
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const isBackendUnavailable = (status: number) =>
  status === 0 || status === 502 || status === 503 || status === 504;

function toApiError(error: unknown) {
  if (error instanceof ApiError) return error;
  if (error instanceof MockApiError)
    return new ApiError(error.message, error.status);
  return new ApiError(
    error instanceof Error
      ? error.message
      : "No pudimos completar la solicitud.",
    0,
  );
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  if (isMockToken(token)) return mockApi<T>(path, options);
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (token && !path.startsWith("/recibos/"))
    headers.set("Authorization", `Bearer ${token}`);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers,
      signal: options.signal ?? controller.signal,
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (isBackendUnavailable(response.status))
        return mockApi<T>(path, options);
      throw new ApiError(
        data?.error?.message ?? "No pudimos completar la solicitud.",
        response.status,
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError && !isBackendUnavailable(error.status))
      throw error;
    try {
      return await mockApi<T>(path, options);
    } catch (mockError) {
      throw toApiError(mockError);
    }
  } finally {
    window.clearTimeout(timer);
  }
}
export const money = (amount: number) =>
  `RD$ ${new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount / 100)}`;
export const shortMoney = (amount: number) =>
  `RD$ ${new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 }).format(amount / 100)}`;
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("es-DO", {
    day: "numeric",
    month: "long",
    ...(date.includes("T") ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(date.includes("T") ? date : `${date}T12:00:00`));
