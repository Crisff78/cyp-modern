import { DomainError } from "./domain.js";
import type { PcpStation } from "./admin-tools.js";

export type RraaValidation = { clientId: string; stationCode: string; deviceId: string; license: string; validatedAt: string };
export type RraaExample = { stationCode: string; deviceId: string };
// `simulated` marks the practice control of the demo; `examples` are data it accepts, shown to whoever tries it.
export type RraaValidator = { clientId: string; validate: (stationCode: string, deviceId: string) => Promise<RraaValidation>; simulated?: boolean; examples?: readonly RraaExample[] };
export type RraaConfig = { endpoint: string; clientId: string; timeoutMs?: number; fetch?: typeof fetch };
const validParameter = (value: string, max = 160) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[|\u0000-\u001f\u007f]/.test(value);
export function parseRraaResponse(text: string): string {
  const parts = text.trim().split("|");
  if (parts.length !== 2 || !parts[1]?.trim() || /[\u0000-\u001f\u007f]/.test(parts[1]))
    throw new DomainError("RRAA_INVALID_RESPONSE", "RRAA devolvió una respuesta inválida. La estación no fue autorizada.", 502);
  if (parts[0] === "ER") {
    // The service answers with short codes instead of the sentence of the contract.
    const reason = parts[1].trim();
    // CNE is about the company id configured in the server, not about what the administrator typed.
    if (reason === "CNE") throw new DomainError("RRAA_CLIENT_NOT_FOUND", "RRAA: Cliente no encontrado (CNE). Revisa el identificador de empresa configurado en el servidor.", 422);
    throw new DomainError("RRAA_STATION_NOT_FOUND", reason === "ENE" ? "RRAA: Estación no encontrada (ENE)." : `RRAA: ${reason}`, 422);
  }
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
// A shared installation (the public demo) lets anyone invited ask the provider through CyP, so the
// questions per minute are capped for the whole server. Refused questions never reach the provider.
// A question is awaited while the store is locked for writing, so after the provider fails to
// answer it is not asked again for a while: a provider that is down holds that lock once, not
// question after question.
export function limitRraaCalls(validator: RraaValidator, perMinute: number, now: () => number = Date.now, pauseMs = 30_000): RraaValidator {
  if (!Number.isInteger(perMinute) || perMinute < 1) throw new Error("El límite de consultas a RRAA debe ser un entero positivo.");
  if (!Number.isInteger(pauseMs) || pauseMs < 0) throw new Error("La pausa tras un fallo de RRAA debe ser un entero no negativo.");
  const calls: number[] = [];
  let pausedUntil = 0;
  return { ...validator, async validate(stationCode, deviceId) {
    if (now() < pausedUntil)
      throw new DomainError("RRAA_PAUSED", "RRAA no respondió hace un momento. Espera medio minuto y vuelve a intentar.", 429);
    const cutoff = now() - 60_000;
    while (calls.length && calls[0] <= cutoff) calls.shift();
    if (calls.length >= perMinute)
      throw new DomainError("RRAA_RATE_LIMITED", "Se hicieron demasiadas consultas a RRAA en un minuto. Espera un momento y vuelve a intentar.", 429);
    const stamp = now();
    calls.push(stamp);
    try { return await validator.validate(stationCode, deviceId); }
    catch (error) {
      // Input that the validator refuses by itself never reached the provider: it does not count.
      if (error instanceof DomainError && error.code === "RRAA_INPUT_INVALID") { const index = calls.lastIndexOf(stamp); if (index >= 0) calls.splice(index, 1); }
      if (error instanceof DomainError && error.code === "RRAA_UNAVAILABLE") pausedUntil = now() + pauseMs;
      throw error;
    }
  } };
}
// Demo only: a practice "company control" so the station flow can be tried before the provider is
// connected. It answers like VALSTAT for the fictional company of the demo and contacts no service:
// only the stations registered in that fictional control are found; any other data is rejected.
export const DEMO_STATION_CLIENT = "EMPRESA-DEMO";
const twoDigits = (value: number) => String(value).padStart(2, "0");
function demoLicense(stationCode: string, deviceId: string): string | undefined {
  const practice = /^EST-PRUEBA-(0[1-9]|[1-9]\d)$/.exec(stationCode);
  if (practice) return deviceId === `DISP-PRUEBA-${practice[1]}` ? `LIC-DEMO-${practice[1]}` : undefined;
  // The example stations that come with the demo catalogue are registered too.
  const seeded = /^DEMO V2 · Estación ([1-6])$/.exec(stationCode);
  if (seeded) return deviceId === `DEMO-V2-DISPOSITIVO-${twoDigits(Number(seeded[1]))}` ? `LIC-DEMO-V2-${twoDigits(Number(seeded[1]))}` : undefined;
  return undefined;
}
export function createDemoStationControl(): RraaValidator {
  return { clientId: DEMO_STATION_CLIENT, simulated: true,
    // Every practice pair the control knows; the status route offers the first ones that are still free.
    examples: Array.from({ length: 99 }, (_, index) => index + 1).map((number) => ({ stationCode: `EST-PRUEBA-${twoDigits(number)}`, deviceId: `DISP-PRUEBA-${twoDigits(number)}` })),
    async validate(stationCode, deviceId) {
      if (!validParameter(stationCode) || !validParameter(deviceId))
        throw new DomainError("RRAA_INPUT_INVALID", "Indica el código de Estación y el ID dispositivo, sin separadores | ni controles.", 422);
      const license = demoLicense(stationCode.trim(), deviceId.trim());
      if (!license) throw new DomainError("RRAA_STATION_NOT_FOUND", "Control de prueba: Estación no encontrada.", 422);
      return { clientId: DEMO_STATION_CLIENT, stationCode: stationCode.trim(), deviceId: deviceId.trim(), license, validatedAt: new Date().toISOString() };
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
