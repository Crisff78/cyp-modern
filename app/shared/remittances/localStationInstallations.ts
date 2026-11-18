const DATABASE_NAME = "cyp-station-installation-v1";
export const STORE_NAME = "keys";

type PublicInstallation = {
  scope: string;
  origin: string;
  stationId: string;
  installationId: string;
  publicKeySpki: string;
};

export function requireStorage() {
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle || !globalThis.indexedDB) {
    throw new Error("La identidad de instalación requiere HTTPS o localhost, Web Crypto e IndexedDB disponibles.");
  }
}

export function isStationSigningKey(value: unknown): value is CryptoKey {
  if (!(value instanceof CryptoKey)) return false;
  const algorithm = value.algorithm as EcKeyAlgorithm;
  return value.type === "private" && value.extractable === false && algorithm.name === "ECDSA" &&
    algorithm.namedCurve === "P-256" && value.usages.length === 1 && value.usages[0] === "sign";
}

export function keyScope(stationId: string) {
  if (!stationId || stationId.length > 200) throw new Error("Selecciona una estación válida.");
  return JSON.stringify([window.location.origin, stationId]);
}

export function base64Url(bytes: Uint8Array) {
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

export async function installationId(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return "CYP-INST-" + Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyPublicIdentity(record: Partial<PublicInstallation>, stationId: string): Promise<CryptoKey> {
  if (record.scope !== keyScope(stationId) || record.origin !== window.location.origin ||
      record.stationId !== stationId || typeof record.publicKeySpki !== "string") {
    throw new Error("La identidad guardada no es válida. No se reemplazó ni se registró otra instalación.");
  }
  const bytes = publicBytes(record.publicKeySpki);
  if (record.installationId !== await installationId(bytes)) throw new Error("El identificador de instalación no corresponde a la clave pública.");
  const publicKey = await crypto.subtle.importKey("spki", bytes as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  if (base64Url(new Uint8Array(await crypto.subtle.exportKey("spki", publicKey))) !== record.publicKeySpki) throw new Error("La clave pública guardada no es canónica.");
  return publicKey;
}

export function openDatabase(): Promise<IDBDatabase> {
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

export async function listLocalStationInstallations(): Promise<{ stationId: string; installationId: string }[]> {
  const database = await openDatabase();
  try {
    const records = await new Promise<Partial<PublicInstallation>[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const cursor = transaction.objectStore(STORE_NAME).openCursor();
      const publicRecords: Partial<PublicInstallation>[] = [];
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (!isStationSigningKey(item.value?.privateKey)) {
          reject(new Error("La identidad guardada no es válida."));
          transaction.abort();
          return;
        }
        const { scope, origin, stationId, installationId, publicKeySpki } = item.value;
        publicRecords.push({ scope, origin, stationId, installationId, publicKeySpki });
        item.continue();
      };
      transaction.oncomplete = () => resolve(publicRecords);
      transaction.onabort = () => reject(new Error("No se pudieron leer las instalaciones de este navegador."));
    });
    return await Promise.all(records.map(async (record) => {
      const { stationId, installationId } = record;
      if (typeof stationId !== "string" || typeof installationId !== "string") throw new Error("La identidad guardada no es válida.");
      await verifyPublicIdentity(record, stationId);
      return { stationId, installationId };
    }));
  } finally { database.close(); }
}
