import { ledgerCurrency } from "./domain.js";

const newDefaultCurrencyPaths = new Set([
  "/api/descargos", "/api/entregas", "/api/depositos", "/api/cargos/recurrentes",
  "/api/cobros/central", "/api/pagos/central", "/api/descargos-recurrentes", "/api/descargos-recurrentes/:id",
]);

// Only compare a previously committed record with the exact validated shape
// used before native currency support. This never authorizes a new write.
// Actor, URL, amount and every other field remain in the fingerprint; an old
// DOP operation can never be replayed as USD or EUR.
export function legacyFinancialFingerprintBody(route: string, body: unknown, rawBody: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const current = body as Record<string, unknown>;
  const raw = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? rawBody as Record<string, unknown> : {};
  if (newDefaultCurrencyPaths.has(route)) {
    if (current.currency !== undefined && current.currency !== "DOP") return;
    const legacy = { ...current };
    delete legacy.currency;
    return legacy;
  }
  if (route === "/api/cargos" || route === "/api/cargos/:id") {
    const value = typeof raw.currency === "string" ? raw.currency.trim() : "Peso Dominicano";
    if (ledgerCurrency(value) !== current.currency) return;
    return { ...current, currency: value };
  }
  if (route === "/api/cargos-recurrentes" || route === "/api/cargos-recurrentes/:id") {
    if (current.currency !== "DOP") return;
    return { ...current, currency: typeof raw.currency === "string" ? raw.currency.trim() : "DOP" };
  }
}
