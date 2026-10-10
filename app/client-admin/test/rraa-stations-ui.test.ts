import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";
import { DomainError } from "../../server/src/domain.js";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((name) => path.join(cache, name, "node_modules/playwright/index.mjs")).find((file) => fs.existsSync(file)) : undefined; }
test("RRAA station UI validates, preserves modal locking, saves proof and permits only validated PCP links", {
  skip: process.platform !== "win32" || !fs.existsSync(edge) || !playwrightEntry ? "Installed Edge/Playwright required; no download or real profile used." : false,
}, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-rraa-ui-")), store = new MemoryStore(seed());
  let rejectStation = false, calls = 0, previewPatch: Record<string, unknown> | null = null;
  const app = await buildApp({ store, demo: true, secret: "rraa-ui-synthetic-secret-at-least-32-characters", origins: [], collectorUrl: "http://localhost:5174",
    rraa: { clientId: "QA-COMPANY", async validate(stationCode, deviceId) {
      calls++; if (rejectStation) throw new DomainError("RRAA_STATION_NOT_FOUND", "RRAA: Estación no encontrada.", 422);
      return { clientId: "QA-COMPANY", stationCode, deviceId, license: "QA-LICENSE", validatedAt: new Date().toISOString() };
    } } });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } })).json().token;
  const fixture = path.join(output, "fixture.tsx");
  const module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
  fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import { ConnectedAdminTools } from ${module("ConnectedAdminTools.tsx")};
