import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { seed } from "../src/seed.js";

// R5 (13-11-2026): behind Render every visitor reached the server from the address of its proxy and shared one limit.
const build = (clientAddressHeader?: string) => buildApp({
  store: new MemoryStore(seed()), secret: "test-only-secret-with-more-than-32-characters", demo: true, origins: [],
  collectorUrl: "http://localhost:5174", clientAddressHeader,
});
type App = Awaited<ReturnType<typeof build>>;
const remaining = async (app: App, headers: Record<string, string> = {}) =>
  Number((await app.inject({ url: "/api/health", headers })).headers["x-ratelimit-remaining"]);
const login = async (app: App, address: string) => (await app.inject({
  method: "POST", url: "/api/auth/login", headers: { "cf-connecting-ip": address },
  payload: { email: "admin@cyp.local", password: "not-the-password" },
})).statusCode;

test("without a platform header the limit follows the socket, whatever the request claims", async () => {
  const app = await build();
  try {
    assert.equal(await remaining(app, { "cf-connecting-ip": "198.51.100.7" }), 119);
    assert.equal(await remaining(app, { "cf-connecting-ip": "203.0.113.9" }), 118);
    assert.equal(await remaining(app, { "x-forwarded-for": "192.0.2.44" }), 117);
  } finally {
    await app.close();
  }
});

test("with the platform header each visitor has a limit of its own", async () => {
  const app = await build("cf-connecting-ip");
  try {
    assert.equal(await remaining(app, { "cf-connecting-ip": "198.51.100.7" }), 119);
    assert.equal(await remaining(app, { "cf-connecting-ip": "203.0.113.9" }), 119);
    assert.equal(await remaining(app, { "cf-connecting-ip": "2001:db8::1" }), 119);
    assert.equal(await remaining(app, { "cf-connecting-ip": "198.51.100.7" }), 118);
    // X-Forwarded-For is never read: the visitor can write it, and Render only appends to it.
    assert.equal(await remaining(app, { "x-forwarded-for": "192.0.2.44" }), 119);
    // What is not an address does not become a key: it falls back to the socket, like the request above.
    assert.equal(await remaining(app, { "cf-connecting-ip": "no-es-una-direccion" }), 118);
    assert.equal(await remaining(app, { "cf-connecting-ip": "198.51.100.7, 203.0.113.9" }), 117);
  } finally {
    await app.close();
  }
});

test("the ten sign-in attempts a minute are counted for each visitor", async () => {
  const app = await build("cf-connecting-ip");
  try {
    for (let attempt = 1; attempt <= 10; attempt++) assert.equal(await login(app, "198.51.100.7"), 401, `attempt ${attempt}`);
    assert.equal(await login(app, "198.51.100.7"), 429);
    assert.equal(await login(app, "203.0.113.9"), 401);
  } finally {
    await app.close();
  }
});
