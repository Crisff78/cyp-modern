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
import {
  acceptDeposit,
  assertAdmin,
  assertCollectorAccess,
  businessDate,
  cancelDeposit,
  closeDay,
  createRecurringPayout,
  collectorForClient,
  DomainError,
  findAccount,
  hashPassword,
  importCharges,
  importPayouts,
  postMovement,
  preview,
  publicAccount,
  snapshot,
  updateRecurringPayout,
  verifyPassword,
  type Account,
  type State,
  type User,
} from "./domain.js";
import type { Store } from "./store.js";

type Config = {
  store: Store;
  secret: string;
  demo: boolean;
  origins: string[];
  collectorUrl: string;
  adminEmail?: string;
  adminPassword?: string;
};
const money = z.number().int().positive().max(1_000_000_000);
const id = z.string().min(1).max(80),
  text = z.string().trim().min(1).max(160),
  date = z.iso.date();
const chargeBody = z
  .object({
    clientId: id,
    service: text,
    amount: money,
    dueDate: date,
    required: z.boolean().default(false),
  })
  .strict();
const batchBody = chargeBody
  .omit({ clientId: true })
  .extend({ clientIds: z.array(id).min(1).max(100) });
const payoutBody = z
  .object({ clientId: id, collectorId: id, concept: text, amount: money })
  .strict();
