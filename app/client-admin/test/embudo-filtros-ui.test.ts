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
import { DEMO_CASHIER_EMAIL, enrichCashierDemo } from "../../server/src/demo-cashier-scenarios.js";
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

// The funnel of «Mostrar/Ocultar filtros» (Rardiel, 28-10-2026: «el embudo que había … funcionando en todas las pestañas
// y en todos lados»). Every window of the portal, as Administración and as Cajero, and the stops of the collector: where
// there are filters there is exactly one funnel, it hides them and shows them again; where there are none, no funnel.
// The window icon of the panels (26-10) is gone everywhere.
test("The funnel shows and hides the filters in every window with filters, for Administración, Cajero and the collector", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-embudo-filtros-"));
  const state = seed();
  enrichCashierDemo(state, new Date());
  const app = await buildApp({ store: new MemoryStore(state), demo: true, secret: "synthetic-funnel-filters-secret-at-least-32-chars", origins: [], collectorUrl: "/collector/" });
  const harness = await keyboardHarness({ app, adminRoot, output, playwrightEntry: playwrightEntry!, edge, localRequire, idempotencyKey: randomUUID, collectorRoot });
  try {
    // The filters a window shows: its fields outside its list, its bar and its dialogs (plain JavaScript for the page).
    const FILTER_FIELDS = `(win) => [...win.querySelectorAll("input:not([type=hidden]),select")].filter((field) => field.getClientRects().length && !field.closest("table,.legacy-mdi-toolbar,[role=dialog] [role=dialog],.remittance-send-form,.collector-monitor-topbar"))`;
    const portal = async (email: string, role: string) => {
      const { page } = await harness.signedOut();
      await page.getByLabel("Usuario o correo", { exact: true }).fill(email);
      await page.getByLabel("Contraseña", { exact: true }).fill(DEMO_PASSWORD);
      await page.keyboard.press("Enter");
      await page.waitForFunction(`document.querySelectorAll(".sidebar .nav-group-trigger, .sidebar .nav-item").length > 2`);
      const closeAll = async () => {
        for (let step = 0; step < 4 && await page.locator(".dialog-overlay, .legacy-dialog-overlay").count(); step += 1) { await page.keyboard.press("Escape"); await page.waitForTimeout(150); }
        for (let step = 0; step < 8; step += 1) { const close = page.locator(".mdi-window-titlebar button[aria-label^='Cerrar']"); if (!await close.count()) break; await close.last().click(); await page.waitForTimeout(80); }
      };
      const front = () => page.locator(".mdi-window").last();
      const results: string[] = [];
      const check = async (from: string) => {
        const win = front();
        if (!await win.count()) return;
        const title = await win.getAttribute("aria-label");
        await page.waitForTimeout(300);
        const funnels = win.locator('button[aria-label="Mostrar/Ocultar filtros"]');
        const count = await funnels.count();
        const shown = await win.evaluate((element: Element, source: string) => (0, eval)(source)(element).length, FILTER_FIELDS) as number;
        assert.equal(await win.locator("[data-icon^='panel-']").count(), 0, `${from}: no window icon of the panels`);
        if (!count) {
          assert.equal(await win.locator("aside[class*=filter], form[class*=filter], [aria-label^='Panel de filtro'], .remittance-toolbar").count(), 0, `${from}: «${title}» has filters but no funnel`);
          results.push(`${title}: sin filtros`); return;
        }
        assert.equal(count, 1, `${from}: one funnel`);
        const funnel = funnels.first();
        assert.equal(await funnel.locator("svg[data-icon='embudo']").count(), 1, `${from}: the funnel icon`);
        assert.equal(await funnel.getAttribute("aria-pressed"), "true", `${from}: filters shown at first`);
        assert.ok(shown > 0, `${from}: «${title}» shows its filters`);
        await funnel.click();
        await page.waitForFunction((args: [string, string]) => { const win = [...document.querySelectorAll(".mdi-window")].pop()!; return (0, eval)(args[0])(win).length === 0 && win.querySelector('button[aria-label="Mostrar/Ocultar filtros"]')?.getAttribute("aria-pressed") === "false"; }, [FILTER_FIELDS, ""] as [string, string]);
        await funnel.click();
        await page.waitForFunction((args: [string, number]) => { const win = [...document.querySelectorAll(".mdi-window")].pop()!; return (0, eval)(args[0])(win).length === args[1]; }, [FILTER_FIELDS, shown] as [string, number]);
        results.push(`${title}: ${shown} filtros, embudo ok`);
      };
      const menu = await page.evaluate(`[...document.querySelectorAll(".sidebar .nav-item, .sidebar .nav-group-direct > .nav-group-trigger")].map((item) => item.getAttribute("aria-label")).filter((name) => !["Configuración de administración", "Reportes"].includes(name))`) as string[];
      for (const name of menu) {
        await closeAll();
        const option = page.locator(".sidebar").getByRole("button", { name, exact: true }).first();
        if (!await option.isVisible()) await page.locator(".sidebar .nav-group").filter({ has: page.locator(`.nav-item[aria-label="${name}"]`) }).locator(".nav-group-trigger").click();
        await option.click(); await page.waitForTimeout(500);
        await check(`${role} → ${name}`);
      }
      for (const [launcher, tile] of [["Configuración de administración", ".control-panel-tile"], ["Reportes", ".report-launcher-tile"]]) {
        const trigger = page.locator(`.sidebar [aria-label="${launcher}"]`).first();
        if (!await trigger.count()) continue;
        const openLauncher = async () => { await closeAll(); await trigger.click(); await page.waitForTimeout(400); return page.locator(tile).count(); };
        const total = await openLauncher();
        for (let index = 0; index < total; index += 1) {
          if (index) await openLauncher();
          const name = (await page.locator(tile).nth(index).innerText()).replace(/\s+/g, " ").trim();
          await page.locator(tile).nth(index).click(); await page.waitForTimeout(600);
          await check(`${role} → ${launcher} → ${name}`);
        }
      }
      await page.context().close();
      return results;
    };

    await t.test("Administración: every window", async () => {
      const results = await portal("admin@cyp.local", "Administración");
      t.diagnostic(results.join(" · "));
      assert.ok(results.filter((line) => line.endsWith("embudo ok")).length >= 30, `${results.length} windows`);
    });

    await t.test("Cajero: every window of the cashier", async () => {
      const results = await portal(DEMO_CASHIER_EMAIL, "Cajero");
      t.diagnostic(results.join(" · "));
      assert.ok(results.some((line) => line.endsWith("embudo ok")));
    });

    await t.test("Collector: the funnel hides and shows the search and the filters of the stops", async () => {
      const { page } = await harness.signedOut({ width: 390, height: 844 }, "/collector/");
      await page.getByLabel("Usuario o correo", { exact: true }).fill("collector@cyp.local");
      await page.getByLabel("Contraseña", { exact: true }).fill(DEMO_PASSWORD);
      await page.keyboard.press("Enter");
      const search = page.getByLabel("Buscar cliente o servicio", { exact: true });
      const filters = page.getByRole("group", { name: "Filtrar paradas", exact: true });
      await search.waitFor();
      const funnel = page.getByRole("button", { name: "Mostrar/Ocultar filtros", exact: true });
      assert.equal(await funnel.count(), 1);
      assert.equal(await funnel.locator("svg[data-icon='embudo']").count(), 1);
      await page.getByRole("button", { name: "Pendientes", exact: true }).click();
      await funnel.click();
      await search.waitFor({ state: "detached" }); assert.equal(await filters.count(), 0);
      assert.equal(await funnel.getAttribute("aria-pressed"), "false");
      await funnel.click();
      await search.waitFor();
      // Hiding them keeps what was chosen.
      assert.equal(await page.getByRole("button", { name: "Pendientes", exact: true }).getAttribute("aria-pressed"), "true");
      await page.screenshot({ path: path.join(output, "cobrador-embudo.png") });
      await page.context().close();
    });
  } finally { await harness.close(); await app.close(); t.diagnostic(`Capturas: ${output}`); }
});
