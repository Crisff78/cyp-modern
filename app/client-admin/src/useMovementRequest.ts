import { useSyncExternalStore } from "react";
import { operationKey, StrictApiError } from "../../shared/remittances/strictApi";
import { remittancesApi } from "./remittancesApi";

type Attempt = { key: string; path: string; body: string; draft: unknown };
type RequestState = { attempt?: Attempt; busy: boolean; uncertain: boolean; error: string };
const idle: RequestState = { busy: false, uncertain: false, error: "" };
// These business errors are emitted after the server has checked the saved key.
const definitiveCodes = new Set([
  "NOT_FOUND", "CLIENT_ROUTE_INACTIVE", "ROUTE_MISMATCH", "INVALID_COLLECTION_LINES",
  "INVALID_AMOUNT", "CHARGE_CLIENT_MISMATCH", "UNSUPPORTED_COLLECTION_CURRENCY",
  "COLLECTOR_INACTIVE", "DAY_CLOSED", "PREVIOUS_DAY_OPEN", "COLLECTION_LIMIT",
  "MOVEMENT_NOT_FOUND", "CANCELLATION_REASON_REQUIRED", "CANCELLATION_DAY_MISMATCH",
  "INSUFFICIENT_COLLECTION_CASH", "INSUFFICIENT_PAYOUT_CASH", "PAYOUT_LIMIT",
  "MOVEMENT_BALANCE_MISMATCH",
]);
const states = new Map<string, RequestState>();
const listeners = new Set<() => void>();
let unloadGuardActive = false;
const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
const requestId = (actorId: string, scope: string) => `${actorId}\n${scope}`;
const publish = (id: string, state: RequestState) => {
  states.set(id, state);
  const unresolved = [...states.values()].some((item) => item.busy || item.uncertain);
  if (unresolved !== unloadGuardActive) {
    window[unresolved ? "addEventListener" : "removeEventListener"]("beforeunload", warnBeforeUnload);
    unloadGuardActive = unresolved;
  }
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

// Keys and submitted data survive closing/reopening a window or renewing the JWT.
// They remain in memory only and are isolated by the authenticated actor.
export function pendingMovementDraft<T>(actorId: string, scope: string): T | undefined {
  return states.get(requestId(actorId, scope))?.attempt?.draft as T | undefined;
}
export function hasUnresolvedMovementRequest(actorId: string) {
  return [...states.entries()].some(([id, state]) => id.startsWith(`${actorId}\n`) && (state.busy || state.uncertain));
}

export function useMovementRequest(actorId: string, scope: string) {
  const id = requestId(actorId, scope);
  const state = useSyncExternalStore(subscribe, () => states.get(id) ?? idle);

  const run = async <T,>(path: string, body: unknown, draft: unknown, valid: (result: T) => boolean): Promise<T> => {
    const previous = states.get(id) ?? idle;
    if (previous.busy) throw new Error("La operación ya se está enviando.");
    const attempt = previous.attempt ?? { key: operationKey(), path, body: JSON.stringify(body), draft };
    publish(id, { ...previous, attempt, busy: true, error: "" });
    try {
      const result = await remittancesApi<T>(attempt.path, {
        method: "POST", headers: { "Idempotency-Key": attempt.key }, body: attempt.body,
      });
      if (!valid(result)) throw new StrictApiError("No se pudo confirmar la respuesta. Reintenta esta misma operación para recuperar su resultado.", 200, true);
      publish(id, idle);
      return result;
    } catch (error) {
      const failure = error instanceof StrictApiError ? error : new StrictApiError(error instanceof Error ? error.message : "No se pudo completar la operación.", 0, true);
      // Auth/prevalidation failures cannot resolve an earlier lost response.
      const definitive = Boolean(failure.code && definitiveCodes.has(failure.code));
      const uncertain = failure.uncertain || (previous.uncertain && !definitive);
      publish(id, { attempt: uncertain ? attempt : undefined, busy: false, uncertain, error: failure.message });
      throw failure;
    }
  };
  const clear = () => {
    const current = states.get(id) ?? idle;
    if (!current.busy && !current.uncertain) publish(id, idle);
  };
  return { ...state, run, clear, locked: state.busy || state.uncertain };
}
