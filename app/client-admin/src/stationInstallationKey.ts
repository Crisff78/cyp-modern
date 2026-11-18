import { base64Url, installationId, isStationSigningKey, keyScope, openDatabase, requireStorage, STORE_NAME, verifyPublicIdentity } from "../../shared/remittances/localStationInstallations";

const pendingCreations = new Map<string, Promise<StationInstallationKey>>();

export type StationInstallationKey = {
  scope: string;
  origin: string;
  stationId: string;
  installationId: string;
  publicKeySpki: string;
  privateKey: CryptoKey;
};

async function validateStored(value: unknown, stationId: string): Promise<StationInstallationKey | null> {
  if (value === undefined) return null;
  const record = value as Partial<StationInstallationKey> | null;
  const key = record?.privateKey;
  if (!record || !isStationSigningKey(key)) {
    throw new Error("La identidad guardada no es válida. No se reemplazó ni se registró otra instalación.");
  }
  const publicKey = await verifyPublicIdentity(record, stationId);
  const probe = new TextEncoder().encode("CYP-INSTALLATION-LOCAL-KEY-CHECK-V1");
  const proof = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, probe);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, proof, probe)) throw new Error("La clave privada guardada no corresponde a la identidad pública. No se reemplazó la identidad.");
  return record as StationInstallationKey;
}

/** Reads a persisted CryptoKey. Reading a screen never generates a key. */
export async function readStationInstallationKey(stationId: string): Promise<StationInstallationKey | null> {
  const scope = keyScope(stationId);
  const database = await openDatabase();
  try {
    const record = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(scope);
      let value: unknown;
      request.onsuccess = () => { value = request.result; };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(new Error("No se pudo leer la identidad guardada."));
      transaction.onerror = () => { /* onabort supplies the settled outcome. */ };
    });
    return await validateStored(record, stationId);
  } finally { database.close(); }
}

/** Call only after an explicit register action; no private key export or localStorage. */
export function getOrCreateStationInstallationKey(stationId: string): Promise<StationInstallationKey> {
  const scope = keyScope(stationId);
  const previous = pendingCreations.get(scope);
  if (previous) return previous;
  const create = async () => {
    const existing = await readStationInstallationKey(stationId);
    if (existing) return existing;
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const bytes = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    const candidate: StationInstallationKey = {
      scope, origin: window.location.origin, stationId, privateKey: pair.privateKey,
      publicKeySpki: base64Url(bytes), installationId: await installationId(bytes),
    };
    const database = await openDatabase();
    try {
      // Read/write transactions are serialized across tabs. add() never replaces
      // a winner; completion, not request success, confirms durable storage.
      const winner = await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        let record: unknown;
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(scope);
        request.onsuccess = () => {
          if (request.result !== undefined) { record = request.result; return; }
          record = candidate;
          try { store.add(candidate); }
          catch { transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(record);
        transaction.onabort = () => reject(new Error("No se pudo conservar la clave de instalación en IndexedDB. No se envió ningún registro; no se sustituyó por una clave exportable."));
        transaction.onerror = () => { /* Never retry a failed CryptoKey clone. */ };
      });
      const stored = await validateStored(winner, stationId);
      if (!stored) throw new Error("No se confirmó la identidad guardada.");
      return stored;
    } finally { database.close(); }
  };
  const result = create();
  pendingCreations.set(scope, result);
  void result.finally(() => { if (pendingCreations.get(scope) === result) pendingCreations.delete(scope); }).catch(() => undefined);
  return result;
}

export async function signStationInstallationPayload(key: StationInstallationKey, payload: string): Promise<string> {
  requireStorage();
  if (key.origin !== window.location.origin || key.privateKey.extractable || key.privateKey.type !== "private") throw new Error("La identidad local no pertenece a este navegador.");
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(payload));
  if (signature.byteLength !== 64) throw new Error("El navegador no produjo una firma P-256 válida.");
  return base64Url(new Uint8Array(signature));
}
