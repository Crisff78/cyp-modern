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

// New records from start to end and back with the keyboard only (goal of 28-10-2026: «cliente nuevo y editarlo; cargo
// recurrente, descargo; cobradores, rutas, zonas y codificadores», «de inicio a fin Y de fin a inicio»): «Nuevo» with
// the keys, every field filled going down with Enter, back up to the first one with ←, down again with → up to the
// button, and Enter saves. Real Admin shell, API and MemoryStore, synthetic data.
test("New records with the keyboard only: down with Enter, back with ←, forth with →, Enter saves; a client is edited", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-teclado-altas-"));
  const state = seed();
  const client = state.clients.find((item) => item.id === "cli-1")!;
  // A service of the catalog, as the real data have (the synthetic one comes empty): a recurring charge needs one.
  state.services.push({ id: "service-keyboard", service: "Servicio semanal", abbr: "S", caption: "", obligated: false, fixedAmount: false, active: true });
  const app = await buildApp({ store: new MemoryStore(state), demo: true, secret: "synthetic-keyboard-new-records-secret-at-least-32", origins: [], collectorUrl: "/collector/" });
  const harness = await keyboardHarness({ app, adminRoot, output, playwrightEntry: playwrightEntry!, edge, localRequire, idempotencyKey: randomUUID });
  try {
    const { page, keys, waitFor, menuTo, tabTo, requests } = await harness.signedOut();
    await waitFor(() => document.activeElement?.id === "admin-login-username");
    await page.keyboard.type("admin@cyp.local"); await keys("Enter");
    await page.keyboard.type(DEMO_PASSWORD); await keys("Enter");
    await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")));
    const DIALOG = '.legacy-dialog, dialog[open], [role="dialog"][data-state="open"]';
    const inDialog = `Boolean(document.activeElement?.closest(${JSON.stringify(DIALOG)}))`;
    const saved = () => requests.filter((request) => request.method !== "GET" && request.status < 300 && !request.path.startsWith("/api/auth/")).length;
    // The field with the keyboard: what it is called and what it holds.
    const here = () => page.evaluate(`(() => {
      const a = document.activeElement;
      const own = (label) => label ? [...label.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join("").replace(/\\s+/g, " ").trim() : "";
      const label = a?.getAttribute("aria-label") || own(a?.id ? document.querySelector('label[for="' + a.id + '"]') : null) || own(a?.closest("label")) || "";
      return { tag: a?.tagName ?? "", type: a?.type ?? "", id: a?.id ?? "", label, placeholder: a?.getAttribute("placeholder") ?? "", value: a?.value ?? "", empty: "value" in (a ?? {}) && !a.value, field: Boolean(a?.matches("input,select,textarea")), button: a?.tagName === "BUTTON", submit: a?.tagName === "BUTTON" && (a.type === "submit" || /^(Aceptar|Guardar)/.test(a.textContent.trim())), disabled: Boolean(a?.disabled), inDialog: Boolean(a?.closest(${JSON.stringify(DIALOG)})) };
    })()`) as Promise<{ tag: string; type: string; id: string; label: string; placeholder: string; value: string; empty: boolean; field: boolean; button: boolean; submit: boolean; disabled: boolean; inDialog: boolean }>;
    // What a person would type in a field, by its name (money from the cents: 10000 is 100.00).
    let window = "";
    const valueFor = (field: { label: string; id: string; type: string; placeholder: string }, index: number) => {
      const name = `${field.label} ${field.id}`;
      // A code the system gives when saving: nothing to type.
      if (/se asignar/i.test(field.placeholder)) return "";
      if (/client-code/i.test(field.id) || /^c[oó]digo del cliente/i.test(field.label)) return client.code;
      if (/c[eé]dula|pasaporte|identificaci/i.test(name)) return `4021234${String(5000 + index).slice(-4)}`;
      if (/tel[eé]fono|celular/i.test(name) || field.type === "tel") return "8095550199";
      // A new account: its user and a synthetic first password of the length asked (15 or more).
      if (/usuario \/ correo/i.test(name)) return "qa.teclado@cyp.local";
      if (/contrase|clave/i.test(name)) return "Clave-sintetica-QA-2026";
      if (/e-?mail|correo/i.test(name) || field.type === "email") return "";
      if (/servicio/i.test(name)) return window === "Servicios y Productos" ? "Servicio QA teclado" : "Servicio semanal";
      if (/importe|monto|l[ií]mite/i.test(name)) return "10000";
      if (/cantidad/i.test(name) || field.type === "number") return "1";
      if (/n[uú]mero/i.test(name)) return String(90 + index);
      if (/d[ií]a/i.test(name)) return "5";
      if (field.type === "date" || /ubicaci[oó]n/i.test(name)) return "";
      return `QA teclado ${index}`;
    };

    // Opens «Nuevo» of a window, fills it going down with Enter, goes back to its first field with ← and down again
    // with → to its button, and saves with Enter. Returns what it did, to say where it failed.
    const newRecord = async (open: () => Promise<void>, extra?: () => Promise<void>) => {
      const trace: string[] = [];
      await open();
      await waitFor(() => Boolean(document.activeElement?.closest(".mdi-window.focused")));
      const title = await page.evaluate(`document.activeElement.closest(".mdi-window").getAttribute("aria-label")`) as string;
      window = title;
      await tabTo((element) => element.closest(".legacy-mdi-toolbar") !== null && /^(Nuevo|Agregar)/.test(element.getAttribute("title") ?? ""), 80, null, "Shift+Tab");
      await keys("Enter");
      await page.waitForFunction(inDialog);
      await page.waitForTimeout(400);
      const before = saved();
      // Down with Enter: each field gets what a person would type; a list to choose from is opened with ↓ and chosen.
      const visited: string[] = [];
      for (let step = 0; step < 40; step += 1) {
        const field = await here();
        if (!field.inDialog) { trace.push(`fuera del diálogo en ${field.tag} «${field.label}»`); break; }
        if (field.submit) break;
        if (field.field) {
          visited.push(field.label || field.id);
          if (field.tag === "SELECT") {
            if (field.empty || /^(Seleccione|No definid)/i.test(await page.evaluate(`document.activeElement.selectedOptions[0]?.textContent ?? ""`) as string)) {
              await page.waitForFunction(`!document.activeElement.disabled && document.activeElement.options.length > 1`, undefined, { timeout: 5000 }).catch(() => undefined);
              await keys("ArrowDown", "ArrowDown", "Enter");
            }
          } else if ((field.empty || /^0(.0+)?$/.test(field.value)) && field.type !== "checkbox" && field.type !== "radio") {
            const value = valueFor(field, step);
            if (value) await page.keyboard.type(value);
          }
          trace.push(`${field.label || field.id}=${(await here()).value}`);
        }
        // The element with the keyboard is marked: after Enter, the keyboard must be on another one.
        await page.evaluate(`document.activeElement?.setAttribute("data-qa-from", "1")`);
        await keys("Enter");
        await page.waitForTimeout(150);
        const stayed = await page.evaluate(`(() => { const from = document.querySelector("[data-qa-from]"); from?.removeAttribute("data-qa-from"); return document.activeElement === from; })()`);
        if (stayed && !(await here()).submit) { trace.push(`Intro se quedó en «${field.label}»`); break; }
      }
      // What the record needs besides its fields (the charges of a receipt), done with the keys before saving.
      if (extra) await extra();
      const atButton = await here();
      assert.ok(atButton.submit, `${title}: Enter reaches the button (${trace.join(" · ")})`);
      assert.equal(saved(), before, `${title}: reaching the button saves nothing`);
      // Back to the first field with ←, and down again with → to the button.
      const first = visited[0];
      for (let step = 0; step < 60 && (await here()).label !== first && (await here()).id !== first; step += 1) await keys("ArrowLeft");
      const top = await here();
      assert.ok(top.label === first || top.id === first, `${title}: ← goes back up to «${first}»`);
      for (let step = 0; step < 60 && !(await here()).submit; step += 1) await keys("ArrowRight");
      assert.ok((await here()).submit, `${title}: → goes down to the button again`);
      await keys("Enter");
      await page.waitForFunction(`!${inDialog}`, undefined, { timeout: 8000 }).catch(async () => {
        const alerts = await page.evaluate(`[...document.querySelectorAll('[role="alert"], [data-sonner-toast]')].map((item) => item.textContent.trim()).filter(Boolean).join(" | ")`);
        assert.fail(`${title}: Enter on the button did not save: ${alerts} (${trace.join(" · ")})`);
      });
      assert.ok(saved() > before, `${title}: saved`);
      // The keyboard is back in the window, which closes with Esc.
      await waitFor((name: string) => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") === name, title);
      await keys("Escape");
      await waitFor((name: string) => !document.querySelector(`.mdi-window[aria-label="${name}"]`), title);
      return title;
    };
    // After each record, whatever it left open is closed (the question «Cambios sin guardar» answered Sí), back to the menu.
    const reset = async () => {
      for (let step = 0; step < 16; step += 1) {
        if (await page.evaluate(`document.activeElement?.closest("dialog")?.getAttribute("aria-label") === "Cambios sin guardar"`)) { await keys("Enter"); continue; }
        // A question of a dialog about leaving what was not saved: Sí (← from No).
        if (await page.evaluate(`document.activeElement?.textContent?.trim() === "No" && [...(document.activeElement.parentElement?.querySelectorAll("button") ?? [])].some((button) => button.textContent.trim() === "Sí")`)) { await keys("ArrowLeft", "Enter"); continue; }
        if (!(await page.evaluate(`document.querySelectorAll(".mdi-window, ${DIALOG.replaceAll('"', '\\"')}").length`))) break;
        await keys("Escape"); await page.waitForTimeout(250);
      }
      await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]"))).catch((error) => { console.log(`reset: ${error.message.split("\n").slice(-1)[0]}`); });
    };
    const fromMenu = (option: string) => async () => { await menuTo(option); await keys("Enter"); };
    const fromTile = (tile: string) => async () => {
      await menuTo("Configuración de administración"); await keys("Enter");
      await waitFor(() => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") === "Configuración de administración");
      await tabTo((element, name) => (element.textContent ?? "").replace(/\s+/g, " ").trim() === name && element.matches(".control-panel-tile"), 60, tile);
      await keys("Enter");
    };

    // Cobros: after its fields, ← up to «Agregar», Enter opens the pending charges, ↓ and Enter add the first one, and
    // Tab goes on to the button that saves.
    const extras: Record<string, () => Promise<void>> = {
      Cobros: async () => {
        await tabTo((element) => (element.textContent ?? "").trim() === "Agregar" && !(element as HTMLButtonElement).disabled, 30, null, "Shift+Tab");
        await keys("Enter");
        await waitFor(() => document.querySelectorAll(".legacy-dialog").length >= 2 && Boolean(document.activeElement?.closest(".legacy-dialog")));
        if (!(await page.evaluate(`document.activeElement?.tagName === "TR"`))) await tabTo((element) => element.tagName === "TR", 20);
        await keys("Enter");
        await waitFor(() => document.querySelectorAll(".legacy-dialog").length === 1);
        await tabTo((element) => (element as HTMLButtonElement).type === "submit" || /^(Aceptar|Guardar)/.test((element.textContent ?? "").trim()), 30);
      },
    };
    for (const [name, open] of [["Clientes", fromMenu("Clientes")], ["Cargos Recurrentes", fromMenu("Cargos Recurrentes")], ["Descargos", fromMenu("Descargos")],
      ["Cobros", fromMenu("Cobros")], ["Cobradores", fromTile("Cobradores")], ["Zonas", fromTile("Zonas")], ["Rutas", fromTile("Rutas")], ["Bancos", fromTile("Bancos")],
      ["Motivos de Atraso", fromTile("Motivos Atraso")], ["Grupos de PCPs", fromTile("Grupos")], ["Servicios y Productos", fromTile("Servicios y Prods.")], ["Usuarios", fromTile("Usuarios")]] as const)
      await t.test(`${name}: «Nuevo» filled down with Enter, back with ←, forth with →, saved with Enter`, async () => { try { await newRecord(open, extras[name]); } finally { await reset(); } });

    // A button of the toolbar of the window in front: Shift+Tab up to the bar, then → up to it.
    const toToolbar = async (name: string) => {
      await tabTo((element) => element.closest(".legacy-mdi-toolbar") !== null, 60, null, "Shift+Tab");
      for (let step = 0; step < 20 && await page.evaluate(`document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.getAttribute("title")`) !== name; step += 1) await keys("ArrowRight");
      assert.equal(await page.evaluate(`document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.getAttribute("title")`), name);
    };
    // The account just made, chosen in the list of Usuarios with the keys.
    const chooseNewAccount = async () => {
      await fromTile("Usuarios")();
      await waitFor(() => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") === "Usuarios");
      await waitFor(() => [...document.querySelectorAll(".mdi-window.focused tbody tr")].some((row) => row.textContent?.includes("qa.teclado@cyp.local")));
      if (!(await page.evaluate(`document.activeElement?.tagName === "TR"`))) await tabTo((element) => element.tagName === "TR", 40);
      for (let step = 0; step < 30 && !(await page.evaluate(`document.activeElement?.textContent?.includes("qa.teclado@cyp.local")`)); step += 1) await keys("ArrowDown");
      assert.equal(await page.evaluate(`document.activeElement?.textContent?.includes("qa.teclado@cyp.local")`), true);
    };

    await t.test("Usuarios: «Cambiar Clave» of the new account with the keys: the password, Enter, its confirmation, Enter, Enter saves", async () => {
      try {
        await chooseNewAccount();
        await toToolbar("Cambiar Clave");
        await keys("Enter");
        await page.waitForFunction(inDialog);
        const before = saved();
        for (let step = 0; step < 6 && !(await here()).submit; step += 1) {
          if ((await here()).field) await page.keyboard.type("Otra-clave-sintetica-2026");
          await keys("Enter");
        }
        assert.ok((await here()).submit, "Enter reaches the button");
        assert.equal(saved(), before, "reaching the button saves nothing");
        await keys("Enter");
        await page.waitForFunction(`!${inDialog}`, undefined, { timeout: 8000 });
        assert.ok(saved() > before, "the password was changed");
      } finally { await reset(); }
    });

    await t.test("Usuarios: «Permisos» of the new account: a permission taken away (Sí) and saved, all with the keys", async () => {
      try {
        await chooseNewAccount();
        await toToolbar("Permisos");
        await keys("Enter");
        await waitFor(() => document.activeElement?.closest(".connected-user-permissions-dialog") !== null);
        await waitFor(() => [...document.querySelectorAll(".connected-user-permissions-dialog button")].some((button) => (button.getAttribute("aria-label") ?? "").startsWith("Quitar permiso") && !(button as HTMLButtonElement).disabled));
        await tabTo((element) => (element.getAttribute("aria-label") ?? "").startsWith("Quitar permiso") && !(element as HTMLButtonElement).disabled, 80);
        await keys("Enter");
        // The question: No has the keyboard; ← goes to Sí, Enter answers.
        await waitFor(() => document.activeElement?.closest(".legacy-dialog")?.textContent?.includes("Quitar permiso") === true && document.activeElement?.textContent?.trim() === "No");
        await keys("ArrowLeft");
        assert.equal(await page.evaluate(`document.activeElement?.textContent?.trim()`), "Sí");
        await keys("Enter");
        const before = saved();
        await tabTo((element) => (element as HTMLButtonElement).type === "submit" && element.closest(".connected-user-permissions-dialog") !== null, 80);
        await keys("Enter");
        // A question before saving, if it asks: Sí.
        for (let step = 0; step < 20 && saved() === before; step += 1) {
          if (await page.evaluate(`[...document.querySelectorAll(".legacy-dialog")].length > 1 && [...document.querySelectorAll(".legacy-dialog button")].some((button) => button.textContent.trim() === "Sí")`)) {
            if (await page.evaluate(`document.activeElement?.textContent?.trim()`) !== "Sí") await keys("ArrowLeft");
            await keys("Enter");
          }
          await page.waitForTimeout(250);
        }
        assert.ok(saved() > before, "the permissions were saved");
      } finally { await reset(); }
    });

    await t.test("Configuración General: a field changed with the keys, Enter down to «Aceptar», Enter saves", async () => {
      try {
        await fromTile("Configuración General")();
        await waitFor(() => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") === "Configuración General");
        await tabTo((element) => (element.closest("label")?.textContent ?? "").trim().startsWith("Empresa"), 60);
        await keys("End");
        await page.keyboard.type(" QA");
        const before = saved();
        for (let step = 0; step < 80 && await page.evaluate(`document.activeElement?.textContent?.trim()`) !== "Aceptar"; step += 1) await keys("Enter");
        assert.equal(await page.evaluate(`document.activeElement?.textContent?.trim()`), "Aceptar", "Enter reaches «Aceptar»");
        assert.equal(saved(), before, "reaching the button saves nothing");
        await keys("Enter");
        for (let step = 0; step < 40 && saved() === before; step += 1) await page.waitForTimeout(200);
        assert.ok(saved() > before, "the configuration was saved");
      } finally { await reset(); }
    });

    await t.test("Reportes: a report with its filters, Imprimir and Exportar, all with the keys", async () => {
      try {
        await menuTo("Reportes"); await keys("Enter");
        await waitFor(() => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") === "Reportes");
        await tabTo((element) => element.matches(".report-launcher-tile"), 40);
        await keys("Enter");
        await waitFor(() => Boolean(document.activeElement?.closest(".mdi-window")) && document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") !== "Reportes");
        // Down the filters with Enter up to «Imprimir».
        await page.evaluate(`window.__printed = 0; window.print = () => { window.__printed += 1; }; window.open = () => ({ document: { write() {}, close() {} }, focus() {}, print() { window.__printed += 1; }, close() {} })`);
        for (let step = 0; step < 20 && !(await page.evaluate(`/Imprimir/.test(document.activeElement?.textContent ?? "")`)); step += 1) await keys(await page.evaluate(`Boolean(document.activeElement?.matches("input,select,textarea"))`) ? "Enter" : "Tab");
        assert.equal(await page.evaluate(`/Imprimir/.test(document.activeElement?.textContent ?? "")`), true, "the keys reach «Imprimir»");
        await keys("Enter");
        await keys("ArrowRight");
        assert.match(await page.evaluate(`document.activeElement?.textContent ?? ""`) as string, /Exportar/);
        await keys("Enter");
        await page.waitForFunction(inDialog);
        const download = page.waitForEvent("download", { timeout: 8000 });
        await keys("Enter");
        assert.equal((await here()).submit, true, "Enter goes from the format to «Aceptar»");
        await keys("Enter");
        await download;
      } finally { await reset(); }
    });

    await t.test("Clientes: the client just made is found, opened with Enter, changed and saved with the keys", async () => {
      await menuTo("Clientes"); await keys("Enter");
      await waitFor(() => document.activeElement?.getAttribute("aria-label") === "Buscar clientes por código, teléfono o nota");
      await page.keyboard.type("8095550199");
      await waitFor(() => document.querySelectorAll(".clients-grid tbody tr[role=button]").length === 1);
      await keys("ArrowDown", "Enter");
      await page.waitForFunction(inDialog);
      const before = saved();
      const onKnownAs = `(document.activeElement?.closest("label")?.textContent ?? "").trim().startsWith("Conocido por")`;
      for (let step = 0; step < 12 && !(await page.evaluate(onKnownAs)); step += 1) await keys("Enter");
      assert.equal(await page.evaluate(onKnownAs), true, "Enter reaches «Conocido por»");
      await keys("End");
      await page.keyboard.type(" editado");
      for (let step = 0; step < 20 && !(await here()).submit; step += 1) await keys("Enter");
      assert.ok((await here()).submit);
      await keys("Enter");
      await page.waitForFunction(`!${inDialog}`, undefined, { timeout: 8000 });
      assert.ok(saved() > before, "the change was saved");
      await keys("Escape");
    });

    await harness.assertNoPointer();
  } finally { await harness.close(); await app.close(); }
});
