import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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
