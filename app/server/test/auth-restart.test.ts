import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { getAdminTools } from "../src/admin-tools.js";
import { enrichCollectorDemo } from "../src/demo-collector-scenarios.js";
import { enrichPublicDemo } from "../src/demo-scenarios.js";
import { normalizeDemoCollectorLabel, seedPublicDemo } from "../src/seed.js";
import { FileStore } from "../src/store.js";

const secret = "synthetic-auth-restart-test-only-secret-2026";
const origin = "https://auth-restart.example.test";
const invitation = "synthetic-auth-restart-invitation";
const originalPassword = "Demo-CyP-2026!";
const actors = [
  { id: "demo-admin", aliases: ["admin", "admin@cyp.local"], password: "Synthetic-new-admin" },
  { id: "demo-collector", aliases: ["collector.demo", "collector@cyp.local"], password: "Synthetic-new-collector" },
] as const;

type App = Awaited<ReturnType<typeof buildApp>>;

async function isolatedRestart() {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, "cyp-auth-restart-"));
  const createdDirectory = await realpath(directory);
  const file = join(createdDirectory, "fictional-state.json");
  let app: App | undefined;
  let store: FileStore | undefined;
  let cookie = "";

  const currentApp = () => {
    assert.ok(app, "An isolated application must be running.");
    return app;
  };
  const currentStore = () => {
    assert.ok(store, "An isolated file store must be open.");
    return store;
  };
  async function stop() {
    const closingApp = app;
    app = undefined;
    cookie = "";
    if (closingApp) await closingApp.close();
    else if (store) await store.close();
    store = undefined;
  }
  async function start(jwtSecret = secret) {
    const previousInvitationCookie = cookie;
    await stop();
    store = await FileStore.open(file, seedPublicDemo());
    try {
      // Reproduce public-demo startup on this private synthetic file only.
      await store.transaction((state) => {
        normalizeDemoCollectorLabel(state, true);
        enrichPublicDemo(state);
        enrichCollectorDemo(state);
      });
      app = await buildApp({ store, secret: jwtSecret, demo: true, publicWeb: true,
        demoAccess: { code: invitation, origin }, origins: [origin], collectorUrl: `${origin}/collector` });
      if (previousInvitationCookie) {
        const retainedAccess = await app.inject({ url: "/api/openapi.json", headers: { cookie: previousInvitationCookie } });
        assert.equal(retainedAccess.statusCode, 200,
          "An unexpired invitation cookie must survive restart with the same invitation configuration.");
      }
      const admitted = await app.inject({ method: "POST", url: "/demo-access",
        headers: { origin, accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({ code: invitation }).toString() });
      assert.equal(admitted.statusCode, 200, "Synthetic invitation must succeed.");
      const setCookie = admitted.headers["set-cookie"];
      assert.ok(typeof setCookie === "string", "Invitation must issue a cookie.");
      cookie = setCookie.split(";")[0];
    } catch (error) {
      await stop();
      throw error;
    }
  }
  const login = (alias: string, password: string) => currentApp().inject({
    method: "POST", url: "/api/auth/login", headers: { cookie }, payload: { email: alias, password },
  });
  async function token(alias: string, password: string) {
    const response = await login(alias, password);
    assert.equal(response.statusCode, 200, "Synthetic account login must succeed.");
    const value: unknown = response.json().token;
    assert.ok(typeof value === "string" && value.length > 0, "Successful login must issue a token.");
    return value;
  }
  const me = (bearer: string) => currentApp().inject({ url: "/api/auth/me",
    headers: { cookie, authorization: `Bearer ${bearer}` } });
  const changePassword = (id: string, bearer: string, password: string) => currentApp().inject({
    method: "POST", url: `/api/usuarios/${id}/clave`,
    headers: { cookie, authorization: `Bearer ${bearer}`, "idempotency-key": randomUUID() },
    payload: { currentPassword: originalPassword, password },
  });
  async function close() {
    await stop();
    // Check the exact mkdtemp result and its canonical parent before recursion.
    const target = await realpath(directory);
    assert.equal(resolve(target), resolve(createdDirectory), "Cleanup must target the directory created by this test.");
    assert.equal(dirname(target), temporaryRoot, "Cleanup must stay directly under os.tmpdir().");
    assert.ok(basename(target).startsWith("cyp-auth-restart-"), "Cleanup must target the test prefix.");
    assert.equal((await lstat(directory)).isSymbolicLink(), false, "Cleanup must not follow a replacement link.");
    await rm(target, { recursive: true });
  }
  return { start, login, token, me, changePassword, state: () => currentStore().read(), close };
}

