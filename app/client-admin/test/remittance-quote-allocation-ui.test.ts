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
  const admin = { id: "demo-admin", name: "Administración", role: "admin" as const }, collector = { id: "demo-collector", name: "Cobrador", role: "collector" as const, collectorId: "col-1" };
  await store.transaction((state) => {
    setDailyRate(state, admin, { currency: "USD", rate: "60", date: businessDate(now) }, now);
    setDailyRate(state, admin, { currency: "EUR", rate: "75", date: businessDate(now) }, now);
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
          const result = await app.inject({ method: request.method as "GET" | "POST", url: url.pathname + url.search,
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
    await t.test("Admin registers both central rates once and future remittances display them readonly", async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", serviceWorkers: "block" });
      try {
        await context.addInitScript((token: string) => localStorage.setItem("cyp-admin-token", token), tokens.admin);
        await context.route("**/*", routeLocalOnly);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        const workspace = page.getByRole("region", { name: "Configuración de comisiones de envíos", exact: true });
        // The fields fill in once the saved policy arrives; reading them before would see the empty draft.
        const openWorkspace = async () => {
          await page.goto(`${origin}/admin/`); await page.getByRole("button", { name: "Admin.", exact: true }).click(); await page.getByRole("button", { name: "Comisiones de envíos", exact: true }).click();
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
    for (const surface of ["admin", "collector"]) await t.test(`${surface} active render: readonly DOP, inverse rounding, save and cancellation`, async () => {
      const context = await browser.newContext({ viewport: surface === "admin" ? { width: 1440, height: 1000 } : { width: 390, height: 844 }, locale: "es-DO", serviceWorkers: "block" });
      try {
        await context.addInitScript(({ token, surface }: { token: string; surface: string }) => {
          if (surface === "admin") localStorage.setItem("cyp-admin-token", token); else sessionStorage.setItem("cyp-collector-token", token);
        }, { token: tokens[surface], surface });
        await context.route("**/*", routeLocalOnly);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(`${origin}/${surface}/?view=remittances`);
        if (surface === "admin") await page.getByRole("button", { name: "ENVÍO DE DINERO", exact: true }).click();
        const workspace = page.getByRole("region", { name: "Envíos de Dinero", exact: true });
        const senderInput = workspace.getByRole("combobox", { name: "Remitente", exact: true });
        if (surface === "admin") {
          // Administración: only the sending section, its form already open and the cursor in the sender.
          await senderInput.waitFor(); await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox");
          assert.equal(await senderInput.evaluate((element: Element) => element === document.activeElement), true, "the cursor starts in the sender");
          assert.equal(await workspace.getByRole("navigation", { name: "Secciones de Envíos", exact: true }).count(), 0);
          assert.equal(await workspace.getByRole("button", { name: "Nuevo envío", exact: true }).count(), 0);
        } else {
          // The collector terminal keeps its four sections and its «Nuevo envío».
          const sections = workspace.getByRole("navigation", { name: "Secciones de Envíos", exact: true });
          await sections.getByRole("button").first().waitFor();
          assert.deepEqual(await sections.getByRole("button").allTextContents(), ["Envíos", "Recibos", "Caja", "Reportes"]);
          await workspace.getByRole("button", { name: "Nuevo envío", exact: true }).click();
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
        await workspace.getByLabel("Ingresar importe de").selectOption("destination");
        assert.equal(await dop.inputValue(), "Calcula la cotización", "changing mode invalidates the quote");
        await workspace.getByLabel("Monto a recibir (EUR)", { exact: true }).fill("80");
        await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('input[readonly]')).some((input) => input.value === "USD 100.00"));
        await page.screenshot({ path: path.join(output, `${surface}-quote.png`) });
        await workspace.getByRole("button", { name: "Revisar y confirmar envío", exact: true }).click();
        const confirmation = page.getByRole("dialog", { name: "Confirmar envío", exact: true });
        assert.match(await confirmation.innerText(), /EUR 1\.60/); assert.match(await confirmation.innerText(), /EUR 2\.40/);
        const savedReply = page.waitForResponse((reply: any) => reply.request().method() === "POST" && new URL(reply.url()).pathname === "/api/envios");
        await confirmation.getByRole("button", { name: "Confirmar", exact: true }).click();
        const registered = await savedReply;
        assert.equal(registered.status(), 200);
        const registeredTransfer = await registered.json();
        const print = page.getByRole("dialog", { name: "¿Quieres imprimir el recibo?", exact: true }); await print.waitFor();
        await print.getByRole("button", { name: "No imprimir", exact: true }).click();
        assert.equal(await workspace.getByRole("combobox", { name: "Remitente", exact: true }).inputValue(), "", "confirmed sends clear the prior sender");
        assert.equal(await workspace.getByRole("combobox", { name: "Destinatario", exact: true }).inputValue(), "", "confirmed sends clear the prior recipient");
        assert.equal(await workspace.getByLabel("Monto a enviar (DOP)", { exact: true }).inputValue(), "");
        assert.equal(await workspace.getByRole("combobox", { name: "Remitente", exact: true }).evaluate((element: Element) => element === document.activeElement), true);
        const saved = (await store.read()).remittances.transfers.find((row) => row.id === registeredTransfer.id)!;
        assert.ok(saved, "The exact transfer returned by the creation response must exist in the ledger.");
        assert.equal(saved.status, "pending");
        assert.equal(saved.requestedReceiveAmount, 8000); assert.equal(saved.commissionAllocation!.managerAmount, 160);
        assert.equal(saved.sendingUserId, surface === "admin" ? admin.id : collector.id);
        await workspace.getByRole("button", { name: saved.envioReference, exact: true }).click();
        const detail = page.getByRole("dialog", { name: `${saved.envioReference} · ${saved.reciboReference}`, exact: true });
        await detail.getByLabel("Motivo de cancelación", { exact: true }).waitFor();
        // Administración pays only in «Pagos de Envíos»: its sending window just cancels.
        if (surface === "admin") assert.equal(await detail.getByRole("button", { name: "Registrar pago completo", exact: true }).count(), 0);
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
        if (surface === "collector") assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      } finally { await context.close(); }
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
        await page.goto(`${origin}/admin/`); await page.getByRole("button", { name: "ENVÍO DE DINERO", exact: true }).click();
        const sending = page.getByRole("region", { name: "Envíos de Dinero", exact: true });
        await sending.getByRole("combobox", { name: "Remitente", exact: true }).waitFor();
        assert.equal(await sending.getByRole("button", { name: "Reportes", exact: true }).count(), 0, "the sending window has no reports section");
        // The consolidated report lives in Reportes & Monitoreo → Reportes, in its own window.
        await page.locator(".sidebar").getByRole("button", { name: "Reportes", exact: true }).click();
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
        await report.getByLabel("Estado de la operación:").selectOption("paid");
        assert.equal(await toolbar.getByRole("button", { name: "Exportar CSV", exact: true }).isDisabled(), true, "Filters invalidate the old printable/exportable result");
        assert.equal(await toolbar.getByRole("button", { name: "Imprimir", exact: true }).isDisabled(), true);
        await consult(); assert.match(await totals.locator("tbody").innerText(), /EUR 4\.00.*EUR 2\.40.*EUR 1\.60/s);
        await report.getByLabel("Gestor:").selectOption(admin.id); await consult();
        assert.match(await totals.innerText(), /No hay resultados/);
        await report.getByLabel("Gestor:").selectOption("");
        await report.getByLabel("Estado de la operación:").selectOption("cancelled"); await consult();
        const cancelledAmounts = await totals.locator("tbody tr").evaluateAll((rows: HTMLTableRowElement[]) => rows.map((row) => Array.from(row.cells).slice(4, 7).map((cell) => cell.textContent)));
        assert.deepEqual(cancelledAmounts, [["EUR 0.00", "EUR 0.00", "EUR 0.00"]]);
        await report.getByLabel("Estado de la operación:").selectOption("active");
        await report.getByLabel("Moneda de destino:").selectOption("EUR");
        await report.getByLabel("Agrupar por:").selectOption("currency"); await consult();
        assert.equal(await report.getByRole("table", { name: "Comisiones agrupadas por Moneda", exact: true }).locator("tbody tr").count(), 1);
        assert.equal(await totals.locator("tbody tr").count(), 1); assert.match(await totals.locator("tbody").innerText(), /EUR 8\.00.*EUR 4\.80.*EUR 3\.20/s);
        const today = businessDate(now), nextDay = new Date(`${today}T12:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        await report.getByLabel("Fecha inicial:", { exact: true }).fill(nextDay.toISOString().slice(0, 10)); await report.getByLabel("Fecha final:", { exact: true }).fill(nextDay.toISOString().slice(0, 10)); await consult();
        assert.match(await totals.innerText(), /No hay resultados/);
      } finally { await context.close(); }
    });
    await t.test("office cashier permissions, atomic quick customers, keyboard capture and continuous focus in the actual Admin shell", async () => {
      const post = (url: string, payload: object, token = tokens.admin) => app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() } });
      const account = await post("/api/usuarios", { role: "user", name: "Cajero sintético", email: "cashier-dionel@example.invalid", password: "Ficticia-2026!" });
      assert.equal(account.statusCode, 200, account.body);
      const cashier = account.json();
      const keys = ["remittances.view", "remittances.create", "remittances.clients.create", "remittances.receipts", "remittances.pay"];
      assert.equal((await post(`/api/usuarios/${cashier.id}/permisos`, { mode: "custom", permissionIds: [1, 2], remittancePermissions: keys, revision: 0 })).statusCode, 200);
      assert.equal((await post("/api/envios/cajas/abrir", { operatorId: cashier.id, currency: "DOP", openingAmount: 0 })).statusCode, 200);
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: cashier.email, password: "Ficticia-2026!" } });
      assert.equal(login.statusCode, 200); const token = login.json().token;
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", serviceWorkers: "block" });
      try {
        await context.addInitScript((token: string) => localStorage.setItem("cyp-admin-token", token), token);
        await context.route("**/*", routeLocalOnly);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(`${origin}/admin/`); await page.getByRole("button", { name: "ENVÍO DE DINERO", exact: true }).click();
        const workspace = page.getByRole("region", { name: "Envíos de Dinero", exact: true });
        const sender = workspace.getByRole("combobox", { name: "Remitente", exact: true }); await sender.waitFor();
        assert.equal(await sender.evaluate((element: Element) => element === document.activeElement), true);
        assert.equal(await page.getByRole("button", { name: "Admin.", exact: true }).count(), 0);
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
        await confirm.getByRole("button", { name: "Confirmar", exact: true }).click();
        const print = page.getByRole("dialog", { name: "¿Quieres imprimir el recibo?", exact: true }); await print.waitFor();
        await print.getByRole("button", { name: "No imprimir", exact: true }).click();
        const after = await store.read(); assert.equal(after.clients.length, before.clients.length + 2);
        assert.equal(after.remittances.transfers.length, before.remittances.transfers.length + 1);
        assert.equal(await sender.inputValue(), ""); assert.equal(await sender.evaluate((element: Element) => element === document.activeElement), true);
        // Paying is done in its own window, «Pagos de Envíos», with the cursor in Buscar.
        assert.equal(await workspace.getByRole("button", { name: "Recibos", exact: true }).count(), 0);
        await page.locator(".sidebar").getByRole("button", { name: "Pagos de Envíos", exact: true }).click();
        const payouts = page.getByRole("region", { name: "Pagos de Envíos", exact: true });
        const search = payouts.getByLabel("Buscar", { exact: true }); await search.waitFor();
        await page.waitForFunction(() => document.activeElement?.hasAttribute("data-receipt-search") === true);
        assert.equal(await search.evaluate((element: Element) => element === document.activeElement), true);
        const transfer = after.remittances.transfers.find(({ sendingUserId }) => sendingUserId === cashier.id)!;
        await payouts.getByRole("button", { name: transfer.reciboReference, exact: true }).click();
        const detail = page.getByRole("dialog", { name: `${transfer.envioReference} · ${transfer.reciboReference}`, exact: true });
        await detail.getByRole("button", { name: "Registrar pago completo", exact: true }).click();
        assert.equal((await store.read()).remittances.transfers.find(({ id }) => id === transfer.id)?.status, "pending", "reviewing a payout does not move money");
        await page.getByRole("dialog", { name: "Confirmar entrega al destinatario", exact: true }).getByRole("button", { name: "Confirmar", exact: true }).click();
        await detail.locator(".remittance-status.paid").waitFor();
        const paid = (await store.read()).remittances.transfers.find(({ id }) => id === transfer.id)!;
        assert.equal(paid.status, "paid"); assert.equal(paid.paidBy, cashier.id);
        assert.equal((await store.read()).remittances.events.filter((event) => event.transferId === paid.id && event.type === "paid").length, 1);
        await detail.getByRole("button", { name: `Cerrar ${transfer.envioReference} · ${transfer.reciboReference}`, exact: true }).click();
        await page.waitForFunction(() => document.activeElement?.hasAttribute("data-receipt-search") === true);
        assert.equal(await search.evaluate((element: Element) => element === document.activeElement), true);
        // Back to the sending window, which is still open.
        await page.locator(".desktop-launchers").getByRole("button", { name: "ENVÍO DE DINERO", exact: true }).click();
        assert.equal((await post(`/api/usuarios/${cashier.id}/permisos`, { mode: "custom", permissionIds: [1, 2], remittancePermissions: ["remittances.view"], revision: 1 })).statusCode, 200);
        await workspace.getByRole("button", { name: "Actualizar", exact: true }).click();
        await sender.waitFor({ state: "detached" });
        for (const name of ["Nuevo envío", "Limpiar formulario", "Calcular cotización"]) assert.equal(await workspace.getByRole("button", { name, exact: true }).count(), 0, name);
        await page.screenshot({ path: path.join(output, "cashier-after-permission-revocation.png") });
      } finally { await context.close(); }
    });
    assert.deepEqual(errors, []); assert.equal(unexpectedExternalAttempts, 0, "The application must not attempt any unexpected external request.");
    t.diagnostic(`Blocked known antivirus attempts: ${blockedAntivirusAttempts}; blocked existing font attempts: ${blockedFontAttempts}; unexpected external attempts: ${unexpectedExternalAttempts}; no external URLs recorded or requests sent.`);
    t.diagnostic(`QA screenshots: ${output}`);
  } finally { await browser?.close(); if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); await app.close(); }
});
