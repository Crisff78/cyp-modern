import { useSyncExternalStore } from "react";
import { api, ApiError } from "./api";
import { operationKey } from "../../shared/remittances/strictApi";

export type ChargeImportResult = { creados: number; errores: { fila: number; mensaje: string }[] };
type ImportBody = { filas: Record<string, unknown>[] };
type Attempt = { key: string; body: string; fileName: string };
type RequestState = { attempt?: Attempt; busy: boolean; uncertain: boolean; error: string };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Transport = <T>(path: string, options: RequestInit) => Promise<T>;
const idle: RequestState = { busy: false, uncertain: false, error: "" };

// An import is additive. Keep its identity until an authoritative response resolves it,
// including closing the dialog, renewing the token and reloading this browser profile.
export function createChargeImportController(actorId: string, storage: StorageLike, transport: Transport = api) {
  const storageKey = `cyp-pending-charge-import-v1:${actorId}`;
  const listeners = new Set<() => void>();
  let state: RequestState = idle;
  let flight: Promise<ChargeImportResult> | undefined;
  const readAttempt = (raw: string): Attempt => {
    const saved = JSON.parse(raw) as Attempt;
    if (typeof saved.key !== "string" || saved.key.length < 8 || saved.key.length > 100 || typeof saved.fileName !== "string" || typeof saved.body !== "string" || !Array.isArray(JSON.parse(saved.body).filas))
      throw new Error("No se pudo recuperar la importación pendiente. Conserva el archivo y comprueba el listado antes de continuar.");
    return saved;
  };
  try {
    const raw = storage.getItem(storageKey);
    if (raw) {
      const saved = readAttempt(raw);
      state = { attempt: saved, busy: false, uncertain: true, error: "Hay una importación pendiente de confirmar. Reintenta el mismo envío antes de elegir otro archivo." };
    }
  } catch (error) {
    state = { busy: false, uncertain: true, error: error instanceof Error ? error.message : "No se pudo recuperar la importación pendiente." };
  }
  const publish = (next: RequestState) => { state = next; listeners.forEach((listener) => listener()); };
  const run = (body?: ImportBody, fileName?: string): Promise<ChargeImportResult> => {
    if (flight) return flight;
    if (state.uncertain && !state.attempt) return Promise.reject(new Error(state.error));
    if (state.attempt && body && JSON.stringify(body) !== state.attempt.body)
      return Promise.reject(new Error("Reintenta la importación pendiente antes de enviar datos nuevos."));
    try {
        const raw = storage.getItem(storageKey);
        if (raw) {
          const attempt = readAttempt(raw);
          if (!state.attempt || attempt.key !== state.attempt.key || attempt.body !== state.attempt.body) {
            const error = "Hay una importación pendiente en este navegador. Reintenta ese envío antes de elegir otro archivo.";
            publish({ attempt, busy: false, uncertain: true, error });
            return Promise.reject(new Error(error));
          }
        }
      } catch (error) {
        publish({ busy: false, uncertain: true, error: "No se pudo comprobar la importación pendiente. No se envió el archivo." });
        return Promise.reject(error);
      }
    const previous = state;
    const attempt = state.attempt ?? { key: operationKey(), body: JSON.stringify(body), fileName: fileName ?? "archivo.csv" };
    if (!attempt.body || !Array.isArray(JSON.parse(attempt.body).filas)) return Promise.reject(new Error("Seleccione un archivo válido."));
    try { storage.setItem(storageKey, JSON.stringify(attempt)); }
    catch { const error = "No se pudo conservar el intento de importación en este navegador. No se envió el archivo."; publish({ ...previous, error }); return Promise.reject(new Error(error)); }
    publish({ attempt, busy: true, uncertain: previous.uncertain, error: "" });
    flight = Promise.resolve().then(async () => {
      try {
        const result = await transport<ChargeImportResult>("/cargos/importar", { method: "POST", headers: { "Idempotency-Key": attempt.key }, body: attempt.body });
        const rowCount = (JSON.parse(attempt.body) as ImportBody).filas.length;
        if (!Number.isSafeInteger(result?.creados) || result.creados < 0 || !Array.isArray(result.errores) || result.creados + result.errores.length !== rowCount || new Set(result.errores.map((error) => error.fila)).size !== result.errores.length || result.errores.some((error) => !Number.isInteger(error.fila) || error.fila < 1 || error.fila > rowCount || typeof error.mensaje !== "string" || !error.mensaje.trim()))
          throw new ApiError("No se pudo confirmar la respuesta de importación. Reintenta este mismo envío para recuperar su resultado.", 200, true);
        try {
          const saved = storage.getItem(storageKey);
          if (saved && readAttempt(saved).key === attempt.key) storage.removeItem(storageKey);
        } catch { throw new ApiError("El servidor confirmó la importación, pero no se pudo limpiar el intento local. Reintenta para recuperar el mismo resultado sin duplicarlo.", 200, true); }
        publish(idle);
        return result;
      } catch (error) {
        let uncertain = previous.uncertain || !(error instanceof ApiError) || Boolean(error.uncertain) || error.status >= 500;
        if (!uncertain) {
          try {
            const saved = storage.getItem(storageKey);
            if (saved && readAttempt(saved).key === attempt.key) storage.removeItem(storageKey);
          } catch { uncertain = true; }
        }
        publish({ attempt: uncertain ? attempt : undefined, busy: false, uncertain, error: error instanceof Error ? error.message : "No se pudo importar el archivo." });
        throw error;
      }
    }).finally(() => { flight = undefined; });
    return flight;
  };
  return { getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, run };
}

const controllers = new Map<string, ReturnType<typeof createChargeImportController>>();
export function useChargeImportRequest(actorId: string) {
  let controller = controllers.get(actorId);
  if (!controller) { controller = createChargeImportController(actorId, localStorage); controllers.set(actorId, controller); }
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { ...state, run: controller.run, locked: state.busy || state.uncertain };
}
