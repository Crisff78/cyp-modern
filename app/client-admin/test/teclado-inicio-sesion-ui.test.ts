import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";
import { DEMO_PASSWORD } from "../../server/src/demo-credentials.js";
import { keyboardHarness } from "./keyboard-harness.js";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const collectorRoot = path.resolve(adminRoot, "../client-collector");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); } catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
}
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);

// Signing in with the keyboard only, now that the form has the list of Estación under the password (20-11-2026).
// The rule (docs/TECLADO-COMPLETO.md): Enter in the password signs in, as always. The list is optional: Enter does not
// stop on it, ↓ and Tab reach it, and from it Enter goes on to «Iniciar sesión» without pressing it.
// Real portals, API and MemoryStore, synthetic stations.
test("Iniciar sesión with the keyboard only: Enter in the password signs in, Estación is reached with ↓ and Tab, and a station that cannot be used leaves a way on", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-teclado-inicio-"));
  const state = seed();
  state.adminTools.stations = ["A", "B"].map((code) => ({ ...state.adminTools.stations[0], id: `fixture-${code}`, number: code, name: `Puesto ${code}`, active: true }));
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-keyboard-sign-in-secret-at-least-32-chars", origins: [], collectorUrl: "/collector/" });
  const harness = await keyboardHarness({ app, adminRoot, output, playwrightEntry: playwrightEntry!, edge, localRequire, idempotencyKey: randomUUID, collectorRoot });
  // The list is a stop only once its stations came: before that it is disabled and ↓ goes past it.
  const listReady = () => { const list = document.querySelector('select[name="station"]'); return list instanceof HTMLSelectElement && !list.disabled && list.options.length === 3; };
  try {
    await t.test("the office: ↓ reaches the list, Enter on it goes to the button without signing in, Enter in the password signs in", async () => {
      const { page, keys, focused, waitFor, requests } = await harness.signedOut();
      const logins = () => requests.filter((request) => request.method === "POST" && request.path === "/api/auth/login").length;
      const here = async () => { const { label, tag } = await focused(); return `${tag} ${label}`; };
      await waitFor(() => document.activeElement?.id === "admin-login-username");
      await waitFor(listReady);
      await page.keyboard.type("admin@cyp.local"); await keys("Enter");
      assert.equal(await page.evaluate(`document.activeElement?.id`), "admin-login-password");
      await page.keyboard.type(DEMO_PASSWORD);
      await keys("ArrowDown");
      assert.equal(await here(), "SELECT Estación");
      await keys("Enter");
      assert.equal(await here(), "BUTTON Iniciar sesión");
      await page.waitForTimeout(400);
      assert.equal(logins(), 0, "reaching the button signs nobody in");
      // Back with Mayús+Tab: the list, the eye of the password, the password. Tab reaches the list too.
      await keys("Shift+Tab");
      assert.equal(await here(), "SELECT Estación");
      await keys("Shift+Tab");
      assert.equal(await here(), "BUTTON Mostrar contraseña");
      await keys("Shift+Tab");
      assert.equal(await page.evaluate(`document.activeElement?.id`), "admin-login-password");
      await keys("Enter");
      await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")));
      assert.equal(logins(), 1);
      assert.equal((await store.read()).adminTools.installations.length, 0, "Enter in the password registers no browser");
      await harness.assertNoPointer();
    });

    await t.test("the collector: a station chosen without permission says why; one key puts the keyboard on the list and «Usar vínculo actual» lets them in", async () => {
      const { page, keys, focused, waitFor, tabTo, requests } = await harness.signedOut({ width: 390, height: 844 }, "/collector/");
      const before = requests.length;
      const logins = () => requests.slice(before).filter((request) => request.method === "POST" && request.path === "/api/auth/login").length;
      const here = async () => { const { label, tag } = await focused(); return `${tag} ${label}`; };
      const chosen = () => page.evaluate(`document.querySelector('select[name="station"]').value`) as Promise<string>;
      await waitFor(() => document.activeElement?.id === "collector-login-username");
      await waitFor(listReady);
      await page.keyboard.type("collector@cyp.local"); await keys("Enter");
      await page.keyboard.type(DEMO_PASSWORD);
      await keys("ArrowDown");
      assert.equal(await here(), "SELECT Estación");
      // A list takes the first letter of what is wanted, without opening.
      await page.keyboard.type("A");
      assert.equal(await chosen(), "A");
      await tabTo((element) => element.id === "collector-login-password", 6, undefined, "Shift+Tab");
      await keys("Enter");
      await waitFor(() => [...document.querySelectorAll('[role="alert"]')].some((alert) => (alert.textContent ?? "").includes("permiso de edición")));
      assert.equal(logins(), 1);
      // The account is already checked, so its user and password stay locked until «Cambiar cuenta». The keyboard was
      // on the password and has nowhere to be: as everywhere in CyP, the first key puts it back, here on the list.
      assert.equal(await page.evaluate(`document.getElementById("collector-login-password").disabled`), true);
      await keys("ArrowDown");
      assert.equal(await here(), "SELECT Estación");
      assert.equal(await chosen(), "A", "the key that brings the keyboard back changes nothing");
      await page.keyboard.type("U");
      assert.equal(await chosen(), "");
      await keys("Enter");
      assert.equal(await here(), "BUTTON Iniciar sesión");
      await keys("Enter");
      await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")) && document.activeElement?.getAttribute("aria-current") === "page");
      assert.equal(logins(), 1, "the same session goes on: the password is not asked again");
      assert.equal((await store.read()).adminTools.installations.length, 0);
      await harness.assertNoPointer();
    });
  } finally { await harness.close(); await app.close(); }
});
