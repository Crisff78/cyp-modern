export type CardStorageInfo = { enabled: false } | { enabled: true; keyId: string; publicKey: JsonWebKey; retentionDays: number };
export type CardEnvelope = { version: 1; keyId: string; ciphertext: string };
export declare function validArchivePan(value: unknown): value is string;
export declare function validArchiveExpiry(value: unknown): value is string;
export declare function encryptCardArchive(number: string, expiry: string, info: CardStorageInfo): Promise<CardEnvelope>;
