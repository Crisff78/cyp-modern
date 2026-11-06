export function validArchivePan(value) {
  if (typeof value !== "string" || !/^[0-9]{16}$/.test(value)) return false;
  let sum = 0;
  for (let i = 15; i >= 0; i--) { let n = Number(value[i]); if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0;
}
export const validArchiveExpiry = (value) => typeof value === "string" && /^(0[1-9]|1[0-2])\/[0-9]{2}$/.test(value);
/** New entries encrypt only the PAN. Optional expiry preserves older callers; CVV is never accepted. */
export async function encryptCardArchive(number, expiry, info) {
  if (typeof isSecureContext === "boolean" && !isSecureContext) throw new Error("El archivo cifrado de tarjeta requiere HTTPS.");
  if (!info.enabled) throw new Error("El guardado cifrado de tarjetas no está configurado.");
  const pan = number.replace(/ /g, "");
  if (!validArchivePan(pan)) throw new Error("Revisa los 16 dígitos de la tarjeta.");
  if (expiry !== undefined && !validArchiveExpiry(expiry)) throw new Error("Revisa el vencimiento MM/YY.");
  const key = await crypto.subtle.importKey("jwk", info.publicKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const plain = new TextEncoder().encode(JSON.stringify({ pan, ...(expiry === undefined ? {} : { expiry }) }));
  try {
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, plain));
    return { version: 1, keyId: info.keyId, ciphertext: btoa(String.fromCharCode(...encrypted)) };
  } finally { plain.fill(0); }
}
