import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assertAuthSession, recordAdminTrace } from "./admin-tools.js";
import { assertAdmin, assertAdminRead, DomainError, type State, type User } from "./domain.js";
import { boundedId, freeText } from "./input-validation.js";
import type { Store } from "./store.js";
import { createStationInstallationChallenge, listStationInstallations, queryStationInstallation,
  registerStationInstallation, revokeStationInstallation, stationInstallationScope,
  type InstallationActor, type StationInstallationOptions } from "./station-installations.js";

type Describe = (method: string, path: string, summary: string, schema?: z.ZodType, isPublic?: boolean, requiresIdempotency?: boolean) => void;
const installationId = z.string().regex(/^CYP-INST-[a-f0-9]{64}$/);
const publicKeySpki = z.string().regex(/^[A-Za-z0-9_-]{122}$/);
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const stationParams = z.object({ id: boundedId }).strict();
const revokeParams = stationParams.extend({ installationId }).strict();
const challengeBody = z.object({ purpose: z.enum(["register", "query"]), installationId, publicKeySpki: publicKeySpki.optional() }).strict()
  .refine((body) => body.purpose === "register" ? body.publicKeySpki !== undefined : body.publicKeySpki === undefined,
    { message: "El registro requiere clave pública y la consulta utiliza la clave registrada." });
const registrationBody = z.object({ challengeId: z.uuid(), installationId, publicKeySpki, signature, confirmed: z.literal(true) }).strict();
const queryBody = z.object({ challengeId: z.uuid(), installationId, signature }).strict();
const revokeBody = z.object({ revision: z.uuid(), reason: freeText(1000, 1) }).strict();
const noQuery = z.object({}).strict();

