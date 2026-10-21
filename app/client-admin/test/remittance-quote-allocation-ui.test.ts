import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { MemoryStore } from "../../server/src/store.js";
import { seed } from "../../server/src/seed.js";
import { businessDate } from "../../server/src/domain.js";
import { randomUUID } from "node:crypto";
import { setCommissionPolicy, setDailyRate, openRemittanceCash, quoteRemittance, createRemittance, cancelRemittance, payRemittance } from "../../server/src/remittances.js";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const collectorRoot = path.resolve(adminRoot, "../client-collector");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined; }

test("actual Admin MDI and Collector PWA quote both directions and persist commission splits", { skip: process.platform === "win32" && fs.existsSync(edge) && playwrightEntry ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-quote-allocation-ui-"));
  const store = new MemoryStore(seed()), now = new Date();
  const sourceRegisteredAt = new Date(now.getTime() - 86400000), destinationRegisteredAt = new Date(now.getTime() - 3 * 86400000);
  const sourceRateDate = businessDate(sourceRegisteredAt), destinationRateDate = businessDate(destinationRegisteredAt);
  const admin = { id: "demo-admin", name: "Administración", role: "admin" as const }, collector = { id: "demo-collector", name: "Cobrador", role: "collector" as const, collectorId: "col-1" };
  await store.transaction((state) => {
    // Each currency carries its own latest registration into today; neither was registered today.
    setDailyRate(state, admin, { currency: "USD", rate: "60", date: sourceRateDate }, sourceRegisteredAt);
    setDailyRate(state, admin, { currency: "EUR", rate: "75", date: destinationRateDate }, destinationRegisteredAt);
    setCommissionPolicy(state, admin, { transactionCommissionBps: 500, managerCommissionBps: 200 }, now);
    openRemittanceCash(state, admin, { operatorId: admin.id, currency: "USD", openingAmount: 0 }, [], now);
    openRemittanceCash(state, admin, { operatorId: collector.id, currency: "USD", openingAmount: 0 }, [collector], now);
  });
  const app = await buildApp({ store, demo: true, secret: "quote-allocation-synthetic-secret-32", origins: [], collectorUrl: "/collector/" });
  let server: ReturnType<typeof createServer> | undefined, browser: any;
  const errors: string[] = [];
  let blockedAntivirusAttempts = 0, blockedFontAttempts = 0, unexpectedExternalAttempts = 0;
  try {
    const tokens: Record<string, string> = {};
    for (const [surface, email] of [["admin", "admin@cyp.local"], ["collector", "collector@cyp.local"]]) {
      const result = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } });
      assert.equal(result.statusCode, 200, result.body); tokens[surface] = result.json().token;
    }
    const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(localRequire.resolve("@tailwindcss/vite")).href), import(pathToFileURL(playwrightEntry!).href),
    ]);
    for (const surface of ["admin", "collector"]) {
      const root = surface === "admin" ? adminRoot : collectorRoot, module = (name: string) => JSON.stringify(path.join(root, "src", name).replaceAll("\\", "/"));
      const fixture = path.join(output, `${surface}.tsx`);
      fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import ${surface === "admin" ? "App" : "{ App }"} from ${module("App.tsx")};
import ${module("styles.css")};
${surface === "admin" ? `import ${module("suggestions-shell.css")};` : ""}
createRoot(document.getElementById("root")).render(<App />);`);
      await build({ root, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, `cache-${surface}`), resolve: { dedupe: ["react", "react-dom"] }, plugins: surface === "admin" ? [react(), tailwind()] : [react()],
        define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.BASE_URL": JSON.stringify("/collector/"), "import.meta.env.VITE_COLLECTOR_URL": JSON.stringify("/collector/") }, logLevel: "error",
        build: { outDir: path.join(output, surface), emptyOutDir: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => `${surface}.js`, cssFileName: surface } } });
    }
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname.startsWith("/api/")) {
          const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
          // Added browser scenarios use fixed synthetic clients, so their own legitimate traffic does not
          // exhaust the earlier scenarios' IP budget. The real API authentication and limits still run.
          const qaClient = request.headers["x-qa-rate-refresh-client"];
          const remoteAddress = qaClient === "admin" ? "192.0.2.20" : qaClient === "collector" ? "192.0.2.21" : qaClient === "cashier" ? "192.0.2.22" : qaClient === "commission-policy" ? "192.0.2.23" : qaClient === "payments-admin" ? "192.0.2.24" : qaClient === "payments-collector" ? "192.0.2.25" : "127.0.0.1";
          const result = await app.inject({ method: request.method as "GET" | "POST", url: url.pathname + url.search, remoteAddress,
            headers: { authorization: request.headers.authorization ?? "", "idempotency-key": String(request.headers["idempotency-key"] ?? ""), ...(request.headers["content-type"] ? { "content-type": request.headers["content-type"] } : {}) },
            ...(chunks.length ? { payload: Buffer.concat(chunks).toString() } : {}) });
          response.writeHead(result.statusCode, { "Content-Type": "application/json" }); response.end(result.body); return;
        }
        const surface = url.pathname.startsWith("/collector/") ? "collector" : "admin";
        if (["/admin/", "/collector/"].includes(url.pathname)) {
          response.writeHead(200, { "Content-Type": "text/html" }); response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/${surface}/${surface}.css"><div id="root"></div><script type="module" src="/${surface}/${surface}.js"></script></html>`); return;
        }
        if (url.pathname === `/${surface}/${surface}.js` || url.pathname === `/${surface}/${surface}.css`) {
          response.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css" }); response.end(fs.readFileSync(path.join(output, surface, path.basename(url.pathname)))); return;
        }
        response.writeHead(404); response.end();
      } catch (failure) { response.writeHead(500); response.end(JSON.stringify({ error: { message: String(failure) } })); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
    const routeLocalOnly = (route: any) => {
      const destination = new URL(route.request().url());
      if (destination.origin === origin) return route.continue();
      if (destination.origin === "http://me.kis.v2.scr.kaspersky-labs.com") blockedAntivirusAttempts += 1;
      else if (["https://fonts.googleapis.com", "https://fonts.gstatic.com"].includes(destination.origin)) blockedFontAttempts += 1;
      else unexpectedExternalAttempts += 1;
      return route.abort("blockedbyclient");
    };
    browser = await chromium.launch({ executablePath: edge, headless: true });
    // Sections of the menu start closed: the option is reached by opening its section.
    const menuOption = async (page: any, name: string) => {
      const option = page.locator(".sidebar").getByRole("button", { name, exact: true });
      const folded = page.locator(`.sidebar .nav-item[aria-label="${name}"]`);
      // Wait until the menu of the account is drawn: the option on view or folded in its section.
      await option.or(folded).first().waitFor({ state: "attached" });
      if (!await option.isVisible()) await page.locator(".sidebar .nav-group").filter({ has: page.locator(`.nav-item[aria-label="${name}"]`) }).locator(".nav-group-trigger").click();
      return option;
    };
    await t.test("Admin registers both central rates once and future remittances display them readonly", async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", serviceWorkers: "block", extraHTTPHeaders: { "x-qa-rate-refresh-client": "commission-policy" } });
      try {
        await context.addInitScript((token: string) => localStorage.setItem("cyp-admin-token", token), tokens.admin);
        await context.route("**/*", routeLocalOnly);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        const workspace = page.getByRole("region", { name: "Configuración de comisiones de remesas", exact: true });
        // The fields fill in once the saved policy arrives; reading them before would see the empty draft.
        const openWorkspace = async () => {
          await page.goto(`${origin}/admin/`); await page.getByRole("button", { name: "Configuración de administración", exact: true }).click(); await page.getByRole("button", { name: "Comisiones de remesas", exact: true }).click();
          await workspace.waitFor(); await workspace.getByText("Cargando configuración…", { exact: true }).waitFor({ state: "detached" });
        };
        await openWorkspace();
        const savePolicy = async (transaction: string, manager: string) => {
          await workspace.getByLabel("Comisión total de la transacción (%)", { exact: true }).fill(transaction);
          await workspace.getByLabel("Comisión del gestor (%)", { exact: true }).fill(manager);
          await workspace.getByRole("button", { name: "Revisar reparto", exact: true }).click();
          await page.getByRole("dialog", { name: "Confirmar configuración de comisiones", exact: true }).getByRole("button", { name: "Confirmar", exact: true }).click();
          await workspace.getByText("Configuración guardada. Se aplicará a los próximos envíos.", { exact: true }).waitFor();
          await page.waitForFunction(() => !document.querySelector('dialog[open]'));
        };
        await savePolicy("6", "2");
        assert.equal((await store.read()).remittances.commissionPolicy!.transactionCommissionBps, 600);
        await openWorkspace();
        assert.equal(await workspace.getByLabel("Comisión total de la transacción (%)", { exact: true }).inputValue(), "6", "configuration survives reload");
        await workspace.getByLabel("Comisión del gestor (%)", { exact: true }).fill("7");
        await workspace.getByRole("button", { name: "Revisar reparto", exact: true }).click();
        await workspace.getByRole("alert").filter({ hasText: "la comisión total debe cubrir" }).waitFor();
        assert.equal((await store.read()).remittances.commissionPolicy!.managerCommissionBps, 200);
        await savePolicy("5", "2");
        await page.screenshot({ path: path.join(output, "admin-central-commission-config.png") });
      } finally { await context.close(); }
    });
    for (const surface of ["admin", "collector"]) await t.test(`${surface} rejects invalid typing and whole pastes without creating clients or remittances`, async () => {
      const context = await browser.newContext({ viewport: surface === "admin" ? { width: 1440, height: 1000 } : { width: 390, height: 844 }, locale: "es-DO", serviceWorkers: "block" });
      const before = await store.read();
      try {
        await context.addInitScript(({ token, surface }: { token: string; surface: string }) => {
          if (surface === "admin") localStorage.setItem("cyp-admin-token", token); else sessionStorage.setItem("cyp-collector-token", token);
          (window as any).__qaPrinted = false; window.print = () => { (window as any).__qaPrinted = true; };
        }, { token: tokens[surface], surface });
        await context.route("**/*", routeLocalOnly);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(`${origin}/${surface}/?view=remittances`);
        if (surface === "admin") await (await menuOption(page, "Envíos de dinero")).click();
        const workspace = page.getByRole("region", { name: "Envíos de dinero", exact: true });
        if (surface === "collector") await workspace.getByRole("button", { name: "Nuevo envío", exact: true }).click();
        else await workspace.getByRole("combobox", { name: "Remitente", exact: true }).waitFor();
        const pasteRejected = (input: any, value: string) => input.evaluate((node: HTMLInputElement, pasted: string) => {
          node.setSelectionRange(0, node.value.length);
          const data = new DataTransfer(); data.setData("text/plain", pasted);
          return !node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        }, value);
        const amount = workspace.getByLabel("Monto a enviar (DOP)", { exact: true });
        await amount.fill("12.34");
        for (const invalid of ["1e3", "12a", "12.345", "-2", "12,34", "１２"]) {
          await amount.fill(invalid); assert.equal(await amount.inputValue(), "12.34", invalid);
        }
        assert.equal(await pasteRejected(amount, "123456789012345678"), true, "an oversized amount cannot be truncated into a different amount");
        assert.equal(await amount.inputValue(), "12.34");
        assert.equal(await pasteRejected(amount, "125.50"), false); await amount.fill("125.50");
        await workspace.getByRole("button", { name: "Registrar cliente nuevo", exact: true }).first().click();
        const client = page.getByRole("dialog", { name: "Nuevo remitente", exact: true });
        const name = client.getByLabel("Cliente:", { exact: true }), document = client.getByLabel("Cédula o pasaporte:", { exact: true }), phone = client.getByLabel("Teléfono:", { exact: true });
        await name.fill("José O'Connor & Hijos #2");
        await document.fill("001-0001234-5"); await document.fill("001';DROP TABLE users");
        assert.equal(await document.inputValue(), "001-0001234-5");
        assert.equal(await pasteRejected(document, "A".repeat(81)), true);
        await phone.fill("+1 (809) 555-0101"); await phone.press("End"); await phone.pressSequentially("Ab<>");
        assert.equal(await phone.inputValue(), "+1 (809) 555-0101");
        await phone.fill("1234567890123456"); assert.equal(await phone.inputValue(), "+1 (809) 555-0101");
        assert.equal(await pasteRejected(phone, "8095550101 ext 2"), true);
        assert.equal(await phone.inputValue(), "+1 (809) 555-0101");
        await client.getByLabel("Dirección:", { exact: true }).fill("Av. Núñez #12 / local (B)");
        await client.getByLabel("Ruta:", { exact: true }).selectOption(before.routes[0].id);
        await name.fill("12345"); await client.getByRole("button", { name: "Usar estos datos", exact: true }).click();
        await client.getByRole("alert").filter({ hasText: "El nombre del cliente debe incluir letras" }).waitFor();
        await name.fill("José O'Connor & Hijos #2"); await client.getByRole("button", { name: "Usar estos datos", exact: true }).click();
        await client.waitFor({ state: "hidden" });
        assert.match(await workspace.innerText(), /José O'Connor & Hijos #2/);
        const recipient = before.clients.find(({ id }) => id === "cli-5")!;
        await workspace.getByRole("combobox", { name: "Destinatario", exact: true }).fill(recipient.code);
        await workspace.getByRole("option").filter({ hasText: recipient.code }).first().click();
        await workspace.getByText("Cargando teléfono y dirección…", { exact: true }).waitFor({ state: "hidden" });
        const recipientPhone = workspace.getByLabel("Teléfono del destinatario", { exact: true });
        await recipientPhone.fill("8095550101"); await recipientPhone.fill("abc");
        assert.equal(await recipientPhone.inputValue(), "8095550101"); assert.equal(await pasteRejected(recipientPhone, "8095550101;DROP"), true);
        const note = "Compra #2; O'Connor & Hijos.\nSaldo < 100";
        await workspace.getByLabel("Nota (opcional)", { exact: true }).fill(note);
        assert.equal(await workspace.getByLabel("Nota (opcional)", { exact: true }).inputValue(), note);
        if (surface === "admin") {
          await (await menuOption(page, "Cuadres Diarios")).click();
          const settlements = page.getByRole("dialog", { name: "Cuadres Diarios", exact: true });
          await settlements.getByRole("group", { name: "Secciones de Cuadres Diarios", exact: true }).getByRole("button", { name: "Caja de remesas", exact: true }).click();
          const cash = settlements.getByRole("region", { name: "Caja de remesas", exact: true });
          const opening = cash.getByLabel("Efectivo inicial", { exact: true });
          await opening.fill("15.50"); await opening.fill("abc"); assert.equal(await opening.inputValue(), "15.50");
          assert.equal(await pasteRejected(opening, "123456789012345678"), true);
          await cash.getByRole("button", { name: "Contar y cerrar", exact: true }).first().click();
          const closing = page.getByRole("dialog", { name: /^Contar caja / });
          const counted = closing.getByLabel("Efectivo contado", { exact: true });
          await counted.fill("0.00"); await counted.fill("0x10"); assert.equal(await counted.inputValue(), "0.00");
          assert.equal(await pasteRejected(counted, "0.001"), true);
          await closing.getByRole("button", { name: /^Cerrar Contar caja / }).click();
        }
        assert.deepEqual(await store.read(), before, "drafting and rejecting fields does not mutate persisted data");
      } finally { await context.close(); }
    });
    for (const surface of ["admin", "collector"]) await t.test(`${surface} active render: readonly DOP, inverse rounding, save and cancellation`, async () => {
      const context = await browser.newContext({ viewport: surface === "admin" ? { width: 1440, height: 1000 } : { width: 390, height: 844 }, locale: "es-DO", serviceWorkers: "block" });
      await context.addInitScript(() => { (window as any).__qaPrinted = false; window.print = () => { (window as any).__qaPrinted = true; }; });
      try {
        await context.addInitScript(({ token, surface }: { token: string; surface: string }) => {
          if (surface === "admin") localStorage.setItem("cyp-admin-token", token); else sessionStorage.setItem("cyp-collector-token", token);
        }, { token: tokens[surface], surface });
        await context.route("**/*", routeLocalOnly);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(`${origin}/${surface}/?view=remittances`);
        if (surface === "admin") await (await menuOption(page, "Envíos de dinero")).click();
        const workspace = page.getByRole("region", { name: "Envíos de dinero", exact: true });
        const senderInput = workspace.getByRole("combobox", { name: "Remitente", exact: true });
        if (surface === "admin") {
          // Administración: only the sending section, its form already open and the cursor in the sender.
          await senderInput.waitFor(); await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox");
          assert.equal(await senderInput.evaluate((element: Element) => element === document.activeElement), true, "the cursor starts in the sender");
          assert.equal(await workspace.getByRole("navigation", { name: "Secciones de remesas", exact: true }).count(), 0);
          assert.equal(await workspace.getByRole("button", { name: "Nuevo envío", exact: true }).count(), 0);
        } else {
          // The collector terminal keeps Envíos, Recibos and Caja (its reports open from its Reportes view) and its «Nuevo envío».
          const sections = workspace.getByRole("navigation", { name: "Secciones de remesas", exact: true });
          await sections.getByRole("button").first().waitFor();
          assert.deepEqual(await sections.getByRole("button").allTextContents(), ["Envíos", "Entregas", "Caja"]);
          await workspace.getByRole("button", { name: "Nuevo envío", exact: true }).click();
          // Searching hands the screen to the list; «Nuevo envío» brings the capture back with the filters cleared.
          const search = workspace.getByLabel("Buscar", { exact: true });
          await search.fill("QA búsqueda");
          assert.equal(await workspace.getByRole("form", { name: "Nuevo envío", exact: true }).count(), 0, "search gives the list the capture space");
          await workspace.getByRole("button", { name: "Nuevo envío", exact: true }).click();
          await workspace.getByRole("form", { name: "Nuevo envío", exact: true }).waitFor();
          assert.equal(await search.inputValue(), "");
        }
        const choose = async (label: string, code: string) => { const input = workspace.getByRole("combobox", { name: label, exact: true }); await input.fill(code); await workspace.getByRole("option").filter({ hasText: code }).first().click(); };
        const state = await store.read(), sender = state.clients.find((row) => row.id === "cli-1")!, recipient = state.clients.find((row) => row.id === "cli-5")!;
        await choose("Remitente", sender.code); await choose("Destinatario", recipient.code);
        await workspace.getByLabel("Moneda del remitente").selectOption("USD");
        await workspace.getByLabel("Moneda del destinatario").selectOption("EUR");
        const commission = workspace.getByRole("textbox", { name: "Comisión (%)", exact: true });
        assert.equal(await commission.getAttribute("readonly"), "");
        assert.equal(await commission.inputValue(), "5", "both surfaces use the saved central policy");
        await commission.evaluate((input: HTMLInputElement) => { input.value = "0"; });
        await workspace.getByLabel("Monto a enviar (USD)", { exact: true }).fill("100");
        await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        const dop = workspace.getByRole("textbox", { name: "Equivalente del principal en DOP", exact: true });
        await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('input[readonly]')).some((input) => input.value === "DOP 6,000.00"));
        assert.equal(await dop.getAttribute("readonly"), ""); assert.equal(await dop.inputValue(), "DOP 6,000.00");
        assert.equal(await commission.inputValue(), "5", "changing the DOM cannot change the server-derived rate");
        assert.equal(await workspace.getByRole("textbox", { name: "Monto a recibir calculado (EUR)", exact: true }).inputValue(), "EUR 80.00");
        const quoteSummary = workspace.locator(".remittance-quote");
        const summaryText = await quoteSummary.innerText();
        for (const label of ["Paga el remitente", "Recibe el destinatario", "Conversión por pesos dominicanos", "Última tasa registrada", sourceRateDate, destinationRateDate]) assert.ok(summaryText.includes(label), label);
        assert.match(summaryText, /USD 105\.00/, "the sender pays principal plus the configured USD 5 commission");
        assert.match(summaryText, /EUR 80\.00/, "the recipient receives the full principal converted through DOP");
        assert.ok(summaryText.includes("La comisión se paga en origen; no se descuenta del monto a recibir."));
        const snapshotReload = page.waitForResponse((reply: any) => new URL(reply.url()).pathname === "/api/envios/snapshot");
        await page.evaluate(() => window.dispatchEvent(new CustomEvent("cyp-remittances-changed", { detail: { source: "qa-other-window" } })));
        await snapshotReload;
        await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).some((button) => button.textContent === "Actualizar" && !button.disabled));
        assert.equal(await dop.inputValue(), "DOP 6,000.00", "a background refresh retains a quote when the latest prior rates did not change");
        assert.equal(await quoteSummary.count(), 1);
        await workspace.getByLabel("Ingresar importe de").selectOption("destination");
        assert.equal(await dop.inputValue(), "Calcula la cotización", "changing mode invalidates the quote");
        await workspace.getByLabel("Monto a recibir (EUR)", { exact: true }).fill("80");
        await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('input[readonly]')).some((input) => input.value === "USD 100.00"));
        await page.screenshot({ path: path.join(output, `${surface}-quote.png`) });
        await workspace.getByRole("button", { name: "Revisar y confirmar envío", exact: true }).click();
        const confirmation = page.getByRole("dialog", { name: "Confirmar envío", exact: true });
        const countBeforeReview = (await store.read()).remittances.transfers.length;
        await confirmation.getByLabel("Dinero recibido (USD)", { exact: true }).fill("104");
        await confirmation.getByRole("button", { name: "Aceptar", exact: true }).click();
        await confirmation.getByRole("alert").filter({ hasText: "no cubre" }).waitFor();
        assert.equal((await store.read()).remittances.transfers.length, countBeforeReview, "insufficient tender does not save");
        await confirmation.getByRole("button", { name: "Cancelar", exact: true }).click();
        assert.equal((await store.read()).remittances.transfers.length, countBeforeReview, "cancelling the review creates no transfer");
        await workspace.getByRole("button", { name: "Revisar y confirmar envío", exact: true }).click();
        await confirmation.getByLabel("Dinero recibido (USD)", { exact: true }).fill("110");
        assert.equal(await confirmation.getByLabel("Devuelta (USD)", { exact: true }).inputValue(), "USD 5.00");
        await confirmation.getByText("Reparto de la comisión entre empresa y gestor", { exact: true }).click();
        assert.match(await confirmation.innerText(), /EUR 1\.60/); assert.match(await confirmation.innerText(), /EUR 2\.40/);
        const savedReply = page.waitForResponse((reply: any) => reply.request().method() === "POST" && new URL(reply.url()).pathname === "/api/envios");
        await confirmation.getByRole("button", { name: "Aceptar", exact: true }).click();
        const registered = await savedReply;
        assert.equal(registered.status(), 200);
        const registeredTransfer = await registered.json();
        const print = page.getByRole("dialog", { name: "¿Quieres imprimir el recibo?", exact: true }); await print.waitFor();
        await print.getByRole("button", { name: "No imprimir", exact: true }).click();
        assert.equal(await workspace.getByRole("combobox", { name: "Remitente", exact: true }).inputValue(), "", "confirmed sends clear the prior sender");
        assert.equal(await workspace.getByRole("combobox", { name: "Destinatario", exact: true }).inputValue(), "", "confirmed sends clear the prior recipient");
        assert.equal(await workspace.getByLabel("Monto a enviar (DOP)", { exact: true }).inputValue(), "");
        // Focus returns to the sender after the print prompt closes; wait for it instead of sampling one frame.
        await page.waitForFunction(() => !document.querySelector("dialog[open]") && document.activeElement?.closest('[data-client-side="sender"]') !== null, undefined, { timeout: 5000 }).catch(() => undefined);
        assert.equal(await workspace.getByRole("combobox", { name: "Remitente", exact: true }).evaluate((element: Element) => element === document.activeElement), true, "after a confirmed send the cursor returns to the sender");
        const saved = (await store.read()).remittances.transfers.find((row) => row.id === registeredTransfer.id)!;
        assert.ok(saved, "The exact transfer returned by the creation response must exist in the ledger.");
        assert.equal(saved.status, "pending");
        assert.equal(saved.quote.date, businessDate(now), "the operation date remains today");
        assert.equal(saved.quote.sourceRateDate, sourceRateDate, "the source rate retains its actual prior registration date");
        assert.equal(saved.quote.destinationRateDate, destinationRateDate, "currencies retain their distinct registration dates");
        assert.equal(saved.requestedReceiveAmount, 8000); assert.equal(saved.commissionAllocation!.managerAmount, 160);
        assert.equal(saved.payment?.tenderedAmount, 11000); assert.equal(saved.payment?.changeAmount, 500);
        assert.equal(saved.sendingUserId, surface === "admin" ? admin.id : collector.id);
        await workspace.getByRole("button", { name: saved.envioReference, exact: true }).click();
        const detail = page.getByRole("dialog", { name: `${saved.envioReference} · ${saved.reciboReference}`, exact: true });
        await detail.getByLabel("Motivo de cancelación", { exact: true }).waitFor();
        const customerReceipt = detail.getByRole("article", { name: "Recibo del envío de dinero", exact: true });
        assert.match(await customerReceipt.innerText(), /USD 110\.00/); assert.match(await customerReceipt.innerText(), /USD 5\.00/);
        assert.equal((await customerReceipt.innerText()).includes("Comisión"), false);
        const receiptPopupPromise = page.waitForEvent("popup");
        await detail.getByRole("button", { name: "Imprimir comprobante", exact: true }).click();
        const receiptPopup = await receiptPopupPromise;
        await receiptPopup.waitForFunction(() => (window as any).__qaPrinted === true);
        assert.equal((await receiptPopup.locator("body").innerText()).includes("Comisión"), false);
        assert.match(await receiptPopup.locator("body").innerText(), /Devuelta/);
        assert.equal(await receiptPopup.locator("nav,aside,button,input,select").count(), 0);
        await receiptPopup.close();
        await detail.locator(".remittance-receipt-body").evaluate((node: HTMLElement) => { node.scrollTop = 0; });
        await page.screenshot({ path: path.join(output, `${surface}-customer-receipt.png`) });
        // Administración pays only in «Entregas de dinero»: its sending window just cancels.
        if (surface === "admin") assert.equal(await detail.getByRole("button", { name: "Registrar entrega", exact: true }).count(), 0);
        await detail.getByLabel("Motivo de cancelación", { exact: true }).fill("Cancelación sintética QA");
        await detail.getByRole("button", { name: "Revisar cancelación", exact: true }).click();
        const cancelledReply = page.waitForResponse((reply: any) => reply.request().method() === "POST" &&
          new URL(reply.url()).pathname === `/api/envios/${encodeURIComponent(saved.id)}/cancelar`);
        await page.getByRole("dialog", { name: "Cancelar envío pendiente", exact: true }).getByRole("button", { name: "Confirmar", exact: true }).click();
        const cancelledResponse = await cancelledReply;
        assert.equal(cancelledResponse.status(), 200);
        const cancelledTransfer = await cancelledResponse.json();
        assert.equal(cancelledTransfer.id, saved.id); assert.equal(cancelledTransfer.status, "cancelled");
        await detail.locator('.remittance-status.cancelled').waitFor();
        const savedRow = workspace.getByRole("row").filter({ has: page.getByRole("button", { name: saved.envioReference, exact: true }) });
        await savedRow.locator('.remittance-status.cancelled').waitFor();
        const afterCancel = await store.read();
        assert.equal(afterCancel.remittances.transfers.find((row) => row.id === saved.id)!.status, "cancelled");
        assert.equal(afterCancel.remittances.events.filter((event) => event.type === "cancelled" && event.transferId === saved.id).length, 1);
        await detail.getByRole("button", { name: `Cerrar ${saved.envioReference} · ${saved.reciboReference}`, exact: true }).click();
        await workspace.getByRole("button", { name: surface === "admin" ? "Limpiar formulario" : "Nuevo envío", exact: true }).click();
        await choose("Remitente", sender.code); await choose("Destinatario", recipient.code);
        await workspace.getByLabel("Moneda del remitente").selectOption("USD");
        await workspace.getByLabel("Moneda del destinatario").selectOption("DOP");
        await workspace.getByLabel("Ingresar importe de").selectOption("destination");
        assert.equal(await commission.inputValue(), "5", "the next remittance keeps the configured rate");
        await workspace.getByLabel("Monto a recibir (DOP)", { exact: true }).fill("72.01");
        await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        await workspace.getByText(/El importe real difiere por redondeo/).waitFor();
        assert.match(await workspace.locator('.remittance-quote').innerText(), /DOP 72\.00/);
        if (surface === "collector") {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          assert.equal(await workspace.getByRole("button", { name: "Reportes", exact: true }).count(), 0);
          await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("button", { name: "Reportes", exact: true }).click();
          const reports = page.getByRole("region", { name: "Reportes de remesas", exact: true });
          await reports.getByRole("button", { name: "Consultar", exact: true }).click();
          await reports.getByRole("table", { name: "Montos de envíos por moneda de origen y destino", exact: true }).waitFor();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        }
      } finally { await context.close(); }
    });
    for (const surface of ["admin", "collector"]) await t.test(`${surface} refresh invalidates a quote after the latest rate changes without rewriting old receipts`, async () => {
      const context = await browser.newContext({ viewport: surface === "admin" ? { width: 1440, height: 1000 } : { width: 390, height: 844 }, locale: "es-DO", serviceWorkers: "block", extraHTTPHeaders: { "x-qa-rate-refresh-client": surface } });
      const previousReceipts = (await store.read()).remittances.transfers.map(({ id, quote, receiveAmount, totalAmount }) => ({ id, quote, receiveAmount, totalAmount }));
      try {
        await context.addInitScript(({ token, surface }: { token: string; surface: string }) => {
          if (surface === "admin") localStorage.setItem("cyp-admin-token", token); else sessionStorage.setItem("cyp-collector-token", token);
        }, { token: tokens[surface], surface });
        await context.route("**/*", routeLocalOnly);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(`${origin}/${surface}/?view=remittances`);
        if (surface === "admin") await (await menuOption(page, "Envíos de dinero")).click();
        const workspace = page.getByRole("region", { name: "Envíos de dinero", exact: true });
        if (surface === "collector") await workspace.getByRole("button", { name: "Nuevo envío", exact: true }).click();
        const state = await store.read();
        for (const [label, id] of [["Remitente", "cli-1"], ["Destinatario", "cli-5"]]) {
          const code = state.clients.find((client) => client.id === id)!.code;
          await workspace.getByRole("combobox", { name: label, exact: true }).fill(code);
          await workspace.getByRole("option").filter({ hasText: code }).first().click();
        }
        await workspace.getByLabel("Moneda del remitente").selectOption("USD");
        await workspace.getByLabel("Moneda del destinatario").selectOption("EUR");
        await workspace.getByLabel("Monto a enviar (USD)", { exact: true }).fill("100");
        await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        const dop = workspace.getByRole("textbox", { name: "Equivalente del principal en DOP", exact: true });
        await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('input[readonly]')).some((input) => input.value === "DOP 6,000.00"));
        await store.transaction((current) => setDailyRate(current, admin, { currency: "USD", rate: "61", date: businessDate(now) }, now));
        await page.evaluate(() => window.dispatchEvent(new Event("cyp-exchange-rates-updated")));
        await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('input[readonly]')).some((input) => input.value === "Calcula la cotización"));
        assert.equal(await dop.inputValue(), "Calcula la cotización");
        assert.equal(await workspace.locator(".remittance-quote").count(), 0, "an outdated quote cannot remain available for confirmation");
        await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('input[readonly]')).some((input) => input.value === "DOP 6,100.00"));
        assert.equal(await workspace.getByRole("textbox", { name: "Monto a recibir calculado (EUR)", exact: true }).inputValue(), "EUR 81.33");
        assert.deepEqual((await store.read()).remittances.transfers.map(({ id, quote, receiveAmount, totalAmount }) => ({ id, quote, receiveAmount, totalAmount })), previousReceipts, "registering a newer rate never recalculates saved receipts");
        await page.screenshot({ path: path.join(output, `${surface}-new-effective-rate.png`) });
      } finally {
        await store.transaction((current) => setDailyRate(current, admin, { currency: "USD", rate: "60", date: businessDate(now) }, now));
        await context.close();
      }
    });
    await t.test("consolidated report filters and totals match CSV and isolated print output", async () => {
      await store.transaction((state) => {
        const make = (actor: typeof admin | typeof collector, destinationCurrency: "EUR" | "DOP", amount = 10000) => {
          const input = { sourceCurrency: "USD" as const, destinationCurrency, amount, commissionBps: 500 };
          return createRemittance(state, { ...actor, name: "=Gestor QA homónimo" }, { ...input, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoteRemittance(state, input, now).quote }, [], now);
        };
        make(admin, "EUR"); const paid = make(collector, "EUR");
        openRemittanceCash(state, admin, { operatorId: admin.id, currency: "EUR", openingAmount: 8000 }, [], now);
        payRemittance(state, admin, paid.id, now);
        const cancelled = make(admin, "EUR", 20000); cancelRemittance(state, admin, cancelled.id, "Cancelación para reporte QA", now);
        make(admin, "DOP");
      });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", serviceWorkers: "block", acceptDownloads: true });
      try {
        await context.addInitScript(({ token }: { token: string }) => { localStorage.setItem("cyp-admin-token", token); (window as any).__qaPrinted = false; window.print = () => { (window as any).__qaPrinted = true; }; }, { token: tokens.admin });
        await context.route("**/*", routeLocalOnly);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(`${origin}/admin/`); await (await menuOption(page, "Envíos de dinero")).click();
        const sending = page.getByRole("region", { name: "Envíos de dinero", exact: true });
        await sending.getByRole("combobox", { name: "Remitente", exact: true }).waitFor();
        assert.equal(await sending.getByRole("button", { name: "Reportes", exact: true }).count(), 0, "the sending window has no reports section");
        // The consolidated report lives in Reportes & Monitoreo → Reportes, in its own window.
        await (await menuOption(page, "Reportes")).click();
        await page.getByRole("dialog", { name: "Reportes", exact: true }).getByRole("button", { name: "Reporte consolidado de comisiones", exact: true }).click();
        const report = page.getByRole("dialog", { name: "Reporte consolidado de comisiones", exact: true });
        const toolbar = report.locator(".legacy-mdi-toolbar");
        // A select inside its label also exposes its options as text: those labels are matched by their start.
        for (const label of ["Fecha inicial:", "Fecha final:"]) assert.equal(await report.getByLabel(label, { exact: true }).count(), 1, label);
        for (const label of ["Agrupar por:", "Estado de la operación:", "Gestor:", "Moneda de destino:"]) assert.equal(await report.locator("label").filter({ hasText: new RegExp(`^${label}`) }).count(), 1, label);
        const totals = report.getByRole("table", { name: "Totales del periodo por Moneda", exact: true });
        const consult = async () => {
          await report.getByRole("button", { name: "Consultar", exact: true }).click();
          await report.getByText("Consultando el reporte…", { exact: true }).waitFor({ state: "hidden" }); await totals.waitFor();
        };
        await consult();
        const columns = await totals.getByRole("columnheader").allTextContents();
        for (const column of ["Comisión Total de la Transacción", "Comisión de la Empresa", "Comisión del Gestor"]) assert.ok(columns.includes(column));
        const expectedTotals = await totals.locator("tbody tr").evaluateAll((rows: HTMLTableRowElement[]) => rows.map((row) => Array.from(row.cells).map((cell) => cell.textContent)));
        assert.deepEqual(expectedTotals.map((row: string[]) => row.slice(1, 7)), [["DOP", "1", "0", "DOP 300.00", "DOP 180.00", "DOP 120.00"], ["EUR", "2", "3", "EUR 8.00", "EUR 4.80", "EUR 3.20"]]);
        const groups = report.getByRole("table", { name: "Comisiones agrupadas por Gestor y Moneda", exact: true });
        assert.equal(await groups.locator("tbody tr").count(), 3, "Homonymous gestor IDs and currencies stay separate");
        const downloadPromise = page.waitForEvent("download"); await toolbar.getByRole("button", { name: "Exportar CSV", exact: true }).click();
        const download = await downloadPromise, csvPath = path.join(output, "consolidated.csv"); await download.saveAs(csvPath);
        const csv = fs.readFileSync(csvPath, "utf8");
        for (const row of expectedTotals) assert.ok(csv.includes(row.map((cell: string) => `"${cell}"`).join(";")), "CSV contains the exact onscreen totals");
        assert.match(csv, /"'=Gestor QA homónimo"/, "Formula injection neutralization remains active");
        const popupPromise = page.waitForEvent("popup"); await toolbar.getByRole("button", { name: "Imprimir", exact: true }).click(); const popup = await popupPromise;
        await popup.waitForFunction(() => (window as any).__qaPrinted === true);
        const printRows = await popup.locator("table").filter({ has: popup.getByRole("columnheader", { name: "Total", exact: true }) }).locator("tbody tr").evaluateAll((rows: HTMLTableRowElement[]) => rows.map((row) => Array.from(row.cells).map((cell) => cell.textContent)));
        assert.deepEqual(printRows, expectedTotals); assert.equal(await popup.locator("nav,aside,button,input,select").count(), 0, "Print isolates report content"); await popup.close();
        await groups.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, "consolidated-report.png") });
        await report.getByLabel("Estado de la operación", { exact: true }).selectOption("paid");
        assert.equal(await toolbar.getByRole("button", { name: "Exportar CSV", exact: true }).isDisabled(), true, "Filters invalidate the old printable/exportable result");
        assert.equal(await toolbar.getByRole("button", { name: "Imprimir", exact: true }).isDisabled(), true);
        await consult(); assert.match(await totals.locator("tbody").innerText(), /EUR 4\.00.*EUR 2\.40.*EUR 1\.60/s);
        await report.getByLabel("Gestor", { exact: true }).selectOption(admin.id); await consult();
        assert.match(await totals.innerText(), /No hay resultados/);
        await report.getByLabel("Gestor", { exact: true }).selectOption("");
        await report.getByLabel("Estado de la operación", { exact: true }).selectOption("cancelled"); await consult();
        const cancelledAmounts = await totals.locator("tbody tr").evaluateAll((rows: HTMLTableRowElement[]) => rows.map((row) => Array.from(row.cells).slice(4, 7).map((cell) => cell.textContent)));
        assert.deepEqual(cancelledAmounts, [["EUR 0.00", "EUR 0.00", "EUR 0.00"]]);
        await report.getByLabel("Estado de la operación", { exact: true }).selectOption("active");
        await report.getByLabel("Moneda de destino", { exact: true }).selectOption("EUR");
        await report.getByLabel("Agrupar por", { exact: true }).selectOption("currency"); await consult();
        assert.equal(await report.getByRole("table", { name: "Comisiones agrupadas por Moneda", exact: true }).locator("tbody tr").count(), 1);
        assert.equal(await totals.locator("tbody tr").count(), 1); assert.match(await totals.locator("tbody").innerText(), /EUR 8\.00.*EUR 4\.80.*EUR 3\.20/s);
        const today = businessDate(now), nextDay = new Date(`${today}T12:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        await report.getByLabel("Fecha inicial:", { exact: true }).fill(nextDay.toISOString().slice(0, 10)); await report.getByLabel("Fecha final:", { exact: true }).fill(nextDay.toISOString().slice(0, 10)); await consult();
        assert.match(await totals.innerText(), /No hay resultados/);
      } finally { await context.close(); }
    });
    await t.test("office Usuario with remittance permissions, atomic quick customers, keyboard capture and continuous focus in the actual Admin shell", async () => {
      const post = (url: string, payload: object, token = tokens.admin) => app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() } });
      const account = await post("/api/usuarios", { role: "cashier", name: "Cajero sintético", email: "cashier-dionel@example.invalid", password: "Ficticia-2026!" });
      assert.equal(account.statusCode, 200, account.body);
      const cashier = account.json();
      const keys = ["remittances.view", "remittances.create", "remittances.clients.create", "remittances.receipts", "remittances.pay"];
      assert.equal((await post(`/api/usuarios/${cashier.id}/permisos`, { mode: "custom", permissionIds: [1, 2], remittancePermissions: keys, revision: 0 })).statusCode, 200);
      assert.equal((await post("/api/envios/cajas/abrir", { operatorId: cashier.id, currency: "DOP", openingAmount: 0 })).statusCode, 200);
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: cashier.email, password: "Ficticia-2026!" } });
      assert.equal(login.statusCode, 200); const token = login.json().token;
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", serviceWorkers: "block", extraHTTPHeaders: { "x-qa-rate-refresh-client": "cashier" } });
      try {
        await context.addInitScript((token: string) => localStorage.setItem("cyp-admin-token", token), token);
        await context.route("**/*", routeLocalOnly);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(`${origin}/admin/`); await (await menuOption(page, "Envíos de dinero")).click();
        const workspace = page.getByRole("region", { name: "Envíos de dinero", exact: true });
        const sender = workspace.getByRole("combobox", { name: "Remitente", exact: true }); await sender.waitFor();
        assert.equal(await sender.evaluate((element: Element) => element === document.activeElement), true);
        assert.equal(await page.getByRole("button", { name: "Configuración de administración", exact: true }).count(), 0);
        for (const name of ["Facturas", "Ventana de Pagos", "Hacer copia de respaldo"])
          assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0, `${name} is not a cashier shortcut`);
        assert.equal(await page.getByTitle("Abrir Cuadres Diarios", { exact: true }).count(), 0);
        for (const label of ["Tasas", "Comisiones"]) assert.equal(await workspace.getByRole("button", { name: label, exact: true }).count(), 0);
        const before = await store.read(); const routeId = before.routes[0].id;
        const capture = async (side: "remitente" | "destinatario", name: string, identification: string) => {
          await workspace.getByRole("group", { name: `Datos del ${side}`, exact: true }).getByRole("button", { name: "Registrar cliente nuevo", exact: true }).click();
          const dialog = page.getByRole("dialog", { name: `Nuevo ${side}`, exact: true });
          const nameField = dialog.getByLabel("Cliente:", { exact: true }); await nameField.fill(name); await nameField.press("Enter");
          assert.equal(await dialog.getByLabel("Cédula o pasaporte:", { exact: true }).evaluate((element: Element) => element === document.activeElement), true);
          await page.keyboard.press("Shift+Enter"); assert.equal(await nameField.evaluate((element: Element) => element === document.activeElement), true);
          await dialog.getByLabel("Cédula o pasaporte:", { exact: true }).fill(identification);
          await dialog.getByLabel("Teléfono:", { exact: true }).fill("+1 (809) 555-0142");
          await dialog.getByLabel("Dirección:", { exact: true }).fill("Dirección ficticia O'Connor & Hijos");
          await dialog.getByLabel("Ruta:", { exact: true }).selectOption(routeId);
          await dialog.getByRole("button", { name: "Usar estos datos", exact: true }).click(); await dialog.waitFor({ state: "detached" });
        };
        await capture("remitente", "Remitente nuevo QA", "QA-DIONEL-SENDER");
        await capture("destinatario", "Destinatario nuevo QA", "QA-DIONEL-RECIPIENT");
        assert.equal((await store.read()).clients.length, before.clients.length, "customer drafts are not persisted before final confirmation");
        const amount = workspace.getByLabel("Monto a enviar (DOP)", { exact: true }); await amount.fill("100");
        await amount.press("Enter"); assert.equal((await store.read()).remittances.transfers.length, before.remittances.transfers.length, "keyboard navigation never saves money");
        await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        await workspace.getByRole("button", { name: "Revisar y confirmar envío", exact: true }).click();
        const confirm = page.getByRole("dialog", { name: "Confirmar envío", exact: true });
        const title = confirm.locator("header"), box = await title.boundingBox(), initial = await confirm.boundingBox(); assert(box && initial);
        await page.mouse.move(box.x + 60, box.y + 12); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y + 25); await page.mouse.up();
        const moved = await confirm.boundingBox(); assert(moved && moved.x > initial.x + 20, "only the modal title drags");
        await confirm.getByRole("button", { name: "Aceptar", exact: true }).click();
        const print = page.getByRole("dialog", { name: "¿Quieres imprimir el recibo?", exact: true }); await print.waitFor();
        await print.getByRole("button", { name: "No imprimir", exact: true }).click();
        const after = await store.read(); assert.equal(after.clients.length, before.clients.length + 2);
        assert.equal(after.remittances.transfers.length, before.remittances.transfers.length + 1);
        assert.equal(await sender.inputValue(), "");
        await page.waitForFunction(() => !document.querySelector("dialog[open]") && document.activeElement?.closest('[data-client-side="sender"]') !== null, undefined, { timeout: 5000 }).catch(() => undefined);
        assert.equal(await sender.evaluate((element: Element) => element === document.activeElement), true, "after a confirmed send the cursor returns to the sender");
        // Paying is done in its own window, «Entregas de dinero», with the cursor in Buscar.
        assert.equal(await workspace.getByRole("button", { name: "Entregas", exact: true }).count(), 0);
        await (await menuOption(page, "Entregas de dinero")).click();
        const payouts = page.getByRole("region", { name: "Entregas de dinero", exact: true });
        const search = payouts.getByLabel("Buscar", { exact: true }); await search.waitFor();
        await page.waitForFunction(() => document.activeElement?.hasAttribute("data-receipt-search") === true);
        assert.equal(await search.evaluate((element: Element) => element === document.activeElement), true);
        const transfer = after.remittances.transfers.find(({ sendingUserId }) => sendingUserId === cashier.id)!;
        await payouts.getByRole("button", { name: transfer.reciboReference, exact: true }).click();
        const detail = page.getByRole("dialog", { name: `${transfer.envioReference} · ${transfer.reciboReference}`, exact: true });
        const initialBox = await detail.boundingBox(); assert(initialBox);
        const detailTitle = detail.locator(".remittance-receipt-titlebar"); const detailBar = await detailTitle.boundingBox(); assert(detailBar);
        await page.mouse.move(detailBar.x + 65, detailBar.y + 15); await page.mouse.down(); await page.mouse.move(detailBar.x + 100, detailBar.y + 30); await page.mouse.up();
        const movedBox = await detail.boundingBox(); assert(movedBox && movedBox.x > initialBox.x + 20);
        await detail.getByRole("button", { name: /^Maximizar / }).click();
        assert.ok((await detail.boundingBox())!.width > initialBox.width);
        await detail.getByRole("button", { name: /^Restaurar tamaño de / }).click();
        await detail.getByRole("button", { name: /^Minimizar / }).click(); await detail.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: `Restaurar ${transfer.envioReference} · ${transfer.reciboReference}`, exact: true }).click();
        await detail.waitFor({ state: "visible" });
        const parentWindow = page.getByRole("dialog", { name: "Envíos de dinero", exact: true });
        await parentWindow.locator(".mdi-window-titlebar > span").click({ position: { x: 5, y: 8 } });
        assert.ok(Number(await parentWindow.evaluate((node: Element) => getComputedStyle(node).zIndex)) > Number(await detail.evaluate((node: Element) => getComputedStyle(node).zIndex)));
        await detailTitle.click();
        assert.ok(Number(await detail.evaluate((node: Element) => getComputedStyle(node).zIndex)) > Number(await parentWindow.evaluate((node: Element) => getComputedStyle(node).zIndex)));
        await page.screenshot({ path: path.join(output, "receipt-window.png") });
        await detail.getByRole("button", { name: "Registrar entrega", exact: true }).click();
        const paymentReview = page.getByRole("dialog", { name: "Confirmar entrega al destinatario", exact: true });
        await paymentReview.waitFor();
        assert.equal(await paymentReview.evaluate((node: Element) => node.matches(":modal")), true, "financial review still blocks the desktop");
        await page.screenshot({ path: path.join(output, "receipt-payment-confirmation.png") });
        assert.equal((await store.read()).remittances.transfers.find(({ id }) => id === transfer.id)?.status, "pending", "reviewing a payout does not move money");
        await paymentReview.getByRole("button", { name: "Confirmar", exact: true }).click();
        await detail.locator(".remittance-status.paid").waitFor();
        const paid = (await store.read()).remittances.transfers.find(({ id }) => id === transfer.id)!;
        assert.equal(paid.status, "paid"); assert.equal(paid.paidBy, cashier.id);
        assert.equal((await store.read()).remittances.events.filter((event) => event.transferId === paid.id && event.type === "paid").length, 1);
        await detail.getByRole("button", { name: `Cerrar ${transfer.envioReference} · ${transfer.reciboReference}`, exact: true }).click();
        await page.waitForFunction(() => document.activeElement?.hasAttribute("data-receipt-search") === true);
        assert.equal(await search.evaluate((element: Element) => element === document.activeElement), true);
        // Back to the sending window, which is still open.
        await (await menuOption(page, "Envíos de dinero")).click();
        assert.equal((await post(`/api/usuarios/${cashier.id}/permisos`, { mode: "custom", permissionIds: [1, 2], remittancePermissions: ["remittances.view"], revision: 1 })).statusCode, 200);
        await workspace.getByRole("button", { name: "Actualizar", exact: true }).click();
        await sender.waitFor({ state: "detached" });
        for (const name of ["Nuevo envío", "Limpiar formulario", "Calcular cotización"]) assert.equal(await workspace.getByRole("button", { name, exact: true }).count(), 0, name);
        await page.screenshot({ path: path.join(output, "cashier-after-permission-revocation.png") });
      } finally { await context.close(); }
    });
    for (const surface of ["admin", "collector"]) await t.test(`${surface} records only verified external payments and refunds without changing physical cash`, async () => {
      const actor = surface === "admin" ? admin : collector;
      await store.transaction((state) => {
        if (!state.remittances.cashSessions.some((cash) => cash.operatorId === actor.id && cash.currency === "DOP" && cash.date === businessDate(now)))
          openRemittanceCash(state, admin, { operatorId: actor.id, currency: "DOP", openingAmount: 0 }, [collector], now);
      });
      const context = await browser.newContext({ viewport: surface === "admin" ? { width: 1440, height: 1000 } : { width: 390, height: 844 }, locale: "es-DO", serviceWorkers: "block", extraHTTPHeaders: { "x-qa-rate-refresh-client": `payments-${surface}` } });
      try {
        await context.addInitScript(({ token, surface }: { token: string; surface: string }) => {
          if (surface === "admin") localStorage.setItem("cyp-admin-token", token); else sessionStorage.setItem("cyp-collector-token", token);
        }, { token: tokens[surface], surface });
        await context.route("**/*", routeLocalOnly);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(`${origin}/${surface}/?view=remittances`);
        if (surface === "admin") await (await menuOption(page, "Envíos de dinero")).click();
        const workspace = page.getByRole("region", { name: "Envíos de dinero", exact: true });
        for (const method of ["card", "transfer", "deposit"]) {
          const choose = async (label: string, code: string) => {
            await workspace.getByRole("combobox", { name: label, exact: true }).fill(code);
            await workspace.getByRole("option").filter({ hasText: code }).first().click();
          };
          await choose("Remitente", "CL-0001"); await choose("Destinatario", "CL-0002");
          await workspace.getByLabel("Moneda del remitente").selectOption("DOP");
          await workspace.getByLabel("Moneda del destinatario").selectOption("DOP");
          await workspace.getByLabel("Monto a enviar (DOP)", { exact: true }).fill("900");
          await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
          await workspace.getByRole("button", { name: "Revisar y confirmar envío", exact: true }).click();
          const review = page.getByRole("dialog", { name: "Confirmar envío", exact: true });
          await review.getByLabel("Forma de pago", { exact: true }).selectOption(method);
          const before = (await store.read()).remittances.transfers.length;
          await review.getByRole("button", { name: "Aceptar", exact: true }).click();
          await review.getByRole("alert").waitFor();
          assert.equal((await store.read()).remittances.transfers.length, before);
          await review.getByLabel("Referencia del comprobante", { exact: true }).fill(`QA-${surface}-${method}`);
          await review.getByLabel("Banco o proveedor (opcional)", { exact: true }).fill("Banco ficticio");
          await review.getByLabel("Comprobé que el pago fue recibido", { exact: true }).check();
          await page.screenshot({ path: path.join(output, `${surface}-${method}-confirmation.png`) });
          await review.getByRole("button", { name: "Aceptar", exact: true }).click();
          const print = page.getByRole("dialog", { name: "¿Quieres imprimir el recibo?", exact: true }); await print.waitFor();
          await print.getByRole("button", { name: "No imprimir", exact: true }).click();
          const saved = (await store.read()).remittances.transfers.at(-1)!;
          assert.equal(saved.payment?.method, method);
          assert.equal((await store.read()).remittances.events.find((event) => event.transferId === saved.id && event.type === "sent")?.amount, 0);
          await workspace.getByRole("button", { name: saved.envioReference, exact: true }).click();
          const detail = page.getByRole("dialog", { name: `${saved.envioReference} · ${saved.reciboReference}`, exact: true });
          const receipt = detail.getByRole("article", { name: "Recibo del envío de dinero", exact: true });
          assert.match(await receipt.innerText(), new RegExp(`QA-${surface}-${method}`)); assert.equal((await receipt.innerText()).includes("Devuelta"), false);
          await detail.getByLabel("Motivo de cancelación", { exact: true }).fill("Prueba de devolución externa");
          await detail.getByLabel("Referencia de devolución", { exact: true }).fill(`QA-REFUND-${surface}-${method}`);
          await detail.getByLabel("Comprobé la devolución al remitente", { exact: true }).check();
          await detail.getByRole("button", { name: "Revisar cancelación", exact: true }).click();
          await page.getByRole("dialog", { name: "Cancelar envío pendiente", exact: true }).getByRole("button", { name: "Confirmar", exact: true }).click();
          await detail.locator(".remittance-status.cancelled").waitFor();
          const after = await store.read(); assert.equal(after.remittances.events.find((event) => event.transferId === saved.id && event.type === "cancelled")?.amount, 0);
          assert.equal(after.remittances.transfers.find(({ id }) => id === saved.id)?.refund?.reference, `QA-REFUND-${surface}-${method}`);
          await detail.getByRole("button", { name: `Cerrar ${saved.envioReference} · ${saved.reciboReference}`, exact: true }).click();
        }
      } finally { await context.close(); }
    });
    assert.deepEqual(errors, []); assert.equal(unexpectedExternalAttempts, 0, "The application must not attempt any unexpected external request.");
    t.diagnostic(`Blocked known antivirus attempts: ${blockedAntivirusAttempts}; blocked existing font attempts: ${blockedFontAttempts}; unexpected external attempts: ${unexpectedExternalAttempts}; no external URLs recorded or requests sent.`);
    t.diagnostic(`QA screenshots: ${output}`);
  } finally { await browser?.close(); if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); await app.close(); }
});
