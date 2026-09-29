import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

export type DemoAccessConfig = { code: string; origin: string };
const cookieName = "__Host-cyp-demo";
const lifetime = 8 * 60 * 60;
const digest = (value: string) => createHash("sha256").update(value).digest();

function page(error = false) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Acceso a la demo · CyP</title><style>body{font:16px system-ui;background:#eef2f7;color:#17283b;display:grid;place-items:center;min-height:100vh;margin:0}main{background:white;border:1px solid #d7e0ea;border-radius:12px;padding:32px;max-width:400px;margin:20px;box-shadow:0 12px 40px #17283b12}h1{font-size:24px}p{line-height:1.5;color:#526176}label{display:block;font-weight:600}input{box-sizing:border-box;width:100%;padding:12px;margin:8px 0 18px;border:1px solid #95a4b7;border-radius:6px;font:inherit}button{background:#145daa;color:white;border:0;border-radius:6px;padding:12px;width:100%;font:inherit;cursor:pointer}.error{color:#a61d24}</style></head><body><main><h1>Demo de Cobros y Pagos</h1><p>Introduce el código de invitación que te compartieron. Después podrás entrar al programa con el usuario de prueba.</p>${error ? '<p class="error" role="alert">Código incorrecto. Comprueba tu invitación.</p>' : ''}<form method="post" action="/demo-access"><label for="code">Código de invitación</label><input id="code" name="code" type="password" required maxlength="256" autocomplete="off"><button type="submit">Entrar a la demo</button></form><p>Entorno compartido de pruebas. Utiliza únicamente datos ficticios.</p></main></body></html>`;
}

export async function registerDemoAccess(app: FastifyInstance, config: DemoAccessConfig) {
  if (config.code.length < 32 || config.code.length > 256)
    throw new Error("DEMO_ACCESS_CODE must contain between 32 and 256 characters.");
  const origin = new URL(config.origin).origin;
  if (!origin.startsWith("https://")) throw new Error("The public demo requires HTTPS.");
  const sign = (expiry: string) => createHmac("sha256", config.code).update(`cyp-demo:${expiry}`).digest("base64url");
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Robots-Tag", "noindex, nofollow");
    // Native form POSTs need their real Origin for the exact-origin check below.
    if (request.url.split("?")[0] === "/demo-access")
      reply.header("Referrer-Policy", "same-origin");
    return payload;
  });
  const validCookie = (header: string | undefined) => {
    const raw = (header ?? "").split(";").map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!raw || raw.length > 128) return false;
    const [expiry, signature, extra] = raw.split(".");
    if (!expiry || !signature || extra || !/^\d{10}$/.test(expiry)) return false;
    const seconds = Math.floor(Date.now() / 1000);
    if (Number(expiry) <= seconds || Number(expiry) > seconds + lifetime) return false;
    return timingSafeEqual(digest(signature), digest(sign(expiry)));
  };
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 1024 }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (request.method === "GET" && path === "/api/health") return;
    if (path === "/demo-access" && (request.method === "GET" || request.method === "POST")) return;
    if (validCookie(request.headers.cookie)) return;
    reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex, nofollow");
    if (path.startsWith("/api/")) return reply.code(401).send({ error: { code: "DEMO_INVITATION_REQUIRED", message: "Abre la demo e introduce tu código de invitación." } });
    return reply.code(303).redirect("/demo-access");
  });
  app.get("/demo-access", async (_request, reply) => reply.type("text/html").send(page()));
  app.post("/demo-access", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, bodyLimit: 1024 }, async (request, reply) => {
    if (request.headers.origin !== origin) return reply.code(403).send("Solicitud no válida.");
    const code = (request.body as { code?: unknown } | null)?.code;
    if (typeof code !== "string" || !timingSafeEqual(digest(code), digest(config.code)))
      return reply.code(401).type("text/html").send(page(true));
    const expiry = String(Math.floor(Date.now() / 1000) + lifetime);
    reply.header("Set-Cookie", `${cookieName}=${expiry}.${sign(expiry)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${lifetime}`);
    return reply.code(303).redirect("/");
  });
}
