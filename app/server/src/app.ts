import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import {
  randomUUID,
  createHash,
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { emailOrEmpty, phoneOrEmpty } from "./contact-schemas.js";
import {
  acceptDeposit,
  assertAdmin,
  assertAdminRead,
  assertCollectorAccess,
  assertCollectorReadAccess,
  businessDate,
  cancelDeposit,
  cancelMovement,
  clientStatement,
  closeDay,
  createRecurringPayout,
  createCentralCollections,
  createCentralPayments,
  collectorForClient,
  DomainError,
  findAccount,
  hashPassword,
  importCharges,
  importPayouts,
  MAX_MONEY_AMOUNT,
  ledgerCurrency,
  supportedLedgerCurrency,
  ledgerCurrencies,
  obligationCurrencyConflict,
  type LedgerCurrency,
  type DepositComponent,
  postMovement,
  preview,
  publicAccount,
  saveSystemConfigData,
  snapshot,
  updateRecurringPayout,
  verifyPassword,
  type Account,
  type State,
  type User,
} from "./domain.js";
import type { Store } from "./store.js";
import { registerRemittanceRoutes } from "./remittance-routes.js";
import { registerCatalogRoutes } from "./catalog-routes.js";
import { registerDemoAccess, type DemoAccessConfig } from "./demo-access.js";
import { assertAuthSession, createAuthSession, recordMutationTrace, revokeUserSessions } from "./admin-tools.js";
import { registerAdminToolsRoutes } from "./admin-tools-routes.js";
import type { RraaValidator } from "./rraa.js";
import { legacyFinancialFingerprintBody } from "./financial-currency-compat.js";
import { boundedId, fourDecimalNumber, freeText, machineCounter, optionalEmail, phone, singleLine, systemConfigInput } from "./input-validation.js";
import { ACCOUNT_ROLES, isOperationalRole } from "./account-roles.js";
import { permissionCatalog, permissionsForAccount, updateAccountPermissions, userPermissionsBody } from "./user-permissions.js";

type Config = {
  store: Store;
  secret: string;
  demo: boolean;
  publicWeb?: boolean;
  demoAccess?: DemoAccessConfig;
  origins: string[];
  collectorUrl: string;
  adminEmail?: string;
  adminPassword?: string;
  rraa?: RraaValidator;
};
const money = z.number().int().positive().max(MAX_MONEY_AMOUNT);
const currency = singleLine(40, 1)
  .refine((value) => supportedLedgerCurrency(value) !== undefined, "Selecciona DOP, USD o EUR.")
  .transform(ledgerCurrency);
const id = boundedId,
  text = singleLine(160, 1),
  date = z.iso.date();
const chargeBody = z
  .object({
    clientId: id,
    service: text,
    concept: singleLine(160).default(""),
    currency: currency.default("DOP"),
    note: freeText(2000).default(""),
    amount: money,
    dueDate: date,
    required: z.boolean().default(false),
  })
  .strict();
const batchBody = z.object({
  service: text,
  currency: currency.default("DOP"),
  amount: money,
  dueDate: date,
  required: z.boolean().default(false),
  clientIds: z.array(id).min(1).max(100),
}).strict();
const payoutBody = z
  .object({ clientId: id, collectorId: id, concept: text, amount: money, currency: currency.default("DOP"), dueDate: date.optional() })
  .strict();
const transferBody = z.object({
  collectorId: id, amount: money, currency: currency.default("DOP"),
  note: freeText(2000).optional(),
  denominations: z.array(z.object({ denominacion: z.number().int().positive(), cantidad: z.number().int().min(0) }).strict()).max(100).optional(),
}).strict();
const nonCashComponent = {
  amount: money,
  bank: singleLine(160, 1),
  reference: singleLine(160, 1),
};
const depositComponent = z.discriminatedUnion("method", [
  z.object({ method: z.literal("cash"), amount: money }).strict(),
  z.object({ method: z.literal("cheque"), ...nonCashComponent }).strict(),
  z.object({ method: z.literal("bank_deposit"), ...nonCashComponent }).strict(),
]);
const depositBody = transferBody.extend({ depositComponents: z.array(depositComponent).min(1).max(20).optional() });
const clientBody = z.object({
  name: text,
  code: singleLine(80, 1),
  phone: phone.pipe(phoneOrEmpty).default(""),
  address: singleLine(240).default(""),
  routeId: id,
  preferredCurrency: z.enum(ledgerCurrencies).optional(),
  alias: singleLine(160).default(""),
  sector: singleLine(160).default(""),
  cellular: phone.pipe(phoneOrEmpty).default(""),
  email: optionalEmail.pipe(emailOrEmpty).default(""),
  note: freeText(2000).default(""),
  identification: singleLine(80).default(""),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).strict().refine((body) => (body.lat === undefined) === (body.lng === undefined), {
  message: "Latitud y longitud deben enviarse juntas.",
});
const newClientBody = clientBody.refine((body) => body.identification.length > 0, {
  path: ["identification"],
  message: "Indica la cédula o el pasaporte del cliente.",
});
const clientMachineBody = z.object({
  number: z.number().int("El número de máquina debe ser entero.").positive("El número de máquina debe ser positivo.").max(2_147_483_647, "El número de máquina no puede superar 2147483647."),
  entry: machineCounter.default(""),
  exit: machineCounter.default(""),
  value: fourDecimalNumber(1_000_000_000),
  percentage: fourDecimalNumber(100),
}).strict();
const loginBody = z
  .object({
    email: singleLine(200, 1),
    password: z.string().min(1).max(200),
  })
  .strict();
export async function buildApp(config: Config) {
  if (config.secret.length < 32)
    throw new Error("JWT_SECRET must contain at least 32 characters.");
  if (
    !config.demo &&
    (!config.adminPassword ||
      config.adminPassword.length < 14 ||
      !config.adminEmail)
  )
    throw new Error(
      "Configure ADMIN_EMAIL and an ADMIN_PASSWORD of at least 14 characters outside demo mode.",
    );
  const authVersion = createHmac("sha256", config.secret)
    .update(
      JSON.stringify({
        demo: config.demo,
        email: config.adminEmail ?? "",
        password: config.demo ? "Demo-CyP-2026!" : config.adminPassword,
      }),
    )
    .digest("hex");
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  await app.register(cors, {
    origin: config.origins,
    methods: ["GET", "POST"],
  });
  await app.register(helmet, {
    referrerPolicy: { policy: "no-referrer" },
    ...(config.publicWeb
      ? {
          contentSecurityPolicy: {
            directives: {
              imgSrc: ["'self'", "data:", "https://tile.openstreetmap.org"],
              styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
              connectSrc: ["'self'"],
            },
          },
        }
      : {}),
  });
  await app.register(jwt, { secret: config.secret });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  if (config.demoAccess) await registerDemoAccess(app, config.demoAccess);
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    if ((error as { statusCode?: number }).statusCode === 413)
      return reply.code(413).send({
        error: { code: "PAYLOAD_TOO_LARGE", message: "La solicitud supera 65536 bytes (64 KiB). Divide el archivo en lotes más pequeños; no se guardó ninguna fila." },
      });
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: "VALIDATION",
          message: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
      });
    if (error instanceof DomainError)
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message } });
    if ((error as { statusCode?: number }).statusCode === 429)
      return reply.code(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Demasiados intentos. Espera un minuto.",
        },
      });
    if ((error as { statusCode?: number }).statusCode === 400)
      return reply.code(400).send({
        error: { code: "BAD_REQUEST", message: "Solicitud no válida." },
      });
    if ((error as { statusCode?: number }).statusCode === 401)
      return reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Inicia sesión para continuar.",
        },
      });
    console.error("Request failed", request.id, (error as Error).message);
    return reply.code(500).send({
      error: {
        code: "INTERNAL",
        message: "No se pudo completar la operación. Intenta de nuevo.",
      },
    });
  });
  app.addHook("preHandler", async (req) => {
    const path = req.url.split("?")[0];
    if (config.publicWeb && config.demoAccess && req.routeOptions.url === "/demo-access") return;
    if (config.publicWeb && config.demoAccess && req.method === "GET" && path === "/demo-access.js") return;
    if (config.publicWeb && ["/", "/collector", "/*"].includes(req.routeOptions.url ?? "")) return;
    if (
      path === "/api/health" ||
      path === "/api/auth/login" ||
      path === "/api/openapi.json" ||
      (req.method === "GET" &&
        /^\/api\/recibos\/[^/]+(?:\/escpos)?$/.test(path))
    )
      return;
    await req.jwtVerify();
    const u = req.user as User & { authVersion?: string };
    assertAuthSession(await config.store.read(), u, (req.user as User & { sid?: string }).sid);
    const legacyIdentity = config.demo
      ? (u.id === "demo-admin" && u.role === "admin") ||
        (u.id === "demo-collector" &&
          u.role === "collector" &&
          u.collectorId === "col-1")
      : u.id === "configured-admin" && u.role === "admin";
    if (legacyIdentity) {
      if (u.authVersion !== authVersion)
        throw new DomainError(
          "SESSION_EXPIRED",
          "La configuración de acceso cambió. Inicia sesión de nuevo.",
          401,
        );
      if (u.role === "collector") {
        const collector = (await config.store.read()).collectors.find((c) => c.id === u.collectorId);
        if (!collector || collector.active === false) throw new DomainError("COLLECTOR_INACTIVE", "El cobrador está inactivo.", 403);
      }
      if (config.demo && u.id === "demo-collector" && u.role === "collector" && u.collectorId === "col-1")
        u.name = "Cobrador";
      return;
    }
    // Provisioned accounts: the token carries the account's credential
    // version, so a password change or a disable revokes older sessions.
    const state = await config.store.read(),
      account = state.accounts.find((a) => a.id === u.id);
    if (
      !account ||
      account.status !== "active" ||
      account.role !== u.role ||
      account.collectorId !== u.collectorId ||
      u.authVersion !== String(account.credentialVersion)
    )
      throw new DomainError(
        "SESSION_EXPIRED",
        "La configuración de acceso cambió. Inicia sesión de nuevo.",
        401,
      );
    if (u.role === "collector" && !state.collectors.some((c) => c.id === u.collectorId && c.active !== false))
      throw new DomainError("COLLECTOR_INACTIVE", "El cobrador está inactivo.", 403);
    if (!isOperationalRole(u.role)) {
      const ownSession = path === "/api/auth/me" || path === "/api/auth/logout" || path === `/api/usuarios/${u.id}/clave`;
      if (!ownSession && !(u.role === "supervisor" && req.method === "GET"))
        throw new DomainError("FORBIDDEN", "Este rol no tiene permiso para realizar esta operación.", 403);
    }
  });
  const user = (req: FastifyRequest) => req.user as User;
  const paths: Record<string, Record<string, unknown>> = {};
  const describe = (
    method: string,
    path: string,
    summary: string,
    schema?: z.ZodType,
    publicAccess = false,
    requiresIdempotency = true,
  ) => {
    const formatted = path.replace(/:([A-Za-z]+)/g, "{$1}");
    const params = [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
      in: "path",
      name: m[1],
      required: true,
      schema: { type: "string" },
    }));
    paths[formatted] ??= {};
    paths[formatted][method] = {
      summary,
      security: publicAccess ? [] : [{ bearerAuth: [] }],
      parameters: [
        ...params,
        ...(method === "post" && !publicAccess && requiresIdempotency
          ? [
              {
                in: "header",
                name: "Idempotency-Key",
                required: true,
                schema: { type: "string", minLength: 8, maxLength: 100 },
              },
            ]
          : []),
      ],
      ...(schema
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: z.toJSONSchema(schema, { io: "input" }) },
              },
            },
          }
        : {}),
      responses: {
        200: { description: "Operación completada" },
        400: { description: "Validación" },
        401: { description: "Sesión requerida" },
        403: { description: "No autorizado" },
        409: { description: "Conflicto o límite" },
        422: { description: "Regla de negocio" },
      },
    };
  };
  const mutate = <T, P = Record<string, string>>(
    path: string,
    summary: string,
    schema: z.ZodType<T>,
    fn: (state: State, u: User, body: T, params: P) => unknown,
  ) => {
    describe("post", path, summary, schema);
    const paramsSchema = z.object(Object.fromEntries(
      [...path.matchAll(/:([A-Za-z]+)/g)].map((match) => [match[1], id]),
    )).strict();
    app.post(path, async (req) => {
      const body = schema.parse(req.body),
        params = paramsSchema.parse(req.params ?? {}) as P,
        u = user(req),
        key = req.headers["idempotency-key"];
      if (typeof key !== "string" || key.length < 8 || key.length > 100)
        throw new DomainError(
          "IDEMPOTENCY_REQUIRED",
          "Envía un Idempotency-Key válido.",
          400,
        );
      const scope = `${u.id}:${key}`,
        fingerprint = createHash("sha256")
          .update(JSON.stringify({ path: req.url, body }))
          .digest("hex");
      return config.store.transaction(async (state) => {
        assertAuthSession(state, u, (u as User & { sid?: string }).sid);
        const existing = state.idempotency.find((i) => i.id === scope);
        if (existing) {
          const legacyBody = legacyFinancialFingerprintBody(path, body, req.body);
          const legacyFingerprint = legacyBody === undefined ? undefined : createHash("sha256")
            .update(JSON.stringify({ path: req.url, body: legacyBody })).digest("hex");
          if (existing.fingerprint !== fingerprint && existing.fingerprint !== legacyFingerprint)
            throw new DomainError(
              "IDEMPOTENCY_CONFLICT",
              "Esta clave ya se usó para otra operación.",
              409,
            );
          return existing.response;
        }
        const response = await fn(state, u, body, params);
        recordMutationTrace(state, u, path, req.params, response);
        state.idempotency.push({
          id: scope,
          fingerprint,
          response: structuredClone(response),
          createdAt: new Date().toISOString(),
        });
        return response;
      });
    });
  };
  app.get("/api/health", () => ({
    status: "ok",
    mode: config.demo ? "demo" : "configured",
    businessDate: businessDate(),
  }));
  describe("get", "/api/health", "Estado del servicio", undefined, true);
  const salt = randomUUID(),
    expectedPassword = scryptSync(
      config.demo ? "Demo-CyP-2026!" : config.adminPassword!,
      salt,
      64,
    );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const body = loginBody.parse(req.body),
        email = body.email.toLowerCase();
      const matches = timingSafeEqual(
        scryptSync(body.password, salt, 64),
        expectedPassword,
      );
      let u: User | undefined,
        version = authVersion;
      if (config.demo) {
        if (email === "admin@cyp.local" || email === "admin")
          u = { id: "demo-admin", name: "Administración", role: "admin" };
        if (email === "collector@cyp.local" || email === "collector.demo")
          u = {
            id: "demo-collector",
            name: "Cobrador",
            role: "collector",
            collectorId: "col-1",
          };
      } else if (email === config.adminEmail!.toLowerCase())
        u = { id: "configured-admin", name: "Administración", role: "admin" };
      if (u) {
        if (!matches)
          throw new DomainError(
            "INVALID_CREDENTIALS",
            "Correo o contraseña incorrectos.",
            401,
          );
      } else {
        const state = await config.store.read(),
          account = findAccount(state, email);
        if (
          account &&
          account.status === "active" &&
          verifyPassword(body.password, account.salt, account.passwordHash)
        ) {
          u = {
            id: account.id,
            name: account.name,
            role: account.role,
            ...(account.collectorId
              ? { collectorId: account.collectorId }
              : {}),
          };
          version = String(account.credentialVersion);
        }
      }
      if (!u)
        throw new DomainError(
          "INVALID_CREDENTIALS",
          "Correo o contraseña incorrectos.",
          401,
        );
      if (u.role === "collector" && !(await config.store.read()).collectors.some((c) => c.id === u!.collectorId && c.active !== false))
        throw new DomainError("COLLECTOR_INACTIVE", "El cobrador está inactivo.", 403);
      const session = await config.store.transaction((s) => createAuthSession(s, u!));
      return {
        token: app.jwt.sign({ ...u, authVersion: version, sid: session.id }, { expiresIn: "8h" }),
        user: u,
      };
    },
  );
  describe("post", "/api/auth/login", "Iniciar sesión", loginBody, true);
  app.get("/api/auth/me", (req) => {
    const { id, name, role, collectorId } = user(req);
    return { id, name, role, collectorId };
  });
  describe("get", "/api/auth/me", "Usuario actual");
  const emailField = z.email("Escribe un correo válido.").max(200);
  const passwordField = z
    .string()
    .min(3, "La contraseña debe tener al menos 3 caracteres.")
    .max(200);
  const accountBody = z
    .object({
      name: text,
      nickname: singleLine(120).optional(),
      note: freeText(1000).optional(),
      email: emailField,
      role: z.enum(ACCOUNT_ROLES),
      collectorId: id.optional(),
      password: passwordField,
    })
    .strict();
  const passwordBody = z.object({ password: passwordField }).strict();
  const accountStatusBody = z
    .object({ status: z.enum(["active", "disabled"]) })
    .strict();
  const touch = (account: Account, now = new Date()) => {
    account.updatedAt = now.toISOString();
    account.credentialVersion += 1;
  };
  app.get("/api/usuarios", async (req) => {
    assertAdminRead(user(req));
    return (await config.store.read()).accounts.map(publicAccount);
  });
  describe("get", "/api/usuarios", "Cuentas provisionadas (sin secretos)");
  app.get("/api/permisos", async (req) => {
    assertAdminRead(user(req));
    return permissionCatalog;
  });
  describe("get", "/api/permisos", "Catálogo de permisos legacy (códigos 1–501 con huecos)");
  app.get("/api/usuarios/:id/permisos", async (req) => {
    assertAdminRead(user(req));
    const params = z.object({ id }).strict().parse(req.params);
    return permissionsForAccount(await config.store.read(), params.id);
  });
  describe("get", "/api/usuarios/:id/permisos", "Asignaciones legacy del usuario");
  mutate("/api/usuarios/:id/permisos", "Guardar asignaciones legacy sin modificar el rol ni las credenciales", userPermissionsBody,
    (state, actor, body, params) => updateAccountPermissions(state, actor, params.id, body));
  mutate(
    "/api/usuarios",
    "Provisionar cuenta de usuario o cobrador",
    accountBody,
    (state, u, body) => {
      assertAdmin(u);
      const email = body.email.trim().toLowerCase();
      if (body.role === "collector" && !body.collectorId)
        throw new DomainError(
          "COLLECTOR_REQUIRED",
          "Una cuenta de cobrador necesita un cobrador asignado.",
          422,
        );
      if (body.role === "admin" && body.collectorId)
        throw new DomainError(
          "COLLECTOR_NOT_ALLOWED",
          "Una cuenta de administración no se asocia a un cobrador.",
          422,
        );
      if (
        body.collectorId &&
        !state.collectors.some((c) => c.id === body.collectorId && c.active !== false)
      )
        throw new DomainError(
          "NOT_FOUND",
          "El cobrador seleccionado no existe o está inactivo.",
          404,
        );
      if (findAccount(state, email))
        throw new DomainError(
          "DUPLICATE_EMAIL",
          "Ya existe una cuenta con ese correo.",
          409,
        );
      const now = new Date().toISOString(),
        { salt, passwordHash } = hashPassword(body.password),
        account: Account = {
          id: randomUUID(),
          name: body.name,
          ...(body.nickname !== undefined ? { nickname: body.nickname } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
          email,
          role: body.role,
          ...(body.collectorId ? { collectorId: body.collectorId } : {}),
          salt,
          passwordHash,
          credentialVersion: 1,
          status: "active",
          createdAt: now,
          updatedAt: now,
        };
      state.accounts.push(account);
      return publicAccount(account);
    },
  );
  mutate("/api/usuarios/:id", "Editar perfil y permisos de cuenta", accountBody.omit({ password: true }), (state, actor, body, params) => {
    assertAdmin(actor);
    const account = state.accounts.find((item) => item.id === params.id);
    if (!account) throw new DomainError("NOT_FOUND", "La cuenta no existe.", 404);
    if (actor.id === account.id && body.role !== "admin") throw new DomainError("FORBIDDEN", "No puedes retirar tu propio acceso administrativo.", 403);
    if (body.role === "admin" && account.role !== "admin" && state.collectors.some((collector) => collector.accountId === account.id))
      throw new DomainError("ACCOUNT_LINKED_COLLECTOR", "Retira la cuenta del cobrador antes de cambiar su rol a Admin.", 409);
    if (body.role === "collector" && !body.collectorId) throw new DomainError("COLLECTOR_REQUIRED", "Una cuenta de cobrador necesita un cobrador asignado.", 422);
    if (body.role === "admin" && body.collectorId) throw new DomainError("COLLECTOR_NOT_ALLOWED", "Una cuenta de administración no se asocia a un cobrador.", 422);
    if (body.collectorId && !state.collectors.some((item) => item.id === body.collectorId && item.active !== false))
      throw new DomainError("COLLECTOR_INACTIVE", "Selecciona un cobrador activo.", 409);
    const email = body.email.trim().toLowerCase();
    if (state.accounts.some((item) => item.id !== account.id && item.email.toLowerCase() === email))
      throw new DomainError("DUPLICATE_EMAIL", "Ya existe una cuenta con ese correo.", 409);
    // Informative fields do not rotate credentials or revoke active sessions.
    // Keep the existing revocation behavior for changes reflected in auth claims.
    const authChanged = account.name !== body.name || account.email !== email ||
      account.role !== body.role || account.collectorId !== body.collectorId;
    Object.assign(account, { name: body.name, email, role: body.role });
    if (body.nickname !== undefined) account.nickname = body.nickname;
    if (body.note !== undefined) account.note = body.note;
    if (body.collectorId) account.collectorId = body.collectorId;
    else delete account.collectorId;
    if (authChanged) {
      touch(account);
      revokeUserSessions(state, account.id, actor.id);
    } else account.updatedAt = new Date().toISOString();
    return publicAccount(account);
  });
  mutate(
    "/api/usuarios/:id/clave",
    "Cambiar contraseña de una cuenta",
    passwordBody,
    (state, u, body, params) => {
      const account = state.accounts.find((a) => a.id === params.id);
      if (!account)
        throw new DomainError(
          "NOT_FOUND",
          "La cuenta no existe.",
          404,
        );
      if (u.role !== "admin" && u.id !== account.id)
        throw new DomainError(
          "FORBIDDEN",
          "Solo puedes cambiar tu propia contraseña.",
          403,
        );
      const { salt, passwordHash } = hashPassword(body.password);
      Object.assign(account, { salt, passwordHash });
      touch(account);
      revokeUserSessions(state, account.id, u.id);
      return { ok: true, credentialVersion: account.credentialVersion };
    },
  );
  mutate(
    "/api/usuarios/:id/estado",
    "Activar o desactivar una cuenta",
    accountStatusBody,
    (state, u, body, params) => {
      assertAdmin(u);
      const account = state.accounts.find((a) => a.id === params.id);
      if (!account)
        throw new DomainError("NOT_FOUND", "La cuenta no existe.", 404);
      if (account.status === body.status)
        throw new DomainError(
          "NO_CHANGE",
          "La cuenta ya tiene ese estado.",
          409,
        );
      if (u.id === account.id && body.status === "disabled")
        throw new DomainError(
          "FORBIDDEN",
          "No puedes desactivar tu propia cuenta.",
          403,
        );
      account.status = body.status;
      touch(account);
      revokeUserSessions(state, account.id, u.id);
      return publicAccount(account);
    },
  );
  app.get("/api/snapshot", async (req) =>
    snapshot(await config.store.read(), user(req)),
  );
  describe("get", "/api/snapshot", "Vista operacional autorizada");

  const moneyUnits = (value: number) => Number((value / 100).toFixed(2));
  const hasLocation = (item: { lat?: number | null; lng?: number | null }) =>
    typeof item.lat === "number" && Number.isFinite(item.lat) && item.lat >= -90 && item.lat <= 90 &&
    typeof item.lng === "number" && Number.isFinite(item.lng) && item.lng >= -180 && item.lng <= 180;
  const mapDataForCollectors = (state: State, collectorIds: string[], routeIds?: string[]) => {
    const collectors = state.collectors.filter((collector) =>
      collectorIds.includes(collector.id),
    );
    if (!collectors.length)
      throw new DomainError(
        "MAP_ENTITY_NOT_FOUND",
        "No encontramos datos geográficos para esta selección.",
        404,
      );
    const primary = collectors[0],
      clients = state.clients.filter((client) =>
        (!routeIds || routeIds.includes(client.routeId)) &&
        collectors.some((collector) => {
          const route = state.routes.find((item) => item.id === client.routeId);
          return route?.collectorId === collector.id;
        }),
      );
    const stops = clients.filter(hasLocation).map((client, index) => {
      const allCharges = state.charges.filter((item) => item.clientId === client.id && item.status !== "cancelled");
      const conflicts = allCharges.filter((charge) => obligationCurrencyConflict(state, charge, "collection"));
      const charges = allCharges.filter((charge) => !obligationCurrencyConflict(state, charge, "collection"));
      const pending = charges.filter((charge) => charge.collected < charge.amount);
      return {
        id: `pcp-${client.id}`,
        order: index + 1,
        client_name: client.name,
        lat: client.lat!,
        lng: client.lng!,
        amount_due: moneyUnits(pending.filter((charge) => ledgerCurrency(charge.currency) === "DOP").reduce((sum, charge) => sum + charge.amount - charge.collected, 0)),
        amount_due_by_currency: Object.fromEntries(ledgerCurrencies.map((currency) => [currency, moneyUnits(pending.filter((charge) => ledgerCurrency(charge.currency) === currency).reduce((sum, charge) => sum + charge.amount - charge.collected, 0))])),
        currency_conflict_count: conflicts.length,
        status: pending.length || conflicts.length ? "pending" : charges.length ? "paid" : "pending",
        obligated: pending.some((charge) => charge.required),
      };
    });
    return {
      collector: {
        id: primary.id,
        name: primary.name,
        phone: primary.cellular ?? "",
        lat: hasLocation(primary) ? primary.lat : null,
        lng: hasLocation(primary) ? primary.lng : null,
        cash_in_hand: moneyUnits(preview(state, primary.id).difference),
        collection_limit: moneyUnits(primary.collectionLimit),
        payout_limit: moneyUnits(primary.payoutLimit),
        last_ping: primary.lastSeen,
      },
      stops,
      missingLocationCount: clients.length - stops.length,
      collectorLocationMissing: !hasLocation(primary),
      route_geometry: null,
    };
  };
  app.get<{ Params: { id: string } }>(
    "/api/monitoring/collector/:id/map-data",
    async (req) => {
      const u = user(req);
      assertAdminRead(u);
      const state = await config.store.read(),
        collector = state.collectors.find((item) => item.id === req.params.id);
      if (!collector)
        throw new DomainError(
          "COLLECTOR_NOT_FOUND",
          "No encontramos este cobrador.",
          404,
        );
      return mapDataForCollectors(state, [collector.id]);
    },
  );
  describe(
    "get",
    "/api/monitoring/collector/{id}/map-data",
    "Datos geográficos y operativos de un cobrador",
  );
  app.get<{ Params: { id: string } }>(
    "/api/monitoring/route/:id/map-data",
    async (req) => {
      const u = user(req);
      assertAdminRead(u);
      const state = await config.store.read(),
        route = state.routes.find((item) => item.id === req.params.id);
      if (!route)
        throw new DomainError(
          "ROUTE_NOT_FOUND",
          "No encontramos esta ruta.",
          404,
        );
      return mapDataForCollectors(state, [route.collectorId], [route.id]);
    },
  );
  describe(
    "get",
    "/api/monitoring/route/{id}/map-data",
    "Datos geográficos y operativos de una ruta",
  );
  app.get<{ Params: { id: string } }>(
    "/api/monitoring/zone/:id/map-data",
    async (req) => {
      const u = user(req);
      assertAdminRead(u);
      const state = await config.store.read(),
        routes = state.routes.filter((item) => item.zoneId === req.params.id || item.sector === req.params.id);
      if (!routes.length)
        throw new DomainError(
          "ZONE_NOT_FOUND",
          "No encontramos esta zona.",
          404,
        );
      return mapDataForCollectors(
        state,
        routes.map((route) => route.collectorId),
        routes.map((route) => route.id),
      );
    },
  );
  describe(
    "get",
    "/api/monitoring/zone/{id}/map-data",
    "Datos geográficos y operativos de una zona",
  );
  for (const [path, key] of [
    ["/api/cargos", "charges"],
    ["/api/descargos", "payouts"],
    ["/api/clientes", "clients"],
    ["/api/rutas", "routes"],
    ["/api/cuadres", "settlements"],
  ] as const) {
    app.get(
      path,
      async (req) => snapshot(await config.store.read(), user(req))[key],
    );
    describe("get", path, `Consultar ${key}`);
  }
  for (const [path, type] of [
    ["/api/cobros", "collection"],
    ["/api/pagos", "payout"],
  ] as const) {
    app.get(path, async (req) =>
      snapshot(await config.store.read(), user(req)).movements.filter(
        (m) => m.type === type,
      ),
    );
    describe("get", path, `Consultar ${type}`);
  }
  mutate("/api/clientes", "Crear cliente", newClientBody, (s, u, b) => {
    assertAdmin(u);
    if (!s.routes.some((route) => route.id === b.routeId))
      throw new DomainError("ROUTE_NOT_FOUND", "Selecciona una ruta válida.", 404);
    if (s.clients.some((client) => client.code === b.code))
      throw new DomainError("CLIENT_CODE_EXISTS", "El código de cliente ya existe.", 409);
    const client = { id: randomUUID(), active: true, ...b, preferredCurrency: b.preferredCurrency ?? "DOP" };
    s.clients.push(client);
    return client;
  });
  mutate<{ name: string; code: string; phone: string; address: string; routeId: string; preferredCurrency?: LedgerCurrency; alias: string; sector: string; cellular: string; email: string; note: string; identification: string; lat?: number; lng?: number }, { id: string }>(
    "/api/clientes/:id",
    "Actualizar cliente",
    clientBody,
    (s, u, b, params) => {
      assertAdmin(u);
      const current = s.clients.find((client) => client.id === params.id);
      if (!current) throw new DomainError("CLIENT_NOT_FOUND", "Cliente no encontrado.", 404);
      if (!s.routes.some((route) => route.id === b.routeId))
        throw new DomainError("ROUTE_NOT_FOUND", "Selecciona una ruta válida.", 404);
      if (s.clients.some((client) => client.id !== params.id && client.code === b.code))
        throw new DomainError("CLIENT_CODE_EXISTS", "El código de cliente ya existe.", 409);
      Object.assign(current, b);
      return current;
    },
  );
  app.get<{ Params: { id: string } }>("/api/clientes/:id/tragamonedas", async (req) => {
    assertAdminRead(user(req));
    const state = await config.store.read();
    if (!state.clients.some((client) => client.id === req.params.id))
      throw new DomainError("CLIENT_NOT_FOUND", "Cliente no encontrado.", 404);
    return state.clientMachines.filter((machine) => machine.clientId === req.params.id);
  });
  describe("get", "/api/clientes/{id}/tragamonedas", "Máquinas tragamonedas del cliente");
  mutate<{ number: number; entry: string; exit: string; value: number; percentage: number }, { id: string }>(
    "/api/clientes/:id/tragamonedas",
    "Crear máquina tragamonedas del cliente",
    clientMachineBody,
    (s, u, b, params) => {
      assertAdmin(u);
      if (!s.clients.some((client) => client.id === params.id))
        throw new DomainError("CLIENT_NOT_FOUND", "Cliente no encontrado.", 404);
      if (s.clientMachines.some((machine) => machine.clientId === params.id && machine.number === b.number))
        throw new DomainError("MACHINE_NUMBER_EXISTS", "El número de máquina ya existe.", 409);
      const registeredAt = new Date().toISOString();
      const machine = { id: randomUUID(), clientId: params.id, ...b, registeredAt, updatedAt: registeredAt };
      s.clientMachines.push(machine);
      s.clientMachineLogs.push({
        id: randomUUID(), clientId: params.id, machineId: machine.id, registeredAt,
        previousEntry: "", entry: b.entry, entryDifference: b.entry,
        previousExit: "", exit: b.exit, exitDifference: b.exit, difference: "",
        currency: "DOP", amount: b.value, percentage: b.percentage, charge: 0,
      });
      return machine;
    },
  );
  mutate<{ number: number; entry: string; exit: string; value: number; percentage: number }, { id: string; machineId: string }>(
    "/api/clientes/:id/tragamonedas/:machineId",
    "Actualizar máquina tragamonedas del cliente",
    clientMachineBody,
    (s, u, b, params) => {
      assertAdmin(u);
      const machine = s.clientMachines.find((item) => item.id === params.machineId && item.clientId === params.id);
      if (!machine) throw new DomainError("MACHINE_NOT_FOUND", "Máquina tragamonedas no encontrada.", 404);
      if (s.clientMachines.some((item) => item.id !== machine.id && item.clientId === params.id && item.number === b.number))
        throw new DomainError("MACHINE_NUMBER_EXISTS", "El número de máquina ya existe.", 409);
      const entryDifference = Number(b.entry) - Number(machine.entry),
        exitDifference = Number(b.exit) - Number(machine.exit),
        difference = entryDifference - exitDifference,
        charge = b.value * b.percentage / 100;
      if ([entryDifference, exitDifference, difference].some((value) => !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) ||
        !Number.isFinite(charge) || charge < 0 || charge > MAX_MONEY_AMOUNT)
        throw new DomainError("MACHINE_COUNTER_RANGE", "Revisa los contadores actuales y anteriores: las diferencias deben estar dentro del rango seguro. No se guardó la máquina ni su registro.", 422);
      const registeredAt = new Date().toISOString();
      s.clientMachineLogs.push({
        id: randomUUID(), clientId: params.id, machineId: machine.id, registeredAt,
        previousEntry: machine.entry, entry: b.entry, entryDifference: String(entryDifference),
        previousExit: machine.exit, exit: b.exit, exitDifference: String(exitDifference),
        difference: String(difference),
        currency: "DOP", amount: b.value, percentage: b.percentage, charge,
        modifiedAt: registeredAt,
      });
      Object.assign(machine, b, { updatedAt: registeredAt });
      return machine;
    },
  );
  app.get<{ Params: { id: string } }>("/api/clientes/:id/tragamonedas/registros", async (req) => {
    assertAdminRead(user(req));
    const state = await config.store.read();
    if (!state.clients.some((client) => client.id === req.params.id))
      throw new DomainError("CLIENT_NOT_FOUND", "Cliente no encontrado.", 404);
    return state.clientMachineLogs.filter((log) => log.clientId === req.params.id);
  });
  describe("get", "/api/clientes/{id}/tragamonedas/registros", "Historial de máquinas tragamonedas del cliente");
  mutate("/api/cargos", "Crear cargo", chargeBody, (s, u, b) => {
    assertAdmin(u);
    collectorForClient(s, b.clientId);
    const charge = {
      id: randomUUID(),
      ...b,
      collected: 0,
      status: "pending" as const,
    };
    s.charges.push(charge);
    return charge;
  });
  mutate("/api/cargos/:id", "Modificar cargo sin cobros asociados", chargeBody, (s, u, b, params: { id: string }) => {
    assertAdmin(u);
    const charge = s.charges.find((item) => item.id === params.id);
    if (!charge)
      throw new DomainError("NOT_FOUND", "Cargo no encontrado.", 404);
    if (charge.status === "cancelled")
      throw new DomainError("CARGO_CANCELLED", "No se puede modificar un cargo cancelado.", 409);
    if (obligationCurrencyConflict(s, charge, "collection") || s.movements.some((movement) => movement.chargeId === charge.id && ledgerCurrency(movement.currency) !== b.currency))
      throw new DomainError("LEGACY_CURRENCY_RECONCILIATION_REQUIRED", "La autorización tiene movimientos históricos en otra moneda. Requiere revisión administrativa; no se convirtió ni modificó ningún importe.", 409);
    if (charge.collected > 0 || s.movements.some((movement) => movement.type === "collection" && movement.chargeId === charge.id && !movement.cancelledAt))
      throw new DomainError("CARGO_HAS_COLLECTIONS", "No se puede modificar un cargo que ya tiene cobros.", 409);
    collectorForClient(s, b.clientId);
    Object.assign(charge, b);
    return charge;
  });
  mutate(
    "/api/cargos/recurrentes",
    "Generación atómica de cargos recurrentes",
    batchBody,
    (s, u, b) => {
      assertAdmin(u);
      if (new Set(b.clientIds).size !== b.clientIds.length)
        throw new DomainError(
          "DUPLICATE_CLIENT",
          "La selección contiene clientes duplicados.",
        );
      b.clientIds.forEach((clientId) => collectorForClient(s, clientId));
      const charges = b.clientIds.map((clientId) => ({
        id: randomUUID(),
        clientId,
        service: b.service,
        currency: b.currency,
        amount: b.amount,
        dueDate: b.dueDate,
        required: b.required,
        collected: 0,
        status: "pending" as const,
      }));
      s.charges.push(...charges);
      return { charges, count: charges.length };
    },
  );
  mutate(
    "/api/descargos",
    "Autorizar pago a cliente",
    payoutBody,
    (s, u, b) => {
      assertAdmin(u);
      if (collectorForClient(s, b.clientId) !== b.collectorId)
        throw new DomainError(
          "ROUTE_MISMATCH",
          "El cobrador debe pertenecer a la ruta del cliente.",
        );
      const payout = {
        id: randomUUID(),
        ...b,
        dueDate: b.dueDate ?? businessDate(),
        paid: 0,
        status: "pending" as const,
      };
      s.payouts.push(payout);
      return payout;
    },
  );
  for (const [path, type, schema] of [
    [
      "/api/cobros",
      "collection",
      z.object({ chargeId: id, amount: money, currency: currency.optional() }).strict(),
    ],
    [
      "/api/pagos",
      "payout",
      z.object({ payoutId: id, amount: money, currency: currency.optional() }).strict(),
    ],
    ["/api/depositos", "deposit", depositBody],
    ["/api/entregas", "office_delivery", transferBody],
  ] as const) {
    mutate(
      path,
      `Registrar ${type}`,
      schema as z.ZodType<{
        amount: number;
        chargeId?: string;
        payoutId?: string;
        collectorId?: string;
        currency?: LedgerCurrency;
        note?: string;
        denominations?: Array<{ denominacion: number; cantidad: number }>;
        depositComponents?: DepositComponent[];
      }>,
      (s, u, b) => {
        const movement = postMovement(s, u, type, b);
        return {
          movement,
          ...(movement.receiptToken
            ? {
                receipt: {
                  token: movement.receiptToken,
                  url: `${config.collectorUrl}/?receipt=${movement.receiptToken}`,
                },
              }
            : {}),
        };
      },
    );
  }
  mutate(
    "/api/cobros/central",
    "Registrar cobros de un cliente desde administración en una sola operación",
    z.object({
      clientId: id,
      collectorId: id,
      currency: currency.default("DOP"),
      lines: z.array(z.object({ chargeId: id, amount: money }).strict()).min(1).max(100),
    }).strict(),
    (s, u, b) => {
      const movements = createCentralCollections(s, u, b);
      return {
        movements,
        receipts: movements.map((movement) => ({
          movementId: movement.id,
          token: movement.receiptToken!,
          url: `${config.collectorUrl}/?receipt=${movement.receiptToken}`,
        })),
      };
    },
  );
  mutate(
    "/api/pagos/central",
    "Registrar pagos de un cliente desde administración en una sola operación",
    z.object({
      clientId: id,
      collectorId: id,
      currency: currency.default("DOP"),
      lines: z.array(z.object({ payoutId: id, amount: money }).strict()).min(1).max(100),
    }).strict(),
    (s, u, b) => {
      const movements = createCentralPayments(s, u, b);
      return {
        movements,
        receipts: movements.map((movement) => ({
          movementId: movement.id,
          token: movement.receiptToken!,
          url: `${config.collectorUrl}/?receipt=${movement.receiptToken}`,
        })),
      };
    },
  );
  const movementCancellationBody = z.object({ reason: freeText(500, 1) }).strict();
  for (const [path, type] of [
    ["/api/cobros/:id/cancelar", "collection"],
    ["/api/pagos/:id/cancelar", "payout"],
    ["/api/entregas/:id/cancelar", "office_delivery"],
  ] as const) {
    mutate(path, `Anular ${type} de la jornada actual`, movementCancellationBody, (s, u, b, params) => {
      const movement = cancelMovement(s, u, params.id, type, b.reason);
      return { ...movement, receiptToken: undefined };
    });
  }
  app.get("/api/configuracion", async (req) => {
    assertAdminRead(user(req));
    return { config: (await config.store.read()).systemConfig ?? {} };
  });
  describe("get", "/api/configuracion", "Configuración general del sistema");
  mutate(
    "/api/configuracion",
    "Guardar configuración general",
    z.object({ config: systemConfigInput }).strict(),
    (s, u, b) => saveSystemConfigData(s, u, b.config),
  );
  app.get<{ Params: { id: string } }>(
    "/api/clientes/:id/estado",
    async (req) =>
      clientStatement(await config.store.read(), user(req), req.params.id),
  );
  describe(
    "get",
    "/api/clientes/{id}/estado",
    "Estado de cuenta del cliente (cargos, cobros, autorizaciones y pagos)",
  );
  const depositLifecycleBody = z.object({}).strict();
  const depositAcceptBody = z
    .object({
      desglose: z
        .array(
          z.object({ denominacion: z.number(), cantidad: z.number() }).strict(),
        )
        .max(100, "El desglose admite hasta 100 filas.")
        .optional(),
    })
    .strict();
  mutate(
    "/api/depositos/:id/aceptar",
    "Aceptar depósito de cobrador",
    depositAcceptBody,
    (s, u, b, params) => acceptDeposit(s, u, params.id, b.desglose),
  );
  mutate(
    "/api/depositos/:id/cancelar",
    "Cancelar depósito de cobrador",
    depositLifecycleBody,
    (s, u, _body, params) => cancelDeposit(s, u, params.id),
  );
  const importChargeRow = z
    .object({
      identificacion: singleLine(80, 1),
      servicio: singleLine(160, 1),
      importe: z.number(),
      fecha: z.iso.date().optional(),
      requerido: z.boolean().optional(),
      moneda: currency.optional(),
    })
    .strict();
  const importPayoutRow = z
    .object({
      identificacion: singleLine(80, 1),
      concepto: singleLine(160, 1),
      importe: z.number(),
      cobrador: singleLine(80, 1).optional(),
      moneda: currency.optional(),
    })
    .strict();
  mutate(
    "/api/cargos/importar",
    "Importación masiva de cargos",
    z.object({ filas: z.array(importChargeRow).min(1).max(1000) }).strict(),
    (s, u, b) => importCharges(s, u, b.filas),
  );
  mutate(
    "/api/descargos/importar",
    "Importación masiva de descargos",
    z.object({ filas: z.array(importPayoutRow).min(1).max(1000) }).strict(),
    (s, u, b) => importPayouts(s, u, b.filas),
  );
  mutate(
    "/api/descargos-recurrentes",
    "Crear descargo recurrente",
    z
      .object({
        clientId: id,
        concept: text,
        amount: money,
        currency: currency.default("DOP"),
        frequency: z.enum(["weekly", "monthly", "quarterly"]),
        nextRunDate: date,
      })
      .strict(),
    (s, u, b) => createRecurringPayout(s, u, b),
  );
  mutate(
    "/api/descargos-recurrentes/:id",
    "Modificar o archivar descargo recurrente",
    z
      .object({
        concept: text.optional(),
        amount: money.optional(),
        currency: currency.optional(),
        frequency: z.enum(["weekly", "monthly", "quarterly"]).optional(),
        nextRunDate: date.optional(),
        status: z.enum(["active", "paused", "archived"]).optional(),
      })
      .strict(),
    (s, u, b, params) => updateRecurringPayout(s, u, params.id, b),
  );
  app.get("/api/cuadres/preview", async (req) => {
    const q = z.object({ collectorId: id, date, currency: currency.default("DOP") }).parse(req.query);
    assertCollectorReadAccess(user(req), q.collectorId);
    const s = await config.store.read();
    if (!s.collectors.some((c) => c.id === q.collectorId))
      throw new DomainError("NOT_FOUND", "Cobrador no encontrado.", 404);
    return preview(s, q.collectorId, q.date, q.currency);
  });
  describe(
    "get",
    "/api/cuadres/preview",
    "Calcular cuadre desde el libro de movimientos",
  );
  (paths["/api/cuadres/preview"].get as Record<string, unknown>).parameters = [
    {
      in: "query",
      name: "collectorId",
      required: true,
      schema: { type: "string" },
    },
    {
      in: "query",
      name: "date",
      required: true,
      schema: { type: "string", format: "date" },
    },
  ];
  mutate(
    "/api/cuadres",
    "Cerrar jornada con diferencia cero",
    z.object({ collectorId: id, date }).strict(),
    (s, u, b) => closeDay(s, u, b.collectorId, b.date),
  );
  app.get(
    "/api/tracking",
    async (req) => snapshot(await config.store.read(), user(req)).collectors,
  );
  describe("get", "/api/tracking", "Posiciones y estado de cobradores");
  const trackingBody = z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .strict();
  app.post("/api/tracking", async (req) => {
    const b = trackingBody.parse(req.body),
      u = user(req);
    if (u.role !== "collector" || !u.collectorId)
      throw new DomainError(
        "FORBIDDEN",
        "Solo un cobrador puede compartir su ubicación.",
        403,
      );
    return config.store.transaction((s) => {
      const c = s.collectors.find((c) => c.id === u.collectorId);
      if (!c)
        throw new DomainError("NOT_FOUND", "Cobrador no encontrado.", 404);
      Object.assign(c, b, {
        lastSeen: new Date().toISOString(),
        status: "active",
      });
      return { ok: true };
    });
  });
  describe(
    "post",
    "/api/tracking",
    "Compartir ubicación voluntariamente",
    trackingBody,
  );
  (paths["/api/tracking"].post as Record<string, unknown>).parameters = [];
  const receipt = async (token: string) => {
    if (!/^[A-Za-z0-9_-]{32}$/.test(token))
      throw new DomainError("NOT_FOUND", "Recibo no disponible.", 404);
    const s = await config.store.read(),
      m = s.movements.find(
        (m) => m.receiptToken === token && !m.receiptRevoked && !m.cancelledAt,
      );
    if (!m) throw new DomainError("NOT_FOUND", "Recibo no disponible.", 404);
    return {
      id: m.id,
      clientName: s.clients.find((c) => c.id === m.clientId)?.name ?? "Cliente",
      collectorName:
        s.collectors.find((c) => c.id === m.collectorId)?.name ?? "Cobrador",
      concept: m.chargeId
        ? (s.charges.find((c) => c.id === m.chargeId)?.concept || s.charges.find((c) => c.id === m.chargeId)?.service || "Cobro")
        : (s.payouts.find((p) => p.id === m.payoutId)?.concept ?? "Pago"),
      amount: m.amount,
      currency: ledgerCurrency(m.currency),
      businessDate: businessDate(new Date(m.createdAt)),
      createdAt: m.createdAt,
      type: m.type,
    };
  };
  app.get<{ Params: { token: string } }>("/api/recibos/:token", (req) =>
    receipt(req.params.token),
  );
  describe(
    "get",
    "/api/recibos/:token",
    "Recibo compartible mínimo",
    undefined,
    true,
  );
  app.get<{ Params: { token: string } }>(
    "/api/recibos/:token/escpos",
    async (req, reply) => {
      const q = z
          .object({ width: z.enum(["58", "80"]).default("58") })
          .parse(req.query),
        r = await receipt(req.params.token),
        cols = q.width === "58" ? 32 : 48;
      const clean = (t: string) =>
        t
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^\x20-\x7E]/g, "")
          .match(new RegExp(`.{1,${cols}}`, "g"))
          ?.join("\n") ?? "";
      const symbol = r.currency === "DOP" ? "RD$" : r.currency;
      const body = `COBROS Y PAGOS\nRecibo operacional\n${"-".repeat(cols)}\n${clean(r.clientName)}\n${clean(r.concept)}\n${symbol} ${(r.amount / 100).toFixed(2)}\n${clean(r.collectorName)}\n${r.businessDate}\n${clean(r.id)}\nNo es comprobante fiscal\n\n\n`;
      return reply
        .header(
          "Content-Disposition",
          `attachment; filename="recibo-${q.width}mm.bin"`,
        )
        .type("application/octet-stream")
        .send(
          Buffer.concat([
            Buffer.from([0x1b, 0x40, 0x1b, 0x74, 0]),
            Buffer.from(body, "ascii"),
            Buffer.from([0x1d, 0x56, 0x00]),
          ]),
        );
    },
  );
  describe(
    "get",
    "/api/recibos/:token/escpos",
    "ESC/POS 58/80 mm para puente local",
    undefined,
    true,
  );
  app.post<{ Params: { token: string } }>(
    "/api/recibos/:token/revocar",
    async (req) => {
      assertAdmin(user(req));
      return config.store.transaction((s) => {
        const m = s.movements.find((m) => m.receiptToken === req.params.token);
        if (!m)
          throw new DomainError("NOT_FOUND", "Recibo no encontrado.", 404);
        m.receiptRevoked = true;
        return { ok: true };
      });
    },
  );
  describe("post", "/api/recibos/:token/revocar", "Revocar enlace de recibo");
  (
    paths["/api/recibos/{token}/revocar"].post as Record<string, unknown>
  ).parameters = [
    { in: "path", name: "token", required: true, schema: { type: "string" } },
  ];
  const cancelBody = z.object({ id, reason: freeText(500).default("") }).strict();
  for (const [path, key] of [
    ["/api/cargos/cancelar", "charges"],
    ["/api/descargos/cancelar", "payouts"],
  ] as const) {
    mutate(
      path,
      "Cancelar autorización sin movimientos",
      cancelBody,
      (s, u, b) => {
        assertAdmin(u);
        const item = s[key].find((i) => i.id === b.id);
        if (!item)
          throw new DomainError("NOT_FOUND", "Registro no encontrado.", 404);
        if (("collected" in item ? item.collected : item.paid) > 0)
          throw new DomainError(
            "HAS_MOVEMENTS",
            "Un registro con movimientos no puede cancelarse.",
            409,
          );
        item.status = "cancelled";
        if ("collected" in item) item.cancelReason = b.reason;
        return item;
      },
    );
  }
  registerCatalogRoutes(app, config.store, user, mutate, describe);
  registerAdminToolsRoutes(app, config.store, user, mutate, describe, config.publicWeb ? undefined : config.rraa);
  registerRemittanceRoutes(app, config.store, user, mutate, describe, config.demo ? [
    { id: "demo-admin", name: "Administración", role: "admin" },
    { id: "demo-collector", name: "Cobrador", role: "collector", collectorId: "col-1" },
  ] : [{ id: "configured-admin", name: "Administración", role: "admin" }]);
  app.get("/api/openapi.json", () => ({
    openapi: "3.1.0",
    info: {
      title: "Cobros y Pagos API",
      version: "0.1.0",
      description:
        "Cobros en centavos DOP; envíos con caja separada DOP/USD/EUR. Idempotency-Key requerido en operaciones financieras.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    paths,
  }));
  app.addHook("onClose", async () => config.store.close());
  return app;
}
