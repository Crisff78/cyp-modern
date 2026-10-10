import { createHash, createPublicKey, randomBytes, randomUUID, verify, type KeyObject } from "node:crypto";
import { assertAdmin, assertAdminRead, DomainError, type State, type User } from "./domain.js";
import { assertAuthSession, getAdminTools, requireAdminRow } from "./admin-tools.js";
import { stationRraaValidated } from "./rraa.js";
import { INSTALLATION_PROTOCOL_VERSION, signingPayload, type InstallationPurpose,
  type StationInstallation, type StationInstallationChallenge, type StationInstallationData,
  type StationInstallationSummary } from "./station-installation-protocol.js";

export type InstallationActor = User & { sid?: string };
export type StationInstallationOptions = { rraaClientId?: string; publicOrigin?: string; origins?: string[]; buildVersion?: string };
type InstallationState = { installationScopeId?: string; installations: StationInstallation[]; installationChallenges: StationInstallationChallenge[] };
export type InstallationChallengeInput = { purpose: InstallationPurpose; installationId: string; publicKeySpki?: string };
export type InstallationRegistrationInput = { challengeId: string; installationId: string; publicKeySpki: string; signature: string; confirmed: true };
export type InstallationQueryInput = { challengeId: string; installationId: string; signature: string };

const fail = (code: string, message: string, status = 409): never => { throw new DomainError(code, message, status); };
function data(state: State) {
  const tools = getAdminTools(state) as ReturnType<typeof getAdminTools> & InstallationState;
  tools.installations ??= []; tools.installationChallenges ??= [];
  return tools;
}
export function stationInstallationScope(state: State, options: StationInstallationOptions, create = false): string | undefined {
  const tools = data(state);
  if (!tools.installationScopeId && create) tools.installationScopeId = randomUUID();
  return tools.installationScopeId ? JSON.stringify([tools.installationScopeId, options.rraaClientId ?? null]) : undefined;
}
function publicKey(value: string): KeyObject {
  try {
    if (!/^[A-Za-z0-9_-]{122}$/.test(value)) throw new Error();
    const der = Buffer.from(value, "base64url");
    if (der.length !== 91 || der.toString("base64url") !== value) throw new Error();
    const key = createPublicKey({ key: der, type: "spki", format: "der" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
        !key.export({ type: "spki", format: "der" }).equals(der)) throw new Error();
    return key;
  } catch { return fail("INSTALLATION_PUBLIC_KEY_INVALID", "Usa una clave pública SPKI canónica ECDSA P-256.", 400); }
}
export function installationIdForPublicKey(value: string) {
  publicKey(value);
  return `CYP-INST-${createHash("sha256").update(Buffer.from(value, "base64url")).digest("hex")}`;
}
function requireIdentity(installationId: string, publicKeySpki: string) {
  if (installationIdForPublicKey(publicKeySpki) !== installationId)
    fail("INSTALLATION_ID_MISMATCH", "El ID de instalación no corresponde a la clave pública.", 400);
}
function installationSummary(row: StationInstallation): StationInstallationSummary {
  return { stationId: row.stationId, installationId: row.installationId, status: row.status,
    revision: row.revision, registeredAt: row.registeredAt, registeredBy: row.registeredBy,
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}), ...(row.revokedBy ? { revokedBy: row.revokedBy } : {}),
    ...(row.revocationReason ? { revocationReason: row.revocationReason } : {}) };
}
function findInstallation(state: State, stationId: string, installationId: string, options: StationInstallationOptions) {
  const scopeId = stationInstallationScope(state, options);
  return data(state).installations.find((row) => row.scopeId === scopeId && row.stationId === stationId && row.installationId === installationId);
}
function activeInstallation(state: State, stationId: string, installationId: string, options: StationInstallationOptions) {
  const row = findInstallation(state, stationId, installationId, options);
  if (!row) return fail("INSTALLATION_NOT_FOUND", "La instalación no está registrada para esta estación y empresa.", 404);
  if (row.status !== "active") return fail("INSTALLATION_REVOKED", "La instalación está revocada.");
  return row;
}
export function listStationInstallations(state: State, actor: User, stationId: string, options: StationInstallationOptions) {
  assertAdminRead(actor); requireAdminRow(getAdminTools(state).stations, stationId, "Estación");
  const scopeId = stationInstallationScope(state, options);
  return { installations: data(state).installations.filter((row) => row.scopeId === scopeId && row.stationId === stationId).map(installationSummary),
    identityKind: "installation" as const };
}
export function createStationInstallationChallenge(state: State, actor: InstallationActor, stationId: string,
  input: InstallationChallengeInput, origin: string, options: StationInstallationOptions, now = new Date()): StationInstallationChallenge {
  input.purpose === "register" ? assertAdmin(actor) : assertAdminRead(actor);
  const session = assertAuthSession(state, actor, actor.sid, now), tools = data(state);
  requireAdminRow(tools.stations, stationId, "Estación");
  if (input.purpose === "register") {
    if (!input.publicKeySpki) fail("INSTALLATION_PUBLIC_KEY_REQUIRED", "Indica la clave pública de la instalación.", 400);
    requireIdentity(input.installationId, input.publicKeySpki!);
    if (findInstallation(state, stationId, input.installationId, options))
      fail("INSTALLATION_ALREADY_REGISTERED", "Esta clave ya fue registrada. Conserva su registro o genera una instalación nueva.");
  } else {
    if (input.publicKeySpki !== undefined) fail("INSTALLATION_PUBLIC_KEY_UNEXPECTED", "La consulta utiliza la clave ya registrada.", 400);
    activeInstallation(state, stationId, input.installationId, options);
  }
  tools.installationChallenges = tools.installationChallenges.filter((row) => Date.parse(row.expiresAt) > now.getTime());
  if (tools.installationChallenges.filter((row) => row.actorId === actor.id).length >= 20)
    fail("INSTALLATION_CHALLENGE_LIMIT", "Ya tienes 20 desafíos vigentes. Espera a que venzan.", 429);
  const challenge: StationInstallationChallenge = { version: INSTALLATION_PROTOCOL_VERSION, purpose: input.purpose,
    challengeId: randomUUID(), nonce: randomBytes(32).toString("base64url"), scopeId: stationInstallationScope(state, options, true)!,
    stationId, installationId: input.installationId, actorId: actor.id, sessionId: session.id, origin,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    ...(input.publicKeySpki ? { publicKeySpki: input.publicKeySpki } : {}) };
  tools.installationChallenges.push(challenge);
  return { ...challenge };
}
function consumeProof(state: State, actor: InstallationActor, stationId: string, purpose: InstallationPurpose,
  input: InstallationQueryInput, publicKeySpki: string, origin: string, options: StationInstallationOptions, now: Date) {
  const session = assertAuthSession(state, actor, actor.sid, now), tools = data(state);
  const challenge = tools.installationChallenges.find((row) => row.challengeId === input.challengeId);
  if (!challenge) fail("INSTALLATION_CHALLENGE_UNAVAILABLE", "El desafío ya se usó o no existe. Solicita uno nuevo.");
  if (challenge!.version !== INSTALLATION_PROTOCOL_VERSION || challenge!.purpose !== purpose ||
      challenge!.scopeId !== stationInstallationScope(state, options) || challenge!.stationId !== stationId ||
      challenge!.installationId !== input.installationId || challenge!.actorId !== actor.id ||
      challenge!.sessionId !== session.id || challenge!.origin !== origin ||
      (purpose === "register" && challenge!.publicKeySpki !== publicKeySpki))
    fail("INSTALLATION_CHALLENGE_MISMATCH", "El desafío no corresponde a esta operación, instalación, sesión u origen.");
  // The route commits consumption even if cryptographic proof fails, then returns the error.
  tools.installationChallenges = tools.installationChallenges.filter((row) => row.challengeId !== input.challengeId);
  if (Date.parse(challenge!.expiresAt) <= now.getTime() || !Number.isFinite(Date.parse(challenge!.expiresAt)))
    fail("INSTALLATION_CHALLENGE_EXPIRED", "El desafío venció. Solicita uno nuevo.");
  let valid = false;
  try {
    const signature = Buffer.from(input.signature, "base64url");
    valid = /^[A-Za-z0-9_-]{86}$/.test(input.signature) && signature.length === 64 && signature.toString("base64url") === input.signature &&
      verify("sha256", Buffer.from(signingPayload(challenge!), "utf8"), { key: publicKey(publicKeySpki), dsaEncoding: "ieee-p1363" }, signature);
  } catch { valid = false; }
  if (!valid) fail("INSTALLATION_PROOF_INVALID", "No se pudo comprobar la clave de esta instalación. Solicita un desafío nuevo.", 403);
}
export function registerStationInstallation(state: State, actor: InstallationActor, stationId: string,
  input: InstallationRegistrationInput, origin: string, options: StationInstallationOptions, now = new Date()): StationInstallationSummary {
  assertAdmin(actor); requireAdminRow(getAdminTools(state).stations, stationId, "Estación");
  if (input.confirmed !== true) fail("INSTALLATION_CONFIRMATION_REQUIRED", "Confirma el registro de esta instalación.", 400);
  requireIdentity(input.installationId, input.publicKeySpki);
  if (findInstallation(state, stationId, input.installationId, options))
    fail("INSTALLATION_ALREADY_REGISTERED", "Esta clave ya tiene un registro. No se puede reemplazar ni reactivar.");
  consumeProof(state, actor, stationId, "register", input, input.publicKeySpki, origin, options, now);
  const row: StationInstallation = { scopeId: stationInstallationScope(state, options)!, stationId, installationId: input.installationId,
    publicKeySpki: input.publicKeySpki, algorithm: "ECDSA-P256-SHA256", status: "active", revision: randomUUID(),
    registeredAt: now.toISOString(), registeredBy: actor.id };
  data(state).installations.push(row);
  return installationSummary(row);
}
export function queryStationInstallation(state: State, actor: InstallationActor, stationId: string,
  input: InstallationQueryInput, origin: string, options: StationInstallationOptions, now = new Date()): StationInstallationData {
  assertAdminRead(actor); const station = requireAdminRow(getAdminTools(state).stations, stationId, "Estación");
  const row = activeInstallation(state, stationId, input.installationId, options);
  consumeProof(state, actor, stationId, "query", input, row.publicKeySpki, origin, options, now);
  const validated = stationRraaValidated(station, options.rraaClientId);
  return { stationId, stationCode: station.name, installationId: row.installationId, installationStatus: row.status,
    active: station.active, rraaValidationStatus: validated ? "validated" : "not_validated",
    ...(validated ? { rraaValidatedAt: station.rraaValidatedAt } : {}), queriedAt: now.toISOString(),
    ...(options.buildVersion ? { cypBuildVersion: options.buildVersion } : {}) };
}
export function revokeStationInstallation(state: State, actor: InstallationActor, stationId: string, installationId: string,
  input: { revision: string; reason: string }, options: StationInstallationOptions, now = new Date()): StationInstallationSummary {
  assertAdmin(actor); assertAuthSession(state, actor, actor.sid, now);
  requireAdminRow(getAdminTools(state).stations, stationId, "Estación");
  const row = findInstallation(state, stationId, installationId, options);
  if (!row) return fail("INSTALLATION_NOT_FOUND", "La instalación no está registrada para esta estación y empresa.", 404);
  if (row.revision !== input.revision) fail("INSTALLATION_REVISION_CHANGED", "El registro cambió. Actualiza la lista antes de revocar.");
  if (row.status !== "active") fail("INSTALLATION_REVOKED", "La instalación está revocada.");
  if (!input.reason.trim() || input.reason.length > 1000) fail("INSTALLATION_REASON_REQUIRED", "Indica un motivo de revocación de hasta 1000 caracteres.", 400);
  row.status = "revoked"; row.revision = randomUUID(); row.revokedAt = now.toISOString(); row.revokedBy = actor.id;
  row.revocationReason = input.reason.trim();
  return installationSummary(row);
}
