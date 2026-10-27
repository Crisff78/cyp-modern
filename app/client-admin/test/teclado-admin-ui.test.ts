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
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); } catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
}
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);

// The whole portal with the keyboard only (goal of 27-10-2026): menu, listings, dialogs, money, reports, codifiers,
// the header and the keys of every window, without one click. Real Admin shell, API and MemoryStore, synthetic data.
test("Administración with the keyboard only: menu, Clientes pages and record, unsaved changes, a charge with money, reports, codifiers and the header", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-teclado-admin-"));
  const state = seed();
  // More than one page of Clientes (50 per page) so AvPág and RePág turn it.
  for (let index = 1; index <= 60; index++) state.clients.push({
    id: `kb-${String(index).padStart(3, "0")}`, name: `Cliente teclado ${index}`, code: `KB-${String(index).padStart(3, "0")}`, phone: `80966${String(index).padStart(5, "0")}`,
    address: "Calle ficticia", routeId: "route-1", sector: "Distrito Nacional", active: true,
  } as (typeof state.clients)[number]);
  const client = state.clients.find((item) => item.id === "cli-1")!;
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-keyboard-admin-secret-at-least-32-chars", origins: [], collectorUrl: "/collector/" });
  const harness = await keyboardHarness({ app, adminRoot, output, playwrightEntry: playwrightEntry!, edge, localRequire, idempotencyKey: randomUUID });
  try {
    const { page, keys, focused, waitFor, menuTo, tabTo, requests } = await harness.signedOut();
    const writes = (pattern: RegExp) => requests.filter((request) => request.method !== "GET" && pattern.test(request.path));
    const inWindow = (title: string) => waitFor((name: string) => document.activeElement?.closest('[role="dialog"]')?.getAttribute("aria-label") === name, title);
    const selectedRow = () => page.evaluate(`document.activeElement?.tagName === "TR" && document.activeElement.getAttribute("aria-selected") === "true" ? document.activeElement.querySelectorAll("td")[0].textContent.trim() : ""`) as Promise<string>;

    await waitFor(() => document.activeElement?.id === "admin-login-username");
    await page.keyboard.type("admin@cyp.local");
    await keys("Enter");
    await page.keyboard.type(DEMO_PASSWORD);
    await keys("Enter");
    await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")));

    // ── Clientes ──
    await menuTo("Clientes");
    await keys("Enter");
    await inWindow("Clientes");
    // The listing opens on its search (F3), with the keys of its toolbar shown on the buttons.
    assert.equal((await focused()).label, "Buscar clientes por código, teléfono o nota");
    await waitFor(() => document.querySelectorAll(".clients-grid tbody tr[role=button]").length === 50);
    const keysShown = await page.locator('.mdi-window[aria-label="Clientes"] [aria-keyshortcuts]').evaluateAll((items) => items.map((item) => item.getAttribute("aria-keyshortcuts")).sort());
    assert.deepEqual(keysShown, ["F2", "F3", "F4"]);
    assert.equal(await page.locator(".cyp-key-badge").count(), 3);
    // ↓ goes down to the list and moves the chosen row; Inicio and Fin go to its ends.
    await keys("ArrowDown");
    const first = await selectedRow();
    assert.ok(first);
    await keys("ArrowDown");
    const second = await selectedRow();
    assert.ok(second && second !== first);
    await keys("End");
    assert.equal(await page.evaluate(`document.activeElement === [...document.querySelectorAll(".clients-grid tbody tr[role=button]")].at(-1)`), true);
    await keys("Home");
    assert.equal(await selectedRow(), first);
    // The list is one Tab stop: Tab leaves it, Mayús+Tab comes back to the chosen row.
    await keys("Tab");
    assert.notEqual((await focused()).tag, "TR");
    await keys("Shift+Tab");
    assert.equal(await selectedRow(), first);
    // AvPág and RePág turn the page of the server.
    await keys("PageDown");
    await waitFor(() => /Página 2 de/.test(document.querySelector(".clients-page-status")?.textContent ?? ""));
    await waitFor(() => document.activeElement?.tagName === "TR");
    await keys("PageUp");
    await waitFor(() => /Página 1 de/.test(document.querySelector(".clients-page-status")?.textContent ?? ""));
    await waitFor(() => document.activeElement?.tagName === "TR");
    // Intro opens the record. Something typed and Esc: it asks first (Enter = Sí, Esc = No).
    await keys("Enter");
    await inWindow("Datos del Cliente...");
    await page.keyboard.type("9");
    await keys("Escape");
    await waitFor(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label") === "Cambios sin guardar");
    assert.equal((await focused()).label, "Sí, cerrar");
    await keys("Escape");
    await inWindow("Datos del Cliente...");
    await keys("Escape");
    await waitFor(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label") === "Cambios sin guardar");
    await keys("Enter");
    await waitFor(() => !document.querySelector('[role="dialog"][aria-label="Datos del Cliente..."]'));
    assert.equal(writes(/^\/api\/clientes/).length, 0);
    // The keyboard is back on the row of the record.
    await waitFor(() => document.activeElement?.tagName === "TR");
    // F4 hides and shows the filters; F2 opens a new record, which closes at once with nothing typed.
    const pressed = () => page.locator('.mdi-window[aria-label="Clientes"] button[aria-label="Mostrar/Ocultar filtros"]').getAttribute("aria-pressed");
    const before = await pressed();
    await keys("F4");
    assert.notEqual(await pressed(), before);
    await keys("F4");
    assert.equal(await pressed(), before);
    await keys("F2");
    await inWindow("Datos del Cliente...");
    assert.equal(await page.locator('[role="dialog"][aria-label="Datos del Cliente..."] input').first().inputValue(), "");
    await keys("Escape");
    await waitFor(() => !document.querySelector('[role="dialog"][aria-label="Datos del Cliente..."]'));
    // Esc closes the window; the keyboard goes back to the menu.
    await inWindow("Clientes");
    await keys("Escape");
    await waitFor(() => !document.querySelector('.mdi-window[aria-label="Clientes"]'));
    await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")));

    // ── Cargos: a form with money ──
    await menuTo("Cargos");
    await keys("Enter");
    await inWindow("Cargos");
    await keys("F2");
    await inWindow("Datos del Cargo...");
    assert.equal(await page.evaluate(`document.activeElement?.id`), "cargo-client-code");
    await page.keyboard.type(client.code);
    // Enter goes field by field; the service is chosen with the arrows of its list.
    for (let step = 0; step < 12 && !(await page.evaluate(`document.activeElement?.matches("[data-money-input]")`)); step += 1) {
      if (await page.evaluate(`document.activeElement?.id === "cargo-service"`)) await page.waitForFunction(`!document.querySelector("#cargo-service")?.disabled && document.querySelector("#cargo-service").options.length > 1`);
      if (await page.evaluate(`document.activeElement?.id === "cargo-service" && !document.activeElement.value`)) await keys("ArrowDown");
      await keys("Enter");
    }
    assert.equal(await page.evaluate(`document.activeElement?.id`), "cargo-amount");
    await page.keyboard.type("12345");
    // Enter up to the last field, and there it stays: money is saved with F9 (or the button), never with Enter.
    let last = "";
    for (let step = 0; step < 6; step += 1) {
      const now = await page.evaluate(`document.activeElement?.id || document.activeElement?.closest("label")?.textContent || ""`) as string;
      if (now === last) break;
      last = now; await keys("Enter");
    }
    assert.equal(await page.evaluate(`document.activeElement?.id`), "cargo-note");
    assert.equal(writes(/^\/api\/cargos/).length, 0);
    await keys("F9");
    await waitFor(() => !document.querySelector('[role="dialog"][aria-label="Datos del Cargo..."]'));
    assert.equal(writes(/^\/api\/cargos$/).filter((request) => request.status === 200).length, 1);
    await inWindow("Cargos");
    await keys("Escape");
    await waitFor(() => !document.querySelector('.mdi-window[aria-label="Cargos"]'));

    // ── Envíos de dinero: Esc with a draft asks first ──
    await menuTo("Envíos de dinero");
    await keys("Enter");
    await waitFor(() => document.activeElement?.getAttribute("role") === "combobox");
    await page.keyboard.type(client.code);
    await keys("Escape"); // closes the list of clients
    await keys("Escape");
    await waitFor(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label") === "Cambios sin guardar");
    await keys("Enter");
    await waitFor(() => !document.querySelector('.mdi-window[aria-label="Envíos de dinero"]'));

    // ── Reportes: a report of remesas, consulted with F9 and printed with F8 ──
    await menuTo("Reportes");
    await keys("Enter");
    await inWindow("Reportes");
    await tabTo((element) => element.textContent?.trim() === "Montos y cantidad de envíos");
    await keys("Enter");
    await waitFor(() => document.querySelector('.mdi-window[aria-label*="Montos y cantidad"]') !== null && document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label")?.includes("Montos y cantidad") === true);
    const consulted = requests.length;
    await keys("F9");
    await waitFor((count: number) => document.querySelector('.mdi-window[aria-label*="Montos y cantidad"] button[aria-label="Imprimir"]:not(:disabled)') !== null, consulted);
    assert.ok(requests.slice(consulted).some((request) => request.path.startsWith("/api/envios/reportes")));
    await keys("F8");
    await keys("Escape");
    await waitFor(() => !document.querySelector('.mdi-window[aria-label*="Montos y cantidad"]'));

    // ── Configuración de administración → Rutas ──
    await menuTo("Configuración de administración");
    await keys("Enter");
    await inWindow("Configuración de administración");
    await tabTo((element) => element.textContent?.trim() === "Rutas");
    await keys("Enter");
    await waitFor(() => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") === "Rutas");
    // It opens on its search; ↓ goes down to the routes once they have arrived, and moves between them.
    await waitFor(() => document.activeElement?.getAttribute("aria-label") === "Buscar en Rutas" && document.querySelectorAll('.mdi-window[aria-label="Rutas"] tbody tr[tabindex]').length > 1);
    await keys("ArrowDown");
    assert.equal((await focused()).tag, "TR");
    const firstRoute = await page.evaluate(`document.activeElement?.textContent`);
    await keys("ArrowDown");
    assert.notEqual(await page.evaluate(`document.activeElement?.textContent`), firstRoute);
    await keys("Escape");
    await waitFor(() => !document.querySelector('.mdi-window[aria-label="Rutas"]'));
    // The control panel is still open behind: the keyboard goes back to it.
    await inWindow("Configuración de administración");
    await keys("Escape");

    // ── Header: Facturas, and the search of Ctrl+K ──
    await keys("F10");
    await tabTo((element) => element.getAttribute("aria-label") === "Facturas");
    await keys("Enter");
    await inWindow("Ventana de Facturas");
    await keys("Escape");
    await waitFor(() => document.activeElement?.getAttribute("aria-label") === "Facturas");
    await keys("Control+k");
    await waitFor(() => document.activeElement?.getAttribute("placeholder")?.startsWith("Nombre, código") === true);
    await page.keyboard.type(client.name.slice(0, 5));
    await keys("Escape");
    await waitFor(() => document.querySelector('[role="dialog"][data-state="open"]') === null);

    // A key with nothing to do says so instead of doing something else.
    await keys("F10", "F8");
    await waitFor(() => /F8: no hay imprimir/.test(document.querySelector(".cyp-keyboard-status")?.textContent ?? ""));

    await harness.assertNoPointer();
    await page.screenshot({ path: path.join(output, "teclado-admin.png") });
    console.log(`UI evidence: ${output}`);
  } finally { await harness.close(); await app.close(); }
});
