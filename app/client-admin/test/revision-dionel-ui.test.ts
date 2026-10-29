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
import { DEMO_PASSWORD } from "../../server/src/demo-credentials.js";

// Dionel's review of 26-10-2026, point by point, in the actual App with a synthetic MemoryStore API.
const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); } catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
}
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);

test("Dionel's review (26-10): header, double click, funnel, paged Clientes, «No Definida» and clean remittance form", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-revision-dionel-"));
  const state = seed();
  // 112 synthetic clients on top of the seed: the Clientes window must page them.
  for (let index = 1; index <= 112; index++) state.clients.push({
    id: `qa-dionel-${String(index).padStart(3, "0")}`, name: `Cliente revisión ${String(index).padStart(3, "0")}`, code: `QA-DIO-${String(index).padStart(3, "0")}`,
    phone: "", address: "Calle ficticia", routeId: index % 2 ? "route-1" : "route-2", sector: index % 5 ? "Distrito Nacional" : "", active: index % 9 !== 0,
  } as (typeof state.clients)[number]);
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-revision-dionel-secret-at-least-32-chars", origins: [], collectorUrl: "/collector/" });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin", password: DEMO_PASSWORD } })).json().token as string;
  const post = async (url: string, payload: unknown) => {
    const response = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() }, payload });
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`); return response.json();
  };
  await post("/api/cobros", { chargeId: "chg-1", amount: 12345 });
  await post("/api/depositos", { collectorId: "col-1", currency: "DOP", amount: 100, denominations: [{ denominacion: 100, cantidad: 1 }] });
  const payout = state.payouts[0];
  await post("/api/pagos", { payoutId: payout.id, amount: 100 });
  // A payout of this week, inside the default dates of Descargos.
  await post("/api/descargos", { clientId: "cli-1", collectorId: "col-1", concept: "Descargo de revisión", amount: 2500 });
  const pageRequests: URL[] = [];
  let browser: any, server: ReturnType<typeof createServer> | undefined;
  const pageErrors: string[] = [];
  try {
    const module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
    const fixture = path.join(output, "fixture.tsx");
    fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";\nimport App from ${module("App.tsx")};\nimport ${module("styles.css")};\nimport ${module("suggestions-shell.css")};\nimport ${JSON.stringify(localRequire.resolve("leaflet/dist/leaflet.css").replaceAll("\\", "/"))};\nwindow.print = () => {};\ncreateRoot(document.getElementById("root")).render(<App />);\n`, "utf8");
    const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href), import(pathToFileURL(localRequire.resolve("@tailwindcss/vite")).href), import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react(), tailwind()], define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.VITE_COLLECTOR_URL": JSON.stringify("/collector/") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, cssCodeSplit: false, sourcemap: false, rollupOptions: { output: { inlineDynamicImports: true } }, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname.startsWith("/api/")) {
          if (url.pathname === "/api/clientes/pagina") pageRequests.push(url);
          const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
          const result = await app.inject({ method: request.method as "GET" | "POST", url: request.url!, headers: request.headers, ...(body ? { payload: body } : {}) });
          response.writeHead(result.statusCode, { "Content-Type": "application/json; charset=utf-8" }); response.end(result.body); return;
        }
        if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>'); return; }
        if (["/fixture.js", "/fixture.css"].includes(url.pathname)) { response.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css" }); response.end(fs.readFileSync(path.join(output, "dist", url.pathname.slice(1)))); return; }
        response.writeHead(404); response.end();
      } catch { response.writeHead(500); response.end('{"error":{"message":"Synthetic fixture failure"}}'); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
    await context.addInitScript(({ auth, origin }: { auth: string; origin: string }) => { if (location.origin === origin) sessionStorage.setItem("cyp-admin-token", auth); }, { auth: token, origin });
    await context.route("**/*", (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on("pageerror", (error: Error) => pageErrors.push(error.message));
    const reset = async () => { await page.goto(origin); await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor(); };
    const openNav = async (name: string, window: string) => {
      await reset();
      const option = page.locator(".sidebar").getByRole("button", { name, exact: true });
      const folded = page.locator(`.sidebar .nav-item[aria-label="${name}"]`);
      await option.or(folded).first().waitFor({ state: "attached" });
      if (!await option.isVisible()) await page.locator(".sidebar .nav-group").filter({ has: page.locator(`.nav-item[aria-label="${name}"]`) }).locator(".nav-group-trigger").click();
      await option.click();
      const frame = page.getByRole("dialog", { name: window, exact: true }); await frame.waitFor(); return frame;
    };
    const shot = (name: string) => page.screenshot({ path: path.join(output, `${name}.png`) });
    const filterIcon = (frame: any) => frame.getByRole("button", { name: "Mostrar/Ocultar filtros", exact: true }).first().locator("svg").getAttribute("data-icon");

    await t.test("1.1 and 1.2: Facturas and Pagos together; no backup button", async () => {
      await reset();
      const labels = await page.locator(".topbar-actions").evaluate((bar: HTMLElement) => [...bar.querySelectorAll(":scope > button")].map((button) => button.getAttribute("aria-label") ?? ""));
      const from = labels.findIndex((label) => label.startsWith("Notificaciones"));
      assert.deepEqual(labels.slice(from + 1, from + 4), ["Facturas", "Ventana de Pagos", "Qué hay de nuevo"]);
      assert.equal(await page.getByRole("button", { name: "Hacer copia de respaldo", exact: true }).count(), 0);
    });

    await t.test("2.3: Clientes asks the server for pages of 50 and moves between them", async () => {
      const clients = await openNav("Clientes", "Clientes");
      const rows = clients.locator(".clients-grid tbody tr[role=button]");
      await rows.nth(49).waitFor();
      assert.equal(await rows.count(), 50);
      const activeTotal = state.clients.filter((client) => client.active !== false).length;
      assert.match(await clients.locator(".legacy-footerbar").innerText(), new RegExp(`Cantidad\\s*${activeTotal}`));
      assert.ok(pageRequests.length > 0 && pageRequests.every((url) => url.searchParams.get("limit") === "50"), "every request asks for one page");
      const firstCode = await rows.first().locator("td").first().innerText();
      assert.equal(await clients.getByRole("button", { name: "Primera página", exact: true }).isDisabled(), true);
      await clients.getByRole("button", { name: "Página siguiente", exact: true }).click();
      await clients.getByText("Página 2 de", { exact: false }).waitFor();
      assert.notEqual(await rows.first().locator("td").first().innerText(), firstCode);
      await clients.getByRole("button", { name: "Última página", exact: true }).click();
      await clients.getByText(`Página ${Math.ceil(activeTotal / 50)} de ${Math.ceil(activeTotal / 50)}`, { exact: false }).waitFor();
      assert.equal(await clients.getByRole("button", { name: "Página siguiente", exact: true }).isDisabled(), true);
      assert.equal(await rows.count(), activeTotal - Math.floor((activeTotal - 1) / 50) * 50);
      await clients.getByRole("button", { name: "Primera página", exact: true }).click();
      await clients.getByText("Página 1 de", { exact: false }).waitFor();
      // «Todos» in Estado is paged too.
      await clients.getByLabel("Estado:", { exact: false }).selectOption("Todos");
      await clients.getByText(new RegExp(`Cantidad\\s*${state.clients.length}`)).waitFor();
      assert.equal(await rows.count(), 50);
      // Typing searches on the server, not in the browser.
      await clients.getByLabel("Buscar clientes por código, teléfono o nota", { exact: true }).fill("QA-DIO-111");
      await clients.locator(".clients-grid tbody tr[role=button]").filter({ hasText: "QA-DIO-111" }).waitFor();
      assert.equal(await rows.count(), 1);
      assert.ok(pageRequests.some((url) => url.searchParams.get("mode") === "search" && url.searchParams.get("q") === "QA-DIO-111"));
      await shot("2.3-clientes-paginas");
    });

    await t.test("2.4: Ruta «No Definida» in Clientes", async () => {
      const clients = await openNav("Clientes", "Clientes");
      const route = clients.getByRole("combobox", { name: "Ruta", exact: true });
      assert.equal((await route.locator("option").allInnerTexts())[0], "No Definida");
      const zone = clients.getByRole("combobox", { name: "Zona", exact: true });
      assert.equal((await zone.locator("option").allInnerTexts())[0], "No Definida");
      const zoneRequest = page.waitForRequest((request: any) => request.url().includes("/api/clientes/pagina") && new URL(request.url()).searchParams.get("mode") === "zone");
      await clients.locator("label.client-radio-line").filter({ hasText: "por Zona:" }).locator("input").check();
      const sent = new URL((await zoneRequest).url());
      assert.equal(sent.searchParams.get("q"), "No Definida");
      assert.equal(sent.searchParams.get("limit"), "50");
      await clients.locator("label.client-radio-line").filter({ hasText: "por Ruta:" }).locator("input").check();
      await route.selectOption({ label: "No Definida" });
      await clients.getByText("No hay clientes para estos filtros.", { exact: true }).waitFor();
    });

    await t.test("2.1: double click or Enter opens the client to edit; Space only selects", async () => {
      const clients = await openNav("Clientes", "Clientes");
      const row = clients.locator(".clients-grid tbody tr[role=button]").nth(3); await row.waitFor();
      const name = await row.locator("td").nth(2).innerText();
      await row.dblclick();
      const ficha = page.getByRole("dialog", { name: "Datos del Cliente...", exact: true }); await ficha.waitFor();
      assert.equal(await ficha.getByLabel("Cliente:", { exact: true }).inputValue(), name);
      await shot("2.1-clientes-doble-clic");
      await page.getByRole("button", { name: "Cerrar Datos del Cliente...", exact: true }).click(); await ficha.waitFor({ state: "detached" });
      const other = clients.locator(".clients-grid tbody tr[role=button]").nth(5);
      await other.focus(); await page.keyboard.press(" ");
      assert.equal(await other.getAttribute("aria-selected"), "true");
      assert.equal(await ficha.count(), 0, "Space selects without opening");
      await page.keyboard.press("Enter"); await ficha.waitFor();
      assert.equal(await ficha.getByLabel("Cliente:", { exact: true }).inputValue(), await other.locator("td").nth(2).innerText());
    });

    await t.test("2.1: Cargos and Descargos edit, Cobros, Depósitos and Pagos open their receipt", async () => {
      const cases: Array<[string, string, string, string]> = [
        ["Cargos", "Cargos", ".charges-view tbody tr[role=button]", "Datos del Cargo..."],
        ["Descargos", "Descargos", ".payouts-table tbody tr[role=button]", "Datos del Descargo..."],
        ["Cobros", "Cobros", ".collections-table tbody tr[role=button]", "Imprimir Recibo de Cobro..."],
        ["Depósitos por Cobradores", "Depósitos por Cobradores", ".deposits-table tbody tr[role=button]", "Imprimir Comprobante de Depósito..."],
        ["Pagos", "Pagos", ".payments-table tbody tr[role=button]", "Imprimir Recibo de Cobro..."],
      ];
      for (const [option, window, rowSelector, dialogName] of cases) {
        const frame = await openNav(option, window);
        const row = frame.locator(rowSelector).first(); await row.waitFor();
        await row.dblclick();
        const dialog = page.getByRole("dialog", { name: dialogName, exact: true }); await dialog.waitFor();
        await shot(`2.1-${option.replaceAll(" ", "-").toLowerCase()}`);
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
        await row.focus(); await page.keyboard.press("Enter"); await dialog.waitFor();
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      }
    });

    await t.test("2.2: the funnel shows and hides the filters (Rardiel, 28-10: the funnel again); Depósitos hides its details panel too", async () => {
      for (const [option, window] of [["Clientes", "Clientes"], ["Cargos", "Cargos"], ["Cobros", "Cobros"], ["Depósitos por Cobradores", "Depósitos por Cobradores"]]) {
        const frame = await openNav(option, window);
        assert.equal(await filterIcon(frame), "embudo", option);
        assert.equal(await frame.locator("[data-icon^='panel-']").count(), 0, option);
        assert.equal(await frame.locator(".lucide-key-round").count(), 0, option);
      }
      const deposits = await openNav("Depósitos por Cobradores", "Depósitos por Cobradores");
      const details = deposits.getByRole("complementary", { name: "Panel de detalles", exact: true });
      await details.waitFor();
      assert.equal(await deposits.getByRole("button", { name: "Mostrar/Ocultar detalles", exact: true }).locator("svg.lucide-panel-right").count(), 1);
      await deposits.getByRole("button", { name: "Mostrar/Ocultar detalles", exact: true }).click();
      await details.waitFor({ state: "detached" });
      await deposits.getByRole("button", { name: "Mostrar/Ocultar filtros", exact: true }).click();
      assert.equal(await deposits.getByRole("complementary", { name: "Panel de filtro de depósitos", exact: true }).count(), 0);
      await shot("2.2-depositos-sin-paneles");
      await deposits.getByRole("button", { name: "Mostrar/Ocultar detalles", exact: true }).click(); await details.waitFor();
    });

    await t.test("2.4: «No Definida» next to «Todas» in Ruta and Zona of the reports", async () => {
      await reset();
      const sidebar = page.locator(".sidebar");
      await sidebar.getByRole("button", { name: "CUADRES Y REPORTES", exact: true }).click();
      await sidebar.getByRole("button", { name: "Reportes", exact: true }).click();
      const reports = page.getByRole("dialog", { name: "Reportes", exact: true }); await reports.waitFor();
      for (const [label, window, field] of [
        ["Cargos pendientes de clientes por rutas.", "Reporte de Cobros Pendientes de Clientes por Ruta", "Ruta:"],
        ["Cargos pendientes de clientes por zonas.", "Reporte de Cobros Pendientes de Clientes por Zona", "Zona:"],
        ["Pagos pendientes por rutas.", "Pagos pendientes por rutas", "Ruta:"],
        ["Pagos pendientes por zonas.", "Pagos pendientes por zonas", "Zona:"],
      ]) {
        await reports.getByRole("button", { name: label, exact: true }).click();
        const report = page.getByRole("dialog", { name: window, exact: true }); await report.waitFor();
        const select = report.locator("label").filter({ hasText: field }).locator("select").first();
        assert.deepEqual((await select.locator("option").allInnerTexts()).slice(0, 2), ["Todas", "No Definida"], `${window} ${field}`);
        await select.selectOption({ label: "No Definida" });
        if (field === "Ruta:") await shot(`2.4-${window.replaceAll(" ", "-").replaceAll(".", "").toLowerCase()}`);
        await page.getByRole("button", { name: `Cerrar ${window}`, exact: true }).click();
      }
    });

    await t.test("3.1: Envíos de dinero without the two fixed texts; the commission keeps its hint", async () => {
      await reset();
      const sidebar = page.locator(".sidebar");
      await sidebar.getByRole("button", { name: "REMESAS", exact: true }).click();
      await sidebar.getByRole("button", { name: "Envíos de dinero", exact: true }).click();
      const workspace = page.getByRole("region", { name: "Envíos de dinero", exact: true });
      await workspace.getByRole("combobox", { name: "Remitente", exact: true }).waitFor();
      const text = await workspace.innerText();
      for (const fixed of ["Reparto automático", "Cada cliente carga su moneda habitual", "Necesitas una caja abierta", "Envíos registrados por tu operación", "Se aplica automáticamente"])
        assert.equal(text.includes(fixed), false, fixed);
      assert.match(String(await workspace.getByLabel("Comisión (%)", { exact: true }).getAttribute("title")), /Parte del gestor/);
      assert.match(String(await workspace.locator("label").filter({ hasText: "Moneda del remitente" }).getAttribute("title")), /caja de remesas abierta/);
      await shot("3.1-envios-de-dinero");
    });
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    await app.close();
    for (const name of ["cache", "dist", "fixture.tsx"]) fs.rmSync(path.join(output, name), { recursive: true, force: true });
    t.diagnostic(`Capturas: ${output}`);
  }
});
