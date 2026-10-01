import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { runInNewContext } from "node:vm";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { seed } from "../src/seed.js";
import { registerPublicWeb } from "../src/public-web.js";

const origin = "https://demo.example.test";
const code = "test-only-invitation-with-more-than-32-characters";
async function setup() {
  const app = await buildApp({ store: new MemoryStore(seed()), secret: "test-only-secret-with-more-than-32-characters", demo: true, publicWeb: true, demoAccess: { code, origin }, origins: [origin], collectorUrl: origin + "/collector" });
  await registerPublicWeb(app);
  return app;
}
test("public demo protects static pages, login, schema and receipts before invitation", async () => {
  const app = await setup();
  try {
    assert.equal((await app.inject("/api/health")).statusCode, 200);
    const invitationPage = await app.inject("/demo-access");
    assert.equal(invitationPage.headers["referrer-policy"], "same-origin");
    assert.equal((await app.inject("/api/health")).headers["referrer-policy"], "no-referrer");
    for (const url of ["/", "/collector/", "/assets/file.js", "/%61pi/snapshot"]) {
      const response = await app.inject(url);
      assert.equal(response.statusCode, 303); assert.equal(response.headers.location, "/demo-access");
    }
    for (const url of ["/api/snapshot", "/api/openapi.json", "/api/recibos/example"])
      assert.equal((await app.inject(url)).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } })).statusCode, 401);
  } finally { await app.close(); }
});

test("invitation script is public only at its exact GET path and keeps the page CSP", async () => {
  const app = await setup();
  try {
    const page = await app.inject("/demo-access");
    assert.match(page.body, /<script src="\/demo-access\.js" defer><\/script>/);
    assert.match(page.body, /id="demo-access-form" method="post" action="\/demo-access"/);
    assert.match(page.body, /id="demo-access-feedback"[^>]*role="alert"/);
    const scriptPolicy = String(page.headers["content-security-policy"]).split(";").find(directive => directive.trim().startsWith("script-src "));
    assert.ok(scriptPolicy?.includes("'self'"));
    assert.ok(!scriptPolicy.includes("'unsafe-inline'"));
    for (const url of ["/demo-access.js", "/demo-access.js?v=1"]) {
      const response = await app.inject(url);
      assert.equal(response.statusCode, 200);
      assert.match(String(response.headers["content-type"]), /^application\/javascript/);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.headers["x-robots-tag"], "noindex, nofollow");
      assert.ok(!response.body.includes(code));
      assert.doesNotMatch(response.body, /localStorage|sessionStorage|document\.cookie|console\./);
      assert.equal(response.headers["set-cookie"], undefined);
    }
    for (const method of ["POST", "HEAD"] as const) {
      const response = await app.inject({ method, url: "/demo-access.js" });
      assert.equal(response.statusCode, 303);
      assert.equal(response.headers.location, "/demo-access");
    }
    for (const url of ["/demo-access.js/", "/demo-access.jsx", "/%64emo-access.js"]) {
      const response = await app.inject(url);
      assert.equal(response.statusCode, 303);
      assert.equal(response.headers.location, "/demo-access");
    }
  } finally { await app.close(); }
});

test("JSON invitation rejects invalid origins and codes before issuing the secure cookie", async () => {
  const app = await setup();
  try {
    const request = (value: string, requestOrigin?: string) => app.inject({
      method: "POST", url: "/demo-access",
      headers: { ...(requestOrigin === undefined ? {} : { origin: requestOrigin }), accept: "application/json", "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      payload: new URLSearchParams({ code: value }).toString(),
    });
    for (const requestOrigin of [undefined, "null", "https://other.example.test"]) {
      const rejected = await request(code, requestOrigin);
      assert.equal(rejected.statusCode, 403);
      assert.equal(rejected.json().error.code, "DEMO_ORIGIN_INVALID");
      assert.equal(rejected.headers["set-cookie"], undefined);
      assert.equal(rejected.headers["cache-control"], "no-store");
      assert.equal(rejected.headers["x-robots-tag"], "noindex, nofollow");
      assert.ok(!rejected.body.includes(code));
    }
    const wrong = await request("wrong", origin);
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.json().error.code, "DEMO_INVITATION_INVALID");
    assert.equal(wrong.headers["set-cookie"], undefined);
    assert.equal(wrong.headers["referrer-policy"], "same-origin");
    const invited = await request(code, origin);
    assert.equal(invited.statusCode, 200);
    assert.deepEqual(invited.json(), { ok: true });
    assert.equal(invited.headers.location, undefined);
    assert.equal(invited.headers["cache-control"], "no-store");
    assert.equal(invited.headers["x-robots-tag"], "noindex, nofollow");
    const setCookie = String(invited.headers["set-cookie"]);
    for (const flag of ["__Host-cyp-demo=", "Secure", "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=28800"]) assert.ok(setCookie.includes(flag));
    assert.ok(!setCookie.includes(code));
    const cookie = setCookie.split(";")[0];
    const snapshot = await app.inject({ url: "/api/snapshot", headers: { cookie } });
    assert.equal(snapshot.statusCode, 401);
    assert.notEqual(snapshot.json().error?.code, "DEMO_INVITATION_REQUIRED");
  } finally { await app.close(); }
});