export function registerStationInstallationRoutes(app: FastifyInstance, store: Store, user: (req: FastifyRequest) => User,
  describe: Describe, options: StationInstallationOptions = {}) {
  const settings = { ...options, origins: [...(options.origins ?? [])] };
  const trustedOrigins = new Set<string>();
  for (const value of [...settings.origins, ...(settings.publicOrigin ? [settings.publicOrigin] : [])]) {
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new Error("Installation origins must be canonical HTTP(S) origins."); }
    if (value.length > 2048 || !["http:", "https:"].includes(parsed.protocol) || parsed.origin !== value || parsed.username || parsed.password)
      throw new Error("Installation origins must be canonical HTTP(S) origins.");
    trustedOrigins.add(value);
  }
  const origin = (req: FastifyRequest, required = true) => {
    const value = req.headers.origin;
    if (!required && value === undefined) return "";
    if (typeof value !== "string" || !trustedOrigins.has(value))
      throw new DomainError("INSTALLATION_ORIGIN_FORBIDDEN", "El origen de esta solicitud no está autorizado.", 403);
    return value;
  };
  const routeOptions = (max: number) => ({ bodyLimit: 4096, logLevel: "silent" as const, config: { rateLimit: {
    max, timeWindow: "1 minute", hook: "preHandler" as const,
    keyGenerator: (req: FastifyRequest) => `installation:${req.routeOptions.url}:${user(req)?.id ?? req.ip}`,
  } } });
  type Action = "challenge" | "register" | "query" | "revoke";
  async function transact<T>(req: FastifyRequest, stationId: string, action: Action,
    operation: (state: State, actor: InstallationActor, requestOrigin: string) => T,
    idempotency?: { body: unknown; params: unknown }): Promise<T> {
    const requestOrigin = origin(req), actor = user(req) as InstallationActor;
    const key = req.headers["idempotency-key"];
    if (idempotency && (typeof key !== "string" || key.length < 8 || key.length > 100 || /[\u0000-\u001f\u007f]/.test(key)))
      throw new DomainError("IDEMPOTENCY_REQUIRED", "Envía un Idempotency-Key válido.", 400);
    const outcome = await store.transaction((state) => {
      let authorized = false;
      try {
        assertAuthSession(state, actor, actor.sid);
        const account = state.accounts.find((row) => row.id === actor.id);
        if (account && (account.status !== "active" || account.role !== actor.role || account.collectorId !== actor.collectorId))
          throw new DomainError("SESSION_EXPIRED", "La cuenta cambió. Inicia sesión de nuevo.", 401);
        if (action === "register" || action === "revoke") assertAdmin(actor); else assertAdminRead(actor);
        authorized = true;
        const scope = `installation:${JSON.stringify([actor.id, key])}`;
        const fingerprint = idempotency ? createHash("sha256").update(JSON.stringify({
          route: req.routeOptions.url, params: idempotency.params, body: idempotency.body, origin: requestOrigin,
          scopeId: stationInstallationScope(state, settings, true),
        })).digest("hex") : undefined;
        if (idempotency) {
          const existing = state.idempotency.find((row) => row.id === scope);
          if (existing) {
            if (existing.fingerprint !== fingerprint)
              throw new DomainError("IDEMPOTENCY_CONFLICT", "La clave ya se usó para una operación diferente.", 409);
            // A confirmed retry returns the original result without consuming its challenge again.
            return { ok: true as const, value: structuredClone(existing.response) as T };
          }
        }
        const value = operation(state, actor, requestOrigin);
        recordAdminTrace(state, actor, `installation.${action}.completed`, "stations/installations", stationId);
        if (idempotency) state.idempotency.push({ id: scope, fingerprint: fingerprint!, response: structuredClone(value), createdAt: new Date().toISOString() });
        return { ok: true as const, value };
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        if (authorized) recordAdminTrace(state, actor, `installation.${action}.rejected`, "stations/installations", stationId);
        // Commit challenge consumption/pruning and metadata, never the proof or request body.
        return { ok: false as const, error };
      }
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }
  const listPath = "/api/estaciones/:id/instalaciones", challengePath = `${listPath}/desafios`;
  const queryPath = "/api/estaciones/:id/datos", revokePath = `${listPath}/:installationId/revocar`;
  app.get(listPath, routeOptions(60), async (req) => {
    origin(req, false); noQuery.parse(req.query); const params = stationParams.parse(req.params), actor = user(req) as InstallationActor;
    const state = await store.read(); assertAuthSession(state, actor, actor.sid);
    return listStationInstallations(state, actor, params.id, settings);
  });
  app.post(challengePath, routeOptions(30), async (req) => {
    const params = stationParams.parse(req.params), body = challengeBody.parse(req.body); noQuery.parse(req.query);
    return transact(req, params.id, "challenge", (state, actor, requestOrigin) => createStationInstallationChallenge(state, actor, params.id, body, requestOrigin, settings));
  });
  app.post(listPath, routeOptions(30), async (req) => {
    const params = stationParams.parse(req.params), body = registrationBody.parse(req.body); noQuery.parse(req.query);
    return transact(req, params.id, "register", (state, actor, requestOrigin) => registerStationInstallation(state, actor, params.id, body, requestOrigin, settings), { body, params });
  });
  app.post(queryPath, routeOptions(60), async (req) => {
    const params = stationParams.parse(req.params), body = queryBody.parse(req.body); noQuery.parse(req.query);
    return transact(req, params.id, "query", (state, actor, requestOrigin) => queryStationInstallation(state, actor, params.id, body, requestOrigin, settings));
  });
  app.post(revokePath, routeOptions(20), async (req) => {
    const params = revokeParams.parse(req.params), body = revokeBody.parse(req.body); noQuery.parse(req.query);
    return transact(req, params.id, "revoke", (state, actor) => revokeStationInstallation(state, actor, params.id, params.installationId, body, settings), { body, params });
  });
  describe("get", listPath, "Consultar identidades lógicas de instalación de una estación", undefined, false, false);
  describe("post", challengePath, "Emitir desafío de posesión de clave de instalación", challengeBody, false, false);
  describe("post", listPath, "Registrar identidad lógica de instalación con confirmación administrativa", registrationBody, false, true);
  describe("post", queryPath, "Obtener datos CyP con prueba de posesión sin consultar RRAA", queryBody, false, false);
  describe("post", revokePath, "Revocar una identidad lógica de instalación", revokeBody, false, true);
}
