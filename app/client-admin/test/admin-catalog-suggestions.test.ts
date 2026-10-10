import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";
import { currentOperationalWeek } from "../../shared/operationalWeek";

// Optional native-browser regression: uses already installed Edge/Playwright,
// an ephemeral loopback HTTP server and MemoryStore. Never downloads a browser,
// reads .env, calls a provider, or opens an existing browser profile.
const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(adminRoot, "../..");
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
const cachedPlaywright = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
const localRequire = createRequire(path.join(adminRoot, "package.json"));
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); } catch { playwrightEntry = cachedPlaywright; }
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

test("administration suggestions run in real components with a synthetic isolated API", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright are required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-admin-suggestions-"));
  const selection = process.env.CYP_QA_CATALOG_CASE ?? "all";
  const ownedSources = selection === "station-status" ? ["app/client-admin/src/ConnectedAdminTools.tsx"] : selection === "recurring-filters" ? ["app/client-admin/src/ConnectedCatalog.tsx", "app/shared/operationalWeek.ts"] : ["app/client-admin/src/ConnectedCatalog.tsx", "app/client-admin/src/CollectorAssignmentsDialog.tsx", "app/client-admin/src/collectorAssignmentsState.ts", "app/client-admin/src/collector-assignments.css", "app/client-admin/src/ConnectedAdminTools.tsx", "app/client-admin/src/ConnectedExchangeRates.tsx", "app/client-admin/src/ConnectedUserPermissionsDialog.tsx", "app/client-admin/src/Users.tsx", "app/server/src/catalog-routes.ts"];
  const before = Object.fromEntries(ownedSources.map((file) => [file, hash(path.join(projectRoot, file))]));
  const report: Record<string, unknown> = { startedUtc: new Date().toISOString(), sourceBases: ["655a54e37d0dc91fbc7d20919082f7a26744b07d", "94d38a8bba1b43e0a84bb216d0dd4a35c473a8e9"], runnerSha256: hash(fileURLToPath(import.meta.url)), sourceHashes: before, scope: "Actual connected components in a QA composition; real buildApp/MemoryStore API; no full App or provider claim.", output, cases: [], externalAttemptsBlocked: [], pageErrors: [] };
  assert(["all", "collector-integration", "account-modal", "account-mock", "service-reference", "station-status", "recurring-filters"].includes(selection), "Only the documented QA case selection is allowed.");
  report.caseSelection = selection;
  const cases = report.cases as Array<{ id: string; status: string }>;
  const external = report.externalAttemptsBlocked as string[];
  const pageErrors = report.pageErrors as string[];
  const state = seed();
  const initialCollector = state.collectors.find((row) => row.id === "col-1")!;
  Object.assign(initialCollector, { name: "Cobrador sintético QA", ident: "QA-COL-01", cellular: "+1-809-555-0101", accountId: "QA-ACCOUNT" });
  Object.assign(state.collectors.find((row) => row.id === "col-2")!, { name: "Segundo cobrador sintético QA" });
  state.zones = ["QA zona inicial", "QA zona adicional", "QA zona otro cobrador"].map((name, index) => ({ id: `qa-zone-${index}`, name, sector: name, number: String(index + 1), from: "Inicio QA", to: "Fin QA", active: true }));
  Object.assign(state.routes[0], { zoneId: "qa-zone-0", sector: "QA zona inicial" });
  Object.assign(state.routes[1], { zoneId: "qa-zone-2", sector: "QA zona otro cobrador" });
  for (let index = 1; index <= 10; index++) state.routes.push({ id: `qa-route-${index}`, name: `QA ruta ${String(index).padStart(2, "0")}`, sector: "QA zona inicial", zoneId: "qa-zone-0", collectorId: "col-1", number: String(index), from: "Desde QA", to: "Hasta QA", active: true });
  state.services = [
    { id: "qa-fixed-active", service: "QA fijo activo", fixedAmount: true, active: true },
    { id: "qa-free-active", service: "QA libre activo", fixedAmount: false, active: true },
    { id: "qa-fixed-inactive", service: "QA fijo inactivo", fixedAmount: true, active: false },
    { id: "qa-free-inactive", service: "QA libre inactivo", fixedAmount: false, active: false },
  ].map((row) => ({ ...row, abbr: "QA", caption: "Producto sintético", obligated: false }));
  const week = currentOperationalWeek();
  state.clients[0].code = "QA-CLIENT-CODE";
  state.clients[0].name = "Cliente semanal QA";
  state.recurringCharges = [
    { id: "qa-recurring-current", concept: "Concepto semanal QA", startDate: week.from, note: "Nota semanal QA", active: true },
    { id: "qa-recurring-old", concept: "Concepto anterior QA", startDate: "2020-01-01", note: "Nota antigua QA", active: false },
  ].map((row) => ({ ...row, clientId: state.clients[0].id, registeredAt: `${row.startDate}T12:00:00.000Z`, endDate: "", frequency: "weekly", day1: "1", day2: "", currency: "DOP", service: row.active ? "Servicio semanal QA" : "Servicio anterior QA", useConceptAmount: false, amount: 10000 }));
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-ui-catalog-secret-at-least-32-characters", origins: ["http://localhost:5173"], collectorUrl: "http://localhost:5174" });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200);
  const { token, user } = login.json();
  const stationId = randomUUID();
  await store.transaction((state) => { state.adminTools.stations.push({ id: stationId, number: "QA-STATION-01", name: "Estación sintética QA", deviceId: "QA-DEVICE", license: "", version: "", description: "", group: "", type: "", active: true }); });
  const fixtureAccount = await app.inject({ method: "POST", url: "/api/usuarios", headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() }, payload: { name: "Cuenta sintética de permisos", email: "qa-existing@example.invalid", role: "collector", collectorId: "col-1", password: "Synthetic-QA-2026!" } });
  assert.equal(fixtureAccount.statusCode, 200, fixtureAccount.body);
  const writes: Array<{ pathname: string; status: number; key?: string; body: Record<string, unknown> }> = [];
  let loseNextLimitsResponse = false;
  let loseNextAccountResponse = false;
  let loseNextStationResponse = false;
  let delayNextLimitsResponse = false;
  let delayNextStationResponse = false;
  let browser: any, context: any, server: ReturnType<typeof createServer> | undefined;
  try {
    const fixture = path.join(output, "fixture.tsx");
    const module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
    fs.writeFileSync(fixture, `import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConnectedCatalog } from ${module("ConnectedCatalog.tsx")};
import { ConnectedAdminTools } from ${module("ConnectedAdminTools.tsx")};
import { ConnectedExchangeRates } from ${module("ConnectedExchangeRates.tsx")};
import AccountModal from ${module("Users.tsx")};
import { remittancesApi } from ${module("remittancesApi.ts")};
function Fixture({ snapshot }) {
  const [view, setView] = useState(new URLSearchParams(location.search).get("view") || "collectors");
  window.__qaView = setView;
  return <main><h1>QA sintética de Administración</h1>{view === "empty" ? <p>Ventana cerrada</p> : ["account", "account-mock"].includes(view) ? <AccountModal operation={{type:"create"}} snapshot={snapshot} actorId=${JSON.stringify(user.id)} onClose={() => setView("empty")} onComplete={async () => {}} /> : view === "rates" ? <ConnectedExchangeRates actorId=${JSON.stringify(user.id)} isAdmin={true} /> : ["stations", "authorizationRequests"].includes(view) ? <ConnectedAdminTools key={view} page={view} snapshot={snapshot} onRefresh={() => {}} /> : <ConnectedCatalog key={view} page={view} actorId=${JSON.stringify(user.id)} snapshot={snapshot} onRefresh={() => {}} />}</main>;
}
remittancesApi("/snapshot").then(snapshot => { if (new URLSearchParams(location.search).get("view") === "account-mock") localStorage.setItem("cyp-admin-token", "mock-token:qa-account"); createRoot(document.getElementById("root")).render(<Fixture snapshot={snapshot} />); });
`, "utf8");
    report.fixtureSha256 = hash(fixture);
    const [{ build }, { default: react }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href),
      import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react()], define: { "process.env.NODE_ENV": JSON.stringify("production") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, sourcemap: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    report.bundleSha256 = hash(path.join(output, "dist", "fixture.js"));
    const html = '<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>body{font:14px Arial}button,input,select{margin:4px}table{border-collapse:collapse}th,td{padding:5px;border:1px solid #bbb}.legacy-dialog-overlay{position:fixed;inset:0;display:grid;place-items:center;background:#0003;z-index:100}.legacy-dialog{padding:15px;background:white;min-width:480px;max-height:90vh;overflow:auto}.legacy-dialog-titlebar,.legacy-dialog-actions{display:flex;justify-content:space-between;gap:8px}.legacy-dialog-form{display:grid;gap:10px}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
    server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (pathname.startsWith("/api/")) {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
          const result = await app.inject({ method: request.method as "GET" | "POST", url: request.url!, headers: request.headers, ...(body ? { payload: body } : {}) });
          if (request.method === "POST") {
            const { password: omitted, ...safeBody } = body ?? {};
            writes.push({ pathname, status: result.statusCode, key: String(request.headers["idempotency-key"] ?? ""), body: { ...safeBody, ...(typeof omitted === "string" ? { passwordLength: omitted.length } : {}) } });
          }
          if (request.method === "POST" && pathname.endsWith("/limites")) {
            if (delayNextLimitsResponse) { delayNextLimitsResponse = false; await new Promise((resolve) => setTimeout(resolve, 300)); }
          }
          if (request.method === "POST" && pathname === `/api/estaciones/${stationId}` && delayNextStationResponse) { delayNextStationResponse = false; await new Promise((resolve) => setTimeout(resolve, 300)); }
          response.writeHead(result.statusCode, { "Content-Type": "application/json; charset=utf-8" }); response.end(result.body); return;
        }
        if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html); return; }
        const allowed = new Map([["/fixture.js", "text/javascript; charset=utf-8"], ["/fixture.css", "text/css; charset=utf-8"]]);
        if (allowed.has(pathname)) { response.writeHead(200, { "Content-Type": allowed.get(pathname)! }); response.end(fs.readFileSync(path.join(output, "dist", pathname.slice(1)))); return; }
        response.writeHead(404); response.end();
      } catch { response.writeHead(500); response.end('{"error":{"message":"Synthetic fixture failure"}}'); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    report.browserVersion = browser.version();
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-DO", serviceWorkers: "block" });
    await context.addInitScript(({ token }: { token: string }) => localStorage.setItem("cyp-admin-token", token), { token });
    await context.route("**/*", async (route: any) => {
      const target = new URL(route.request().url());
      if (target.origin !== origin) { external.push(target.origin); return route.abort("blockedbyclient"); }
      if (route.request().method() === "POST" && ((target.pathname.endsWith("/limites") && loseNextLimitsResponse) || (target.pathname === "/api/usuarios" && loseNextAccountResponse) || (target.pathname === `/api/estaciones/${stationId}` && loseNextStationResponse))) {
        loseNextLimitsResponse = false;
        loseNextAccountResponse = false;
        loseNextStationResponse = false;
        const confirmed = await route.fetch();
        assert.equal(confirmed.status(), 200, "The synthetic backend must commit before dropping its response.");
        await confirmed.dispose();
        return route.abort("failed");
      }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    page.on("pageerror", (error: Error) => pageErrors.push(error.message));
    const open = async (view: string) => { await page.goto(`${origin}/?view=${view}`); await (["account", "account-mock"].includes(view) ? page.getByRole("dialog", { name: "Nueva cuenta", exact: true }) : page.getByRole("heading", { name: "QA sintética de Administración" })).waitFor(); };
    const limitsWrites = () => writes.filter((row) => row.pathname.endsWith("/limites"));
    const currentLimits = async () => { const current = (await store.read()).collectors.find((row) => row.id === "col-1")!; return { collectionLimit: current.collectionLimit, payoutLimit: current.payoutLimit }; };
    const openRelation = async (kind: "zones" | "limits" | "routes", collectorName = "Cobrador sintético QA") => {
      await page.getByRole("row").filter({ has: page.getByText(collectorName, { exact: true }) }).click();
      const name = { zones: "Zonas del Cobrador", limits: "Límites del Cobrador", routes: "Rutas del Cobrador" }[kind];
      await page.getByRole("button", { name, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: `${name}...`, exact: true });
      await dialog.waitFor();
      return dialog;
    };
    const openLimits = async () => { const dialog = await openRelation("limits"); await dialog.getByRole("button", { name: "Modificar límites operativos DOP", exact: true }).click(); };
    const enterAndReview = async (collection: string, payout: string) => { await page.getByLabel("Límite de cobro (DOP)", { exact: true }).fill(collection); await page.getByLabel("Límite de pago (DOP)", { exact: true }).fill(payout); await page.getByRole("button", { name: "Revisar límites", exact: true }).click(); await page.getByRole("dialog", { name: "Confirmar límites del cobrador...", exact: true }).waitFor(); };
    const run = async (id: string, body: () => Promise<void>) => {
      if (selection === "account-modal" && !id.includes("auxiliary account modal")) return;
      if (selection === "account-mock" && !id.includes("account mock compatibility")) return;
      if (selection === "service-reference" && !id.includes("service manual references")) return;
      if (selection === "collector-integration" && !id.startsWith("SUG-2.1") && !id.startsWith("PR3 Z/L/R")) return;
      if (selection === "station-status" && !id.includes("station")) return;
      if (selection === "recurring-filters" && !id.includes("recurring filters")) return;
      await t.test(id, async () => { try { await body(); cases.push({ id, status: "PASS" }); } catch (error) { cases.push({ id, status: "FAIL" }); throw error; } });
    };

    await run("SUG-2.1 limits preview, cancel, identity and immutable records", async () => {
      await open("collectors"); await openLimits();
      assert.equal(await page.getByRole("dialog").getByRole("textbox").count(), 2);
      const beforeLimits = await currentLimits(), count = limitsWrites().length;
      await enterAndReview("3210.01", "4110.02");
      const dialog = page.getByRole("dialog", { name: "Confirmar límites del cobrador...", exact: true });
      assert.match(await dialog.innerText(), /Cobrador sintético QA.*QA-COL-01/);
      assert.match(await dialog.innerText(), /Nombre, contacto, cuenta, actividad y ruta se conservan/);
      const headers = await dialog.getByRole("columnheader").allTextContents(); assert.deepEqual(headers, ["Límite", "Antes", "Después"]);
      assert.equal(limitsWrites().length, count);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.deepEqual(await currentLimits(), beforeLimits); assert.equal(limitsWrites().length, count);
      await openLimits(); await page.getByRole("button", { name: "Cerrar Modificar límites del cobrador...", exact: true }).click();
      assert.equal(limitsWrites().length, count);
    });
    await run("SUG-2.1 lost response locks the intent, survives window reopen and replays once", async () => {
      const original = structuredClone((await store.read()).collectors.find((row) => row.id === "col-1")!);
      await openLimits(); await enterAndReview("3210.01", "4110.02");
      loseNextLimitsResponse = true;
      await page.getByRole("button", { name: "Confirmar límites", exact: true }).click();
      await page.getByRole("button", { name: "Reintentar mismos límites", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Volver", exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Cancelar", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "Cerrar Confirmar límites del cobrador...", exact: true }).click();
      assert.equal(await page.getByRole("dialog", { name: "Confirmar límites del cobrador...", exact: true }).count(), 1);
      await page.evaluate(() => (window as any).__qaView("empty"));
      await page.getByText("Ventana cerrada", { exact: true }).waitFor();
      await page.evaluate(() => (window as any).__qaView("collectors"));
      await openLimits();
      await page.getByRole("button", { name: "Reintentar mismos límites", exact: true }).click();
      await page.getByText("Límites del cobrador guardados. Sus demás datos se conservan.", { exact: true }).waitFor();
      const history = limitsWrites(); assert.equal(history.length, 2); assert.equal(history[0].key, history[1].key); assert.deepEqual(history[0].body, history[1].body);
      const saved = (await store.read()).collectors.find((row) => row.id === "col-1")!;
      assert.deepEqual(saved, { ...original, collectionLimit: 321001, payoutLimit: 411002 });
    });
    await run("SUG-2.1 A to B to A retires successful keys and ignores double confirmation", async () => {
      for (const [collection, payout] of [["3220.01", "4120.02"], ["3210.01", "4110.02"]]) {
        await openLimits(); await enterAndReview(collection, payout);
        delayNextLimitsResponse = true;
        await page.getByRole("button", { name: "Confirmar límites", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
        await page.getByText("Límites del cobrador guardados. Sus demás datos se conservan.", { exact: true }).waitFor();
      }
      const history = limitsWrites(); assert.equal(history.length, 4);
      assert.equal(new Set([history[0].key, history[2].key, history[3].key]).size, 3);
      assert.deepEqual(await currentLimits(), { collectionLimit: 321001, payoutLimit: 411002 });
    });
    await run("SUG-2.1 invalid limit never submits", async () => {
      const count = limitsWrites().length;
      await openLimits(); await page.getByLabel("Límite de cobro (DOP)", { exact: true }).fill("0");
      await page.getByRole("button", { name: "Revisar límites", exact: true }).click();
      await page.getByRole("alert").waitFor(); assert.equal(limitsWrites().length, count);
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    });
    const sessionRows = async (collectorId: string, kind: "zones" | "limits" | "routes") => page.evaluate(({ collectorId, kind }: { collectorId: string; kind: string }) => {
      const value = sessionStorage.getItem(`cyp-collector-assignments-v1:${encodeURIComponent(collectorId)}:${kind}`);
      return value === null ? null : JSON.parse(value);
    }, { collectorId, kind });
    const operationalState = async () => {
      const current = await store.read();
      return structuredClone({ collectors: current.collectors, routes: current.routes, zones: current.zones, charges: current.charges, payouts: current.payouts, movements: current.movements });
    };
    await run("PR3 Z/L/R L session currencies survive reload without changing operational DOP limits", async () => {
      await open("collectors");
      const beforeState = await operationalState(), count = writes.length;
      const addLimit = async (dialog: any, currency: string, collection: string, payout: string) => {
        await dialog.getByRole("button", { name: "Agregar", exact: true }).click();
        const picker = page.getByRole("dialog", { name: "Seleccionar...", exact: true });
        await picker.getByLabel(/^Moneda:/).selectOption(currency);
        await picker.getByLabel("Lím. de Cobro:", { exact: true }).fill(collection);
        await picker.getByLabel("Lím. de Pago:", { exact: true }).fill(payout);
        await picker.getByRole("button", { name: "oK", exact: true }).click();
      };
      let dialog = await openRelation("limits");
      assert.match(await dialog.innerText(), /sesión/i);
      assert.equal(await dialog.getByRole("button", { name: "Modificar límites operativos DOP", exact: true }).isEnabled(), true);
      await addLimit(dialog, "USD", "101.01", "51.02");
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(await sessionRows("col-1", "limits"), null);
      dialog = await openRelation("limits");
      assert.equal(await dialog.getByRole("row").filter({ hasText: "USD" }).count(), 0);
      await addLimit(dialog, "DOP", "999.99", "777.77");
      await addLimit(dialog, "USD", "101.01", "51.02");
      await addLimit(dialog, "EUR", "202.02", "52.03");
      await dialog.getByRole("button", { name: "oK", exact: true }).click();
      await page.getByText("Asignaciones guardadas para esta sesión.", { exact: true }).waitFor();
      const saved = await sessionRows("col-1", "limits");
      assert.deepEqual(saved.map((row: any) => [row.id, row.collectionLimit, row.payoutLimit]), [["DOP", 99999, 77777], ["USD", 10101, 5102], ["EUR", 20202, 5203]]);
      await page.reload();
      dialog = await openRelation("limits");
      assert.equal(await dialog.getByRole("row").filter({ hasText: "USD" }).count(), 1);
      assert.equal(await dialog.getByRole("row").filter({ hasText: "EUR" }).count(), 1);
      assert.deepEqual(await dialog.getByRole("row").filter({ hasText: "USD" }).getByRole("cell").allTextContents(), ["", "Dólar Americano", "USD", "101.01", "51.02"]);
      assert.deepEqual(await sessionRows("col-1", "limits"), saved);
      await addLimit(dialog, "USD", "333.33", "222.22");
      await dialog.getByRole("button", { name: "Modificar límites operativos DOP", exact: true }).click();
      const operational = page.getByRole("dialog", { name: "Modificar límites del cobrador...", exact: true });
      assert.deepEqual(await sessionRows("col-1", "limits"), saved, "Opening the operational editor must not save a pending session draft.");
      assert.equal(await operational.getByLabel("Límite de cobro (DOP)", { exact: true }).inputValue(), "3210.01");
      assert.equal(await operational.getByLabel("Límite de pago (DOP)", { exact: true }).inputValue(), "4110.02");
      await operational.getByRole("button", { name: "Cancelar", exact: true }).click();
      dialog = await openRelation("limits");
      await dialog.getByRole("row").filter({ hasText: "USD" }).click();
      await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
      await page.getByRole("dialog", { name: "Confirm", exact: true }).getByRole("button", { name: "No", exact: true }).click();
      assert.equal(await dialog.getByRole("row").filter({ hasText: "USD" }).count(), 1);
      await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
      await page.getByRole("dialog", { name: "Confirm", exact: true }).getByRole("button", { name: "Sí", exact: true }).click();
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.deepEqual(await sessionRows("col-1", "limits"), saved);
      dialog = await openRelation("limits", "Segundo cobrador sintético QA");
      assert.equal(await dialog.getByRole("row").filter({ hasText: "USD" }).count(), 0);
      assert.equal(await dialog.getByRole("row").filter({ hasText: "EUR" }).count(), 0);
      assert.equal(await sessionRows("col-2", "limits"), null);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(writes.length, count);
      assert.deepEqual(await operationalState(), beforeState);
    });
    await run("PR3 Z/L/R Z draft cancellation, duplicate rejection and collector isolation remain session-only", async () => {
      await open("collectors");
      const beforeState = await operationalState(), count = writes.length;
      const addZone = async (dialog: any) => {
        await dialog.getByRole("button", { name: "Agregar", exact: true }).click();
        const picker = page.getByRole("dialog", { name: "Seleccionar...", exact: true });
        await picker.getByRole("row").filter({ hasText: "QA zona adicional" }).click();
        await picker.getByRole("button", { name: "oK", exact: true }).click();
      };
      let dialog = await openRelation("zones");
      await dialog.getByRole("button", { name: "Agregar", exact: true }).waitFor({ state: "visible" });
      await addZone(dialog);
      assert.equal(await dialog.getByRole("row").filter({ hasText: "QA zona adicional" }).count(), 1);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(await sessionRows("col-1", "zones"), null);
      dialog = await openRelation("zones");
      assert.equal(await dialog.getByRole("row").filter({ hasText: "QA zona adicional" }).count(), 0);
      await addZone(dialog);
      await dialog.getByRole("button", { name: "oK", exact: true }).click();
      await page.getByText("Asignaciones guardadas para esta sesión.", { exact: true }).waitFor();
      const saved = await sessionRows("col-1", "zones");
      assert.deepEqual(saved.map((row: any) => row.id), ["qa-zone-0", "qa-zone-1"]);
      dialog = await openRelation("zones");
      await dialog.getByRole("button", { name: "Agregar", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Seleccionar...", exact: true });
      await picker.getByRole("row").filter({ hasText: "QA zona adicional" }).click();
      await picker.getByRole("button", { name: "oK", exact: true }).click();
      await picker.getByRole("alert").filter({ hasText: "Este registro ya está asignado al cobrador." }).waitFor();
      await picker.getByRole("button", { name: "Cancelar", exact: true }).click();
      await dialog.getByRole("row").filter({ hasText: "QA zona adicional" }).click();
      await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
      await page.getByRole("dialog", { name: "Confirm", exact: true }).getByRole("button", { name: "Sí", exact: true }).click();
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.deepEqual(await sessionRows("col-1", "zones"), saved);
      dialog = await openRelation("zones", "Segundo cobrador sintético QA");
      assert.equal(await dialog.getByRole("row").filter({ hasText: "QA zona adicional" }).count(), 0);
      assert.equal(await dialog.getByRole("row").filter({ hasText: "QA zona otro cobrador" }).count(), 1);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      await page.reload(); dialog = await openRelation("zones");
      assert.equal(await dialog.getByRole("row").filter({ hasText: "QA zona adicional" }).count(), 1);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(writes.length, count);
      assert.deepEqual(await operationalState(), beforeState);
    });
    await run("PR3 Z/L/R R paging, refresh and saved removal never reassign API routes", async () => {
      await open("collectors");
      const beforeState = await operationalState(), count = writes.length;
      let dialog = await openRelation("routes");
      assert.equal(await dialog.getByRole("row").count(), 11, "First page has one header and ten assignments.");
      assert.equal(await dialog.getByRole("spinbutton", { name: "Página", exact: true }).inputValue(), "1");
      await dialog.getByRole("button", { name: "Página siguiente", exact: true }).click();
      assert.equal(await dialog.getByRole("spinbutton", { name: "Página", exact: true }).inputValue(), "2");
      const last = dialog.getByRole("row").filter({ hasText: "QA ruta 10" });
      await last.click();
      await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
      await page.getByRole("dialog", { name: "Confirm", exact: true }).getByRole("button", { name: "No", exact: true }).click();
      assert.equal(await last.count(), 1);
      await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
      await page.getByRole("dialog", { name: "Confirm", exact: true }).getByRole("button", { name: "Sí", exact: true }).click();
      await dialog.getByRole("button", { name: "Refrescar", exact: true }).click();
      await dialog.getByRole("button", { name: "Página siguiente", exact: true }).click();
      assert.equal(await last.count(), 1, "Refresh discards an unsaved removal.");
      await last.click(); await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
      await page.getByRole("dialog", { name: "Confirm", exact: true }).getByRole("button", { name: "Sí", exact: true }).click();
      await dialog.getByRole("button", { name: "oK", exact: true }).click();
      await page.getByText("Asignaciones guardadas para esta sesión.", { exact: true }).waitFor();
      const saved = await sessionRows("col-1", "routes");
      assert.equal(saved.length, 10); assert.equal(saved.some((row: any) => row.id === "qa-route-10"), false);
      await page.reload(); dialog = await openRelation("routes");
      assert.equal(await dialog.getByRole("button", { name: "Página siguiente", exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByRole("row").filter({ hasText: "QA ruta 10" }).count(), 0);
      await dialog.getByRole("button", { name: "Agregar", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Seleccionar...", exact: true });
      const otherRoute = state.routes.find((row) => row.id === "route-2")!;
      await picker.getByRole("row").filter({ hasText: otherRoute.name }).click();
      await picker.getByRole("button", { name: "oK", exact: true }).click();
      await dialog.getByRole("button", { name: "oK", exact: true }).click();
      await page.getByText("Asignaciones guardadas para esta sesión.", { exact: true }).waitFor();
      assert.equal((await sessionRows("col-1", "routes")).some((row: any) => row.id === "route-2"), true);
      dialog = await openRelation("routes", "Segundo cobrador sintético QA");
      assert.equal(await dialog.getByRole("row").filter({ hasText: otherRoute.name }).count(), 1);
      assert.equal(await dialog.getByRole("row").filter({ hasText: "QA ruta 01" }).count(), 0);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(await sessionRows("col-2", "routes"), null);
      assert.equal(writes.length, count);
      assert.deepEqual(await operationalState(), beforeState);
    });
    await run("SUG-2.4 fixed amount and activity show four independent combinations", async () => {
      await open("servicesProducts"); await page.getByText("QA fijo activo", { exact: true }).waitFor();
      for (const [name, fixed, active] of [["QA fijo activo", true, true], ["QA libre activo", false, true], ["QA fijo inactivo", true, false], ["QA libre inactivo", false, false]] as const) {
        const row = page.getByRole("row").filter({ hasText: name });
        assert.equal(await row.getByRole("checkbox", { name: "Usa importe fijo", exact: true }).isChecked(), fixed);
        assert.equal(await row.locator("td:last-child input").isChecked(), active);
      }
      assert.equal(await page.getByRole("columnheader", { name: "Importe fijo", exact: true }).count(), 1);
    });
    await run("SUG-2.2/2.3 unvalidated stations remain visible without enabling manual actions", async () => {
      await open("stations");
      const before = await store.read(), count = writes.length;
      const row = page.getByRole("row").filter({ hasText: "Estación sintética QA" }); await row.click();
      assert.match(await page.getByRole("status").innerText(), /No validado.*RRAA/);
      for (const title of ["Nuevo", "Editar"]) assert.equal(await page.getByTitle(title, { exact: true }).isDisabled(), true);
      // A historical station can be deactivated safely; it cannot be activated without RRAA.
      assert.equal(await page.getByTitle("Inactivar", { exact: true }).isDisabled(), false);
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(writes.length, count); assert.deepEqual(await store.read(), before);
    });
    await run("SUG-2.3 double click and programmatic edit cannot open a station form", async () => {
      const count = writes.length;
      await page.getByRole("row").filter({ hasText: "Estación sintética QA" }).dblclick();
      await page.getByTitle("Editar", { exact: true }).evaluate((button: HTMLButtonElement) => button.click());
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(writes.length, count);
    });
    await run("SUG-2.3 API denies arbitrary device, license and activation even for Admin", async () => {
      const before = await store.read();
      const headers = { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() };
      const denied = await app.inject({ method: "POST", url: `/api/estaciones/${stationId}`, headers, payload: { number: "QA-EDIT", name: "Manual", deviceId: "FORGED", license: "FORGED", active: true } });
      assert.equal(denied.statusCode, 400, "A browser-supplied license is rejected by the strict schema before any external validation");
      const unavailable = await app.inject({ method: "POST", url: `/api/estaciones/${stationId}`, headers, payload: { number: "QA-EDIT", name: "Manual", deviceId: "FORGED", active: true } });
      assert.equal(unavailable.statusCode, 409); assert.equal(unavailable.json().error.code, "STATION_RRAA_REQUIRED");
      const invalid = await app.inject({ method: "POST", url: "/api/estaciones", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { id: "forged", number: "QA", name: "Manual" } });
      assert.equal(invalid.statusCode, 400, "Strict identity contract remains enforced");
      assert.deepEqual(await store.read(), before);
    });
    await run("SUG-2.3 denied station retries preserve stored data and refresh remains available", async () => {
      const headers = { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() };
      const before = await store.read();
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await app.inject({ method: "POST", url: "/api/estaciones", headers, payload: { number: "QA-NEW", name: "Manual", active: false } });
        assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, "STATION_RRAA_REQUIRED");
      }
      assert.deepEqual(await store.read(), before);
      await page.getByTitle("Refrescar", { exact: true }).click();
      await page.getByRole("row").filter({ hasText: "Estación sintética QA" }).waitFor();
      assert.equal(await page.getByTitle("Editar", { exact: true }).isDisabled(), true);
    });
    await run("SUG-2.6/2.10 panels explain administrative scope without granting roles", async () => {
      const count = writes.length;
      await open("authorizationRequests"); await page.getByText(/Solicitudes de revisión administrativa de un cliente/).waitFor();
      assert.match(await page.locator("main").innerText(), /no registra cobros o pagos ni amplía límites o permisos/);
      await open("users"); await page.getByRole("button", { name: "Permisos", exact: true }).click();
      assert.match(await page.getByRole("dialog").innerText(), /No cambian los permisos efectivos de un rol ni conceden operaciones en el servidor/);
      assert.equal(writes.length, count);
      await page.getByRole("button", { name: "Cerrar Permisos del Usuario...", exact: true }).click();
    });
    await run("SUG-2.7 Tasa accepts a positive value below one", async () => {
      await open("rates"); await page.getByTitle("Nuevo", { exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[title="Nuevo"]')?.disabled);
      await page.getByTitle("Nuevo", { exact: true }).click();
      await page.getByLabel("Tasa de remesas", { exact: true }).fill("0.005000");
      await page.getByLabel("Compra", { exact: true }).fill("0.004000");
      await page.getByLabel("Venta", { exact: true }).fill("0.006000");
      await page.getByRole("button", { name: "Revisar tasa", exact: true }).click();
      await page.getByRole("button", { name: "Confirmar", exact: true }).click();
      await page.getByText("Tasa del día guardada. Los envíos anteriores conservan su tasa.", { exact: true }).waitFor();
      for (const name of ["Tasa de remesas", "Compra", "Venta"]) assert.equal(await page.getByRole("columnheader", { name, exact: true }).count(), 1);
      const saved = writes.findLast((row) => row.pathname === "/api/envios/tasas")!;
      assert.equal(saved.status, 200); assert.equal(saved.body.rate, "0.005000");
      assert.equal(saved.body.purchaseRate, "0.004000"); assert.equal(saved.body.saleRate, "0.006000");
    });
    await run("SUG-2.8/2.9 account metadata and the authorized three-character minimum", async () => {
      await open("users"); await page.getByTitle("Nuevo", { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Datos de Usuario...", exact: true });
      await dialog.getByLabel("Nombre", { exact: true }).fill("Cuenta sintética QA");
      await dialog.getByLabel("Usuario / correo", { exact: true }).fill("qa-catalog@example.invalid");
      await dialog.getByLabel("Rol", { exact: true }).selectOption("collector");
      await dialog.getByLabel("Apodo", { exact: true }).fill("QA apodo"); await dialog.getByLabel("Nota", { exact: true }).fill("Nota sintética conservada");
      await dialog.getByLabel("Cobrador asociado", { exact: true }).selectOption("col-1");
      const password = dialog.getByLabel("Contraseña inicial (mínimo 3 caracteres)", { exact: true });
      await password.fill("Qa"); const count = writes.length;
      assert.equal(await password.evaluate((input: HTMLInputElement) => input.checkValidity()), false);
      await dialog.getByRole("button", { name: "oK", exact: true }).click(); assert.equal(writes.length, count);
      await password.fill("Qa3"); await dialog.getByRole("button", { name: "oK", exact: true }).click();
      await page.getByText("Datos guardados correctamente.", { exact: true }).waitFor();
      const created = (await store.read()).accounts.find((row) => row.email === "qa-catalog@example.invalid")!;
      assert.equal(created.nickname, "QA apodo"); assert.equal(created.note, "Nota sintética conservada"); assert.equal(created.role, "collector");
    });
    await run("SUG-2.8/2.9 auxiliary account modal locks and replays metadata with the authorized minimum", async () => {
      await open("account");
      const dialog = page.getByRole("dialog", { name: "Nueva cuenta", exact: true });
      await dialog.getByLabel("Nombre", { exact: true }).fill("Cuenta modal sintética");
      await dialog.getByLabel("Usuario / correo", { exact: true }).fill("qa-modal@example.invalid");
      await dialog.getByLabel("Apodo", { exact: true }).fill("QA modal");
      await dialog.getByLabel("Nota", { exact: true }).fill("Nota de modal sintética");
      const password = dialog.getByLabel("Contraseña (3 caracteres mínimo)", { exact: true });
      await password.fill("Qa");
      assert.equal(await password.evaluate((input: HTMLInputElement) => input.checkValidity()), false);
      const count = writes.length;
      await dialog.getByRole("button", { name: "Crear cuenta", exact: true }).click();
      assert.equal(writes.length, count);
      await password.fill("Qa3");
      loseNextAccountResponse = true;
      await dialog.getByRole("button", { name: "Crear cuenta", exact: true }).click();
      await dialog.getByRole("button", { name: "Reintentar misma operación", exact: true }).waitFor();
      assert.equal(await dialog.getByLabel("Apodo", { exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByRole("button", { name: "Cancelar", exact: true }).isDisabled(), true);
      await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
      assert.equal(await dialog.count(), 1);
      await dialog.getByRole("button", { name: "Reintentar misma operación", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
      await page.getByText("Ventana cerrada", { exact: true }).waitFor();
      const attempts = writes.slice(count).filter((row) => row.pathname === "/api/usuarios");
      assert.equal(attempts.length, 2); assert.equal(attempts[0].key, attempts[1].key); assert.deepEqual(attempts[0].body, attempts[1].body); assert.equal(attempts[0].body.passwordLength, 3);
      const accounts = (await store.read()).accounts.filter((row) => row.email === "qa-modal@example.invalid");
      assert.equal(accounts.length, 1); assert.equal(accounts[0].nickname, "QA modal"); assert.equal(accounts[0].note, "Nota de modal sintética");
    });
    await run("SUG-2.5 service manual references validate, preserve exact cents and clear without financial effects", async () => {
      await open("servicesProducts");
      const financial = (current: typeof state) => structuredClone({ charges: current.charges, payouts: current.payouts, movements: current.movements, recurringCharges: current.recurringCharges });
      const beforeFinancial = financial(await store.read());
      const openService = async () => { await page.getByRole("row").filter({ hasText: "QA libre activo" }).click(); await page.getByTitle("Editar", { exact: true }).click(); };
      await openService();
      const dialog = page.getByRole("dialog", { name: "Datos del Servicio o Producto (Bien)...", exact: true });
      const price = dialog.getByLabel("Precio de referencia", { exact: true });
      const currency = dialog.getByLabel("Moneda del precio de referencia", { exact: true });
      assert.equal(await price.inputValue(), ""); assert.equal(await currency.inputValue(), "");
      assert.match(await dialog.innerText(), /No calculan impuestos o beneficios ni modifican cargos, existencias o totales/);
      const count = writes.length;
      await price.fill("123.45"); await dialog.getByRole("button", { name: "oK", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "El precio de referencia requiere su moneda" }).waitFor(); assert.equal(writes.length, count);
      await currency.selectOption("USD"); await price.fill("10000000.01");
      await dialog.getByRole("button", { name: "oK", exact: true }).click(); await dialog.getByRole("alert").filter({ hasText: "El precio de referencia debe ser de hasta 10,000,000.00 en su moneda." }).waitFor(); assert.equal(writes.length, count);
      await price.fill("123.45");
      await dialog.getByLabel("Impuestos de referencia (indica unidad)", { exact: true }).fill("18 % anotado");
      await dialog.getByLabel("Beneficio de referencia (indica unidad)", { exact: true }).fill("20 USD por unidad");
      await dialog.getByLabel("Cantidad de referencia (indica unidad)", { exact: true }).fill("2 unidades");
      await dialog.getByRole("button", { name: "oK", exact: true }).click(); await page.getByText("Datos guardados correctamente.", { exact: true }).waitFor();
      const saved = (await store.read()).services.find((row) => row.id === "qa-free-active")!;
      assert.equal(saved.referencePriceCents, 12345); assert.equal(saved.referenceCurrency, "USD");
      assert.equal(saved.taxReference, "18 % anotado"); assert.equal(saved.benefitReference, "20 USD por unidad"); assert.equal(saved.referenceQuantity, "2 unidades");
      assert.equal(saved.active, true); assert.equal(saved.fixedAmount, false); assert.deepEqual(financial(await store.read()), beforeFinancial);
      await openService(); assert.equal(await price.inputValue(), "123.45"); assert.equal(await currency.inputValue(), "USD");
      await price.fill("0.00"); await currency.selectOption("DOP");
      await dialog.getByRole("button", { name: "oK", exact: true }).click(); await page.getByText("Datos guardados correctamente.", { exact: true }).waitFor();
      assert.equal((await store.read()).services.find((row) => row.id === "qa-free-active")!.referencePriceCents, 0);
      await openService(); await price.fill(""); await currency.selectOption("");
      for (const label of ["Impuestos de referencia (indica unidad)", "Beneficio de referencia (indica unidad)", "Cantidad de referencia (indica unidad)"]) await dialog.getByLabel(label, { exact: true }).fill("");
      await dialog.getByRole("button", { name: "oK", exact: true }).click(); await page.getByText("Datos guardados correctamente.", { exact: true }).waitFor();
      const cleared = (await store.read()).services.find((row) => row.id === "qa-free-active")!;
      for (const key of ["referencePriceCents", "referenceCurrency", "taxReference", "benefitReference", "referenceQuantity"] as const) assert.equal(cleared[key], null);
      assert.deepEqual(financial(await store.read()), beforeFinancial);
    });
    await run("SUG-2.8/2.9 account mock compatibility keeps an unsupported operation cancelable", async () => {
      await open("account-mock");
      const dialog = page.getByRole("dialog", { name: "Nueva cuenta", exact: true });
      await dialog.getByLabel("Nombre", { exact: true }).fill("Cuenta mock sintética");
      await dialog.getByLabel("Usuario / correo", { exact: true }).fill("qa-mock@example.invalid");
      await dialog.getByLabel("Contraseña (3 caracteres mínimo)", { exact: true }).fill("Qa3");
      const count = writes.length;
      await dialog.getByRole("button", { name: "Crear cuenta", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "Ruta mock no implementada para esta vista." }).waitFor();
      assert.equal(writes.length, count);
      assert.equal(await dialog.getByLabel("Nombre", { exact: true }).isDisabled(), false);
      assert.equal(await dialog.getByRole("button", { name: "Cancelar", exact: true }).isDisabled(), false);
      assert.equal(await dialog.getByRole("button", { name: "Reintentar misma operación", exact: true }).count(), 0);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      await page.getByText("Ventana cerrada", { exact: true }).waitFor();
    });
    await run("OCT-3.2.1/6.2 recurring filters explain fields and keep the current RD week", async () => {
      await open("recurringCharges");
      const panel = page.getByRole("complementary", { name: "Panel de filtro de cargos recurrentes", exact: true });
      const from = panel.getByLabel("Fecha Inicial:", { exact: true });
      const to = panel.getByLabel("Fecha final:", { exact: true });
      assert.equal(await from.inputValue(), week.from);
      assert.equal(await to.inputValue(), week.to);
      const search = panel.getByLabel("Buscar:", { exact: true });
      const helpId = await search.getAttribute("aria-describedby");
      assert(helpId);
      assert.match(await panel.locator(`[id=${JSON.stringify(helpId)}]`).innerText(), /concepto, nota, código o nombre del cliente/);
      await page.getByRole("cell", { name: "Servicio semanal QA", exact: true }).waitFor();
      assert.equal(await page.getByRole("cell", { name: "Servicio anterior QA", exact: true }).count(), 0);
      for (const query of ["Concepto semanal", "Nota semanal", "QA-CLIENT-CODE", "Cliente semanal"]) {
        await search.fill(query);
        assert.equal(await page.getByRole("cell", { name: "Servicio semanal QA", exact: true }).count(), 1);
      }
      await search.fill("sin coincidencia QA");
      await page.getByRole("cell", { name: "No hay registros para estos filtros.", exact: true }).waitFor();
      await search.fill("");
      await from.fill("2020-01-01");
      await page.getByRole("cell", { name: "Servicio anterior QA", exact: true }).waitFor();
      await page.getByTitle("Refrescar", { exact: true }).click();
      assert.equal(await from.inputValue(), "2020-01-01", "Refreshing must preserve dates chosen by the user.");
      await to.fill("2019-12-31");
      await panel.getByRole("alert").waitFor();
      assert.equal(await page.getByRole("cell", { name: "Servicio semanal QA", exact: true }).count(), 0);
      assert.equal(await page.getByRole("cell", { name: "Servicio anterior QA", exact: true }).count(), 0);
    });
    assert.deepEqual(pageErrors, []);
    const after = Object.fromEntries(ownedSources.map((file) => [file, hash(path.join(projectRoot, file))]));
    assert.deepEqual(after, before, "Owned source files must remain unchanged during the run.");
    report.sourceHashesAfter = after;
    report.sourcesStable = true;
    report.writes = writes;
    report.functionalStatus = cases.length === (selection === "all" ? 19 : selection === "collector-integration" ? 7 : selection === "station-status" ? 4 : 1) && cases.every((row) => row.status === "PASS") ? "PASS" : "FAIL";
    report.isolation = "All HTTP served on the owned loopback listener; all backend writes in MemoryStore. External browser attempts were blocked and reported separately.";
  } finally {
    await context?.close(); report.contextClosed = true;
    await browser?.close(); report.browserClosed = true;
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    report.serverClosed = true;
    await app.close(); report.apiClosed = true;
    report.finishedUtc = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    t.diagnostic(`QA receipt: ${path.join(output, "report.json")}`);
  }
});
