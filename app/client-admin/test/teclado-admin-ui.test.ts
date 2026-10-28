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
    // Tabster moves the keyboard: the menu carries its mark and is one Tab stop that remembers its option.
    assert.equal(await page.locator('[data-keyboard-menu][data-tabster*="mover"]').count(), 1);
    await menuTo("Clientes");
    await keys("Tab");
    assert.equal(await page.evaluate(`Boolean(document.activeElement?.closest("[data-keyboard-menu]"))`), false);
    await keys("Shift+Tab");
    assert.equal((await focused()).label, "Clientes");

    // ── Clientes ──
    await menuTo("Clientes");
    await keys("Enter");
    await inWindow("Clientes");
    // Its list and its bar of buttons are Tabster's too (marked by their shape).
    await waitFor(() => document.querySelector(".clients-grid")?.getAttribute("data-tabster")?.includes("mover") === true && document.querySelector('.mdi-window[aria-label="Clientes"] .legacy-mdi-toolbar')?.getAttribute("data-tabster")?.includes("mover") === true);
    // The listing opens on its search, and nothing is drawn on its buttons.
    assert.equal((await focused()).label, "Buscar clientes por código, teléfono o nota");
    await waitFor(() => document.querySelectorAll(".clients-grid tbody tr[role=button]").length === 50);
    assert.equal(await page.locator("[aria-keyshortcuts], .cyp-key-badge, .cyp-key-hint").count(), 0);
    // ↓ goes down to the list and moves the chosen row; Inicio and Fin go to its ends; ↑ on the first row, back to the search.
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
    await keys("ArrowUp");
    assert.equal((await focused()).label, "Buscar clientes por código, teléfono o nota");
    await keys("ArrowDown");
    assert.equal(await selectedRow(), first);
    // The list is one Tab stop: Mayús+Tab leaves it, Tab comes back to the chosen row (the list is the last stop of the
    // window: Tab from it goes round to the first one).
    await keys("Shift+Tab");
    assert.notEqual((await focused()).tag, "TR");
    await keys("Tab");
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
    // Who gives the keyboard back when the record closes: Tabster (its Deloser).
    await page.evaluate(`window.__givenBack = []; window.addEventListener("tabster:movefocus", (event) => { if (event.detail.by === "deloser") window.__givenBack.push(event.detail.next?.tagName); })`);
    await keys("Enter");
    await waitFor(() => !document.querySelector('[role="dialog"][aria-label="Datos del Cliente..."]'));
    assert.equal(writes(/^\/api\/clientes/).length, 0);
    // The keyboard is back on the row of the record, given back by Tabster.
    await waitFor(() => document.activeElement?.tagName === "TR");
    assert.equal((await page.evaluate(`window.__givenBack`) as string[]).at(-1), "TR");
    // The buttons of the toolbar: Mayús+Tab goes up to them, ← and → go from one to the next, Enter presses.
    const pressed = () => page.locator('.mdi-window[aria-label="Clientes"] button[aria-label="Mostrar/Ocultar filtros"]').getAttribute("aria-pressed");
    const before = await pressed();
    await tabTo((element) => element.closest(".legacy-mdi-toolbar") !== null, 10, null, "Shift+Tab");
    for (let step = 0; step < 12 && (await focused()).label !== "Mostrar/Ocultar filtros"; step += 1) await keys("ArrowLeft");
    assert.equal((await focused()).label, "Mostrar/Ocultar filtros");
    await keys("Enter");
    assert.notEqual(await pressed(), before);
    await keys("Enter");
    assert.equal(await pressed(), before);
    for (let step = 0; step < 12 && !(await page.evaluate(`document.activeElement?.getAttribute("title")?.startsWith("Nuevo") === true`)); step += 1) await keys("ArrowRight");
    assert.equal(await page.evaluate(`document.activeElement?.closest(".legacy-mdi-toolbar") !== null && document.activeElement.getAttribute("title").startsWith("Nuevo")`), true);
    await keys("Enter");
    await inWindow("Datos del Cliente...");
    assert.equal(await page.locator('[role="dialog"][aria-label="Datos del Cliente..."] input').first().inputValue(), "");
    // Tab does not leave an open dialog (Tabster's Modalizer): round and round, forwards and backwards.
    const dialogStops = await page.evaluate(`document.querySelectorAll('[role="dialog"][aria-label="Datos del Cliente..."] :is(button,input,select,textarea):not(:disabled)').length`) as number;
    for (let step = 0; step < dialogStops + 4; step += 1) await keys("Tab");
    await inWindow("Datos del Cliente...");
    for (let step = 0; step < dialogStops + 4; step += 1) await keys("Shift+Tab");
    await inWindow("Datos del Cliente...");
    await keys("Escape");
    await waitFor(() => !document.querySelector('[role="dialog"][aria-label="Datos del Cliente..."]'));
    // Tab never leaves the page (the browser kept the keyboard until a click, Rardiel 28-10-2026): after the last stop of
    // the window it goes back to its first one, round and round.
    await inWindow("Clientes");
    const tabStops: string[] = [];
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press("Tab"); await page.waitForTimeout(40);
      assert.equal(await page.evaluate(`document.hasFocus() && Boolean(document.activeElement?.closest('.mdi-window[aria-label="Clientes"] .mdi-window-content'))`), true, `Tab ${step + 1} stays in the window`);
      tabStops.push((await focused()).label);
    }
    assert.ok(tabStops.filter((label) => label === "Mostrar/Ocultar filtros").length >= 2, `Tab goes round the window: ${tabStops.join(" · ")}`);
    // Esc closes the window; the keyboard goes back to the menu.
    await keys("Escape");
    await waitFor(() => !document.querySelector('.mdi-window[aria-label="Clientes"]'));
    await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")));

    // ── Cargos: a form with money ──
    await menuTo("Cargos");
    await keys("Enter");
    await inWindow("Cargos");
    // Its filter panel with Enter, as with Tab: the options are one stop (Todos, then Fecha Inicial); ↓ opens a list to
    // choose from, as a click does (every option is seen), ↓ moves in it, Enter chooses, the next Enter goes on.
    await tabTo((element) => element.matches('.charges-filter-panel input[type="radio"]:checked'));
    await keys("Enter");
    assert.equal((await focused()).label, "Fecha Inicial:");
    await keys("Enter", "Enter");
    assert.equal((await focused()).label, "Estado:");
    const state = () => page.evaluate(`({ value: document.activeElement.value, open: document.activeElement.matches(":open") })`) as Promise<{ value: string; open: boolean }>;
    assert.deepEqual(await state(), { value: "Activo", open: false });
    await keys("ArrowDown");
    assert.deepEqual(await state(), { value: "Activo", open: true }, "↓ opens the list without changing what it shows");
    await keys("ArrowDown", "Enter");
    assert.deepEqual(await state(), { value: "Todos", open: false });
    await keys("Enter");
    assert.equal((await focused()).label, "Relación de Pago:");
    await tabTo((element) => element.closest(".legacy-mdi-toolbar") !== null, 10, null, "Shift+Tab");
    for (let step = 0; step < 12 && !(await page.evaluate(`document.activeElement?.getAttribute("title")?.startsWith("Nuevo") === true`)); step += 1) await keys("ArrowLeft");
    await keys("Enter");
    await inWindow("Datos del Cargo...");
    assert.equal(await page.evaluate(`document.activeElement?.id`), "cargo-client-code");
    await page.keyboard.type(client.code);
    // Enter goes field by field; the service is chosen in its list: ↓ opens it, ↓ moves, Enter chooses.
    for (let step = 0; step < 12 && !(await page.evaluate(`document.activeElement?.matches("[data-money-input]")`)); step += 1) {
      if (await page.evaluate(`document.activeElement?.id === "cargo-service"`)) await page.waitForFunction(`!document.querySelector("#cargo-service")?.disabled && document.querySelector("#cargo-service").options.length > 1`);
      if (await page.evaluate(`document.activeElement?.id === "cargo-service" && !document.activeElement.value`)) await keys("ArrowDown", "ArrowDown", "Enter");
      await keys("Enter");
    }
    assert.equal(await page.evaluate(`document.activeElement?.id`), "cargo-amount");
    await page.keyboard.type("12345");
    // Enter field by field and, after the last one, to the button without pressing it (Rardiel, 28-10-2026: Enter never
    // stays still); the next Enter saves. One Enter alone never saves money.
    const onSave = `(document.activeElement?.type === "submit" && document.activeElement.closest('[role="dialog"]')?.getAttribute("aria-label") === "Datos del Cargo...")`;
    const here = () => page.evaluate(`document.activeElement?.id || document.activeElement?.textContent || ""`) as Promise<string>;
    for (let step = 0; step < 8 && !(await page.evaluate(onSave)); step += 1) {
      const before = await here();
      await keys("Enter");
      assert.notEqual(await here(), before, "Enter never stays still");
    }
    assert.equal(await page.evaluate(onSave), true);
    assert.equal(writes(/^\/api\/cargos/).length, 0, "reaching the button saves nothing");
    // Back from the button to the amount with ← and forth again with →: the side arrows go both ways.
    for (let step = 0; step < 8 && await page.evaluate(`document.activeElement?.id`) !== "cargo-amount"; step += 1) await keys("ArrowLeft");
    assert.equal(await page.evaluate(`document.activeElement?.id`), "cargo-amount");
    for (let step = 0; step < 8 && !(await page.evaluate(onSave)); step += 1) await keys("ArrowRight");
    assert.equal(await page.evaluate(onSave), true);
    await keys("Enter");
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

    // ── Reportes: a report of remesas, consulted with Enter and printed with its button ──
    await menuTo("Reportes");
    await keys("Enter");
    await inWindow("Reportes");
    await tabTo((element) => element.textContent?.trim() === "Montos y cantidad de envíos");
    await keys("Enter");
    await waitFor(() => document.querySelector('.mdi-window[aria-label*="Montos y cantidad"]') !== null && document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label")?.includes("Montos y cantidad") === true);
    // Enter goes through its filters and, from the last one, to «Consultar», which Enter presses.
    const consulted = requests.length;
    for (let step = 0; step < 12 && !requests.slice(consulted).some((request) => request.path.startsWith("/api/envios/reportes")); step += 1) await keys("Enter");
    await waitFor(() => document.querySelector('.mdi-window[aria-label*="Montos y cantidad"] button[aria-label="Imprimir"]:not(:disabled)') !== null);
    assert.ok(requests.slice(consulted).some((request) => request.path.startsWith("/api/envios/reportes")));
    // Tab reaches «Consultar»; → goes on to «Imprimir», beside it; Enter prints.
    await tabTo((element) => element.textContent?.trim() === "Consultar" && element.closest(".mdi-window")?.getAttribute("aria-label")?.includes("Montos y cantidad") === true, 40);
    await keys("ArrowRight");
    assert.equal(await page.evaluate(`document.activeElement?.textContent?.trim()`), "Imprimir");
    await keys("Enter");
    await keys("Escape");
    await waitFor(() => !document.querySelector('.mdi-window[aria-label*="Montos y cantidad"]'));

    // ── Configuración de administración → Rutas ──
    await menuTo("Configuración de administración");
    await keys("Enter");
    await inWindow("Configuración de administración");
    // Tab reaches the tiles of its section; → goes from one tile to the next until Rutas.
    await tabTo((element) => element.matches(".control-panel-tile") && [...(element.closest(".control-panel-grid")?.querySelectorAll(".control-panel-tile") ?? [])].some((tile) => tile.textContent?.trim() === "Rutas"));
    for (let step = 0; step < 30 && await page.evaluate(`document.activeElement?.textContent?.trim()`) !== "Rutas"; step += 1) await keys("ArrowRight");
    assert.equal(await page.evaluate(`document.activeElement?.textContent?.trim()`), "Rutas");
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

    // ── Header: Facturas ── Esc, Esc… closes the windows still open (Reportes, behind); with none left the keyboard
    // is on the menu, and Tab reaches the header.
    for (let step = 0; step < 4 && !(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")))); step += 1) await keys("Escape");
    await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")) && !document.querySelector(".mdi-window"));
    await tabTo((element) => element.getAttribute("aria-label") === "Facturas");
    await keys("Enter");
    await inWindow("Ventana de Facturas");
    await keys("Escape");
    await waitFor(() => document.activeElement?.getAttribute("aria-label") === "Facturas");

    // Nothing extra was drawn on the screen at any moment of the way.
    assert.equal(await page.locator("[aria-keyshortcuts], .cyp-key-badge, .cyp-key-hint, .cyp-keyboard-status").count(), 0);

    await harness.assertNoPointer();
    await page.screenshot({ path: path.join(output, "teclado-admin.png") });
    console.log(`UI evidence: ${output}`);
  } finally { await harness.close(); await app.close(); }
});
