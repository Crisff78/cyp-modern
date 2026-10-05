export type IntentScope = {
  actorId: string;
  kind: "collection" | "payout";
  entityId: string;
};
export type PaymentIntent = IntentScope & {
  version: 1;
  key: string;
  amount: number;
  status: "pending" | "confirmed";
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type IntentLock = <T>(name: string, action: () => Promise<T>) => Promise<T>;
export const intentStorageKey = (scope: IntentScope) =>
  `cyp-attempt-v1:${JSON.stringify([scope.actorId, scope.kind, scope.entityId])}`;

export function confirmedPaymentReceipt(result: unknown, intent: PaymentIntent, mock = false): boolean {
  if (!result || typeof result !== "object") return false;
  const response = result as { receipt?: { token?: unknown }; movement?: {
    id?: unknown; actorId?: unknown; amount?: unknown; type?: unknown; chargeId?: unknown; payoutId?: unknown;
  } };
  if (typeof response.receipt?.token !== "string" || !response.receipt.token) return false;
  if (mock) return true;
  const movement = response.movement;
  return !!movement && typeof movement.id === "string" && movement.id.length > 0 &&
    movement.actorId === intent.actorId && movement.amount === intent.amount && movement.type === intent.kind &&
    (intent.kind === "collection" ? movement.chargeId : movement.payoutId) === intent.entityId;
}

const storageError = () => new Error(
  "No se pudo conservar la referencia de esta operación en el navegador. Comprueba el almacenamiento y consulta el recibo original antes de registrar otro movimiento.",
);
export class PaymentIntents {
  private storage: StoragePort;
  private lock: IntentLock;
  private createKey: () => string;
  constructor(
    storage: StoragePort,
    lock: IntentLock,
    createKey: () => string,
  ) { this.storage = storage; this.lock = lock; this.createKey = createKey; }

  read(scope: IntentScope): PaymentIntent | null {
    let raw: string | null;
    try { raw = this.storage.getItem(intentStorageKey(scope)); }
    catch { throw storageError(); }
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as PaymentIntent;
      if (value.version !== 1 || value.actorId !== scope.actorId ||
          value.kind !== scope.kind || value.entityId !== scope.entityId ||
          typeof value.key !== "string" || value.key.length < 8 || value.key.length > 100 ||
          !Number.isSafeInteger(value.amount) || value.amount <= 0 ||
          !["pending", "confirmed"].includes(value.status)) throw Error();
      return value;
    } catch {
      throw new Error("La referencia guardada no es válida. No confirmes otra operación; revisa el recibo original con la oficina.");
    }
  }

  private write(scope: IntentScope, intent: PaymentIntent) {
    try {
      this.storage.setItem(intentStorageKey(scope), JSON.stringify(intent));
      // Fail closed when the browser silently discards a write.
      if (this.storage.getItem(intentStorageKey(scope)) !== JSON.stringify(intent)) throw Error();
    } catch { throw storageError(); }
  }
  private remove(scope: IntentScope) {
    try { this.storage.removeItem(intentStorageKey(scope)); }
    catch { throw storageError(); }
  }

  async confirm<T>(
    scope: IntentScope,
    amount: number,
    send: (intent: PaymentIntent) => Promise<T>,
    isConfirmed: (result: T, intent: PaymentIntent) => boolean,
    isDefinitiveInitialFailure: (error: unknown) => boolean,
    beginAnother = false,
    replaceConfirmedKey?: string,
    knownIntent?: PaymentIntent | null,
  ): Promise<T> {
    return this.lock(intentStorageKey(scope), async () => {
      const previous = this.read(scope);
      if (beginAnother && previous?.status !== "confirmed")
        throw new Error("Primero resuelve la referencia pendiente y consulta su recibo.");
      const replacing = replaceConfirmedKey !== undefined;
      if (replacing && (previous?.status !== "confirmed" || previous.key !== replaceConfirmedKey))
        throw new Error("La referencia cambió en otra pestaña. Consulta el intento actual antes de registrar dinero nuevo.");
      if ((!previous || replacing) && (!Number.isSafeInteger(amount) || amount <= 0))
        throw new Error("Introduce un importe válido en centavos.");
      if (knownIntent && (knownIntent.actorId !== scope.actorId || knownIntent.kind !== scope.kind || knownIntent.entityId !== scope.entityId))
        throw new Error("La referencia pertenece a otra cuenta u operación.");
      const active: PaymentIntent = (!replacing && (previous ?? knownIntent)) || {
        ...scope, version: 1, key: this.createKey(), amount, status: "pending",
      };
      // Persist before dispatch, including before any synchronous transport exception.
      if (!previous || replacing) this.write(scope, active);
      let result: T;
      try {
        result = await send(active);
        if (!isConfirmed(result, active))
          throw new Error("No se pudo verificar el recibo. Conservamos la referencia; consulta el mismo intento antes de registrar otro.");
      } catch (error) {
        // A 4xx on a retry says nothing about an earlier committed/lost response.
        if (((!previous && !knownIntent) || replacing) && isDefinitiveInitialFailure(error)) {
          // Keep the preceding confirmed generation visible to other tabs.
          if (replacing && previous) this.write(scope, previous);
          else this.remove(scope);
        }
        throw error;
      }
      this.write(scope, { ...active, status: "confirmed" });
      return result;
    });
  }
}

export function browserPaymentIntents(): PaymentIntents {
  const lock: IntentLock = async (name, action) => {
    if (!navigator.locks)
      throw new Error("Este navegador no puede proteger operaciones entre pestañas. Usa Edge actualizado mediante HTTPS o localhost; no se enviaron datos.");
    return await navigator.locks.request(name, { mode: "exclusive" }, action);
  };
  // Access may itself throw (for example when browser storage is disabled).
  try { return new PaymentIntents(localStorage, lock, () => crypto.randomUUID()); }
  catch { throw storageError(); }
}
