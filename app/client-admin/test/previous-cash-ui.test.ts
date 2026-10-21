import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";
import { businessDate } from "../../server/src/domain.js";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwright: string | undefined;
try { playwright = require.resolve("playwright"); } catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  playwright = fs.existsSync(cache) ? fs.readdirSync(cache).map((folder) => path.join(cache, folder, "node_modules/playwright/index.mjs")).find((file) => fs.existsSync(file)) : undefined;
}
test("actual Cuadres Diarios UI exclusively closes synthetic cash, preserves history and recovers confirmations safely", {
  skip: process.platform !== "win32" || !fs.existsSync(edge) || !playwright ? "Installed Edge and Playwright required; no download attempted." : false,
}, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-previous-cash-ui-"));
  const state = seed(), old = new Date(Date.now() - 2 * 86400000).toISOString();
  state.settlements = [];
  state.movements = [
    { id: "old-delivery-dop", type: "office_delivery", collectorId: "col-1", amount: 100000, currency: "DOP", createdAt: old, actorId: "demo-admin" },
    { id: "old-delivery-usd", type: "office_delivery", collectorId: "col-1", amount: 2500, currency: "USD", createdAt: old, actorId: "demo-admin" },
    { id: "second-collector-old", type: "office_delivery", collectorId: "col-2", amount: 20000, currency: "DOP", createdAt: old, actorId: "demo-admin" },
  ];
  const oldMovements = structuredClone(state.movements), store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-previous-cash-ui-secret-at-least-32", origins: [], collectorUrl: "/collector/" });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200); const token = login.json().token;
  const writes: Array<{ url: string; status: number; key: string | undefined; body: any }> = [];
  let failSnapshotOnce = false, loseReceiptOnce = false, loseCloseOnce = false;
  let browser: any, context: any, server: ReturnType<typeof createServer> | undefined;
  const errors: string[] = [], external: string[] = [];
  try {
    const module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
    const entry = path.join(output, "fixture.tsx");
    fs.writeFileSync(entry, `import {createRoot} from 'react-dom/client'; import App from ${module("App.tsx")}; import ${module("styles.css")}; import ${module("suggestions-shell.css")}; createRoot(document.getElementById('root')).render(<App/>);`);
    const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([
      import(pathToFileURL(require.resolve("vite")).href), import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(require.resolve("@tailwindcss/vite")).href), import(pathToFileURL(playwright!).href),
    ]);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react(), tailwind()], define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.VITE_COLLECTOR_URL": JSON.stringify("/collector/") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, cssCodeSplit: false, lib: { entry, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname.startsWith("/api/")) {
          if (url.pathname === "/api/snapshot" && failSnapshotOnce) { failSnapshotOnce = false; response.writeHead(503, { "Content-Type": "application/json" }); response.end('{"error":{"message":"Recarga ficticia no disponible"}}'); return; }
          const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
          const result = await app.inject({ method: request.method as "GET" | "POST", url: request.url!, headers: request.headers, ...(body ? { payload: body } : {}) });
          if (request.method === "POST") writes.push({ url: url.pathname, status: result.statusCode, key: request.headers["idempotency-key"] as string | undefined, body });
          if (url.pathname === "/api/cuadres/regularizar" && loseReceiptOnce && result.statusCode === 200) {
            loseReceiptOnce = false;
            response.writeHead(503, { "Content-Type": "application/json" });
            response.end('{"error":{"message":"Se perdió la confirmación ficticia después de guardar"}}'); return;
          }
          if (url.pathname === "/api/cuadres" && loseCloseOnce && result.statusCode === 200) {
            loseCloseOnce = false; response.writeHead(503, { "Content-Type": "application/json" });
            response.end('{"error":{"message":"Se perdió la confirmación del cierre ficticio"}}'); return;
          }
          response.writeHead(result.statusCode, { "Content-Type": "application/json; charset=utf-8" }); response.end(result.body); return;
        }
        if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>'); return; }
        if (["/fixture.js", "/fixture.css"].includes(url.pathname)) { response.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css" }); response.end(fs.readFileSync(path.join(output, "dist", url.pathname.slice(1)))); return; }
        response.writeHead(404); response.end();
      } catch { response.writeHead(500); response.end('{"error":{"message":"Synthetic fixture failed"}}'); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", serviceWorkers: "block" });
    await context.addInitScript(({ token, origin }: { token: string; origin: string }) => { if (location.origin === origin) localStorage.setItem("cyp-admin-token", token); }, { token, origin });
    await context.route("**/*", (route: any) => {
      const target = new URL(route.request().url());
      if (target.origin === origin) return route.continue();
      if (!/kaspersky|\.kis\./i.test(target.hostname)) external.push(target.origin);
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", (error: Error) => { if (!/kaspersky|\.kis\./i.test(error.stack ?? "")) errors.push(error.message); });
    await page.goto(origin); await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor();
    await page.locator(".sidebar").getByRole("button", { name: "PAGOS", exact: true }).click();
    await page.locator(".sidebar").getByRole("button", { name: "Entregas de Dinero a Cobradores", exact: true }).click();
    const view = page.locator(".cash-deliveries-legacy-view"); await view.waitFor();
    const oldDate = businessDate(new Date(old)), today = businessDate(new Date());
    const receipt = () => page.getByRole("dialog", { name: "Devolución de efectivo del cuadre...", exact: true });
    const delivery = () => page.getByRole("dialog", { name: "Datos de la Entrega de Dinero...", exact: true });
    const closing = () => page.getByRole("dialog", { name: "Confirmar cierre de jornada...", exact: true });
    const settlementGrid = () => page.locator(".connected-settlements-mdi");
    // Sections of the menu start closed: open the one that holds the option first.
    const navigate = async (name: string) => {
      const option = page.locator(".sidebar").getByRole("button", { name, exact: true });
      const folded = page.locator(`.sidebar .nav-item[aria-label="${name}"]`);
      // Wait until the menu of the account is drawn: the option on view or folded in its section.
      await option.or(folded).first().waitFor({ state: "attached" });
      if (!await option.isVisible()) await page.locator(".sidebar .nav-group").filter({ has: page.locator(`.nav-item[aria-label="${name}"]`) }).locator(".nav-group-trigger").click();
      await option.click();
    };
    const openDelivery = async (collector = "col-1") => {
      await navigate("Entregas de Dinero a Cobradores"); await view.getByTitle("Nuevo", { exact: true }).click(); await delivery().waitFor();
      await delivery().getByLabel("Cobrad.:").selectOption(collector);
      await delivery().getByLabel("Cantidad a entregar 10", { exact: true }).fill("5");
    };
    const openClosing = async (collector = "col-1", date = oldDate) => {
      await navigate("Cuadres Diarios"); await settlementGrid().waitFor();
      await settlementGrid().getByLabel("Cobrador:", { exact: true }).selectOption(collector);
      const name = state.collectors.find((row) => row.id === collector)!.name;
      const row = settlementGrid().locator("tbody tr").filter({ has: page.getByRole("cell", { name: `${name} · DOP`, exact: true }) })
        .filter({ has: page.getByRole("cell", { name: date, exact: true }) });
      await row.click(); await settlementGrid().getByRole("button", { name: "Revisar cuadre", exact: true }).click(); await closing().waitFor();
    };
    const openReceipt = async () => {
      await closing().getByRole("button", { name: "Registrar devolución y cerrar", exact: true }).click();
      await receipt().getByRole("button", { name: /^(Registrar devolución y cerrar|Reintentar devolución)$/ }).waitFor();
    };
    await t.test("delivery only saves a delivery; an earlier balance directs the operator to Cuadres Diarios", async () => {
      await openDelivery();
      assert.equal(await delivery().getByRole("button", { name: "Resolver saldo anterior", exact: true }).count(), 0);
      await delivery().getByRole("button", { name: "Guardar", exact: true }).click();
      await delivery().getByRole("alert").filter({ hasText: "Cuadres Diarios" }).waitFor(); assert.equal(writes.at(-1)?.status, 409);
      await delivery().getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(writes.filter((row) => row.url.startsWith("/api/cuadres")).length, 0);
      await openClosing(); await openReceipt();
      assert.ok((await receipt().innerText()).includes("USD"));
      await receipt().getByLabel("Efectivo recibido DOP", { exact: true }).fill("1000.00");
      await receipt().getByLabel("Motivo de devolución", { exact: true }).fill("Borrador sin guardar");
      const before = writes.length;
      await receipt().getByRole("button", { name: "Cancelar", exact: true }).click();
      await receipt().waitFor({ state: "hidden" }); assert.equal(writes.length, before);
      assert.equal((await store.read()).cashReconciliations?.length, 0);
      await closing().waitFor(); assert.equal(await closing().getByLabel("Fecha:", { exact: true }).inputValue(), oldDate);
    });
    await t.test("closing requires exact currency totals, a reason and explicit receipt confirmation", async () => {
      await openReceipt(); assert.equal(await receipt().getByLabel("Efectivo recibido DOP", { exact: true }).inputValue(), "0.00");
      const before = writes.length;
      await receipt().getByRole("button", { name: "Registrar devolución y cerrar", exact: true }).click();
      await receipt().getByRole("alert").filter({ hasText: "Confirma la recepción" }).waitFor();
      await receipt().getByRole("checkbox").check(); await receipt().getByRole("button", { name: "Registrar devolución y cerrar", exact: true }).click();
      await receipt().getByRole("alert").filter({ hasText: "Escribe el motivo" }).waitFor();
      await receipt().getByLabel("Motivo de devolución", { exact: true }).fill("Devolución de prueba del cierre diario");
      await receipt().getByRole("button", { name: "Usar importes ficticios de prueba", exact: true }).click();
      await receipt().getByLabel("Efectivo recibido USD", { exact: true }).fill("0.00");
      await receipt().getByRole("button", { name: "Registrar devolución y cerrar", exact: true }).click();
      await receipt().getByRole("alert").filter({ hasText: "USD debe coincidir exactamente" }).waitFor(); assert.equal(writes.length, before);
      await receipt().getByRole("button", { name: "Usar importes ficticios de prueba", exact: true }).click();
      const screenshots = path.join(adminRoot, "../../output/playwright"); fs.mkdirSync(screenshots, { recursive: true });
      await page.screenshot({ path: path.join(screenshots, "settlement-cash-close-20261015.png") });
    });
    await t.test("a saved receipt refreshes only the snapshot after a failed reload and permits subsequent deliveries", async () => {
      failSnapshotOnce = true; await receipt().getByRole("button", { name: "Registrar devolución y cerrar", exact: true }).click();
      await receipt().getByRole("alert").filter({ hasText: "El cuadre y la devolución ya se guardaron" }).waitFor();
      assert.equal((await store.read()).cashReconciliations?.length, 2);
      const posts = writes.filter((row) => row.url === "/api/cuadres/regularizar").length;
      await receipt().getByRole("button", { name: "Actualizar vista", exact: true }).click(); await receipt().waitFor({ state: "hidden" });
      await closing().waitFor({ state: "hidden" });
      assert.equal(writes.filter((row) => row.url === "/api/cuadres/regularizar").length, posts);
      assert.equal(await settlementGrid().getByRole("cell", { name: "Conciliado", exact: true }).count(), 2);
      assert.deepEqual((await store.read()).movements.slice(0, 3), oldMovements);
      await openDelivery(); assert.equal(await delivery().getByRole("alert").count(), 0);
      await delivery().getByRole("button", { name: "Guardar", exact: true }).click(); await delivery().waitFor({ state: "hidden" }); assert.equal(writes.at(-1)?.status, 200);
      await openDelivery(); await delivery().getByRole("button", { name: "Guardar", exact: true }).click(); await delivery().waitFor({ state: "hidden" }); assert.equal(writes.at(-1)?.status, 200);
    });
    await t.test("a lost receipt response retains the same date, immutable body and key after reopening", async () => {
      await openClosing("col-2"); await openReceipt();
      await receipt().getByRole("button", { name: "Usar importes ficticios de prueba", exact: true }).click();
      await receipt().getByLabel("Motivo de devolución", { exact: true }).fill("Segunda devolución de prueba"); await receipt().getByRole("checkbox").check();
      loseReceiptOnce = true; await receipt().getByRole("button", { name: "Registrar devolución y cerrar", exact: true }).click();
      await receipt().getByRole("button", { name: "Reintentar devolución", exact: true }).waitFor();
      assert.equal(await receipt().getByLabel("Motivo de devolución", { exact: true }).isDisabled(), true);
      const committed = writes.at(-1); assert.equal(committed?.body.date, oldDate); assert.equal((await store.read()).cashReconciliations?.length, 3);
      await receipt().getByRole("button", { name: "Cancelar", exact: true }).click();
      await closing().getByRole("button", { name: "Cancelar", exact: true }).click();
      await settlementGrid().getByRole("button", { name: "Refrescar", exact: true }).click();
      await settlementGrid().getByRole("button", { name: "Generar cuadre", exact: true }).click();
      const recovery = page.getByRole("dialog", { name: "Generar cuadre...", exact: true });
      await recovery.getByRole("button", { name: "Reintentar devolución", exact: true }).click();
      await receipt().getByRole("button", { name: "Reintentar devolución", exact: true }).waitFor();
      assert.equal(await receipt().getByLabel("Motivo de devolución", { exact: true }).inputValue(), "Segunda devolución de prueba");
      failSnapshotOnce = true;
      await receipt().getByRole("button", { name: "Reintentar devolución", exact: true }).click();
      await receipt().getByRole("alert").filter({ hasText: "El cuadre y la devolución ya se guardaron" }).waitFor();
      assert.deepEqual(writes.at(-1)?.body, committed?.body); assert.equal(writes.at(-1)?.key, committed?.key); assert.equal((await store.read()).cashReconciliations?.length, 3);
      const posted = writes.length;
      await receipt().getByRole("button", { name: "Actualizar vista", exact: true }).click(); await receipt().waitFor({ state: "hidden" });
      assert.equal(writes.length, posted);
    });
    await t.test("Cuadres closes today's remaining cash and the delivery view cannot operate on the closed day", async () => {
      await openClosing("col-1", today); await openReceipt();
      await receipt().getByRole("button", { name: "Usar importes ficticios de prueba", exact: true }).click();
      await receipt().getByLabel("Motivo de devolución", { exact: true }).fill("Cierre del día actual"); await receipt().getByRole("checkbox").check();
      await receipt().getByRole("button", { name: "Registrar devolución y cerrar", exact: true }).click(); await receipt().waitFor({ state: "hidden" });
      assert.equal((await store.read()).cashReconciliations?.filter((row) => row.collectorId === "col-1" && row.date === today).length, 1);
      await openDelivery(); await delivery().getByRole("button", { name: "Guardar", exact: true }).click();
      await delivery().getByRole("alert").filter({ hasText: "La jornada ya está cerrada" }).waitFor(); assert.equal(writes.at(-1)?.status, 409);
      await delivery().getByRole("button", { name: "Cancelar", exact: true }).click();
    });
    await t.test("zero balance closing recovers a lost response and a failed refresh without duplicating the stored closure", async () => {
      await navigate("Cuadres Diarios"); await settlementGrid().getByRole("button", { name: "Generar cuadre", exact: true }).click();
      const generation = page.getByRole("dialog", { name: "Generar cuadre...", exact: true });
      await generation.getByLabel("Cobrador:", { exact: true }).selectOption("col-2"); await generation.getByLabel("Jornada:", { exact: true }).fill(today);
      await generation.getByRole("button", { name: "Calcular cuadre", exact: true }).click(); await closing().waitFor();
      loseCloseOnce = true; await closing().getByRole("button", { name: "Cerrar jornada", exact: true }).click();
      await closing().getByRole("button", { name: "Reintentar cierre", exact: true }).waitFor(); const committed = writes.at(-1);
      assert.equal((await store.read()).settlements.length, 1);
      await closing().getByRole("button", { name: "Cancelar", exact: true }).click();
      await settlementGrid().getByRole("button", { name: "Generar cuadre", exact: true }).click();
      await generation.waitFor(); assert.equal(await generation.getByLabel("Cobrador:", { exact: true }).isDisabled(), true);
      failSnapshotOnce = true; await generation.getByRole("button", { name: "Reintentar cierre", exact: true }).click();
      await generation.getByRole("alert").filter({ hasText: "El cuadre ya se guardó" }).waitFor();
      assert.deepEqual(writes.at(-1)?.body, committed?.body); assert.equal(writes.at(-1)?.key, committed?.key);
      const count = writes.filter((row) => row.url === "/api/cuadres").length;
      await generation.getByRole("button", { name: "Actualizar vista", exact: true }).click(); await generation.waitFor({ state: "hidden" });
      assert.equal(writes.filter((row) => row.url === "/api/cuadres").length, count); assert.equal((await store.read()).settlements.length, 1);
      await page.reload(); await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor(); await navigate("Cuadres Diarios");
      // The reloaded window starts on the current operational week (from Monday): the closures of two days ago need the range.
      await settlementGrid().getByLabel("Fecha Inicial:", { exact: true }).fill(oldDate);
      assert.equal(await settlementGrid().getByRole("cell", { name: "Conciliado", exact: true }).count(), 4);
      assert.equal(await settlementGrid().getByRole("cell", { name: "Cerrado", exact: true }).count(), 1);
    });
    await t.test("stored settlement and monitor retain original gross totals while showing returned cash and zero net balance", async () => {
      assert.deepEqual((await store.read()).movements.filter((row) => oldMovements.some((old) => old.id === row.id)), oldMovements);
      await navigate("Monitor C"); const monitor = page.locator(".collector-monitor-mdi"); await monitor.waitFor();
      const collector = monitor.locator("tbody tr").filter({ has: page.getByRole("cell", { name: state.collectors[0].name, exact: true }) });
      assert.equal(await collector.locator("td").nth(5).innerText(), "RD$ 1,100.00"); assert.equal(await collector.locator("td").nth(7).innerText(), "RD$ 0.00");
      assert.match(await collector.locator("td").nth(7).locator("span").getAttribute("title"), /devuelto y conciliado/);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
    });
  } finally {
    await context?.close(); await browser?.close();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await app.close(); fs.rmSync(output, { recursive: true, force: true });
  }
});
