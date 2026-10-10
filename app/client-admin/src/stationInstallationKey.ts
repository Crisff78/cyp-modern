const DATABASE_NAME = "cyp-station-installation-v1";
const STORE_NAME = "keys";
const pendingCreations = new Map<string, Promise<StationInstallationKey>>();

export type StationInstallationKey = {
  scope: string;
  origin: string;
  stationId: string;
  installationId: string;
  publicKeySpki: string;
  privateKey: CryptoKey;
};

function requireStorage() {
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle || !globalThis.indexedDB) {
    throw new Error("La identidad de instalación requiere HTTPS o localhost, Web Crypto e IndexedDB disponibles.");
  }
}

function keyScope(stationId: string) {
  if (!stationId || stationId.length > 200) throw new Error("Selecciona una estación válida.");
  return JSON.stringify([window.location.origin, stationId]);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function publicBytes(value: string) {
  if (!/^[A-Za-z0-9_-]{122}$/.test(value)) throw new Error("La clave pública local no es válida.");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== 91 || base64Url(bytes) !== value) throw new Error("La clave pública local no tiene codificación canónica.");
  return bytes;
}

async function installationId(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return "CYP-INST-" + Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateStored(value: unknown, stationId: string): Promise<StationInstallationKey | null> {
  if (value === undefined) return null;
  const record = value as Partial<StationInstallationKey> | null;
  const key = record?.privateKey;
  const algorithm = key?.algorithm as EcKeyAlgorithm | undefined;
  if (!record || record.scope !== keyScope(stationId) || record.origin !== window.location.origin ||
      record.stationId !== stationId || typeof record.publicKeySpki !== "string" ||
      key?.type !== "private" || key.extractable !== false || algorithm?.name !== "ECDSA" ||
      algorithm.namedCurve !== "P-256" || !Array.isArray(key.usages) || key.usages.length !== 1 || key.usages[0] !== "sign" ||
      record.installationId !== await installationId(publicBytes(record.publicKeySpki))) {
    throw new Error("La identidad guardada no es válida. No se reemplazó ni se registró otra instalación.");
  }
  const bytes = publicBytes(record.publicKeySpki!);
  const publicKey = await crypto.subtle.importKey("spki", bytes as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  if (base64Url(new Uint8Array(await crypto.subtle.exportKey("spki", publicKey))) !== record.publicKeySpki) throw new Error("La clave pública guardada no es canónica.");
  const probe = new TextEncoder().encode("CYP-INSTALLATION-LOCAL-KEY-CHECK-V1");
  const proof = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key!, probe);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, proof, probe)) throw new Error("La clave privada guardada no corresponde a la identidad pública. No se reemplazó la identidad.");
  return record as StationInstallationKey;
}

function openDatabase(): Promise<IDBDatabase> {
  requireStorage();
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "scope" });
    };
    request.onerror = () => { settled = true; reject(new Error("No se pudo abrir el almacenamiento de la identidad de este navegador.")); };
    request.onblocked = () => { settled = true; reject(new Error("El almacenamiento está ocupado por otra pestaña. Cierra esa pestaña y vuelve a intentarlo.")); };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (settled) database.close();
      else { settled = true; resolve(database); }
    };
  });
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
