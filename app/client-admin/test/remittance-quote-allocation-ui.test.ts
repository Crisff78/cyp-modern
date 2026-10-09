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
    setCommissionPolicy(state, admin, 200, now);
    openRemittanceCash(state, admin, { operatorId: admin.id, currency: "USD", openingAmount: 0 }, [], now);
    openRemittanceCash(state, admin, { operatorId: collector.id, currency: "USD", openingAmount: 0 }, [collector], now);
  });
  const app = await buildApp({ store, demo: true, secret: "quote-allocation-synthetic-secret-32", origins: [], collectorUrl: "/collector/" });
  let server: ReturnType<typeof createServer> | undefined, browser: any;
  const errors: string[] = [], external: string[] = [];
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
    browser = await chromium.launch({ executablePath: edge, headless: true });
    for (const surface of ["admin", "collector"]) await t.test(`${surface} active render: readonly DOP, inverse rounding, save and cancellation`, async () => {
      const context = await browser.newContext({ viewport: surface === "admin" ? { width: 1440, height: 1000 } : { width: 390, height: 844 }, locale: "es-DO", serviceWorkers: "block" });
      try {
        await context.addInitScript(({ token, surface }: { token: string; surface: string }) => {
          if (surface === "admin") localStorage.setItem("cyp-admin-token", token); else sessionStorage.setItem("cyp-collector-token", token);
        }, { token: tokens[surface], surface });
        await context.route("**/*", async (route: any) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) { if (!["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) external.push(url.origin); return route.abort("blockedbyclient"); }
          return route.continue();
        });
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(`${origin}/${surface}/?view=remittances`);
        if (surface === "admin") await page.getByRole("button", { name: "REMESAS", exact: true }).click();
        const workspace = page.getByRole("region", { name: "Envíos de Dinero", exact: true });
        await workspace.getByRole("button", { name: "Nuevo envío", exact: true }).click();
        const choose = async (label: string, code: string) => { const input = workspace.getByRole("combobox", { name: label, exact: true }); await input.fill(code); await workspace.getByRole("option").filter({ hasText: code }).first().click(); };
        const state = await store.read(), sender = state.clients.find((row) => row.id === "cli-1")!, recipient = state.clients.find((row) => row.id === "cli-5")!;
        await choose("Remitente", sender.code); await choose("Destinatario", recipient.code);
        await workspace.getByLabel("Moneda del remitente").selectOption("USD");
        await workspace.getByLabel("Moneda del destinatario").selectOption("EUR");
        await workspace.getByLabel("Comisión (%)", { exact: true }).fill("5");
        await workspace.getByLabel("Monto a enviar (USD)", { exact: true }).fill("100");
        await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        const dop = workspace.getByRole("textbox", { name: "Equivalente del principal en DOP", exact: true });
        await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('input[readonly]')).some((input) => input.value === "DOP 6,000.00"));
        assert.equal(await dop.getAttribute("readonly"), ""); assert.equal(await dop.inputValue(), "DOP 6,000.00");
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
        await confirmation.getByRole("button", { name: "Confirmar", exact: true }).click();
        const print = page.getByRole("dialog", { name: "¿Quieres imprimir el recibo?", exact: true }); await print.waitFor();
        await print.getByRole("button", { name: "No imprimir", exact: true }).click();
        const saved = (await store.read()).remittances.transfers.at(-1)!;
        assert.equal(saved.requestedReceiveAmount, 8000); assert.equal(saved.commissionAllocation!.managerAmount, 160);
        assert.equal(saved.sendingUserId, surface === "admin" ? admin.id : collector.id);
        await workspace.getByRole("button", { name: saved.envioReference, exact: true }).click();
        const detail = page.getByRole("dialog", { name: `${saved.envioReference} · ${saved.reciboReference}`, exact: true });
        await detail.getByLabel("Motivo de cancelación", { exact: true }).fill("Cancelación sintética QA");
        await detail.getByRole("button", { name: "Revisar cancelación", exact: true }).click();
        await page.getByRole("dialog", { name: "Cancelar envío pendiente", exact: true }).getByRole("button", { name: "Confirmar", exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.remittance-status.cancelled') !== null);
        assert.equal((await store.read()).remittances.transfers.find((row) => row.id === saved.id)!.status, "cancelled");
        await detail.getByRole("button", { name: `Cerrar ${saved.envioReference} · ${saved.reciboReference}`, exact: true }).click();
        await workspace.getByRole("button", { name: "Nuevo envío", exact: true }).click();
        await workspace.getByLabel("Moneda del destinatario").selectOption("DOP");
        await workspace.getByLabel("Comisión (%)", { exact: true }).fill("50");
        await workspace.getByLabel("Monto a recibir (DOP)", { exact: true }).fill("1");
        await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        await workspace.getByText(/El importe real difiere por redondeo/).waitFor();
        assert.match(await workspace.locator('.remittance-quote').innerText(), /DOP 1\.20/);
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
        await context.route("**/*", async (route: any) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) { if (!["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) external.push(url.origin); return route.abort("blockedbyclient"); }
          return route.continue();
        });
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(`${origin}/admin/`); await page.getByRole("button", { name: "REMESAS", exact: true }).click();
        const workspace = page.getByRole("region", { name: "Envíos de Dinero", exact: true });
        await workspace.getByRole("button", { name: "Reportes", exact: true }).click();
        await workspace.getByLabel("Reporte", { exact: false }).selectOption("allocations");
        const consult = async () => { await workspace.getByRole("button", { name: "Consultar", exact: true }).click(); await workspace.getByRole("table", { name: "Totales del periodo por Moneda", exact: true }).waitFor(); };
        await consult();
        const totals = workspace.getByRole("table", { name: "Totales del periodo por Moneda", exact: true });
        const columns = await totals.getByRole("columnheader").allTextContents();
        for (const column of ["Comisión Total de la Transacción", "Comisión de la Empresa", "Comisión del Gestor"]) assert.ok(columns.includes(column));
        const expectedTotals = await totals.locator("tbody tr").evaluateAll((rows: HTMLTableRowElement[]) => rows.map((row) => Array.from(row.cells).map((cell) => cell.textContent)));
        assert.deepEqual(expectedTotals.map((row: string[]) => row.slice(1, 7)), [["DOP", "1", "0", "DOP 300.00", "DOP 180.00", "DOP 120.00"], ["EUR", "2", "3", "EUR 8.00", "EUR 4.80", "EUR 3.20"]]);
        const groups = workspace.getByRole("table", { name: "Comisiones agrupadas por Gestor y Moneda", exact: true });
        assert.equal(await groups.locator("tbody tr").count(), 3, "Homonymous gestor IDs and currencies stay separate");
        const downloadPromise = page.waitForEvent("download"); await workspace.getByRole("button", { name: "Exportar CSV", exact: true }).click();
        const download = await downloadPromise, csvPath = path.join(output, "consolidated.csv"); await download.saveAs(csvPath);
        const csv = fs.readFileSync(csvPath, "utf8");
        for (const row of expectedTotals) assert.ok(csv.includes(row.map((cell: string) => `"${cell}"`).join(";")), "CSV contains the exact onscreen totals");
        assert.match(csv, /"'=Gestor QA homónimo"/, "Formula injection neutralization remains active");
        const popupPromise = page.waitForEvent("popup"); await workspace.getByRole("button", { name: "Imprimir", exact: true }).click(); const popup = await popupPromise;
        await popup.waitForFunction(() => (window as any).__qaPrinted === true);
        const printRows = await popup.locator("table").filter({ has: popup.getByRole("columnheader", { name: "Total", exact: true }) }).locator("tbody tr").evaluateAll((rows: HTMLTableRowElement[]) => rows.map((row) => Array.from(row.cells).map((cell) => cell.textContent)));
        assert.deepEqual(printRows, expectedTotals); assert.equal(await popup.locator("nav,aside,button,input,select").count(), 0, "Print isolates report content"); await popup.close();
        await groups.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, "consolidated-report.png") });
        await workspace.getByLabel("Estado de la operación", { exact: true }).selectOption("paid");
        assert.equal(await workspace.getByRole("button", { name: "Exportar CSV", exact: true }).count(), 0, "Filters invalidate the old printable/exportable result");
        await consult(); assert.match(await totals.locator("tbody").innerText(), /EUR 4\.00.*EUR 2\.40.*EUR 1\.60/s);
        await workspace.getByLabel("Gestor", { exact: true }).selectOption(admin.id); await consult();
        assert.match(await totals.innerText(), /No hay resultados/);
        await workspace.getByLabel("Gestor", { exact: true }).selectOption("");
        await workspace.getByLabel("Estado de la operación", { exact: true }).selectOption("cancelled"); await consult();
        const cancelledAmounts = await totals.locator("tbody tr").evaluateAll((rows: HTMLTableRowElement[]) => rows.map((row) => Array.from(row.cells).slice(4, 7).map((cell) => cell.textContent)));
        assert.deepEqual(cancelledAmounts, [["EUR 0.00", "EUR 0.00", "EUR 0.00"]]);
        await workspace.getByLabel("Estado de la operación", { exact: true }).selectOption("active");
        await workspace.getByLabel("Moneda de destino", { exact: true }).selectOption("EUR");
        await workspace.getByLabel("Agrupar por", { exact: true }).selectOption("currency"); await consult();
        assert.equal(await workspace.getByRole("table", { name: "Comisiones agrupadas por Moneda", exact: true }).locator("tbody tr").count(), 1);
        assert.equal(await totals.locator("tbody tr").count(), 1); assert.match(await totals.locator("tbody").innerText(), /EUR 8\.00.*EUR 4\.80.*EUR 3\.20/s);
        const today = businessDate(now), nextDay = new Date(`${today}T12:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        await workspace.getByLabel("Desde", { exact: true }).fill(nextDay.toISOString().slice(0, 10)); await workspace.getByLabel("Hasta", { exact: true }).fill(nextDay.toISOString().slice(0, 10)); await consult();
        assert.match(await totals.innerText(), /No hay resultados/);
      } finally { await context.close(); }
    });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    t.diagnostic(`QA screenshots: ${output}`);
  } finally { await browser?.close(); if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); await app.close(); }
});
