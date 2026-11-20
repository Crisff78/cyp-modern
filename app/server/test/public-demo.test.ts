import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";
import { registerPublicWeb } from "../src/public-web.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";

// The public demo, as Render serves it: the two portals and the API under one address. Until 20-11-2026 a code of
// invitation was asked for before anything else; Rardiel had it removed. What protects the demo now is the sign-in.
const origin = "https://demo.example.test";
async function setup() {
  const app = await buildApp({ store: new MemoryStore(seed()), secret: "test-only-secret-with-more-than-32-characters", demo: true, publicWeb: true,
    publicOrigin: origin, origins: [origin], collectorUrl: origin + "/collector" });
  await registerPublicWeb(app);
  return app;
}

test("public demo: nothing asks for an invitation, and what needs a session still needs it", async () => {
  const app = await setup();
  try {
    // The pages are served as they are (200 with the builds in dist, 404 without them): never a redirection to a gate.
    for (const url of ["/", "/collector/", "/assets/file.js", "/demo-access"]) {
      const response = await app.inject(url);
      assert.ok([200, 404].includes(response.statusCode), `${url}: ${response.statusCode}`);
      assert.equal(response.headers.location, undefined, url);
    }
    // The form of the invitation and its script are gone.
    assert.equal((await app.inject("/demo-access.js")).statusCode, 404);
    const posted = await app.inject({ method: "POST", url: "/demo-access", headers: { origin, "content-type": "application/json" }, payload: { code: "lo-que-sea" } });
    assert.ok([401, 404].includes(posted.statusCode), String(posted.statusCode));
    assert.equal(posted.headers["set-cookie"], undefined);
    // What every installation shows without a session.
    assert.equal((await app.inject("/api/health")).statusCode, 200);
    assert.equal((await app.inject("/api/openapi.json")).statusCode, 200);
    const stations = await app.inject("/api/auth/estaciones");
    assert.equal(stations.statusCode, 200); assert.ok(Array.isArray(stations.json()));
    assert.equal((await app.inject("/api/recibos/example")).statusCode, 404);
    // Everything else asks for the session, also by an encoded path.
    for (const url of ["/api/snapshot", "/%61pi/snapshot", "/api/estaciones", "/api/usuarios"]) {
      const response = await app.inject(url);
      assert.equal(response.statusCode, 401, url); assert.equal(response.json().error.code, "UNAUTHORIZED", url);
    }
    assert.equal((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "otra-clave-ficticia" } })).statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: DEMO_PASSWORD } });
    assert.equal(login.statusCode, 200);
    assert.equal((await app.inject({ url: "/api/snapshot", headers: { authorization: `Bearer ${login.json().token}` } })).statusCode, 200);
    assert.equal((await app.inject({ url: "/%61pi/snapshot", headers: { authorization: `Bearer ${login.json().token}` } })).statusCode, 200);
  } finally { await app.close(); }
});

test("public demo: search engines are asked to leave it out, and the pages keep their policies", async () => {
  const app = await setup();
  try {
    // A page, a static file, the API with and without a session, a petition of the text protocol and what does not exist.
    for (const url of ["/", "/assets/file.js", "/api/health", "/api/snapshot", "/cyp_noexiste", "/no/existe"])
      assert.equal((await app.inject(url)).headers["x-robots-tag"], "noindex, nofollow", url);
    const page = await app.inject("/");
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal(page.headers["referrer-policy"], "no-referrer");
    const scriptPolicy = String(page.headers["content-security-policy"]).split(";").find((directive) => directive.trim().startsWith("script-src "));
    assert.ok(scriptPolicy?.includes("'self'"));
    assert.ok(!scriptPolicy.includes("'unsafe-inline'"));
  } finally { await app.close(); }
});

test("outside the public demo nobody is told to stay out of the search engines by this server", async () => {
  const app = await buildApp({ store: new MemoryStore(seed()), secret: "test-only-secret-with-more-than-32-characters", demo: true, origins: [], collectorUrl: "http://127.0.0.1:5174" });
  try {
    assert.equal((await app.inject("/api/health")).headers["x-robots-tag"], undefined);
  } finally { await app.close(); }
});
