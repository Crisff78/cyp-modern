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

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwright: string | undefined;
try { playwright = require.resolve("playwright"); } catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  playwright = fs.existsSync(cache) ? fs.readdirSync(cache).map((folder) => path.join(cache, folder, "node_modules/playwright/index.mjs")).find((file) => fs.existsSync(file)) : undefined;
}
test("actual delivery UI resolves synthetic previous cash, preserves history and recovers confirmations safely", {
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
  let failSnapshotOnce = false, loseReceiptOnce = false;
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
    await page.locator(".sidebar").getByRole("button", { name: "Entregas de Dinero", exact: true }).click();
    const view = page.locator(".cash-deliveries-legacy-view"); await view.waitFor();
    const receipt = () => page.getByRole("dialog", { name: "Resolver efectivo de jornadas anteriores...", exact: true });
    const delivery = () => page.getByRole("dialog", { name: "Datos de la Entrega de Dinero...", exact: true });
    const openDelivery = async (collector = "col-1") => {
      await view.getByTitle("Nuevo", { exact: true }).click(); await delivery().waitFor();
      await delivery().getByLabel("Cobrad.:").selectOption(collector);
      await delivery().getByLabel("Cantidad a entregar 10", { exact: true }).fill("5");
    };
    await openDelivery();
    await t.test("blocking explains earlier cash; nested Cancel preserves the delivery draft and performs no writes", async () => {
      await delivery().getByRole("button", { name: "Guardar", exact: true }).click();
      await delivery().getByRole("alert").filter({ hasText: "Debes resolver el efectivo pendiente" }).waitFor();
      assert.equal(writes.at(-1)?.status, 409);
      await delivery().getByRole("button", { name: "Resolver saldo anterior", exact: true }).click();
      await receipt().getByRole("button", { name: "Registrar devolución", exact: true }).waitFor();
      assert.ok((await receipt().innerText()).includes("USD"));
      await receipt().getByLabel("Efectivo recibido DOP", { exact: true }).fill("1000.00");
      await receipt().getByLabel("Motivo de devolución", { exact: true }).fill("Borrador sin guardar");
      const before = writes.length;
      await receipt().getByRole("button", { name: "Cancelar", exact: true }).click();
      await receipt().waitFor({ state: "hidden" }); assert.equal(writes.length, before);
      assert.equal((await store.read()).cashReconciliations?.length, 0);
      assert.equal(await delivery().getByLabel("Cantidad a entregar 10", { exact: true }).inputValue(), "5");
    });
    await t.test("exact currency totals, reason and receipt confirmation are mandatory", async () => {
      await delivery().getByRole("button", { name: "Resolver saldo anterior", exact: true }).click();
      await receipt().getByRole("button", { name: "Registrar devolución", exact: true }).waitFor();
      assert.equal(await receipt().getByLabel("Efectivo recibido DOP", { exact: true }).inputValue(), "0.00");
      const before = writes.length;
      await receipt().getByRole("button", { name: "Registrar devolución", exact: true }).click();
      await receipt().getByRole("alert").filter({ hasText: "Confirma la recepción" }).waitFor();
      await receipt().getByRole("checkbox").check();
      await receipt().getByRole("button", { name: "Registrar devolución", exact: true }).click();
      await receipt().getByRole("alert").filter({ hasText: "Escribe el motivo" }).waitFor();
      await receipt().getByLabel("Motivo de devolución", { exact: true }).fill("Devolución de prueba del efectivo anterior");
      await receipt().getByRole("button", { name: "Usar importes ficticios de prueba", exact: true }).click();
      const screenshots = path.join(adminRoot, "../../output/playwright"); fs.mkdirSync(screenshots, { recursive: true });
      await page.screenshot({ path: path.join(screenshots, "previous-cash-reconciliation-20261014.png") });
      await receipt().getByLabel("Efectivo recibido USD", { exact: true }).fill("0.00");
      await receipt().getByRole("button", { name: "Registrar devolución", exact: true }).click();
      await receipt().getByRole("alert").filter({ hasText: "USD debe coincidir exactamente" }).waitFor();
      assert.equal(writes.length, before);
      await receipt().getByRole("button", { name: "Usar importes ficticios de prueba", exact: true }).click();
    });
    await t.test("a committed receipt followed by a failed refresh retries only the snapshot; new and repeated deliveries work", async () => {
      failSnapshotOnce = true;
      await receipt().getByRole("button", { name: "Registrar devolución", exact: true }).click();
      await receipt().getByRole("alert").filter({ hasText: "La devolución ya se guardó" }).waitFor();
      assert.equal((await store.read()).cashReconciliations?.length, 2);
      const posts = writes.filter((row) => row.url === "/api/cuadres/regularizar").length;
      await receipt().getByRole("button", { name: "Actualizar vista", exact: true }).click();
      await receipt().waitFor({ state: "hidden" });
      assert.equal(writes.filter((row) => row.url === "/api/cuadres/regularizar").length, posts);
      assert.deepEqual((await store.read()).movements.slice(0, 3), oldMovements);
      await delivery().getByRole("button", { name: "Guardar", exact: true }).click(); await delivery().waitFor({ state: "hidden" });
      assert.equal(writes.at(-1)?.status, 200);
      await openDelivery(); await delivery().getByRole("button", { name: "Guardar", exact: true }).click(); await delivery().waitFor({ state: "hidden" });
      assert.equal(writes.at(-1)?.status, 200);
    });
    await t.test("a 503 after committing is recovered with the same immutable body and key after closing and reopening", async () => {
      await openDelivery("col-2"); await delivery().getByRole("button", { name: "Resolver saldo anterior", exact: true }).click();
      await receipt().getByRole("button", { name: "Registrar devolución", exact: true }).waitFor();
      await receipt().getByRole("button", { name: "Usar importes ficticios de prueba", exact: true }).click();
      await receipt().getByLabel("Motivo de devolución", { exact: true }).fill("Segunda devolución de prueba"); await receipt().getByRole("checkbox").check();
      loseReceiptOnce = true; await receipt().getByRole("button", { name: "Registrar devolución", exact: true }).click();
      await receipt().getByRole("button", { name: "Reintentar devolución", exact: true }).waitFor();
      assert.equal(await receipt().getByLabel("Motivo de devolución", { exact: true }).isDisabled(), true);
      const committed = writes.at(-1); assert.equal((await store.read()).cashReconciliations?.length, 3);
      await receipt().getByRole("button", { name: "Cancelar", exact: true }).click();
      await delivery().getByRole("button", { name: "Resolver saldo anterior", exact: true }).click();
      assert.equal(await receipt().getByLabel("Motivo de devolución", { exact: true }).inputValue(), "Segunda devolución de prueba");
      await receipt().getByRole("button", { name: "Reintentar devolución", exact: true }).click(); await receipt().waitFor({ state: "hidden" });
      assert.deepEqual(writes.at(-1)?.body, committed?.body); assert.equal(writes.at(-1)?.key, committed?.key);
      assert.equal((await store.read()).cashReconciliations?.length, 3);
      await delivery().getByRole("button", { name: "Cancelar", exact: true }).click();
    });
    await t.test("daily settlement and monitor show net cash without modifying original delivered totals", async () => {
      await page.locator(".sidebar").getByRole("button", { name: "Cuadres Diarios", exact: true }).click();
      const grid = page.locator(".connected-settlements-mdi"); await grid.waitFor();
      await page.getByText("Devuelto / conciliado:", { exact: true }).first().waitFor();
      assert.equal((await store.read()).movements.filter((row) => oldMovements.some((old) => old.id === row.id)).length, 3);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      assert.equal(await grid.getByRole("cell", { name: "Conciliado", exact: true }).count(), 3);
      await page.locator(".sidebar").getByRole("button", { name: "Monitor C", exact: true }).click();
      const monitor = page.locator(".collector-monitor-mdi"); await monitor.waitFor();
      const collector = monitor.locator("tbody tr").filter({ has: page.getByRole("cell", { name: state.collectors[0].name, exact: true }) });
      assert.equal(await collector.locator("td").nth(5).innerText(), "RD$ 1,100.00");
      assert.equal(await collector.locator("td").nth(7).innerText(), "RD$ 100.00");
      assert.match(await collector.locator("td").nth(7).locator("span").getAttribute("title"), /devuelto y conciliado/);
    });
  } finally {
    await context?.close(); await browser?.close();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await app.close(); fs.rmSync(output, { recursive: true, force: true });
  }
});
