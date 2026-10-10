import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { MemoryStore } from "../../server/src/store.js";
import { seed } from "../../server/src/seed.js";
import { businessDate } from "../../server/src/domain.js";
import { createRemittance, openRemittanceCash, quoteRemittance, setCommissionPolicy } from "../../server/src/remittances.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(root, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  if (fs.existsSync(cache)) playwrightEntry = fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find(fs.existsSync);
}

test("October financial screens use central rates, currency-separated settlements and private receipt output", { skip: process.platform !== "win32" || !fs.existsSync(edge) || !playwrightEntry ? "Requires installed Edge and Playwright; no download" : false }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-october-financial-ui-"));
  const store = new MemoryStore(seed()), now = new Date(), date = businessDate(now);
  const actor = { id: "demo-admin", name: "Administración", role: "admin" as const };
  await store.transaction((state) => {
    state.clients[0].identification = "QA-DOC-ORIGIN"; state.clients[0].phone = "8090000101";
    state.systemConfig = { ...state.systemConfig, receiptFooterNote: "Pie ficticio para comprobar impresión" };
    state.settlements.push({ id: "qa-multicurrency-close", collectorId: "col-1", date, status: "closed", closedAt: now.toISOString(), collected: 10000, deposited: 10000, officeDelivered: 0, paidToClients: 0, difference: 0,
      totalsByCurrency: { DOP: { collected: 10000, deposited: 10000, officeDelivered: 0, paidToClients: 0, difference: 0 }, USD: { collected: 1000, deposited: 1000, officeDelivered: 0, paidToClients: 0, difference: 0 }, EUR: { collected: 500, deposited: 500, officeDelivered: 0, paidToClients: 0, difference: 0 } } });
    setCommissionPolicy(state, actor, { transactionCommissionBps: 500, managerCommissionBps: 200 }, now);
    openRemittanceCash(state, actor, { operatorId: actor.id, currency: "DOP", openingAmount: 0 }, [], now);
    const quote = quoteRemittance(state, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 10000, commissionBps: 500 }, now);
    createRemittance(state, actor, { senderClientId: "cli-1", recipientClientId: "cli-5", sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 10000, commissionBps: 500, quote: quote.quote, note: "Nota QA búsqueda" }, [], now);
  });
  const app = await buildApp({ store, demo: true, secret: "october-financial-synthetic-secret-32", origins: [], collectorUrl: "/collector/" });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200);
  const token = login.json().token;
  let server: ReturnType<typeof createServer> | undefined, browser: any;
  const writes: { path: string; key: string }[] = [], errors: string[] = [], blockedExternal = new Set<string>();
  let loseRateResponse = false;
  try {
    const fixture = path.join(output, "fixture.tsx"), module = (name: string) => JSON.stringify(path.join(root, "src", name).replaceAll("\\", "/"));
    const shared = JSON.stringify(path.resolve(root, "../shared/remittances/RemittancesWorkspace.tsx").replaceAll("\\", "/"));
    fs.writeFileSync(fixture, `import {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {ConnectedExchangeRates} from ${module("ConnectedExchangeRates.tsx")};
import {ConnectedSettlements} from ${module("ConnectedSettlements.tsx")};
import {remittancesApi} from ${module("remittancesApi.ts")};
import RemittancesWorkspace from ${shared};
import ${module("styles.css")};
function Fixture({snapshot}){const [view,setView]=useState('rates');return <main><nav>{['rates','settlements','remittances'].map(v=><button key={v} onClick={()=>setView(v)}>{v}</button>)}</nav>{view==='rates'?<ConnectedExchangeRates actorId='demo-admin' isAdmin={true}/>:view==='settlements'?<ConnectedSettlements snapshot={snapshot} onRefresh={()=>{}}/>:<RemittancesWorkspace api={remittancesApi} user={{id:'demo-admin',name:'Administración'}} isAdmin={true}/>}</main>}
remittancesApi('/snapshot').then(snapshot=>createRoot(document.getElementById('root')).render(<Fixture snapshot={snapshot}/>));`, "utf8");
    const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href), import(pathToFileURL(localRequire.resolve("@tailwindcss/vite")).href), import(pathToFileURL(playwrightEntry!).href)]);
    await build({ root, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react(), tailwind()], define: { "process.env.NODE_ENV": JSON.stringify("production") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const result = await app.inject({ method: request.method as "GET" | "POST", url: url.pathname + url.search, headers: request.headers, ...(chunks.length ? { payload: Buffer.concat(chunks).toString() } : {}) });
        if (request.method === "POST") writes.push({ path: url.pathname, key: String(request.headers["idempotency-key"] ?? "") });
        if (loseRateResponse && url.pathname === "/api/envios/tasas" && request.method === "POST" && result.statusCode === 200) { loseRateResponse = false; response.writeHead(200, { "Content-Type": "application/json" }); response.end("null"); return; }
        response.writeHead(result.statusCode, { "Content-Type": "application/json" }); response.end(result.body); return;
      }
      if (["/fixture.js", "/fixture.css"].includes(url.pathname)) { response.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css" }); response.end(fs.readFileSync(path.join(output, "dist", path.basename(url.pathname)))); return; }
      response.writeHead(200, { "Content-Type": "text/html" }); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>');
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert.ok(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "es-DO", serviceWorkers: "block" });
    await context.addInitScript((value: string) => localStorage.setItem("cyp-admin-token", value), token);
    await context.route("**/*", (route: any) => { const target = new URL(route.request().url()); if (target.origin === origin || target.protocol === "about:") return route.continue(); blockedExternal.add(target.hostname); return route.abort("blockedbyclient"); });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(origin);
    await t.test("buy/sell survive a missing successful acknowledgement and retry keeps one idempotent write", async () => {
      await page.getByRole("button", { name: "Nuevo", exact: true }).click();
      let dialog = page.getByRole("dialog", { name: "Datos de la Tasa de Cambio...", exact: true });
      await dialog.getByLabel("Tasa de remesas", { exact: true }).fill("60"); await dialog.getByLabel("Compra", { exact: true }).fill("59.25"); await dialog.getByLabel("Venta", { exact: true }).fill("61.75");
      await dialog.getByRole("button", { name: "Revisar tasa", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "Confirmar Tasa de Cambio...", exact: true });
      const before = (await store.read()).remittances.rateHistory?.length ?? 0;
      loseRateResponse = true;
      await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
      await dialog.getByRole("button", { name: "Reintentar misma operación", exact: true }).waitFor();
      assert.equal((await store.read()).remittances.rateHistory?.length, before + 1);
      await dialog.getByRole("button", { name: "Reintentar misma operación", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal((await store.read()).remittances.rateHistory?.length, before + 1);
      const requests = writes.filter((entry) => entry.path === "/api/envios/tasas"); assert.equal(requests.length, 2); assert.ok(requests[0].key); assert.equal(requests[0].key, requests[1].key);
      const row = page.locator("tbody tr").filter({ hasText: "59.250000" }); await row.waitFor(); assert.ok((await row.innerText()).includes("61.750000"));
      await page.screenshot({ path: path.join(output, "rates.png"), fullPage: true });
    });
    await t.test("editing the DOP reference shows three readonly values of one", async () => {
      await page.locator("tbody tr").filter({ hasText: "Peso Dominicano" }).dblclick();
      const dialog = page.getByRole("dialog", { name: "Datos de la Tasa de Cambio...", exact: true });
      for (const name of ["Tasa de remesas", "Compra", "Venta"]) { const input = dialog.getByLabel(name, { exact: true }); assert.equal(await input.inputValue(), "1.000000"); assert.equal(await input.getAttribute("readonly"), ""); }
      await dialog.getByRole("button", { name: "Revisar tasa", exact: true }).click();
      await page.getByRole("dialog", { name: "Confirmar Tasa de Cambio...", exact: true }).getByRole("button", { name: "Cerrar Confirmar Tasa de Cambio...", exact: true }).click();
    });
    await t.test("daily settlement filter and output preserve DOP/USD/EUR independently", async () => {
      await page.getByRole("button", { name: "settlements", exact: true }).click();
      const filter = page.locator(".daily-settlements-filter select").first(); await filter.waitFor(); assert.equal(await filter.isDisabled(), false);
      await filter.selectOption("USD");
      const row = page.locator("tbody tr").filter({ hasText: "USD" }); await row.waitFor(); assert.ok((await row.innerText()).includes("USD 10.00")); assert.ok(!(await row.innerText()).includes("DOP 100.00"));
      await row.dblclick(); const detail = page.getByRole("dialog", { name: "Balance del Día...", exact: true }); assert.equal(await detail.getByLabel("Moneda:").inputValue(), "USD"); await detail.getByRole("button", { name: "Cerrar", exact: true }).click();
      await filter.selectOption(""); assert.equal(await page.locator("tbody tr").count(), 3);
      const popupReady = context.waitForEvent("page"); await page.getByRole("button", { name: "Imprimir", exact: true }).click(); const popup = await popupReady; await popup.waitForLoadState();
      const totals = await popup.locator("table").last().innerText(); for (const amount of ["DOP 100.00", "USD 10.00", "EUR 5.00"]) assert.ok(totals.includes(amount)); assert.ok(!totals.includes("115.00")); await popup.close();
      await page.screenshot({ path: path.join(output, "settlements.png"), fullPage: true });
    });
    await t.test("remittance rates are readonly central references and receipt print hides commission splits", async () => {
      await page.getByRole("button", { name: "remittances", exact: true }).click(); await page.getByRole("button", { name: "Tasas", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Revisar tasa", exact: true }).count(), 0); assert.ok((await page.locator(".remittances").innerText()).includes("Consulta de tasas de Administración"));
      await page.getByRole("button", { name: "Recibos", exact: true }).click(); await page.getByLabel("Buscar", { exact: true }).fill("QA-DOC-ORIGIN");
      const row = page.locator(".remittance-transfer-table tbody tr").filter({ hasText: "REC" }); await row.waitFor(); await row.dblclick();
      const detail = page.getByRole("dialog"); const popupReady = context.waitForEvent("page"); await detail.getByRole("button", { name: "Imprimir comprobante", exact: true }).click(); const popup = await popupReady; await popup.waitForLoadState();
      const receiptText = await popup.locator("body").innerText(); assert.ok(receiptText.includes("DOP 105.00")); assert.ok(receiptText.includes("8090000101")); assert.ok(receiptText.includes("Pie ficticio para comprobar impresión")); assert.ok(!/Comisión|gestor/i.test(receiptText)); await popup.close();
      await page.screenshot({ path: path.join(output, "remittance-detail.png"), fullPage: true });
    });
    assert.deepEqual(errors, []);
    assert.equal([...blockedExternal].filter((host) => !/(^|\.)kaspersky-labs\.com$/.test(host)).length, 0, "Unexpected external origin blocked");
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ isolation: "MemoryStore, fresh browser, localhost only", blockedInjectorOrigins: blockedExternal.size, pageErrors: errors.length, physicalPrinting: "Not tested" }));
    await context.close(); console.log(`Synthetic financial UI evidence: ${output}`);
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    await app.close();
    assert.equal(path.dirname(path.resolve(output)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(output).startsWith("cyp-october-financial-ui-"));
    for (const name of ["cache", "dist", "fixture.tsx"]) {
      const target = path.resolve(output, name);
      assert.ok(target.startsWith(path.resolve(output) + path.sep));
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
});
