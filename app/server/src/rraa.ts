import { DomainError } from "./domain.js";
import type { PcpStation } from "./admin-tools.js";

export type RraaValidation = { clientId: string; stationCode: string; deviceId: string; license: string; validatedAt: string };
export type RraaValidator = { clientId: string; validate: (stationCode: string, deviceId: string) => Promise<RraaValidation> };
export type RraaConfig = { endpoint: string; clientId: string; timeoutMs?: number; fetch?: typeof fetch };
const validParameter = (value: string, max = 160) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[|\u0000-\u001f\u007f]/.test(value);
export function parseRraaResponse(text: string): string {
  const parts = text.trim().split("|");
  if (parts.length !== 2 || !parts[1]?.trim() || /[\u0000-\u001f\u007f]/.test(parts[1]))
    throw new DomainError("RRAA_INVALID_RESPONSE", "RRAA devolvió una respuesta inválida. La estación no fue autorizada.", 502);
  if (parts[0] === "ER") throw new DomainError("RRAA_STATION_NOT_FOUND", `RRAA: ${parts[1].trim()}`, 422);
  if (parts[0] !== "OK" || parts[1].trim().length > 1024)
    throw new DomainError("RRAA_INVALID_RESPONSE", "RRAA devolvió una respuesta inválida. La estación no fue autorizada.", 502);
  return parts[1].trim();
}
export function createRraaValidator(config: RraaConfig): RraaValidator {
  let endpoint: URL;
  try { endpoint = new URL(config.endpoint); }
  catch { throw new Error("RRAA_ENDPOINT debe ser una URL válida de VALSTAT."); }
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !endpoint.pathname.endsWith("/VALSTAT"))
    throw new Error("RRAA_ENDPOINT debe apuntar a VALSTAT, sin credenciales, query ni fragmento.");
  if (!validParameter(config.clientId, 80)) throw new Error("RRAA_CLIENT_ID debe identificar a la empresa configurada.");
  const timeoutMs = config.timeoutMs ?? 8000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) throw new Error("RRAA_TIMEOUT_MS debe estar entre 100 y 10000.");
  const request = config.fetch ?? fetch;
  return { clientId: config.clientId, async validate(stationCode, deviceId) {
    if (!validParameter(stationCode) || !validParameter(deviceId))
      throw new DomainError("RRAA_INPUT_INVALID", "Indica el código de Estación y el ID dispositivo, sin separadores | ni controles.", 422);
    const target = new URL(endpoint); target.searchParams.set("p", [config.clientId, stationCode.trim(), deviceId.trim()].join("|"));
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await request(target, { method: "GET", redirect: "manual", cache: "no-store", signal: controller.signal, headers: { Accept: "text/plain" } });
      if (!response.ok || response.status !== 200) { await response.body?.cancel(); throw new DomainError("RRAA_UNAVAILABLE", "RRAA no está disponible. La estación no fue autorizada; vuelve a intentar.", 502); }
      const reader = response.body?.getReader();
      if (!reader) throw new DomainError("RRAA_INVALID_RESPONSE", "RRAA no devolvió la licencia.", 502);
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > 4096) { await reader.cancel(); throw new DomainError("RRAA_INVALID_RESPONSE", "La respuesta de RRAA excede el tamaño permitido.", 502); }
        chunks.push(chunk.value);
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      return { clientId: config.clientId, stationCode: stationCode.trim(), deviceId: deviceId.trim(), license: parseRraaResponse(text), validatedAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("RRAA_UNAVAILABLE", controller.signal.aborted ? "RRAA no respondió a tiempo. La estación no fue autorizada; reintenta." : "No pudimos consultar RRAA. La estación no fue autorizada; reintenta.", 502);
    } finally { clearTimeout(timer); }
  } };
}
export function stationRraaValidated(station: PcpStation, clientId?: string) {
  return Boolean(clientId && station.license && station.rraaClientId === clientId && station.rraaStationCode === station.name &&
    station.rraaDeviceId === station.deviceId && station.rraaValidatedAt && Number.isFinite(Date.parse(station.rraaValidatedAt)) && station.rraaValidatedBy);
}
export function applyRraaValidation(station: PcpStation, validation: RraaValidation, actorId: string) {
  Object.assign(station, { license: validation.license, rraaClientId: validation.clientId, rraaStationCode: validation.stationCode,
    rraaDeviceId: validation.deviceId, rraaValidatedAt: validation.validatedAt, rraaValidatedBy: actorId });
}