import { remittancesApi } from ${module("remittancesApi.ts")};
import ${module("styles.css")};
remittancesApi("/snapshot").then(snapshot => createRoot(document.getElementById("root")).render(<ConnectedAdminTools page={new URLSearchParams(location.search).get("view") || "stations"} snapshot={snapshot} onRefresh={() => {}} />));`, "utf8");
  const [{ build }, { default: react }, { chromium }] = await Promise.all([import(pathToFileURL(localRequire.resolve("vite")).href),
    import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href), import(pathToFileURL(playwrightEntry!).href)]);
  let server: ReturnType<typeof createServer> | undefined, browser: any, context: any;
  const errors: string[] = [];
  try {
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, resolve: { dedupe: ["react", "react-dom"] }, plugins: [react()], logLevel: "error",
      define: { "process.env.NODE_ENV": JSON.stringify("production") }, build: { outDir: path.join(output, "dist"), emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (pathname.startsWith("/api/")) {
          const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const result = await app.inject({ method: request.method as "GET" | "POST", url: request.url!, headers: request.headers,
            ...(chunks.length ? { payload: JSON.parse(Buffer.concat(chunks).toString("utf8")) } : {}) });
          const responseBody = pathname === "/api/estaciones/validar" && result.statusCode === 200 && previewPatch
            ? JSON.stringify({ ...result.json(), ...previewPatch }) : result.body;
          response.writeHead(result.statusCode, { "Content-Type": "application/json" }); response.end(responseBody); return;
        }
        if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root" style="height:850px"></div><script type="module" src="/fixture.js"></script></html>'); return; }
        const mime = { "/fixture.js": "text/javascript", "/fixture.css": "text/css" }[pathname];
        if (mime) { response.writeHead(200, { "Content-Type": mime }); response.end(fs.readFileSync(path.join(output, "dist", pathname.slice(1)))); return; }
        response.writeHead(404); response.end();
      } catch { response.writeHead(500); response.end(); }
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 950 }, serviceWorkers: "block" });
    await context.addInitScript((token: string) => localStorage.setItem("cyp-admin-token", token), token);
    await context.route("**/*", (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
    const page = await context.newPage(); page.setDefaultTimeout(8000); page.on("pageerror", (error: Error) => errors.push(error.message));
    await t.test("preview validates but does not save; license/read-only fields cannot be edited", async () => {
      await page.goto(origin); await page.getByTitle("Nuevo", { exact: true }).waitFor();
      await page.getByTitle("Nuevo", { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Datos de la Estación de PCP", exact: true }); await dialog.waitFor();
      await dialog.getByRole("button", { name: "Obtener Licencia", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "El campo Nombre no puede estar vacío" }).waitFor(); assert.equal(calls, 0);
      await dialog.getByLabel("Estación", { exact: true }).fill("QA-STATION"); await dialog.getByLabel("Número", { exact: true }).fill("QA-1");
      await dialog.getByLabel("ID dispositivo", { exact: true }).fill("QA-DEVICE");
      assert.equal(await dialog.getByLabel("Activa", { exact: true }).isDisabled(), true);
      await dialog.getByRole("button", { name: "Obtener Licencia", exact: true }).click();
      await dialog.getByText(/Validación recibida:/).waitFor();
      assert.equal(await dialog.getByLabel("Lic.:", { exact: true }).inputValue(), "QA-LICENSE");
      for (const label of ["Lic.:", "Versión registrada:", "Cliente RRAA:"]) assert.equal(await dialog.getByLabel(label, { exact: true }).getAttribute("readonly"), "");
      assert.equal((await store.read()).adminTools.stations.length, 0);
      await dialog.getByLabel("ID dispositivo", { exact: true }).fill("QA-DEVICE-CHANGED");
      assert.equal(await dialog.getByLabel("Activa", { exact: true }).isDisabled(), true);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); assert.equal(await page.getByRole("dialog").count(), 0);
    });
    await t.test("foreign or malformed previews cannot display an authorized license or enable activation", async () => {
      await page.getByTitle("Nuevo", { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Datos de la Estación de PCP", exact: true });
      await dialog.getByLabel("Estación", { exact: true }).fill("QA-STATION"); await dialog.getByLabel("Número", { exact: true }).fill("QA-1");
      await dialog.getByLabel("ID dispositivo", { exact: true }).fill("QA-DEVICE");
      for (const patch of [{ clientId: "OTHER-COMPANY" }, { deviceId: "OTHER-DEVICE" }, { stationCode: "OTHER-STATION" }, { license: "" }, { validatedAt: "invalid" }]) {
        previewPatch = patch;
        await dialog.getByRole("button", { name: "Obtener Licencia", exact: true }).click();
        await dialog.getByRole("alert").filter({ hasText: "No pudimos confirmar la respuesta de RRAA" }).waitFor();
        assert.equal(await dialog.getByLabel("Activa", { exact: true }).isDisabled(), true);
        assert.equal(await dialog.getByLabel("Lic.:", { exact: true }).inputValue(), "");
        assert.equal((await store.read()).adminTools.stations.length, 0);
      }
      previewPatch = null;
      await dialog.getByRole("button", { name: "Obtener Licencia", exact: true }).click();
      await dialog.getByText(/Validación recibida:/).waitFor();
      assert.equal(await dialog.getByLabel("Activa", { exact: true }).isDisabled(), false);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    });
    await t.test("new station saves fresh RRAA evidence and explicit activation; edits reject ER without closing form", async () => {
      await page.getByTitle("Nuevo", { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Datos de la Estación de PCP", exact: true });
      await dialog.getByLabel("Estación", { exact: true }).fill("QA-STATION"); await dialog.getByLabel("Número", { exact: true }).fill("QA-1");
      await dialog.getByLabel("ID dispositivo", { exact: true }).fill("QA-DEVICE");
      await dialog.getByRole("button", { name: "Obtener Licencia", exact: true }).click(); await dialog.getByText(/Validación recibida:/).waitFor();
      await dialog.getByLabel("Activa", { exact: true }).check();
      const previewCalls = calls; await dialog.getByRole("button", { name: "oK", exact: true }).click();
      await page.getByText("Datos guardados correctamente.", { exact: true }).waitFor(); assert.equal(calls, previewCalls + 1);
      const station = (await store.read()).adminTools.stations[0]; assert.equal(station.active, true); assert.equal(station.license, "QA-LICENSE");
      await page.getByRole("row").filter({ hasText: "QA-STATION" }).click(); await page.getByTitle("Editar", { exact: true }).click();
      assert.equal(await dialog.getByLabel("ID dispositivo", { exact: true }).inputValue(), "QA-DEVICE");
      rejectStation = true; await dialog.getByLabel("Estación", { exact: true }).fill("QA-NOT-FOUND");
      await dialog.getByRole("button", { name: "Obtener Licencia", exact: true }).click(); await dialog.getByRole("alert").filter({ hasText: "Estación no encontrada." }).waitFor();
      await dialog.getByRole("button", { name: "oK", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Confirmación", exact: true });
      await review.getByRole("button", { name: "Confirmar", exact: true }).click();
      await review.getByRole("alert").filter({ hasText: "Estación no encontrada." }).waitFor();
      assert.equal((await store.read()).adminTools.stations[0].name, "QA-STATION");
      await review.getByRole("button", { name: "Cancelar", exact: true }).click();
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); rejectStation = false;
      await page.screenshot({ path: path.join(output, "station-list.png") });
    });
    await t.test("a fresh rejection invalidates old proof even if unchanged identifiers are restored", async () => {
      await page.getByRole("row").filter({ hasText: "QA-STATION" }).click(); await page.getByTitle("Editar", { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Datos de la Estación de PCP", exact: true });
      assert.equal(await dialog.getByLabel("Activa", { exact: true }).isDisabled(), false);
      rejectStation = true;
      await dialog.getByRole("button", { name: "Obtener Licencia", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "Estación no encontrada." }).waitFor();
      assert.equal(await dialog.getByLabel("Activa", { exact: true }).isDisabled(), true);
      await dialog.getByLabel("ID dispositivo", { exact: true }).fill("QA-CHANGED");
      await dialog.getByLabel("ID dispositivo", { exact: true }).fill("QA-DEVICE");
      assert.equal(await dialog.getByLabel("Activa", { exact: true }).isDisabled(), true, "restoring old IDs cannot reuse rejected proof");
      assert.equal((await store.read()).adminTools.stations[0].active, true, "preview rejection does not mutate the saved record");
      rejectStation = false;
      await dialog.getByRole("button", { name: "Obtener Licencia", exact: true }).click();
      await dialog.getByText(/Validación recibida:/).waitFor();
      assert.equal(await dialog.getByLabel("Activa", { exact: true }).isDisabled(), false);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    });
    await t.test("PCP station selector lists only active validated stations and persists their link", async () => {
      const headers = { authorization: `Bearer ${token}`, "idempotency-key": "qa-rraa-group" };
      const group = (await app.inject({ method: "POST", url: "/api/grupos-pcp", headers, payload: { name: "QA-GROUP" } })).json();
      const pcp = await app.inject({ method: "POST", url: "/api/pcps", headers: { ...headers, "idempotency-key": "qa-rraa-pcp" }, payload: { number: "QA-PCP", name: "QA-PCP", groupId: group.id } });
      assert.equal(pcp.statusCode, 200);
      await page.goto(`${origin}/?view=pcps`); await page.getByRole("row").filter({ hasText: "QA-PCP" }).click();
      await page.getByTitle("Estaciones del PCP", { exact: true }).click();
      const manager = page.getByRole("dialog", { name: "Estaciones del PCP...", exact: true });
      await manager.getByRole("button", { name: "Agregar", exact: true }).click();
      const selector = page.getByRole("dialog", { name: "Seleccionar...", exact: true });
      assert.match(await selector.getByRole("combobox").innerText(), /QA-STATION/);
      await selector.getByRole("button", { name: "oK", exact: true }).click();
      await manager.getByRole("button", { name: "Guardar", exact: true }).click(); await page.getByText("Estaciones del PCP guardadas.", { exact: true }).waitFor();
      assert.equal((await store.read()).adminTools.pcpStations.length, 1);
    });
    assert.deepEqual(errors, []);
    t.diagnostic(`Synthetic UI evidence: ${output}; external traffic blocked; no operational database or normal browser profile used.`);
  } finally {
    await context?.close(); await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    await app.close();
  }
});
