import { StrictApiError, operationKey, type StrictApi } from "./remittances/strictApi";
import { INSTALLATION_PROTOCOL_VERSION, signingPayload, type StationInstallationChallenge, type StationInstallationSummary, type StationInstallationRef } from "../server/src/station-installation-protocol";
import { signStationInstallationPayload, type StationInstallationKey } from "./stationInstallationKey";

export type PendingRequest = {
  kind: "register" | "query" | "revoke";
  stage: "challenge" | "complete";
  path: string;
  body: string;
  key: string;
  identity?: StationInstallationKey;
  installationId: string;
  inFlight?: Promise<unknown>;
  uncertain?: boolean;
};
export const invalidResponse = () => new StrictApiError("La API no devolvió una confirmación válida. Reintenta la misma solicitud y revisa el listado.", 200, true);

export function validSummary(value: unknown, stationId: string, installationId?: string): value is StationInstallationSummary {
  const row = value as Partial<StationInstallationSummary> | null;
  return Boolean(row && row.stationId === stationId && typeof row.installationId === "string" &&
    (!installationId || row.installationId === installationId) && (row.status === "active" || row.status === "revoked") &&
    typeof row.revision === "string" && row.revision.length > 0 && typeof row.registeredBy === "string" &&
    typeof row.registeredAt === "string" && Number.isFinite(Date.parse(row.registeredAt)) &&
    (row.revokedAt === undefined || (typeof row.revokedAt === "string" && Number.isFinite(Date.parse(row.revokedAt)))) &&
    (row.revocationReason === undefined || typeof row.revocationReason === "string"));
}

function validateChallenge(challenge: StationInstallationChallenge, request: PendingRequest, stationId: string, actorId: string) {
  if (!challenge || challenge.version !== INSTALLATION_PROTOCOL_VERSION || challenge.stationId !== stationId ||
      challenge.installationId !== request.installationId || challenge.purpose !== request.kind ||
      challenge.origin !== window.location.origin || challenge.actorId !== actorId ||
      typeof challenge.challengeId !== "string" || !challenge.challengeId ||
      typeof challenge.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge.nonce) ||
      typeof challenge.scopeId !== "string" || !challenge.scopeId ||
      typeof challenge.sessionId !== "string" || !challenge.sessionId ||
      !Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= Date.now() ||
      (request.kind === "register" && challenge.publicKeySpki !== request.identity?.publicKeySpki)) {
    throw new Error("El desafío no corresponde a esta estación, usuario, navegador y operación, o ya venció. No se firmó ni se registró una instalación.");
  }
}

export async function sendPending(api: StrictApi, request: PendingRequest): Promise<unknown> {
  if (request.inFlight) return request.inFlight;
  const response = api<unknown>(request.path, { method: "POST", body: request.body, headers: { "Idempotency-Key": request.key } });
  request.inFlight = response;
  try { return await response; }
  finally { if (request.inFlight === response) request.inFlight = undefined; }
}

export function registrationChallenge(stationId: string, identity: StationInstallationKey): PendingRequest {
  return {
    kind: "register", stage: "challenge", identity, installationId: identity.installationId, key: operationKey(),
    path: `/estaciones/${encodeURIComponent(stationId)}/instalaciones/desafios`,
    body: JSON.stringify({ purpose: "register", installationId: identity.installationId, publicKeySpki: identity.publicKeySpki }),
  };
}

export async function signInstallationRequest(api: StrictApi, request: PendingRequest, stationId: string, actorId: string,
  fromLogin?: { number: string; name: string; installations: StationInstallationRef[] }): Promise<PendingRequest> {
  const challenge = await sendPending(api, request) as StationInstallationChallenge;
  validateChallenge(challenge, request, stationId, actorId);
  if (!request.identity) throw new Error("La identidad local no está disponible.");
  const signature = await signStationInstallationPayload(request.identity, signingPayload(challenge));
  return {
    kind: request.kind, stage: "complete", key: operationKey(), identity: request.identity,
    installationId: request.installationId,
    path: `/estaciones/${encodeURIComponent(stationId)}/${request.kind === "register" ? "instalaciones" : "datos"}`,
    body: JSON.stringify(request.kind === "register"
      ? { challengeId: challenge.challengeId, installationId: request.installationId, publicKeySpki: request.identity.publicKeySpki, signature, confirmed: true, ...(fromLogin && { fromLogin }) }
      : { challengeId: challenge.challengeId, installationId: request.installationId, signature }),
  };
}