test("invitation script validates, prevents duplicate submits and displays failures before retry", async () => {
  const app = await setup();
  try {
    const script = (await app.inject("/demo-access.js")).body;
    const button = { disabled: false, textContent: "Entrar a la demo" };
    const feedback = { className: "", textContent: "" };
    const attributes: Record<string, string> = {};
    let valid = false, resets = 0, navigated = "", calls = 0;
    let submit: ((event: { preventDefault(): void }) => Promise<void>) | undefined;
    const form = {
      querySelector: () => button, reportValidity: () => valid,
      setAttribute: (key: string, value: string) => { attributes[key] = value; },
      reset: () => { resets += 1; },
      addEventListener: (_type: string, listener: typeof submit) => { submit = listener; },
    };
    let finishFirst: (response: unknown) => void = () => { throw new Error("No pending request"); };
    runInNewContext(script, {
      document: { getElementById: (id: string) => id === "demo-access-form" ? form : feedback },
      window: { location: { assign: (url: string) => { navigated = url; } } },
      URLSearchParams,
      FormData: class extends Map<string, string> { constructor() { super([["code", "synthetic-input"]]); } },
      fetch: async (url: string, options: { method: string; credentials: string; headers: Record<string, string>; body: URLSearchParams }) => {
        calls += 1;
        assert.equal(url, "/demo-access"); assert.equal(options.method, "POST");
        assert.equal(options.credentials, "same-origin"); assert.equal(options.headers.Accept, "application/json");
        assert.equal(options.body.get("code"), "synthetic-input");
        if (calls === 1) return new Promise(resolve => { finishFirst = resolve; });
        if (calls === 2) throw new Error("synthetic network failure");
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    });
    assert.ok(submit);
    const event = { preventDefault() {} };
    await submit(event); assert.equal(calls, 0);
    valid = true;
    const first = submit(event);
    assert.equal(button.disabled, true); assert.equal(attributes["aria-busy"], "true");
    await submit(event); assert.equal(calls, 1);
    finishFirst({ ok: false, status: 401, json: async () => ({ error: { code: "DEMO_INVITATION_INVALID" } }) });
    await first;
    assert.match(feedback.textContent, /Código incorrecto/);
    assert.equal(button.disabled, false); assert.equal(attributes["aria-busy"], "false");
    await submit(event);
    assert.match(feedback.textContent, /No se pudo conectar/);
    assert.equal(button.disabled, false); assert.equal(navigated, "");
    await submit(event);
    assert.equal(navigated, "/"); assert.equal(resets, 1); assert.equal(calls, 3);
  } finally { await app.close(); }
});
test("invitation uses secure signed cookie and still requires application login", async () => {
  const app = await setup();
  try {
    const request = (value: string, requestOrigin = origin) => app.inject({ method: "POST", url: "/demo-access", headers: { origin: requestOrigin, "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams({ code: value }).toString() });
    assert.equal((await request(code, "https://other.example.test")).statusCode, 403);
    assert.equal((await request(code, "null")).statusCode, 403);
    const wrong = await request("wrong"); assert.equal(wrong.statusCode, 401); assert.ok(!wrong.body.includes(code));
    assert.equal(wrong.headers["referrer-policy"], "same-origin");
    const invited = await request(code); assert.equal(invited.statusCode, 303);
    const setCookie = String(invited.headers["set-cookie"]);
    for (const flag of ["Secure", "HttpOnly", "SameSite=Strict", "Path=/"]) assert.ok(setCookie.includes(flag));
    assert.ok(!setCookie.includes(code));
    const cookie = setCookie.split(";")[0];
    assert.equal((await app.inject({ url: "/api/snapshot", headers: { cookie } })).statusCode, 401);
    assert.equal((await app.inject({ url: "/%61pi/snapshot", headers: { cookie } })).statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { cookie }, payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
    assert.equal(login.statusCode, 200);
    assert.equal((await app.inject({ url: "/api/snapshot", headers: { cookie, authorization: `Bearer ${login.json().token}` } })).statusCode, 200);
    assert.equal((await app.inject({ url: "/api/snapshot", headers: { cookie: cookie + "x", authorization: `Bearer ${login.json().token}` } })).statusCode, 401);
    for (const offset of [-1, 9 * 60 * 60]) {
      const expiry = String(Math.floor(Date.now() / 1000) + offset);
      const signature = createHmac("sha256", code).update(`cyp-demo:${expiry}`).digest("base64url");
      assert.equal((await app.inject({ url: "/api/snapshot", headers: { cookie: `__Host-cyp-demo=${expiry}.${signature}`, authorization: `Bearer ${login.json().token}` } })).statusCode, 401);
    }
  } finally { await app.close(); }
});
