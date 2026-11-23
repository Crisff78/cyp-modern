import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { buildApp } from "../src/app.js";
import { DEMO_MOBILE_TEST_ID, DEMO_MOBILE_TEST_LOGIN, DEMO_MOBILE_TEST_PASSWORD, enrichMobileTestDemo } from "../src/demo-cashier-scenarios.js";
import { verifyPassword } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";

// The account the mobile application tests with in the public demo (order of Rardiel, 2026-11-23). Synthetic data only.
const now = new Date("2026-11-23T15:00:00.000Z");
const secret = "synthetic-mobile-test-account-secret-32chars";
const configured = { adminEmail: "principal@example.invalid", adminPassword: "Principal-ficticia-2026!" };
const credentials = `${DEMO_MOBILE_TEST_LOGIN}|${DEMO_MOBILE_TEST_PASSWORD}`;

async function setup(t: TestContext, store: MemoryStore, demo = true) {
  const app = await buildApp({ store, secret, origins: [], collectorUrl: "http://localhost:5174", ...(demo ? { demo: true } : { demo: false, ...configured }) });
  t.after(() => app.close());
  const text = async (url: string) => (await app.inject({ url })).body.split("|");
  const postText = async (url: string, payload: string) =>
    (await app.inject({ method: "POST", url, payload, headers: { "content-type": "text/plain; charset=utf-8" } })).body.split("|");
  return { app, text, postText };
}

test("the mobile test account is added once, as a Cajero, and an existing or deleted account is left alone", async () => {
  const state = seed();
  enrichMobileTestDemo(state, now);
  const added = state.accounts.filter((row) => row.email === DEMO_MOBILE_TEST_LOGIN);
  assert.equal(added.length, 1);
  assert.equal(added[0].id, DEMO_MOBILE_TEST_ID);
  assert.equal(added[0].role, "cashier");
  assert.equal(added[0].status, "active");
  assert.equal(added[0].collectorId, undefined);
  assert.ok(verifyPassword(DEMO_MOBILE_TEST_PASSWORD, added[0].salt, added[0].passwordHash));
  // Once: a later start changes nothing, and a deleted account does not come back.
  const before = structuredClone(state);
  enrichMobileTestDemo(state, new Date("2026-11-24T15:00:00.000Z"));
  assert.deepEqual(state, before);
  state.accounts = state.accounts.filter((row) => row.id !== DEMO_MOBILE_TEST_ID);
  enrichMobileTestDemo(state);
  assert.equal(state.accounts.some((row) => row.email === DEMO_MOBILE_TEST_LOGIN), false);

  // An account that already has that login, written in any case, is not touched.
  const taken = seed();
  taken.accounts.push({ id: "qa-own-account", name: "Cuenta sintética", email: "COB", role: "supervisor", salt: "synthetic-salt",
    passwordHash: "synthetic-hash", credentialVersion: 3, status: "disabled", createdAt: now.toISOString(), updatedAt: now.toISOString() });
  const untouched = structuredClone(taken.accounts);
  enrichMobileTestDemo(taken, now);
  assert.deepEqual(taken.accounts, untouched);
});

test("with the way the application calls, the account signs in, quotes and registers once its cash box is open", async (t) => {
  const state = seed();
  enrichMobileTestDemo(state, now);
  const { app, text } = await setup(t, new MemoryStore(state));

  const login = await text(`/cyp_login?p=${credentials}|3.0`);
  assert.equal(login[0], "OK", login.join("|"));
  assert.equal(login.length, 5);
  const [id, , role, canSend, canSee] = login[3].split(";");
  assert.deepEqual([id, role, canSend, canSee], [DEMO_MOBILE_TEST_ID, "cashier", "1", "1"]);
  const session = login[2];

  assert.equal((await text(`/cyp_clients?p=${session}|3.0`))[0], "OK");
  const quote = await text(`/cyp_quote?p=${session}|DOP|DOP|1000.00|3.0`);
  assert.equal(quote[0], "OK", quote.join("|"));
  const [, , total, toReceive] = quote[2].split(";");
  const data = (operation: string) => `${operation}|cli-1|cli-5|DOP|DOP|1000.00|0|${total}|${toReceive}|1|${total}||||`;

  // Nothing opens the cash box by itself: the protocol answers CNA until the account opens it in the web.
  const closed = await text(`/cyp_send?p=${session}|${data(randomUUID())}|3.0`);
  assert.deepEqual([closed[0], closed[2]], ["ER", "CNA"]);
  const web = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "10.45.0.2",
    payload: { email: DEMO_MOBILE_TEST_LOGIN, password: DEMO_MOBILE_TEST_PASSWORD } });
  assert.equal(web.statusCode, 200, web.body);
  const opened = await app.inject({ method: "POST", url: "/api/envios/cajas/abrir", remoteAddress: "10.45.0.2",
    headers: { authorization: `Bearer ${web.json().token}`, "idempotency-key": randomUUID() },
    payload: { operatorId: DEMO_MOBILE_TEST_ID, currency: "DOP", openingAmount: 0 } });
  assert.equal(opened.statusCode, 200, opened.body);
  const sent = await text(`/cyp_send?p=${session}|${data(randomUUID())}|3.0`);
  assert.equal(sent[0], "OK", sent.join("|"));
  assert.equal((await text(`/cyp_logout?p=${session}|3.0`))[0], "OK");
});

test("outside demo mode the account does not sign in and the session opened in demo mode is not valid", async (t) => {
  const state = seed();
  enrichMobileTestDemo(state, now);
  const store = new MemoryStore(state);
  const demo = await setup(t, store);
  const login = await demo.text(`/cyp_login?p=${credentials}|3.0`);
  assert.equal(login[0], "OK", login.join("|"));
  await demo.app.close();

  const real = await setup(t, store, false);
  // By POST: outside demo mode a GET with a password is refused before the account is looked at.
  const refused = await real.postText("/cyp_login", credentials);
  assert.deepEqual([refused[0], refused[2]], ["ER", "UCI"]);
  const web = await real.app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "10.45.0.3",
    payload: { email: DEMO_MOBILE_TEST_LOGIN, password: DEMO_MOBILE_TEST_PASSWORD } });
  assert.equal(web.statusCode, 401, web.body);
  const clients = await real.text(`/cyp_clients?${login[2]}`);
  assert.equal(clients[0], "ER", clients.join("|"));
  assert.ok(["SNE", "SNA"].includes(clients[2]), clients.join("|"));
});
