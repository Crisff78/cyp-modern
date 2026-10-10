// Pure browser/server protocol. Never put Node APIs or private key material here.
export const INSTALLATION_PROTOCOL_VERSION = "CYP-INSTALLATION-V1" as const;
export type InstallationPurpose = "register" | "query";
export type StationInstallation = {
  scopeId: string; stationId: string; installationId: string; publicKeySpki: string;
  algorithm: "ECDSA-P256-SHA256"; status: "active" | "revoked"; revision: string;
  registeredAt: string; registeredBy: string;
  revokedAt?: string; revokedBy?: string; revocationReason?: string;
};
export type StationInstallationSummary = Pick<StationInstallation,
  "stationId" | "installationId" | "status" | "revision" | "registeredAt" | "registeredBy" |
  "revokedAt" | "revokedBy" | "revocationReason">;
export type StationInstallationChallenge = {
  version: typeof INSTALLATION_PROTOCOL_VERSION; purpose: InstallationPurpose;
  challengeId: string; nonce: string; scopeId: string; stationId: string;
  installationId: string; actorId: string; sessionId: string; origin: string;
  expiresAt: string; createdAt: string; publicKeySpki?: string;
};
export type StationInstallationData = {
  stationId: string; stationCode: string; installationId: string;
  installationStatus: StationInstallation["status"]; active: boolean;
  rraaValidationStatus: "validated" | "not_validated"; rraaValidatedAt?: string;
  queriedAt: string; cypBuildVersion?: string;
};
export function signingPayload(challenge: StationInstallationChallenge): string {
  return JSON.stringify([challenge.version, challenge.purpose, challenge.challengeId, challenge.nonce,
    challenge.scopeId, challenge.stationId, challenge.installationId, challenge.actorId,
    challenge.sessionId, challenge.origin, challenge.expiresAt]);
}
