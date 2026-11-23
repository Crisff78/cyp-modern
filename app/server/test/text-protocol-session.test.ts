import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { buildApp } from "../src/app.js";
import { DEMO_CASHIER_EMAIL, enrichCashierDemo } from "../src/demo-cashier-scenarios.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import { sessionIdCodec } from "../src/text-protocol-session.js";

// The short idSesion (order of Rardiel, 2026-11-23). Synthetic data only.
const secret = "synthetic-short-session-secret-for-isolated-tests";
const CASHIER = "demo-cashier";
const NEW_PASSWORD = "Nueva-ficticia-2026!";

async function setup(t: TestContext, store = (() => { const state = seed(); enrichCashierDemo(state); return new MemoryStore(state); })()) {
  const app = await buildApp({ store, secret, demo: true, origins: [], collectorUrl: "http://127.0.0.1:5174" });
  t.after(() => app.close());
  // Each request from its own address, so the limit of sign-ins per minute does not count here.
  let address = 0;
  const remoteAddress = () => `10.46.0.${++address}`;
  const text = async (url: string) => (await app.inject({ url, remoteAddress: remoteAddress() })).body.split("|");
  const signIn = async () => {
    const parts = await text(`/cyp_login?p=${DEMO_CASHIER_EMAIL}|${DEMO_PASSWORD}|3.0`);
    assert.equal(parts[0], "OK", parts.join("|"));
    return parts[2];
  };
  const webToken = async (email = "admin@cyp.local") =>
    (await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: remoteAddress(), payload: { email, password: DEMO_PASSWORD } })).json().token as string;
  const post = (url: string, payload: unknown, token: string) => app.inject({ method: "POST", url, remoteAddress: remoteAddress(), payload,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() } });
  return { app, store, text, signIn, webToken, post, remoteAddress };
}
const code = (parts: string[]) => [parts[0], parts[2]];

test("the codec: 32 uppercase hexadecimal characters that only its own key opens", () => {
  const codec = sessionIdCodec(secret, "binding"), sid = randomUUID(), id = codec.seal(sid);
  assert.match(id, /^[0-9A-F]{32}$/);
  assert.equal(codec.open(id), sid);
  assert.equal(codec.seal(sid), id, "the same session, the same idSesion");
  assert.notEqual(id, sid.replaceAll("-", "").toUpperCase(), "the id of the record is not shown");
  assert.notEqual(sessionIdCodec("another-synthetic-secret-for-isolated-tests", "binding").open(id), sid);
  assert.notEqual(sessionIdCodec(secret, "another binding").open(id), sid);
  for (const wrong of [`${id.slice(0, 31)}g`, id.slice(1), `${id}0`, "", "a.b.c", sid]) assert.equal(codec.open(wrong), undefined, wrong);
  assert.equal(codec.open("a".repeat(32)), undefined, "lowercase is not the form it is given in");
  assert.throws(() => codec.seal("not-a-uuid"));
});

test("the application signs in and works with the short idSesion, read through the store of the requests", async (t) => {
  class Counting extends MemoryStore {
    lookups = 0;
    override async readSessionIdentity(id: string) { this.lookups += 1; return super.readSessionIdentity(id); }
  }
  const state = seed(); enrichCashierDemo(state);
  const store = new Counting(state), { text, signIn } = await setup(t, store);
  const session = await signIn();
  assert.match(session, /^[0-9A-F]{32}$/);
  assert.equal((await text(`/cyp_clients?p=${session}|3.0`))[0], "OK");
  assert.equal((await text(`/cyp_quote?p=${session}|DOP|DOP|1000.00|3.0`))[0], "OK");
  assert.ok(store.lookups >= 2, "one row per petition, not the whole state");
  assert.equal((await text(`/cyp_logout?p=${session}|3.0`))[0], "OK");
  assert.deepEqual(code(await text(`/cyp_clients?p=${session}|3.0`)), ["ER", "SNA"]);
  assert.deepEqual(code(await text(`/cyp_logout?p=${session}|3.0`)), ["ER", "SNA"]);
});

test("an idSesion is not the id of the record, cannot be made up, and does not open the JSON API", async (t) => {
  const { app, store, text, signIn, remoteAddress } = await setup(t);
  const session = await signIn();
  const sid = (await store.read()).adminTools!.sessions.at(-1)!.id;
  assert.deepEqual(code(await text(`/cyp_clients?${sid}`)), ["ER", "SNE"], "as Administración sees it");
  assert.deepEqual(code(await text(`/cyp_clients?${sid.replaceAll("-", "").toUpperCase()}`)), ["ER", "SNE"], "with the size of an idSesion");
  // Any block may decrypt into the form of a UUID: what it does not find is a record.
  for (let index = 0; index < 40; index++)
    assert.deepEqual(code(await text(`/cyp_clients?${randomBytes(16).toString("hex").toUpperCase()}`)), ["ER", "SNE"]);
  assert.deepEqual(code(await text(`/cyp_clients?${session.toLowerCase()}`)), ["ER", "SNE"]);
  for (const url of ["/api/auth/me", "/api/snapshot", "/api/envios", "/api/usuarios"]) {
    const refused = await app.inject({ url, remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${session}` } });
    assert.equal(refused.statusCode, 401, url);
  }
  assert.equal((await text(`/cyp_clients?${session}`))[0], "OK", "the session is still open");
});

for (const [name, change] of [
  ["its password", (id: string) => [`/api/usuarios/${id}/clave`, { password: NEW_PASSWORD }]],
  ["its role", (id: string) => [`/api/usuarios/${id}`, { name: "Cajero de práctica", email: DEMO_CASHIER_EMAIL, role: "supervisor" }]],
  ["its status", (id: string) => [`/api/usuarios/${id}/estado`, { status: "disabled" }]],
] as const)
  test(`a change of ${name} closes the short session`, async (t) => {
    const { text, signIn, webToken, post } = await setup(t);
    const session = await signIn(), [url, body] = change(CASHIER);
    assert.equal((await text(`/cyp_clients?${session}`))[0], "OK");
    const changed = await post(url as string, body, await webToken());
    assert.equal(changed.statusCode, 200, changed.body);
    assert.deepEqual(code(await text(`/cyp_clients?${session}`)), ["ER", "SNA"]);
  });

test("a long idSesion given before this version keeps working until it ends", async (t) => {
  const { app, text, webToken } = await setup(t);
  const claims = app.jwt.decode<Record<string, unknown>>(await webToken(DEMO_CASHIER_EMAIL))!;
  const { iat: _iat, exp: _exp, ...rest } = claims;
  const before = app.jwt.sign({ ...rest, channel: "cyp" }, { expiresIn: "8h" });
  assert.equal((await text(`/cyp_clients?${before}`))[0], "OK");
  assert.equal((await text(`/cyp_logout?${before}`))[0], "OK");
  assert.deepEqual(code(await text(`/cyp_clients?${before}`)), ["ER", "SNA"]);
});
