import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";
import { currentOperationalWeek } from "../../shared/operationalWeek";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); } catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
}
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);
const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// Actual App, styles, API and MemoryStore; no .env, browser download, shared
// data, existing browser profile, production listener or external HTTP allowed.
test("October nine shell changes work in actual App with isolated synthetic APIs", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-october-nine-shell-"));
  const sourceFiles = ["App.tsx", "components.tsx", "styles.css", "ConnectedBanks.tsx", "connected-banks.css"];
  const sourceHashes = () => Object.fromEntries(sourceFiles.map((file) => [file, hash(path.join(adminRoot, "src", file))]));
  const before = sourceHashes();
  const cases: Array<{ name: string; status: string }> = [];
  const report: Record<string, unknown> = { scope: "Actual App and styles; ephemeral loopback, two separate MemoryStore APIs; synthetic identities only.", startedUtc: new Date().toISOString(), sourceHashes: before, cases, externalAttemptsBlocked: 0, antivirusAttemptsBlocked: 0, unexpectedPageErrors: 0 };
  const state = seed();
  state.movements = []; state.settlements = [];
  state.charges.forEach((charge) => { charge.collected = 0; charge.status = "pending"; charge.currency = "DOP"; });
  Object.assign(state.collectors[0], { name: "Cobrador sintético octubre", ident: "QA-COL-OCT", cellular: "+18095550101", active: true });
  Object.assign(state.clients[0], { name: "Cliente sintético octubre", code: "QA-CLIENT-OCT", identification: "QA-LEGAL-OCT", active: true, preferredCurrency: "DOP" });
  state.systemConfig = { "general.empresa": "Empresa sintética octubre", "general.direccion": "Dirección ficticia", "general.telefono": "+18095550100", receiptFooterNote: "Pie inicial sintético", companyLogoDataUrl: "" };
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-shell-main-secret-at-least-32-characters", origins: [], collectorUrl: "/collector/" });
  const passwordApp = await buildApp({ store: new MemoryStore(seed()), demo: true, secret: "synthetic-shell-password-secret-at-least-32-characters", origins: [], collectorUrl: "/collector/" });
  const login = async (target: typeof app) => {
    const response = await target.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin", password: "Demo-CyP-2026!" } });
    assert.equal(response.statusCode, 200); return response.json() as { token: string; user: { id: string } };
  };
  const { token } = await login(app), passwordSession = await login(passwordApp);
  const post = async (url: string, payload: unknown) => {
    const response = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() }, payload });
    assert.equal(response.statusCode, 200, `Synthetic fixture setup failed: ${url}`); return response.json();
  };
  const deliveryCreated = (await post("/api/entregas", { collectorId: "col-1", currency: "DOP", amount: 10000, note: "Nota entrega octubre", denominations: [{ denominacion: 2000, cantidad: 5 }] })).movement;
  const delivery = (await app.inject({ url: "/api/snapshot", headers: { authorization: `Bearer ${token}` } })).json().movements.find((movement: { id: string }) => movement.id === deliveryCreated.id);
  await post("/api/entregas", { collectorId: "col-2", currency: "DOP", amount: 1000, note: "Otra nota entrega" });
  await post("/api/cobros", { chargeId: "chg-1", amount: 12345 });
  const writes: Array<{ pathname: string; status: number; body: Record<string, unknown>; passwordSession: boolean }> = [];
  let failMainSnapshots = false, controlledSnapshotFailures = 0;
  let browser: any, context: any, ownContext: any, server: ReturnType<typeof createServer> | undefined;
  const unexpectedErrors: string[] = [];
  try {
    const module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
    const fixture = path.join(output, "fixture.tsx");
    fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";\nimport App from ${module("App.tsx")};\nimport ${module("styles.css")};\nimport ${module("suggestions-shell.css")};\nimport ${JSON.stringify(localRequire.resolve("leaflet/dist/leaflet.css").replaceAll("\\", "/"))};\nwindow.print = () => { window.__qaPrintCalls = (window.__qaPrintCalls || 0) + 1; };\ncreateRoot(document.getElementById("root")).render(<App />);\n`, "utf8");
    const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href), import(pathToFileURL(localRequire.resolve("@tailwindcss/vite")).href), import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react(), tailwind()], define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.VITE_COLLECTOR_URL": JSON.stringify("/collector/") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, cssCodeSplit: false, sourcemap: false, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (pathname.startsWith("/api/")) {
          const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
          const isPassword = request.headers["x-qa-own-session"] === "synthetic-password";
          if (!isPassword && pathname === "/api/snapshot" && request.method === "GET" && failMainSnapshots) {
            controlledSnapshotFailures++;
            response.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
            response.end('{"error":{"code":"QA_SNAPSHOT_UNAVAILABLE","message":"Recarga sintética no disponible"}}'); return;
          }
          const result = await (isPassword ? passwordApp : app).inject({ method: request.method as "GET" | "POST", url: request.url!, headers: request.headers, ...(body ? { payload: body } : {}) });
          if (request.method === "POST") {
            const { password: _password, currentPassword: _currentPassword, ...safe } = body ?? {};
            writes.push({ pathname, status: result.statusCode, body: safe, passwordSession: isPassword });
          }
          response.writeHead(result.statusCode, { "Content-Type": "application/json; charset=utf-8" }); response.end(result.body); return;
        }
        if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>'); return; }
        if (["/fixture.js", "/fixture.css"].includes(pathname)) { response.writeHead(200, { "Content-Type": pathname.endsWith(".js") ? "text/javascript" : "text/css" }); response.end(fs.readFileSync(path.join(output, "dist", pathname.slice(1)))); return; }
        response.writeHead(404); response.end();
      } catch { response.writeHead(500); response.end('{"error":{"message":"Synthetic shell fixture failure"}}'); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true }); report.browserVersion = browser.version();
    const protect = async (target: any, auth: string) => {
      await target.addInitScript(({ auth, origin }: { auth: string; origin: string }) => { if (location.origin === origin) localStorage.setItem("cyp-admin-token", auth); }, { auth, origin });
      await target.route("**/*", async (route: any) => {
        const destination = new URL(route.request().url());
        if (destination.origin === origin) return route.continue();
        report.externalAttemptsBlocked = Number(report.externalAttemptsBlocked) + 1;
        if (/kaspersky|\.kis\.|^gc\.kis/i.test(destination.hostname)) report.antivirusAttemptsBlocked = Number(report.antivirusAttemptsBlocked) + 1;
        return route.abort("blockedbyclient");
      });
      target.on("page", (page: any) => {
        page.setDefaultTimeout(12000);
        page.on("pageerror", (error: Error) => {
          if (/kaspersky|\.kis\.|^gc\.kis/i.test(error.stack ?? "")) return;
          unexpectedErrors.push(`${error.name}: ${error.message.replace(/https?:\/\/[^\s'"<>]+/g, "[blocked-origin]")}`); report.unexpectedPageErrors = unexpectedErrors.length;
        });
      });
    };
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
    await protect(context, token); const page = await context.newPage();
    const reset = async () => { await page.goto(origin); await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor(); };
    const openNav = async (name: string, selector: string) => { await reset(); await page.locator('.sidebar').getByRole("button", { name, exact: true }).click(); const view = page.locator(selector); await view.waitFor(); return view; };
    const openAdmin = async (name: string, selector: string) => { await reset(); await page.getByRole("button", { name: "Admin.", exact: true }).click(); await page.getByRole("dialog", { name: "Panel de Control", exact: true }).getByRole("button", { name, exact: true }).click(); const view = page.locator(selector); await view.waitFor(); return view; };
    const run = async (name: string, action: () => Promise<void>) => t.test(name, async () => {
      try { await action(); cases.push({ name, status: "PASS" }); }
      catch (error) { cases.push({ name, status: "FAIL" }); await page.screenshot({ path: path.join(output, `failure-${cases.length}.png`) }).catch(() => {}); throw error; }
    });
    await run("dashboard modules, visible SVGs, support and clickable daily settlement", async () => {
      await reset(); const launchers = page.locator(".desktop-launchers");
      assert.deepEqual(await launchers.getByRole("button").allTextContents(), ["CARGOS", "COBROS", "DESCARGOS", "PAGOS", "REMESAS", "CUADRES"]);
      assert.equal(await page.getByRole("button", { name: "Soporte Técnico", exact: true }).isVisible(), true);
      await page.getByTitle("Abrir Cuadres Diarios", { exact: true }).click(); await page.getByRole("dialog", { name: "Cuadres Diarios", exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, "dashboard.png") });
    });
    let bankId = "";
    await run("banks create, edit and inactivate through the actual Administration catalog", async () => {
      const view = await openAdmin("Bancos", ".connected-banks"); await view.getByTitle("Nuevo", { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Datos del Banco...", exact: true });
      await dialog.getByLabel("Banco:", { exact: true }).fill("Banco sintético octubre"); await dialog.getByRole("button", { name: "oK", exact: true }).click();
      await view.getByRole("cell", { name: "Banco sintético octubre", exact: true }).waitFor();
      bankId = (await store.read()).banks!.find((bank) => bank.name === "Banco sintético octubre")!.id;
      await view.getByTitle("Editar", { exact: true }).click(); await dialog.getByLabel("Activo", { exact: true }).uncheck(); await dialog.getByRole("button", { name: "oK", exact: true }).click();
      await dialog.waitFor({ state: "hidden" }); assert.equal((await store.read()).banks!.find((bank) => bank.id === bankId)!.active, false);
      await view.getByTitle("Editar", { exact: true }).click(); await dialog.getByLabel("Activo", { exact: true }).check(); await dialog.getByRole("button", { name: "oK", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      await page.screenshot({ path: path.join(output, "banks.png") });
    });
    const footer = "Pie sintético octubre\nSegunda línea <texto>";
    await run("company logo is bounded and configurable receipt footer saves literal text", async () => {
      const view = await openAdmin("Configuracion General", ".legacy-config-layout");
      await page.waitForFunction(() => !(document.querySelector(".legacy-config-actions .ok-button") as HTMLButtonElement)?.disabled);
      const upload = view.locator('input[type="file"]'); await upload.waitFor();
      await upload.setInputFiles({ name: "synthetic-logo.png", mimeType: "image/png", buffer: Buffer.from(logo.split(",")[1], "base64") });
      await view.locator(".company-logo-setting img").waitFor();
      await view.getByRole("button", { name: "Cobros y Pagos", exact: true }).click(); await view.getByRole("button", { name: "Recibos", exact: true }).click();
      await view.getByLabel(/^Nota al pie del recibo:/).fill(footer); await view.getByRole("button", { name: "oK", exact: true }).click();
      await page.getByText("Configuración guardada", { exact: true }).waitFor();
      assert.equal((await store.read()).systemConfig!.companyLogoDataUrl, logo); assert.equal((await store.read()).systemConfig!.receiptFooterNote, footer);
      await page.locator(".brand-company-logo img").waitFor();
      await view.getByRole("button", { name: "General", exact: true }).click();
      const beforeWrites = writes.filter((write) => write.pathname === "/api/configuracion").length;
      await upload.setInputFiles({ name: "oversized.png", mimeType: "image/png", buffer: Buffer.alloc(18 * 1024 + 1) });
      await page.getByText(/El logo debe ocupar como máximo/).waitFor(); assert.equal(writes.filter((write) => write.pathname === "/api/configuracion").length, beforeWrites);
      await page.screenshot({ path: path.join(output, "configuration.png") });
    });
    await run("client creation consumes one reservation; failed reloads keep legal identity and allow location/manual edits without resending the reservation", async () => {
      const view = await openNav("Clientes", ".clients-mdi-view"); await view.getByTitle("Nuevo", { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Datos del Cliente...", exact: true });
      const reservationsBefore = writes.filter((write) => write.pathname === "/api/clientes/sugerencias").length;
      await dialog.getByRole("button", { name: "Generar identificación", exact: true }).click();
      await page.waitForFunction(() => Boolean((document.getElementById("client-internal-identification") as HTMLInputElement)?.value));
      const internal = await dialog.locator("#client-internal-identification").inputValue();
      await dialog.getByRole("button", { name: "Generar código", exact: true }).click();
      await page.waitForFunction(() => (document.getElementById("client-generated-code") as HTMLInputElement)?.value.startsWith("CLI"));
      assert.equal(writes.filter((write) => write.pathname === "/api/clientes/sugerencias").length, reservationsBefore + 1);
      await dialog.getByLabel("Cédula / pasaporte:", { exact: true }).fill("QA-LEGAL-CREATED"); await dialog.getByLabel("Cliente:", { exact: true }).fill("Cliente creado sintético octubre");
      await dialog.getByLabel("Ruta del cliente", { exact: true }).selectOption("route-1");
      // Keep the parent snapshot stale until both updates finish. Reloading the
      // page, editing first, or letting a successful snapshot replace local
      // clients would mask a consumed reservation left on the local record.
      const failuresBefore = controlledSnapshotFailures;
      const failedSnapshot = () => page.waitForResponse((response: any) => new URL(response.url()).pathname === "/api/snapshot" && response.status() === 503);
      failMainSnapshots = true;
      try {
        const createReload = failedSnapshot();
        await dialog.getByRole("button", { name: "oK", exact: true }).click(); await dialog.waitFor({ state: "hidden" }); await createReload;
        await page.getByText("El cliente quedó guardado; no se pudo actualizar el listado.", { exact: true }).waitFor();
        assert.equal(controlledSnapshotFailures, failuresBefore + 1);
        const created = (await store.read()).clients.find((client) => client.name === "Cliente creado sintético octubre")!;
        assert.ok(created); assert.equal(created.internalIdentification, internal); assert.equal(created.identification, "QA-LEGAL-CREATED");
        const creation = writes.findLast((write) => write.pathname === "/api/clientes")!;
        assert.equal(creation.status, 200); assert.equal(Object.hasOwn(creation.body, "internalIdentification"), false); assert.equal(typeof creation.body.reservationId, "string");
        const clientPath = `/api/clientes/${created.id}`;
        await view.locator("tbody tr").filter({ hasText: "Cliente creado sintético octubre" }).click();
        await view.getByTitle("Mapa", { exact: true }).click();
        const mapDialog = page.getByRole("dialog", { name: "Ubicación del Cliente...", exact: true });
        await mapDialog.getByLabel("Latitud:", { exact: true }).fill("0.123456"); await mapDialog.getByLabel("Longitud:", { exact: true }).fill("0.654321");
        const locationReload = failedSnapshot();
        await mapDialog.getByRole("button", { name: "Guardar y cerrar", exact: true }).click(); await mapDialog.waitFor({ state: "hidden" }); await locationReload;
        const locationWrite = writes.findLast((write) => write.pathname === clientPath)!;
        assert.equal(locationWrite.status, 200, "Location must save after a failed reload of a newly reserved client.");
        assert.equal(Object.hasOwn(locationWrite.body, "reservationId"), false, "Location cannot resend the consumed reservation.");
        assert.equal(Object.hasOwn(locationWrite.body, "internalIdentification"), false);
        assert.equal(locationWrite.body.code, created.code); assert.equal(locationWrite.body.identification, "QA-LEGAL-CREATED");
        assert.equal(locationWrite.body.lat, 0.123456); assert.equal(locationWrite.body.lng, 0.654321);
        const located = (await store.read()).clients.find((client) => client.id === created.id)!;
        assert.equal(located.internalIdentification, internal); assert.equal(located.identification, "QA-LEGAL-CREATED"); assert.equal(located.lat, 0.123456); assert.equal(located.lng, 0.654321);
        assert.equal(controlledSnapshotFailures, failuresBefore + 2);
        await view.getByTitle("Editar", { exact: true }).click();
        assert.equal(await dialog.getByRole("button", { name: "Generar código", exact: true }).isDisabled(), true); assert.equal(await dialog.getByRole("button", { name: "Generar identificación", exact: true }).count(), 0);
        await dialog.locator("#client-generated-code").fill("QA-MANUAL-EDIT");
        const editReload = failedSnapshot();
        await dialog.getByRole("button", { name: "oK", exact: true }).click(); await dialog.waitFor({ state: "hidden" }); await editReload;
        const editWrite = writes.findLast((write) => write.pathname === clientPath)!;
        assert.equal(editWrite.status, 200); assert.equal(Object.hasOwn(editWrite.body, "reservationId"), false); assert.equal(Object.hasOwn(editWrite.body, "internalIdentification"), false);
        assert.equal(editWrite.body.code, "QA-MANUAL-EDIT"); assert.equal(editWrite.body.identification, "QA-LEGAL-CREATED"); assert.equal(editWrite.body.lat, 0.123456); assert.equal(editWrite.body.lng, 0.654321);
        const edited = (await store.read()).clients.find((client) => client.id === created.id)!;
        assert.equal(edited.code, "QA-MANUAL-EDIT"); assert.equal(edited.internalIdentification, internal); assert.equal(edited.identification, "QA-LEGAL-CREATED"); assert.equal(edited.lat, 0.123456); assert.equal(edited.lng, 0.654321);
        assert.equal(controlledSnapshotFailures, failuresBefore + 3); assert.equal(writes.filter((write) => write.pathname === clientPath).length, 2);
        assert.equal(writes.filter((write) => write.pathname === "/api/clientes/sugerencias").length, reservationsBefore + 1);
      } finally { failMainSnapshots = false; }
    });
    await run("deliveries search actual collector and actor data, retain current week and open ledger detail on double click", async () => {
      const view = await openNav("Entregas de Dinero", ".cash-deliveries-legacy-view");
      assert.deepEqual(await view.locator('input[type="date"]').evaluateAll((nodes: HTMLInputElement[]) => nodes.map((node) => node.value)), [currentOperationalWeek().from, currentOperationalWeek().to]);
      const searches = [["Serie / referencia", delivery.id], ["Celular del cobrador", "5550101"], ["Nombre del cobrador", "sintético octubre"], ["Identificación del cobrador", "QA-COL-OCT"], ["Registrado por", delivery.createdByName], ["Nota", "Nota entrega octubre"]];
      for (const [label, value] of searches) { await view.getByLabel(label, { exact: true }).fill(value); assert.equal(await view.locator("tbody tr").filter({ hasText: "Cobrador sintético octubre" }).count(), 1); await view.getByLabel(label, { exact: true }).fill(""); }
      await view.getByLabel("Nota", { exact: true }).fill("sin coincidencia ficticia"); assert.equal(await view.locator("tbody tr[role=button]").count(), 0); await view.getByLabel("Nota", { exact: true }).fill("Nota entrega octubre");
      await view.locator("tbody tr[role=button]").dblclick(); const detail = page.getByRole("dialog", { name: "Detalle de la Entrega de Dinero...", exact: true }); await detail.waitFor();
      assert.ok((await detail.innerText()).includes(delivery.id)); assert.ok((await detail.innerText()).includes("QA-COL-OCT")); assert.ok((await detail.innerText()).includes("Nota entrega octubre"));
      assert.ok((await detail.innerText()).includes(delivery.createdByName)); await page.screenshot({ path: path.join(output, "delivery-detail.png") });
    });
    await run("charges import and collection print/map tools sit together at left; deposit denominations ascend without changing greedy refresh", async () => {
      const charges = await openNav("Cargos", ".charges-view");
      const refresh = await charges.getByTitle("Refrescar", { exact: true }).boundingBox(), upload = await charges.locator(".mdi-toolbar-extra").getByTitle("Subir", { exact: true }).boundingBox(); assert(refresh && upload); assert(upload.x - (refresh.x + refresh.width) < 24);
      assert.equal(await charges.locator(".mdi-toolbar-extra").getByTitle("Subir", { exact: true }).locator("svg").evaluate((node: SVGElement) => getComputedStyle(node).display), "block");
      await charges.getByTitle("Nuevo", { exact: true }).click(); const chargeDialog = page.getByRole("dialog", { name: "Datos del Cargo...", exact: true }); await chargeDialog.waitFor(); assert.equal(await chargeDialog.getByLabel("Cantidad", { exact: true }).count(), 1); assert.equal(await chargeDialog.getByText("Tasa / Cantidad", { exact: true }).count(), 0);
      const deposits = await openNav("Depósitos por Cobradores", ".deposits-legacy-view"); await deposits.getByTitle("Nuevo", { exact: true }).click();
      const deposit = page.getByRole("dialog", { name: "Datos del Depósito...", exact: true }); await deposit.waitFor();
      const names = await deposit.locator(".deposit-denominations-table input").evaluateAll((nodes: HTMLInputElement[]) => nodes.map((node) => node.getAttribute("aria-label")));
      assert.deepEqual(names, [1, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].map((value) => `Cantidad ${value / 100}`));
      await deposit.locator(".deposit-denominations-toolbar").getByRole("button", { name: "Refrescar", exact: true }).click();
      assert.equal(await deposit.getByLabel("Cantidad 20", { exact: true }).inputValue(), "6"); assert.equal(await deposit.getByLabel("Cantidad 0.01", { exact: true }).inputValue(), "");
      await page.screenshot({ path: path.join(output, "deposit-denominations.png") });
    });
    await run("collection bank reference and note persist; selected row highlights; list printing is a single table and current receipt uses configured footer", async () => {
      const view = await openNav("Cobros", ".collections-legacy-view");
      const refresh = await view.getByTitle("Refrescar", { exact: true }).boundingBox(), print = await view.getByTitle("Imprimir", { exact: true }).boundingBox(), map = await view.getByTitle("Mapa", { exact: true }).boundingBox(); assert(refresh && print && map); assert(print.x - (refresh.x + refresh.width) < 24); assert(map.x - (print.x + print.width) < 16);
      await view.getByTitle("Nuevo", { exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Datos del Cobro...", exact: true });
      await dialog.locator("#receipt-client-code").fill("QA-CLIENT-OCT"); await dialog.locator("#receipt-bank").selectOption(bankId);
      await dialog.locator("#receipt-reference").fill("REF-OCT-SYNTHETIC"); await dialog.locator("#receipt-note").fill("Nota cobro sintética octubre");
      await dialog.getByRole("button", { name: "Agregar", exact: true }).click(); const picker = page.getByRole("dialog", { name: "Seleccionar...", exact: true }); await picker.getByRole("button", { name: "oK", exact: true }).click();
      await dialog.getByRole("button", { name: "Guardar", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
      const movement = (await store.read()).movements.findLast((movement) => movement.reference === "REF-OCT-SYNTHETIC")!; assert.equal(movement.bankId, bankId); assert.equal(movement.bankName, "Banco sintético octubre"); assert.equal(movement.note, "Nota cobro sintética octubre");
      const row = view.locator("tbody tr[role=button]").filter({ hasText: movement.receiptToken.slice(0, 10) }); await row.locator("td").first().click();
      await page.waitForFunction((prefix: string) => Array.from(document.querySelectorAll(".collections-table tbody tr")).find((node) => node.textContent?.includes(prefix))?.getAttribute("aria-selected") === "true", movement.receiptToken.slice(0, 10)); assert.equal(await row.getAttribute("aria-selected"), "true");
      assert.notEqual(await row.locator("td").first().evaluate((node: HTMLElement) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
      await view.getByTitle("Imprimir", { exact: true }).click(); let choice = page.getByRole("dialog", { name: "Seleccione...", exact: true });
      await choice.getByLabel("Listado de registros", { exact: true }).check(); const popupPromise = context.waitForEvent("page"); await choice.getByRole("button", { name: "oK", exact: true }).click(); const popup = await popupPromise;
      await popup.getByRole("heading", { name: "Listado de Cobros", exact: true }).waitFor(); assert.equal(await popup.getByRole("heading", { name: "Totales por moneda", exact: true }).count(), 1); assert.ok((await popup.locator("body").innerText()).includes("REF-OCT-SYNTHETIC")); assert.equal(await page.locator(".collection-ticket-preview").count(), 0); await popup.close();
      await view.getByTitle("Imprimir", { exact: true }).click(); choice = page.getByRole("dialog", { name: "Seleccione...", exact: true }); await choice.getByLabel("Registro actual", { exact: true }).check(); await choice.getByRole("button", { name: "oK", exact: true }).click();
      const receipt = page.getByRole("dialog", { name: "Imprimir Recibo de Cobro...", exact: true }); await receipt.getByRole("button", { name: "Imprimir / Guardar PDF", exact: true }).waitFor();
      await receipt.getByRole("button", { name: "Imprimir / Guardar PDF", exact: true }).click(); assert.equal(await page.evaluate(() => (window as any).__qaPrintCalls), 1); assert.equal(await receipt.locator(".collection-ticket-preview").count(), 1); assert.ok((await receipt.innerText()).includes(footer)); assert.ok((await receipt.innerText()).includes("Banco sintético octubre")); await page.screenshot({ path: path.join(output, "collection-receipt.png") });
    });
    await run("own password validates current value, logs out after save and leaves the other synthetic session usable", async () => {
      ownContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", serviceWorkers: "block", extraHTTPHeaders: { "x-qa-own-session": "synthetic-password" } }); await protect(ownContext, passwordSession.token);
      const ownPage = await ownContext.newPage(); await ownPage.goto(origin); await ownPage.getByRole("button", { name: "Abrir cuenta", exact: true }).click(); await ownPage.getByRole("button", { name: "Cambiar mi clave", exact: true }).click();
      const dialog = ownPage.getByRole("dialog", { name: "Cambiar mi clave...", exact: true }); await dialog.getByLabel("Clave actual:", { exact: true }).fill("Incorrecta-ficticia"); await dialog.getByLabel("Nueva clave:", { exact: true }).fill("Nueva-ficticia-2026!"); await dialog.getByLabel("Confirmación:", { exact: true }).fill("Nueva-ficticia-2026!"); await dialog.getByRole("button", { name: "Guardar", exact: true }).click(); await dialog.getByRole("alert").waitFor();
      assert.equal(await ownPage.evaluate(() => Boolean(localStorage.getItem("cyp-admin-token"))), true);
      await dialog.getByLabel("Clave actual:", { exact: true }).fill("Demo-CyP-2026!"); await dialog.getByRole("button", { name: "Guardar", exact: true }).click(); await ownPage.getByRole("button", { name: /^Administrador/ }).waitFor(); assert.equal(await ownPage.evaluate(() => localStorage.getItem("cyp-admin-token")), null);
      assert.equal((await app.inject({ url: "/api/snapshot", headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
      const oldLogin = await passwordApp.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin", password: "Demo-CyP-2026!" } }); assert.equal(oldLogin.statusCode, 401);
      const newLogin = await passwordApp.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin", password: "Nueva-ficticia-2026!" } }); assert.equal(newLogin.statusCode, 200);
    });
    assert.deepEqual(sourceHashes(), before, "Product sources must remain stable during browser execution."); assert.deepEqual(unexpectedErrors, []);
    report.sourcesStable = true; report.status = cases.every((row) => row.status === "PASS") ? "PASS" : "FAIL";
  } finally {
    await ownContext?.close(); await context?.close(); await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    await passwordApp.close(); await app.close(); report.finishedUtc = new Date().toISOString(); report.closed = true; report.controlledSnapshotFailures = controlledSnapshotFailures;
    report.writes = writes.map(({ pathname, status, body, passwordSession }) => ({ pathname, status, fields: Object.keys(body), passwordSession }));
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    // Delete only this test's verified temporary build inputs and outputs.
    assert.equal(path.dirname(path.resolve(output)), path.resolve(os.tmpdir())); assert(path.basename(output).startsWith("cyp-october-nine-shell-"));
    for (const name of ["cache", "dist", "fixture.tsx"]) { const target = path.resolve(output, name); assert(target.startsWith(path.resolve(output) + path.sep)); fs.rmSync(target, { recursive: true, force: true }); }
    t.diagnostic(`QA receipt: ${path.join(output, "report.json")}; cases ${cases.filter((row) => row.status === "PASS").length}/${cases.length}; all external attempts blocked: ${report.externalAttemptsBlocked}; antivirus subset: ${report.antivirusAttemptsBlocked}; no external URLs recorded.`);
  }
});
