import type { Store } from "./store.js";
import type { State } from "./domain.js";

// HTTP business handlers append audit events; they never edit the past audit.
// History is read only by its paginated query. The full Store API stays available
// to migrations, maintenance, backups and integration tests without changing it.
export function requestStore(store: Store): Store {
  return {
    read: () => store.readRequest ? store.readRequest() : store.read(),
    transaction: <T>(fn: (state: State) => T | Promise<T>) => store.transactionRequest ? store.transactionRequest(fn) : store.transaction(fn),
    close: () => store.close(),
    ...(store.readAccess ? {readAccess: store.readAccess.bind(store)} : {}),
    ...(store.readAdminPage ? {readAdminPage: store.readAdminPage.bind(store)} : {}),
    ...(store.readIdempotency ? {readIdempotency: store.readIdempotency.bind(store)} : {}),
  };
}
