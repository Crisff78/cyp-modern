import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";
import { businessDate } from "../../server/src/domain.js";
import { createRemittance, openRemittanceCash, quoteRemittance, setCommissionPolicy, setDailyRate } from "../../server/src/remittances.js";
import { DEMO_PASSWORD } from "../../server/src/demo-credentials.js";
import { DEMO_CASHIER_EMAIL, enrichCashierDemo } from "../../server/src/demo-cashier-scenarios.js";
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

// The cashier works with the keyboard only (goal of 27-10-2026): from signing in to signing out, without one click.
// Real Admin shell, API and MemoryStore with synthetic data; no external request, no .env, no download.
test("Cajero with the keyboard only: sign in, open the box, send, deliver, count and close the box, notices and sign out, with simple keys only", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-teclado-cajero-"));
  const state = seed(), now = new Date(), today = businessDate(now);
  const admin = { id: "demo-admin", name: "Administración", role: "admin" as const };
  setDailyRate(state, admin, { currency: "USD", rate: "60", date: today }, now);
  setCommissionPolicy(state, admin, { transactionCommissionBps: 500, managerCommissionBps: 200 }, now);
  enrichCashierDemo(state, now);
  const sender = state.clients.find((client) => client.id === "cli-1")!, recipient = state.clients.find((client) => client.id === "cli-5")!;
  // A send of Administración waiting for its delivery: the cashier delivers it from Entregas de dinero.
  openRemittanceCash(state, admin, { operatorId: admin.id, currency: "DOP", openingAmount: 0 }, [], now);
  const input = { sourceCurrency: "DOP" as const, destinationCurrency: "DOP" as const, amount: 150000, commissionBps: 500 };
  const waiting = createRemittance(state, admin, { ...input, senderClientId: sender.id, recipientClientId: recipient.id, quote: quoteRemittance(state, input, now).quote }, [], now);
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-keyboard-cashier-secret-at-least-32-chars", origins: [], collectorUrl: "/collector/" });
  const harness = await keyboardHarness({ app, adminRoot, output, playwrightEntry: playwrightEntry!, edge, localRequire, idempotencyKey: randomUUID });
  try {
    const { page, keys, focused, waitFor, menuTo, tabTo, requests } = await harness.signedOut();
    const posts = (pathname: string | RegExp) => requests.filter((request) => request.method === "POST" && (typeof pathname === "string" ? request.path === pathname : pathname.test(request.path)));

    // Sign in: Enter goes from the user to the password and, from the password, signs in.
    await waitFor(() => document.activeElement?.getAttribute("aria-label") === "Usuario o correo" || document.activeElement?.id === "admin-login-username");
    await page.keyboard.type(DEMO_CASHIER_EMAIL);
    await keys("Enter");
    assert.equal((await focused()).type, "password");
    await page.keyboard.type(DEMO_PASSWORD);
    await keys("Enter");
    // The keyboard starts on the menu.
    await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")));

    // Cuadres Diarios → Caja de remesas: open today's box.
    await menuTo("Cuadres Diarios");
    await keys("Enter");
    await waitFor(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute("aria-label") === "Cuadres Diarios" && document.activeElement?.tagName === "SELECT");
    assert.equal((await focused()).label, "Moneda");
    await keys("Enter");
    assert.equal((await focused()).label, "Efectivo inicial");
    // Money fields are typed from the cents (IMPORTES-DESDE-CENTAVOS): 200000 is 2,000.00.
    await page.keyboard.type("200000");
    // Enter never stays still (28-10-2026): after the last field it goes to the button without pressing it, and nothing
    // is sent; the next Enter presses it, and the box still asks its confirmation.
    await keys("Enter");
    assert.equal((await focused()).label, "Revisar apertura");
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await keys("Enter");
    await waitFor(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label") === "Abrir caja de remesas");
    assert.equal((await focused()).label, "Confirmar");
    await keys("Enter");
    await waitFor(() => !document.querySelector("dialog[open]"));
    assert.equal(posts("/api/envios/cajas/abrir").length, 1);
    // The keyboard comes back into the window, not nowhere.
    await waitFor(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute("aria-label") === "Cuadres Diarios");
    // Saved: Esc closes without asking and the keyboard goes back to the menu.
    await keys("Escape");
    await waitFor(() => !document.querySelector('.mdi-window[aria-label="Cuadres Diarios"]'));
    await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")));

    // Envíos de dinero: a whole send.
    await menuTo("Envíos de dinero");
    await keys("Enter");
    await waitFor(() => document.activeElement?.getAttribute("role") === "combobox" && document.activeElement.closest("[data-client-side]")?.getAttribute("data-client-side") === "sender");
    // The sender waits without unfolding its list over the form.
    assert.equal(await page.locator('[data-client-side="sender"] [role="listbox"]').count(), 0);
    await page.keyboard.type(sender.code);
    // The list is ready once the search by phone has answered.
    await waitFor((code: string) => [...document.querySelectorAll('[data-client-side="sender"] [role="option"]')].some((option) => option.textContent?.includes(code)) && !document.querySelector('[data-client-side="sender"]')?.textContent?.includes("Buscando contactos"), sender.code);
    await keys("ArrowDown", "Enter");
    // Who sends and who receives first, then the money in the order of the whiteboard (Rardiel, 28-10-2026): Dinero a
    // enviar → Dinero que se recibe → Tasa. The sender chosen, the keyboard is on the recipient.
    await waitFor(() => document.activeElement?.closest("[data-client-side]")?.getAttribute("data-client-side") === "recipient");
    await page.keyboard.type(recipient.code);
    // The list is ready once the search by phone has answered.
    await waitFor((code: string) => [...document.querySelectorAll('[data-client-side="recipient"] [role="option"]')].some((option) => option.textContent?.includes(code)) && !document.querySelector('[data-client-side="recipient"]')?.textContent?.includes("Buscando contactos"), recipient.code);
    await keys("ArrowDown", "Enter");
    await waitFor((name: string) => document.querySelector('[data-client-side="recipient"] .remittance-client-selection')?.textContent?.includes(name) === true, recipient.name);
    await waitFor(() => document.activeElement?.closest("label")?.textContent?.startsWith("Teléfono del destinatario") === true);
    const box = () => page.evaluate(`document.activeElement?.closest("fieldset.remittance-money")?.querySelector("legend")?.textContent ?? ""`) as Promise<string>;
    await keys("Enter");
    assert.equal((await focused()).label, "Ingresar importe de");
    await keys("Enter");
    assert.equal((await focused()).label, "Nota (opcional)");
    await keys("Enter");
    assert.deepEqual([(await focused()).label, await box()], ["Moneda del remitente", "Dinero a enviar"]);
    await keys("Enter");
    assert.match((await focused()).label, /^Monto a enviar/);
    await page.keyboard.type("500");
    await keys("Enter");
    assert.deepEqual([(await focused()).label, await box()], ["Moneda del destinatario", "Dinero que se recibe"]);
    // The last field of money: Enter goes on to «Calcular cotización» without pressing it (Rardiel, 28-10-2026: there it
    // used to stay still). Back to the sender with ← and forth again with →, without changing anything.
    await keys("Enter");
    assert.equal((await focused()).label, "Calcular cotización");
    for (let step = 0; step < 30 && (await focused()).label !== "Remitente"; step += 1) await keys("ArrowLeft");
    assert.equal((await focused()).label, "Remitente");
    for (let step = 0; step < 30 && (await focused()).label !== "Calcular cotización"; step += 1) await keys("ArrowRight");
    assert.equal((await focused()).label, "Calcular cotización");
    assert.equal(posts("/api/envios").length, 0);
    // Enter: the quote comes and the keyboard is already on the next step.
    await keys("Enter");
    await waitFor(() => document.activeElement?.textContent === "Revisar y confirmar envío");
    await keys("Enter");
    await waitFor(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label") === "Confirmar envío");
    assert.equal((await focused()).label, "Forma de pago");
    // Enter goes on to the money received and then to «Aceptar», without pressing it: nothing is sent yet.
    await keys("Enter");
    assert.match((await focused()).label, /^Dinero recibido/);
    await keys("Enter");
    assert.equal((await focused()).label, "Aceptar");
    assert.equal(posts("/api/envios").length, 0);
    await keys("Enter");
    await waitFor(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label") === "¿Quieres imprimir el recibo?");
    assert.equal(posts("/api/envios").length, 1);
    assert.equal((await focused()).label, "Imprimir");
    await keys("Escape");
    await waitFor(() => document.activeElement?.closest("[data-client-side]")?.getAttribute("data-client-side") === "sender");
    await keys("Escape");
    await waitFor(() => !document.querySelector('.mdi-window[aria-label="Envíos de dinero"]'));

    // Entregas de dinero: find the receipt, open it, deliver it.
    await menuTo("Entregas de dinero");
    await keys("Enter");
    await waitFor(() => document.activeElement?.matches("[data-receipt-search]") === true);
    await page.keyboard.type(waiting.reciboReference);
    await waitFor((reference: string) => [...document.querySelectorAll(".remittance-transfer-table tbody button")].some((button) => button.textContent === reference) && document.querySelectorAll(".remittance-transfer-table tbody tr").length === 1, waiting.reciboReference);
    // ↓ goes from the search down to the list; Enter opens the receipt.
    await keys("ArrowDown");
    assert.equal((await focused()).label, waiting.reciboReference);
    await keys("Enter");
    await waitFor(() => document.activeElement?.closest(".remittance-receipt-window") !== null);
    // Its buttons go together: → from «Imprimir comprobante» reaches «Registrar entrega».
    await tabTo((element) => element.textContent === "Imprimir comprobante" && element.closest(".remittance-receipt-window") !== null, 30);
    await keys("ArrowRight");
    assert.equal((await focused()).label, "Registrar entrega");
    await keys("Enter");
    await waitFor(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label") === "Confirmar entrega al destinatario");
    await keys("Enter");
    await waitFor(() => !document.querySelector("dialog[open]"));
    assert.equal(posts(`/api/envios/${waiting.id}/pagar`).length, 1);
    // Esc closes the receipt, then the window.
    await waitFor(() => document.activeElement?.closest(".remittance-receipt-window") !== null || document.activeElement?.closest('[role="dialog"]')?.getAttribute("aria-label") === "Entregas de dinero");
    if (await page.evaluate(() => document.activeElement?.closest(".remittance-receipt-window") !== null)) await keys("Escape");
    await waitFor(() => !document.querySelector(".remittance-receipt-window") || getComputedStyle(document.querySelector(".remittance-receipt-window")!).display === "none" || !document.activeElement?.closest(".remittance-receipt-window"));
    await keys("Escape");
    await waitFor(() => !document.querySelector('.mdi-window[aria-label="Entregas de dinero"]'));

    // Cuadres Diarios: count the box and close it.
    await menuTo("Cuadres Diarios");
    await keys("Enter");
    await waitFor(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute("aria-label") === "Cuadres Diarios");
    await tabTo((element) => element.textContent === "Contar y cerrar");
    await keys("Enter");
    await waitFor(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label")?.startsWith("Contar caja") === true);
    // Typed from the cents: the digits of the expected amount.
    const expected = (await page.locator("dialog[open] p strong").first().textContent())!.replace(/\D/g, "");
    await page.keyboard.type(expected);
    // Enter goes on to «Revisar cierre» without pressing it; the next Enter asks the confirmation.
    for (let step = 0; step < 6 && (await focused()).label !== "Revisar cierre"; step += 1) await keys("Enter");
    assert.equal((await focused()).label, "Revisar cierre");
    assert.equal(await page.locator('dialog[open][aria-label="Confirmar cierre de caja"]').count(), 0, "reaching the button does not close the box");
    await keys("Enter");
    await waitFor(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label") === "Confirmar cierre de caja");
    await keys("Enter");
    await waitFor(() => !document.querySelector("dialog[open]"));
    assert.equal(posts(/^\/api\/envios\/cajas\/[^/]+\/cerrar$/).length, 1);
    await keys("Escape");
    await waitFor(() => !document.querySelector('.mdi-window[aria-label="Cuadres Diarios"]'));

    // Notices: the last window closed, the keyboard is on the menu; Tab reaches the bell; Esc gives the keyboard back to it.
    await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")));
    await tabTo((element) => (element.getAttribute("aria-label") ?? "").startsWith("Notificaciones"));
    await keys("Enter");
    await waitFor(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute("aria-labelledby") !== undefined && document.querySelector('[role="dialog"][data-state="open"]') !== null);
    await keys("Escape");
    await waitFor(() => (document.activeElement?.getAttribute("aria-label") ?? "").startsWith("Notificaciones"));

    // Nothing extra on the screen: no key is drawn on the buttons.
    assert.equal(await page.locator("[aria-keyshortcuts], .cyp-key-badge, .cyp-key-hint").count(), 0);

    // Sign out: the account, then «Cerrar sesión».
    await tabTo((element) => element.getAttribute("aria-label") === "Abrir cuenta");
    await keys("Enter");
    await waitFor(() => document.querySelector('[role="dialog"][data-state="open"]') !== null);
    await tabTo((element) => element.textContent?.trim() === "Cerrar sesión");
    await keys("Enter");
    await page.getByLabel("Usuario o correo", { exact: true }).waitFor();

    await harness.assertNoPointer();
    await page.screenshot({ path: path.join(output, "teclado-cajero.png") });
    console.log(`UI evidence: ${output}`);
  } finally { await harness.close(); await app.close(); }
});