const transferBody = z.object({ collectorId: id, amount: money }).strict();
const loginBody = z
  .object({
    email: z.string().trim().min(1).max(200),
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
  await app.register(helmet, { referrerPolicy: { policy: "no-referrer" } });
  await app.register(jwt, { secret: config.secret });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
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
  });
  const user = (req: FastifyRequest) => req.user as User;
  const paths: Record<string, Record<string, unknown>> = {};
  const describe = (
    method: string,
    path: string,
    summary: string,
    schema?: z.ZodType,
    publicAccess = false,
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
        ...(method === "post" && !publicAccess
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
                "application/json": { schema: z.toJSONSchema(schema) },
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
    app.post(path, async (req) => {
      const body = schema.parse(req.body),
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
      return config.store.transaction((state) => {
        const existing = state.idempotency.find((i) => i.id === scope);
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw new DomainError(
              "IDEMPOTENCY_CONFLICT",
              "Esta clave ya se usó para otra operación.",
              409,
            );
          return existing.response;
        }
        const response = fn(state, u, body, (req.params ?? {}) as P);
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
            name: "Ana Martínez",
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
      return {
        token: app.jwt.sign({ ...u, authVersion: version }, { expiresIn: "8h" }),
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
    .min(12, "La contraseña debe tener al menos 12 caracteres.")
    .max(200);
  const accountBody = z
    .object({
      name: text,
      email: emailField,
      role: z.enum(["admin", "collector"]),
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
    assertAdmin(user(req));
    return (await config.store.read()).accounts.map(publicAccount);
  });
  describe("get", "/api/usuarios", "Cuentas provisionadas (sin secretos)");
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
        !state.collectors.some((c) => c.id === body.collectorId)
      )
        throw new DomainError(
          "NOT_FOUND",
          "El cobrador seleccionado no existe.",
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
      return publicAccount(account);
    },
  );
  app.get("/api/snapshot", async (req) =>
    snapshot(await config.store.read(), user(req)),
  );
  describe("get", "/api/snapshot", "Vista operacional autorizada");

  const moneyUnits = (value: number) => Number((value / 100).toFixed(2));
  const stopCoordinates = (lat: number, lng: number, index: number) => ({
    lat: Number((lat + 0.003 + index * 0.0017).toFixed(6)),
    lng: Number((lng + 0.002 - index * 0.0013).toFixed(6)),
  });
  const mapDataForCollectors = (state: State, collectorIds: string[]) => {
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
        collectors.some((collector) => {
          const route = state.routes.find((item) => item.id === client.routeId);
          return route?.collectorId === collector.id;
        }),
      );
    const stops = clients.map((client, index) => {
      const charge = state.charges.find((item) => item.clientId === client.id),
        route = state.routes.find((item) => item.id === client.routeId),
        routeCollector =
          collectors.find((collector) => collector.id === route?.collectorId) ??
          primary,
        coords = stopCoordinates(routeCollector.lat, routeCollector.lng, index);
      return {
        id: `pcp-${client.id}`,
        order: index + 1,
        client_name: client.name,
        lat: coords.lat,
        lng: coords.lng,
        amount_due: moneyUnits(
          (charge?.amount ?? 0) - (charge?.collected ?? 0),
        ),
        status: charge?.status ?? "pending",
        obligated: Boolean(charge?.required),
      };
    });
    return {
      collector: {
        id: primary.id,
        name: primary.name,
        phone: clients[0]?.phone ?? "809-555-0101",
        lat: primary.lat,
        lng: primary.lng,
        cash_in_hand: moneyUnits(preview(state, primary.id).difference),
        collection_limit: moneyUnits(primary.collectionLimit),
        payout_limit: moneyUnits(primary.payoutLimit),
        last_ping: primary.lastSeen,
      },
      stops,
      route_geometry: null,
    };
  };
  app.get<{ Params: { id: string } }>(
    "/api/monitoring/collector/:id/map-data",
    async (req) => {
      const u = user(req);
      assertAdmin(u);
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
      assertAdmin(u);
      const state = await config.store.read(),
        route = state.routes.find((item) => item.id === req.params.id);
      if (!route)
        throw new DomainError(
          "ROUTE_NOT_FOUND",
          "No encontramos esta ruta.",
          404,
        );
      return mapDataForCollectors(state, [route.collectorId]);
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
      assertAdmin(u);
      const state = await config.store.read(),
        routes = state.routes.filter((item) => item.sector === req.params.id);
      if (!routes.length)
        throw new DomainError(
          "ZONE_NOT_FOUND",
          "No encontramos esta zona.",
          404,
        );
      return mapDataForCollectors(
        state,
        routes.map((route) => route.collectorId),
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
      z.object({ chargeId: id, amount: money }).strict(),
    ],
    [
      "/api/pagos",
      "payout",
      z.object({ payoutId: id, amount: money }).strict(),
    ],
    ["/api/depositos", "deposit", transferBody],
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
  const depositLifecycleBody = z.object({}).strict();
  mutate(
    "/api/depositos/:id/aceptar",
    "Aceptar depósito de cobrador",
    depositLifecycleBody,
    (s, u, _body, params) => acceptDeposit(s, u, params.id),
  );
  mutate(
    "/api/depositos/:id/cancelar",
    "Cancelar depósito de cobrador",
    depositLifecycleBody,
    (s, u, _body, params) => cancelDeposit(s, u, params.id),
  );
  const importChargeRow = z
    .object({
      identificacion: z.string().trim().min(1).max(80),
      servicio: z.string().trim().min(1).max(160),
      importe: z.number(),
      fecha: z.iso.date().optional(),
      requerido: z.boolean().optional(),
    })
    .strict();
  const importPayoutRow = z
    .object({
      identificacion: z.string().trim().min(1).max(80),
      concepto: z.string().trim().min(1).max(160),
      importe: z.number(),
      cobrador: z.string().trim().min(1).max(80).optional(),
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
        frequency: z.enum(["weekly", "monthly", "quarterly"]).optional(),
        nextRunDate: date.optional(),
        status: z.enum(["active", "paused", "archived"]).optional(),
      })
      .strict(),
    (s, u, b, params) => updateRecurringPayout(s, u, params.id, b),
  );
  app.get("/api/cuadres/preview", async (req) => {
    const q = z.object({ collectorId: id, date }).parse(req.query);
    assertCollectorAccess(user(req), q.collectorId);
    const s = await config.store.read();
    if (!s.collectors.some((c) => c.id === q.collectorId))
      throw new DomainError("NOT_FOUND", "Cobrador no encontrado.", 404);
    return preview(s, q.collectorId, q.date);
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
        (m) => m.receiptToken === token && !m.receiptRevoked,
      );
    if (!m) throw new DomainError("NOT_FOUND", "Recibo no disponible.", 404);
    return {
      id: m.id,
      clientName: s.clients.find((c) => c.id === m.clientId)?.name ?? "Cliente",
      collectorName:
        s.collectors.find((c) => c.id === m.collectorId)?.name ?? "Cobrador",
      concept: m.chargeId
        ? (s.charges.find((c) => c.id === m.chargeId)?.service ?? "Cobro")
        : (s.payouts.find((p) => p.id === m.payoutId)?.concept ?? "Pago"),
      amount: m.amount,
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
      const body = `COBROS Y PAGOS\nRecibo operacional\n${"-".repeat(cols)}\n${clean(r.clientName)}\n${clean(r.concept)}\nRD$ ${(r.amount / 100).toFixed(2)}\n${clean(r.collectorName)}\n${r.createdAt.slice(0, 10)}\n${clean(r.id)}\nNo es comprobante fiscal\n\n\n`;
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
  const cancelBody = z.object({ id }).strict();
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
        return item;
      },
    );
  }
  app.get("/api/openapi.json", () => ({
    openapi: "3.1.0",
    info: {
      title: "Cobros y Pagos API",
      version: "0.1.0",
      description:
        "Centavos enteros DOP. Sin impuestos ni amortización. Idempotency-Key requerido en operaciones financieras.",
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
