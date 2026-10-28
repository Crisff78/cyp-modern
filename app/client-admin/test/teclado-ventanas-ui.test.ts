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

// Every window of the portal with the keyboard only (goal of 27-10-2026, «para toda la aplicación»): each option of
// the menu, of Configuración de administración and of Reportes opens with the keys, takes the keyboard, moves its
// list with the arrows, opens its «Nuevo» (Tab up to it, Enter) and its record (Enter) and closes them with Esc, and closes with Esc.
// Nothing is typed, so nothing is saved: no request that writes may happen.
test("Every window of the portal with the keyboard only: opens, takes the keyboard, ↓ in its list, «Nuevo» and Enter open, Esc closes, simple keys only", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-teclado-ventanas-"));
  const store = new MemoryStore(seed());
  const app = await buildApp({ store, demo: true, secret: "synthetic-keyboard-windows-secret-at-least-32-chars", origins: [], collectorUrl: "/collector/" });
  const harness = await keyboardHarness({ app, adminRoot, output, playwrightEntry: playwrightEntry!, edge, localRequire, idempotencyKey: randomUUID });
  try {
    const { page, keys, waitFor, menuTo, tabTo, requests } = await harness.signedOut();
    await waitFor(() => document.activeElement?.id === "admin-login-username");
    await page.keyboard.type("admin@cyp.local"); await keys("Enter");
    await page.keyboard.type(DEMO_PASSWORD); await keys("Enter");
    await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")));
    const writesBefore = () => requests.filter((request) => request.method !== "GET" && !request.path.startsWith("/api/auth/")).length;
    const writes = writesBefore();

    // The options, read from the menu and from the two launchers (reading the page is not using it).
    await page.waitForFunction(`document.querySelectorAll("[data-keyboard-menu] .nav-group").length > 3`);
    const menu = await page.evaluate(`[...document.querySelectorAll("[data-keyboard-menu] .nav-item, [data-keyboard-menu] .nav-group-direct > .nav-group-trigger")].map((item) => item.getAttribute("aria-label"))`) as string[];
    const tilesOf = async (launcher: string, tile: string) => {
      await menuTo(launcher); await keys("Enter");
      await waitFor((title: string) => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") === title, launcher);
      const names = await page.evaluate(`[...document.querySelectorAll("${tile}")].map((item) => item.textContent.replace(/\\s+/g, " ").trim())`) as string[];
      await keys("Escape"); await waitFor((title: string) => !document.querySelector(`.mdi-window[aria-label="${title}"]`), launcher);
      return names;
    };
    const tiles = await tilesOf("Configuración de administración", ".control-panel-tile");
    const reports = await tilesOf("Reportes", ".report-launcher-tile");
    assert.ok(menu.length >= 15 && tiles.length >= 14 && reports.length >= 20, `${menu.length} options, ${tiles.length} tiles, ${reports.length} reports`);

    const checked: string[] = [];
    // What each window did with the keys: the inventory of docs/TECLADO-COMPLETO.md comes from here.
    const inventory: { window: string; from: string; focus: string; list: boolean; enter: string; nuevo: string; esc: boolean }[] = [];
    const describeFocus = () => page.evaluate(`(() => { const a = document.activeElement; if (!a) return ""; if (a.closest("tbody")) return "la lista"; if (a.matches("input[type=search]") || /buscar|digite|búsqueda/i.test((a.closest("label")?.textContent ?? "") + " " + (a.getAttribute("aria-label") ?? "") + " " + (a.getAttribute("placeholder") ?? ""))) return "la búsqueda"; if (a.matches("input,select,textarea")) return "el primer campo: " + ([...(a.closest("label")?.childNodes ?? [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim() || a.getAttribute("aria-label") || a.id || "campo"); return "el botón " + (a.getAttribute("aria-label") || a.textContent || "").replace(/\s+/g, " ").trim(); })()`) as Promise<string>;
    const openedTitle = () => page.evaluate(`(() => { const d = [...document.querySelectorAll('.legacy-dialog, dialog[open], .remittance-receipt-window, [role="dialog"][data-state="open"]')].pop(); return d ? (d.getAttribute("aria-label") || d.querySelector("h2")?.textContent || "diálogo") : ""; })()`) as Promise<string>;
    // ← → and Enter in every field of a window or dialog (28-10-2026, «cero sitios donde el teclado se quede quieto»): each
    // key, from each field, takes the keyboard somewhere else (Enter may also send its form, open what the field opens,
    // or, in a form with a required field still empty, the browser asks to fill it in). Nothing is sent: while these keys are tried a form that would be sent is held back before the screen sees it.
    const stuck: string[] = [];
    await page.evaluate(`window.addEventListener("submit", (event) => { if (!window.__holdSubmit) return; event.preventDefault(); event.stopImmediatePropagation(); window.__submitted = (window.__submitted || 0) + 1; }, true)`);
    const OPEN = '.legacy-dialog-overlay, dialog[open], [role="dialog"][data-state="open"], .remittance-receipt-window';
    const checkFields = async (scope: string, label: string) => {
      const count = await page.evaluate(`(() => {
        const scope = [...document.querySelectorAll(${JSON.stringify(scope)})].filter((item) => item.getClientRects().length).pop();
        const owner = scope?.closest('[role="dialog"],dialog') ?? scope;
        window.__fields = scope ? [...scope.querySelectorAll('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=file]),select,textarea')].filter((field) => field.closest('[role="dialog"],dialog') === owner && field.getClientRects().length && !field.disabled && !field.closest("fieldset:disabled") && !field.readOnly && field.tabIndex >= 0) : [];
        return window.__fields.length;
      })()`) as number;
      for (let index = 0; index < Math.min(count, 30); index += 1) for (const key of ["ArrowLeft", "ArrowRight", "Enter"]) {
        const name = await page.evaluate(`(() => { const field = window.__fields[${index}]; if (!field?.isConnected || !field.getClientRects().length) return null; window.__holdSubmit = true; window.__submitted = 0; window.__opened = document.querySelectorAll(${JSON.stringify(OPEN)}).length; field.focus(); if (${JSON.stringify(key)} !== "Enter") { try { field.select(); } catch {} } return (field.getAttribute("aria-label") || [...(field.closest("label")?.childNodes ?? [])].filter((node) => node.nodeType === 3).map((node) => node.textContent).join("").trim() || field.name || field.type).slice(0, 40); })()`) as string | null;
        if (name === null) continue;
        await page.keyboard.press(key); await page.waitForTimeout(140);
        const moved = await page.evaluate(`(() => { const field = window.__fields[${index}]; const moved = document.activeElement !== field || window.__submitted > 0 || document.querySelectorAll(${JSON.stringify(OPEN)}).length !== window.__opened || (${JSON.stringify(key)} === "Enter" && Boolean(field.form) && !field.form.checkValidity()); window.__holdSubmit = false; return moved; })()`);
        if (!moved) stuck.push(`${label}: «${name}» con ${key}`);
        // Whatever the key opened closes again.
        for (let guard = 0; guard < 3 && await page.evaluate(`document.querySelectorAll(${JSON.stringify(OPEN)}).length > window.__opened`); guard += 1) { await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
      }
    };
    const visit = async (name: string, open: () => Promise<void>) => {
      await t.test(name, async () => {
        const windowsBefore = await page.evaluate(`document.querySelectorAll(".mdi-window").length`) as number;
        await open();
        // A new window in front, with the keyboard inside it.
        await waitFor((count: number) => document.querySelectorAll(".mdi-window").length > count && Boolean(document.activeElement?.closest(".mdi-window.focused")), windowsBefore);
        const title = await page.evaluate(`document.activeElement.closest(".mdi-window").getAttribute("aria-label")`) as string;
        const entry = { window: title, from: name.split(" → ")[0], focus: "", list: false, enter: "—", nuevo: "—", esc: false };
        await page.waitForTimeout(500);
        entry.focus = await describeFocus();
        // Its list, once it has arrived: ↓ moves the chosen row.
        await page.waitForTimeout(500);
        const listed = await page.evaluate(`(() => { const win = document.querySelector(".mdi-window.focused"); const body = [...win.querySelectorAll("tbody")].find((item) => [...item.rows].filter((row) => row.hasAttribute("tabindex") || row.querySelector("button")).length >= 2); return Boolean(body); })()`);
        entry.list = Boolean(listed);
        if (listed) {
          if (!(await page.evaluate(`document.activeElement?.tagName === "TR" || Boolean(document.activeElement?.closest("tbody"))`))) {
            // From its search (or its first field) ↓ or Enter go down to the list.
            await keys("ArrowDown");
            if (!(await page.evaluate(`Boolean(document.activeElement?.closest("tbody"))`))) await tabTo((element) => Boolean(element.closest("tbody")), 40);
          }
          const first = await page.evaluate(`document.activeElement.closest("tr").rowIndex`);
          await keys("ArrowDown");
          assert.notEqual(await page.evaluate(`document.activeElement.closest("tr")?.rowIndex`), first, `${title}: ↓ moves in the list`);
          // Enter does what a double click does; whatever it opens closes with Esc and gives the keyboard back.
          const modalsBefore = await page.evaluate(`document.querySelectorAll('.legacy-dialog-overlay, dialog[open], .remittance-receipt-window').length`) as number;
          await keys("Enter");
          await page.waitForTimeout(400);
          entry.enter = "selecciona la fila";
          if (await page.evaluate(`document.querySelectorAll('.legacy-dialog-overlay, dialog[open], .remittance-receipt-window').length`) as number > modalsBefore) {
            entry.enter = "abre «" + await openedTitle() + "»";
            await waitFor(() => Boolean(document.activeElement?.closest('.legacy-dialog, dialog[open], .remittance-receipt-window')));
            await keys("Escape");
            await waitFor((count: number) => document.querySelectorAll('.legacy-dialog-overlay, dialog[open], .remittance-receipt-window').length === count, modalsBefore);
            await waitFor((name: string) => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") === name, title);
          }
        }
        await checkFields(".mdi-window.focused", title);
        // «Nuevo», when the window has one: Mayús+Tab goes up to it and Enter opens it; Esc closes it at once (nothing typed) and
        // the keyboard comes back.
        if (await page.evaluate(`Boolean([...document.querySelectorAll(".mdi-window.focused .legacy-mdi-toolbar button")].find((button) => button.title.startsWith("Nuevo") && !button.disabled))`)) {
          await tabTo((element) => element.closest(".legacy-mdi-toolbar") !== null && (element.getAttribute("title") ?? "").startsWith("Nuevo"), 60, null, "Shift+Tab");
          await keys("Enter");
          await waitFor(() => Boolean(document.activeElement?.closest(".legacy-dialog, dialog[open]")) || Boolean(document.querySelector('[role="dialog"][data-state="open"]')));
          entry.nuevo = "abre «" + await openedTitle() + "»";
          await checkFields('.legacy-dialog, dialog[open], [role="dialog"][data-state="open"]', `${title} › Nuevo`);
          await keys("Escape");
          await waitFor(() => !document.querySelector(".legacy-dialog-overlay, dialog[open]"));
          await waitFor((name: string) => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") === name, title);
        }
        // Esc closes the window (nothing typed: it does not ask) and the keyboard goes to the window behind (the
        // launcher it was opened from) or, with none, to the menu.
        await keys("Escape");
        await waitFor((name: string) => !document.querySelector(`.mdi-window[aria-label="${name}"]`), title);
        await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]") || document.activeElement?.closest(".mdi-window.focused")));
        assert.equal(writesBefore(), writes, `${title}: the keys never saved anything`);
        entry.esc = true;
        inventory.push(entry);
        checked.push(title);
      });
    };
    for (const option of menu) if (option !== "Configuración de administración" && option !== "Reportes") await visit(`menu → ${option}`, async () => { await menuTo(option); await keys("Enter"); });
    for (const [launcher, names] of [["Configuración de administración", tiles], ["Reportes", reports]] as const) for (const name of names) await visit(`${launcher} → ${name}`, async () => {
      await menuTo(launcher); await keys("Enter");
      await waitFor((title: string) => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") === title, launcher);
      await tabTo((element, tile) => (element.textContent ?? "").replace(/\s+/g, " ").trim() === tile && element.matches(".control-panel-tile,.report-launcher-tile"), 60, name);
      await keys("Enter");
      // The launcher stays behind; the window of the tile is in front.
      await waitFor((title: string) => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") !== title, launcher);
    });
    t.diagnostic(`${checked.length} windows checked with the keyboard only: ${checked.join(" · ")}`);
    assert.deepEqual(stuck, [], "every field takes ←, → and Enter somewhere else");
    fs.writeFileSync(path.join(output, "inventario-teclado.json"), JSON.stringify(inventory, null, 2));
    t.diagnostic(`inventory: ${path.join(output, "inventario-teclado.json")}`);
    await harness.assertNoPointer();
  } finally { await harness.close(); await app.close(); }
});
