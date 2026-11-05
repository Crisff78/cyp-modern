import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, randomBytes, constants, type KeyObject } from "node:crypto";
import { z } from "zod";
import { DomainError } from "./domain.js";
import { validArchiveExpiry, validArchivePan, type CardEnvelope, type CardStorageInfo } from "../../shared/remittances/cardArchive.mjs";
export const cardEnvelopeSchema = z.object({ version: z.literal(1), keyId: z.string().regex(/^[a-f0-9]{64}$/), ciphertext: z.string().min(344).max(1024).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
export type ArchivedCard = { transferId: string; actorId: string; keyId: string; createdAt: string; expiresAt: string; version: 1; wrappedKey: string; iv: string; tag: string; ciphertext: string };
const invalid = () => new DomainError("INVALID_CARD_ARCHIVE", "No se pudo validar la tarjeta protegida. Revisa sus datos.", 400);
const aad = (id: string, actor: string, created: string, expires: string, keyId: string) => Buffer.from(JSON.stringify(["cyp-card-v1", id, actor, created, expires, keyId]));
export class CardVault {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  readonly keyId: string;
  constructor(privatePem: string, readonly retentionDays: number) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error("Configura una conservación de tarjeta aprobada entre 1 y 365 días.");
    try {
      this.privateKey = createPrivateKey(privatePem); this.publicKey = createPublicKey(this.privateKey);
      if (this.privateKey.asymmetricKeyType !== "rsa" || (this.privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) throw Error();
    } catch { throw new Error("La clave privada del archivo de tarjetas no es válida (RSA de al menos 3072 bits)."); }
    this.keyId = createHash("sha256").update(this.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  }
  info(): CardStorageInfo { return { enabled: true, keyId: this.keyId, publicKey: this.publicKey.export({ format: "jwk" }) as JsonWebKey, retentionDays: this.retentionDays }; }
  archive(envelope: CardEnvelope, transferId: string, actorId: string, last4: string, now = new Date()): ArchivedCard {
    if (!cardEnvelopeSchema.safeParse(envelope).success || envelope.keyId !== this.keyId) throw invalid();
    let raw: Buffer | undefined; const dataKey = randomBytes(32);
    try {
      raw = privateDecrypt({ key: this.privateKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.ciphertext, "base64"));
      const parsed: unknown = JSON.parse(raw.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "expiry,pan") throw invalid();
      const value = parsed as { pan: unknown; expiry: unknown };
      if (!validArchivePan(value.pan) || !validArchiveExpiry(value.expiry) || value.pan.slice(-4) !== last4) throw invalid();
      const createdAt = now.toISOString(), expiresAt = new Date(now.getTime() + this.retentionDays * 86400000).toISOString();
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", dataKey, iv); cipher.setAAD(aad(transferId, actorId, createdAt, expiresAt, this.keyId));
      const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
      return { transferId, actorId, keyId: this.keyId, version: 1, createdAt, expiresAt,
        iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"),
        wrappedKey: publicEncrypt({ key: this.publicKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, dataKey).toString("base64") };
    } catch { throw invalid(); } finally { raw?.fill(0); dataKey.fill(0); }
  }
  /** Maintenance-only primitive. No API endpoint exposes this operation. */
  open(record: ArchivedCard, transferId: string, actorId: string, now = new Date()): { pan: string; expiry: string } {
    if (record.keyId !== this.keyId || record.transferId !== transferId || record.actorId !== actorId || Date.parse(record.expiresAt) <= now.getTime()) throw invalid();
    let key: Buffer | undefined, raw: Buffer | undefined;
    try {
      key = privateDecrypt({ key: this.privateKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(record.wrappedKey, "base64"));
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64")); decipher.setAAD(aad(transferId, actorId, record.createdAt, record.expiresAt, record.keyId)); decipher.setAuthTag(Buffer.from(record.tag, "base64"));
      raw = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]); return JSON.parse(raw.toString("utf8"));
    } catch { throw invalid(); } finally { key?.fill(0); raw?.fill(0); }
  }
}
export function configuredCardVault(env: NodeJS.ProcessEnv): CardVault | undefined {
  if (env.CARD_VAULT_ENABLED !== "true") return undefined;
  if (!env.CARD_VAULT_PRIVATE_KEY_B64 || !/^[0-9]{1,3}$/.test(env.CARD_VAULT_RETENTION_DAYS ?? "")) throw new Error("Falta configurar la clave privada y el plazo aprobado del archivo de tarjetas.");
  return new CardVault(Buffer.from(env.CARD_VAULT_PRIVATE_KEY_B64, "base64").toString("utf8"), Number(env.CARD_VAULT_RETENTION_DAYS));
}
