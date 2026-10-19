import { useSyncExternalStore } from "react";
import { operationKey, StrictApiError } from "../../shared/remittances/strictApi";
import { api, ApiError } from "./api";
import { remittancesApi } from "./remittancesApi";

type Attempt = { key: string; path: string; method: "POST" | "PUT"; transport: "strict" | "api"; body: string; draft: unknown };
// `denied`: a retry of an unconfirmed operation was refused because the account lost the permission.
// The attempt (key and data) stays in memory, but its window and dialog can be closed.
type RequestState = { attempt?: Attempt; busy: boolean; uncertain: boolean; denied?: boolean; error: string };
const idle: RequestState = { busy: false, uncertain: false, error: "" };
const permissionCodes = new Set(["PERMISSION_REQUIRED", "ACCESS_REVOKED", "FORBIDDEN"]);
// These business errors are emitted after the server has checked the saved key.
const definitiveCodes = new Set([
  "NOT_FOUND", "CLIENT_ROUTE_INACTIVE", "ROUTE_MISMATCH", "INVALID_COLLECTION_LINES",
  "INVALID_AMOUNT", "CHARGE_CLIENT_MISMATCH", "UNSUPPORTED_COLLECTION_CURRENCY",
  "CLIENT_INACTIVE", "INVALID_PAYMENT_LINES", "PAYOUT_CLIENT_MISMATCH", "PAYOUT_COLLECTOR_MISMATCH",
  "COLLECTOR_INACTIVE", "DAY_CLOSED", "PREVIOUS_DAY_OPEN", "COLLECTION_LIMIT",
  "MOVEMENT_NOT_FOUND", "CANCELLATION_REASON_REQUIRED", "CANCELLATION_DAY_MISMATCH",
  "INSUFFICIENT_COLLECTION_CASH", "INSUFFICIENT_PAYOUT_CASH", "PAYOUT_LIMIT",
  "MOVEMENT_BALANCE_MISMATCH",
  "CASH_RECEIPT_CONFIRMATION_REQUIRED", "RECONCILIATION_NOTE_REQUIRED", "CASH_RECONCILIATION_CHANGED",
  "NO_PREVIOUS_CASH", "CASH_RECONCILIATION_REVIEW_REQUIRED", "CASH_RECONCILIATION_AMOUNT_MISMATCH",
  "FUTURE_DATE", "INVALID_DATE", "UNBALANCED",
  "RATE_DATE", "DOP_RATE", "INVALID_RATE", "INVALID_CURRENCY",
  "PERMISSIONS_CHANGED",
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
  return [...states.entries()].some(([id, state]) => id.startsWith(`${actorId}\n`) && (state.busy || state.uncertain && !state.denied));
}

export function useMovementRequest(actorId: string, scope: string) {
  const id = requestId(actorId, scope);
  const state = useSyncExternalStore(subscribe, () => states.get(id) ?? idle);

  const run = async <T,>(path: string, body: unknown, draft: unknown, valid: (result: T) => boolean, method: "POST" | "PUT" = "POST", transport: "strict" | "api" = "strict"): Promise<T> => {
    const previous = states.get(id) ?? idle;
    if (previous.busy) throw new Error("La operación ya se está enviando.");
    const attempt = previous.attempt ?? { key: operationKey(), path, method, transport, body: JSON.stringify(body), draft };
    publish(id, { ...previous, attempt, busy: true, error: "" });
    try {
      const request = attempt.transport === "api" ? api : remittancesApi;
      const result = await request<T>(attempt.path, {
        method: attempt.method, headers: { "Idempotency-Key": attempt.key }, body: attempt.body,
      });
      if (!valid(result)) throw new StrictApiError("No se pudo confirmar la respuesta. Reintenta esta misma operación para recuperar su resultado.", 200, true);
      publish(id, idle);
      return result;
    } catch (error) {
      const failure = error instanceof StrictApiError ? error : error instanceof ApiError
        ? new StrictApiError(error.message, error.status, error.uncertain, error.code)
        : new StrictApiError(error instanceof Error ? error.message : "No se pudo completar la operación.", 0, true);
      // Auth/prevalidation failures cannot resolve an earlier lost response.
      const definitive = Boolean(failure.code && definitiveCodes.has(failure.code));
      const uncertain = failure.uncertain || (previous.uncertain && !definitive);
      // Without the permission no retry can confirm the earlier attempt: keep it, but let the user leave.
      const denied = uncertain && !failure.uncertain && failure.status === 403 && Boolean(failure.code && permissionCodes.has(failure.code));
      publish(id, { attempt: uncertain ? attempt : undefined, busy: false, uncertain, denied, error: denied
        ? `${failure.message} No se pudo confirmar si la operación anterior quedó registrada: pide a Administración que lo revise. Puedes cerrar esta ventana; el intento se conserva para reintentarlo si recuperas el permiso.`
        : failure.message });
      throw failure;
    }
  };
  const clear = () => {
    const current = states.get(id) ?? idle;
    if (!current.busy && !current.uncertain) publish(id, idle);
  };
  // `locked` keeps the data frozen while the result is unknown; `closable` says whether the dialog may close.
  return { ...state, run, clear, locked: state.busy || state.uncertain, closable: !state.busy && (!state.uncertain || Boolean(state.denied)) };
}
