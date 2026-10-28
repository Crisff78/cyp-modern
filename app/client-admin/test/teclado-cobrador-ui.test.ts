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

// The collector app with the keyboard only, at phone size (goal of 28-10-2026: «en el cobrador: entrar, ruta, cobrar,
// demorar, ayuda, cerrar sesión», forwards and backwards). Real collector app, API and MemoryStore, synthetic data.
test("Cobrador with the keyboard only: sign in, collect back and forth, the receipt, a delay, every view, help and sign out", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-teclado-cobrador-"));
  const app = await buildApp({ store: new MemoryStore(seed()), demo: true, secret: "synthetic-keyboard-collector-secret-at-least-32-chars", origins: [], collectorUrl: "/collector/" });
  const harness = await keyboardHarness({ app, adminRoot, output, playwrightEntry: playwrightEntry!, edge, localRequire, idempotencyKey: randomUUID, collectorRoot });
  try {
    const { page, keys, focused, waitFor, tabTo, requests } = await harness.signedOut({ width: 390, height: 844 }, "/collector/");
    const posts = (pathname: string) => requests.filter((request) => request.method === "POST" && request.path === pathname && request.status === 200).length;
    const text = () => page.evaluate(`(document.activeElement?.textContent ?? "").replace(/\\s+/g, " ").trim()`) as Promise<string>;
    const toMenu = () => tabTo((element) => Boolean(element.closest("[data-keyboard-menu]")), 120);

    await t.test("sign in: the keyboard starts on the user and, inside, on the menu", async () => {
      await waitFor(() => document.activeElement?.id === "collector-login-username");
      await page.keyboard.type("collector@cyp.local"); await keys("Enter");
      await page.keyboard.type(DEMO_PASSWORD); await keys("Enter");
      await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")) && document.activeElement?.getAttribute("aria-current") === "page");
    });

    await t.test("collect: the sheet opens on the amount; Enter to «Confirmar», ← back to the amount, → forth, Enter registers", async () => {
      await tabTo((element) => (element.textContent ?? "").trim().startsWith("Registrar Cobro"), 120);
      await keys("Enter");
      await waitFor(() => document.activeElement?.id === "collection-amount");
      await page.keyboard.type("100");
      await keys("Enter");
      assert.match(await text(), /^Confirmar cobro/);
      assert.equal(posts("/api/cobros"), 0, "reaching the button registers nothing");
      for (let step = 0; step < 30 && await page.evaluate(`document.activeElement?.id`) !== "collection-amount"; step += 1) await keys("ArrowLeft");
      assert.equal(await page.evaluate(`document.activeElement?.id`), "collection-amount");
      for (let step = 0; step < 30 && !/^Confirmar cobro/.test(await text()); step += 1) await keys("ArrowRight");
      assert.match(await text(), /^Confirmar cobro/);
      await keys("Enter");
      for (let step = 0; step < 50 && posts("/api/cobros") === 0; step += 1) await page.waitForTimeout(100);
      assert.equal(posts("/api/cobros"), 1);
    });

    await t.test("the receipt: the keyboard is on «Compartir recibo»; Shift+Tab up to «Volver a mi ruta», Enter", async () => {
      await waitFor(() => (document.activeElement?.textContent ?? "").includes("Compartir recibo"));
      await tabTo((element) => (element.textContent ?? "").includes("Volver a mi ruta"), 20, null, "Shift+Tab");
      await keys("Enter");
      await waitFor(() => !document.querySelector(".receipt-page"));
    });

    await t.test("a delay: «Sin Cobro / Atraso» opens its reasons on the first one; → and Enter choose; the keyboard comes back", async () => {
      await tabTo((element) => (element.textContent ?? "").trim() === "Sin Cobro / Atraso", 120);
      await keys("Enter");
      await waitFor(() => (document.activeElement?.textContent ?? "").trim() === "Local cerrado");
      await keys("ArrowRight");
      assert.equal(await text(), "Cliente ausente");
      await keys("Enter");
      await waitFor(() => !document.querySelector(".delay-reason-sheet"));
      await waitFor(() => (document.activeElement?.textContent ?? "").trim() === "Sin Cobro / Atraso");
    });

    for (const view of ["Pagos", "Recibos", "Remesas", "Reportes", "Mi bolsillo", "Mi ruta"]) await t.test(`the menu: → up to «${view}», Enter; Tab goes into it`, async () => {
      await toMenu();
      for (let step = 0; step < 8 && (await focused()).label !== view; step += 1) await keys("ArrowRight");
      assert.equal((await focused()).label, view);
      await keys("Enter");
      await waitFor((name: string) => document.querySelector(`[data-keyboard-menu] [aria-label="${name}"]`)?.getAttribute("aria-current") === "page", view);
      await tabTo((element) => Boolean(element.closest("main")) && !element.closest("[data-keyboard-menu]"), 60);
      // And back: Shift+Tab leaves the view the same way.
      await tabTo((element) => Boolean(element.closest("[data-keyboard-menu]")) || Boolean(element.closest("header")), 80, null, "Shift+Tab");
    });

    await t.test("help: «Instalar CyP» in Mi bolsillo opens it with the keyboard inside; Esc gives the keyboard back", async () => {
      await toMenu();
      for (let step = 0; step < 8 && (await focused()).label !== "Mi bolsillo"; step += 1) await keys("ArrowRight");
      await keys("Enter");
      await tabTo((element) => (element.textContent ?? "").includes("Instalar CyP"), 60);
      await keys("Enter");
      await waitFor(() => Boolean(document.activeElement?.closest(".help-sheet")));
      await keys("Escape");
      await waitFor(() => (document.activeElement?.textContent ?? "").includes("Instalar CyP"));
    });

    await t.test("sign out: «Cerrar sesión», Enter; the keyboard is on the user again", async () => {
      await tabTo((element) => (element.textContent ?? "").includes("Cerrar sesión"), 60);
      await keys("Enter");
      await waitFor(() => document.activeElement?.id === "collector-login-username");
    });

    await harness.assertNoPointer();
  } finally { await harness.close(); await app.close(); }
});
