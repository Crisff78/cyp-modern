// The idSesion of the plain-text protocol: 32 hexadecimal characters, the size the other party's programs use.
// It is the id of the session record, encrypted. That id is shown in Administración and kept in the audit, so it is not
// a credential by itself: without the key nobody can get an idSesion from it, or make up one that opens a session.
import { createCipheriv, createDecipheriv, hkdfSync } from "node:crypto";

const SHORT_ID = /^[0-9A-F]{32}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isShortSessionId = (text: string) => SHORT_ID.test(text);

/**
 * `secret` is the one of the session tokens; `binding` is part of the key, so a change of the configured access closes
 * these sessions. One AES block without padding: what it encrypts is one random UUID, never repeated, and 16 bytes
 * leave no room for a nonce or a tag. What authenticates an idSesion is that its session record exists and is alive.
 */
export function sessionIdCodec(secret: string, binding: string) {
  const key = Buffer.from(hkdfSync("sha256", secret, binding, "cyp-text-protocol-session-v1", 32));
  const run = (cipher: ReturnType<typeof createCipheriv> | ReturnType<typeof createDecipheriv>, block: Buffer) => {
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(block), cipher.final()]);
  };
  return {
    seal(sid: string) {
      if (!UUID_V4.test(sid)) throw new Error("The id of a session must be a UUID");
      return run(createCipheriv("aes-256-ecb", key, null), Buffer.from(sid.replaceAll("-", ""), "hex")).toString("hex").toUpperCase();
    },
    /** The id of the session record, or undefined. A value that opens proves nothing until that record is found. */
    open(id: string) {
      if (!isShortSessionId(id)) return undefined;
      const hex = run(createDecipheriv("aes-256-ecb", key, null), Buffer.from(id, "hex")).toString("hex");
      const sid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      return UUID_V4.test(sid) ? sid : undefined;
    },
  };
}