test("initial admin and collector aliases and active sessions survive a complete FileStore application restart", async () => {
  const isolated = await isolatedRestart();
  try {
    await isolated.start();
    const tokens: string[] = [];
    for (const actor of actors) for (const alias of actor.aliases)
      tokens.push(await isolated.token(alias, originalPassword));
    const before = await isolated.state();
    assert.ok(before.accounts.every((account) => !actors.some((actor) => actor.id === account.id)),
      "Initial bootstrap identities must remain virtual until their own password changes.");

    // start closes the old app/store, opens the same file and builds new instances.
    await isolated.start();
    const after = await isolated.state();
    assert.ok(JSON.stringify(after.accounts) === JSON.stringify(before.accounts), "Restart must preserve account data.");
    assert.ok(JSON.stringify(getAdminTools(after).sessions) === JSON.stringify(getAdminTools(before).sessions),
      "Restart must preserve existing sessions.");
    for (const bearer of tokens)
      assert.equal((await isolated.me(bearer)).statusCode, 200, "Unexpired sessions must survive a stable-secret restart.");
    for (const actor of actors) for (const alias of actor.aliases)
      await isolated.token(alias, originalPassword);
  } finally { await isolated.close(); }
});

test("both own passwords and session revocations survive FileStore restart; rotating JWT secret preserves new passwords", async () => {
  const isolated = await isolatedRestart();
  try {
    await isolated.start();
    const revoked: string[] = [], active: string[] = [];
    for (const actor of actors) {
      const previous = await Promise.all(actor.aliases.map((alias) => isolated.token(alias, originalPassword)));
      revoked.push(...previous);
      const changed = await isolated.changePassword(actor.id, previous[0], actor.password);
      assert.equal(changed.statusCode, 200, "Each actor must be able to change its own password.");
      for (const bearer of previous)
        assert.equal((await isolated.me(bearer)).statusCode, 401, "Own password change must revoke every earlier session.");
      for (const alias of actor.aliases) active.push(await isolated.token(alias, actor.password));
    }
    const before = await isolated.state();
    for (const actor of actors) {
      const account = before.accounts.find((row) => row.id === actor.id);
      assert.ok(account && account.credentialVersion === 1 && account.status === "active",
        "Own password must be stored as an active versioned account.");
      assert.ok(account.passwordHash !== actor.password, "Stored credentials must not contain a plaintext password.");
    }

    await isolated.start();
    const after = await isolated.state();
    assert.ok(JSON.stringify(after.accounts) === JSON.stringify(before.accounts),
      "Restart and demo enrichment must preserve salts, hashes and credential versions.");
    assert.ok(JSON.stringify(getAdminTools(after).sessions) === JSON.stringify(getAdminTools(before).sessions),
      "Restart and demo enrichment must preserve session revocation and expiry.");
    for (const bearer of revoked)
      assert.equal((await isolated.me(bearer)).statusCode, 401, "Revoked sessions must remain rejected after restart.");
    for (const bearer of active)
      assert.equal((await isolated.me(bearer)).statusCode, 200, "Current sessions must survive a stable-secret restart.");
    const current: string[] = [];
    // Eight logins in this instance; the existing ten-per-minute limit stays active.
    for (const actor of actors) for (const alias of actor.aliases) {
      assert.equal((await isolated.login(alias, originalPassword)).statusCode, 401,
        "Each alias must reject the original password after restart.");
      current.push(await isolated.token(alias, actor.password));
    }

    await isolated.start("synthetic-auth-restart-different-jwt-secret-2026");
    const rotated = await isolated.state();
    assert.ok(JSON.stringify(rotated.accounts) === JSON.stringify(after.accounts),
      "JWT secret rotation must not replace password hashes or credential versions.");
    for (const bearer of [...active, ...current])
      assert.equal((await isolated.me(bearer)).statusCode, 401, "JWT secret rotation must invalidate previously signed tokens.");
    for (const actor of actors) for (const alias of actor.aliases) {
      const bearer = await isolated.token(alias, actor.password);
      assert.equal((await isolated.me(bearer)).statusCode, 200,
        "Each persisted new password must still work with tokens signed by the new JWT secret.");
    }
  } finally { await isolated.close(); }
});
