import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { getAdminTools } from "../../server/src/admin-tools.js";
import { createDemoStationControl } from "../../server/src/rraa.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((name) => path.join(cache, name, "node_modules/playwright/index.mjs")).find((file) => fs.existsSync(file)) : undefined; }

// Actual ConnectedAdminTools, styles and API over an isolated MemoryStore: the practice control of
// the demo lets a station be created only with data registered for the example company.
test("the practice station control of the demo says what it is, rejects arbitrary data and saves a registered station", {
  skip: process.platform !== "win32" || !fs.existsSync(edge) || !playwrightEntry ? "Installed Edge/Playwright required; no download or real profile used." : false,
}, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-demo-station-control-")), store = new MemoryStore(seed());
  const app = await buildApp({ store, demo: true, secret: "demo-station-control-ui-secret-at-least-32-characters", origins: [], collectorUrl: "http://localhost:5174",
    demoStationControl: createDemoStationControl() });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } })).json().token;
  const fixture = path.join(output, "fixture.tsx");
  const module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
  fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import { ConnectedAdminTools } from ${module("ConnectedAdminTools.tsx")};
import { remittancesApi } from ${module("remittancesApi.ts")};
import ${module("styles.css")};
remittancesApi("/snapshot").then(snapshot => createRoot(document.getElementById("root")).render(<ConnectedAdminTools page="stations" snapshot={snapshot} onRefresh={() => {}} />));`, "utf8");
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
          response.writeHead(result.statusCode, { "Content-Type": "application/json" }); response.end(result.body); return;
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
    const dialog = page.getByRole("dialog", { name: "Datos de la Estación de PCP", exact: true });
    const fill = async (station: string) => { await dialog.getByLabel("Estación", { exact: true }).fill(station); };
    await t.test("the window says it is a practice control and names the data it accepts", async () => {
      await page.goto(origin);
      const note = page.getByRole("status").filter({ hasText: "Control de prueba de esta demo; no es RRAA real." });
      await note.waitFor();
      const text = await note.innerText();
      for (const expected of ["«EMPRESA-DEMO»", "Escribe «EST-PRUEBA-01» y pulsa Obtener Datos", "(del 01 al 99)"]) assert.ok(text.includes(expected), expected);
      assert.equal(await note.getAttribute("title"), "Con datos que no estén en el control responde «Estación no encontrada». Las estaciones «DEMO V2 · Estación 1» a «6» del catálogo también están en él.");
      // Two lines at most, so the list keeps the room it had with the notes this one replaces.
      // Measured a little narrower than the 684 px its text has in the default Stations window (720 px wide).
      const lines = await note.evaluate((node: HTMLElement) => {
        const before = node.getAttribute("style");
        node.style.boxSizing = "content-box"; node.style.width = "670px";
        const range = document.createRange(); range.selectNodeContents(node);
        const count = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
        if (before === null) node.removeAttribute("style"); else node.setAttribute("style", before);
        return count;
      });
      assert.ok(lines <= 2, `the note takes ${lines} lines`);
      assert.equal(await page.getByTitle("Nuevo", { exact: true }).isDisabled(), false);
    });
    await t.test("arbitrary data is not found, neither on the preview nor when saving", async () => {
      await page.getByTitle("Nuevo", { exact: true }).click(); await dialog.waitFor();
      assert.equal(await dialog.getByLabel("Empresa del control de prueba:", { exact: true }).inputValue(), "EMPRESA-DEMO");
      await dialog.getByText(/Escribe únicamente la Estación del control de prueba, por ejemplo «EST-PRUEBA-01»/).waitFor();
      await fill("Estación inventada");
      await dialog.getByRole("button", { name: "Obtener Licencia", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "Estación no encontrada." }).waitFor();
      assert.equal(await dialog.getByLabel("Activa", { exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByLabel("Lic.:", { exact: true }).inputValue(), "");
      const rejected = page.waitForResponse((response: any) => new URL(response.url()).pathname === "/api/estaciones" && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "oK", exact: true }).click();
      assert.equal((await rejected).status(), 422);
      await dialog.getByRole("alert").filter({ hasText: "Estación no encontrada." }).waitFor();
      assert.equal(getAdminTools(await store.read()).stations.length, 0);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); assert.equal(await page.getByRole("dialog").count(), 0);
    });
    await t.test("a station registered in the practice control receives its licence and is saved active", async () => {
      await page.getByTitle("Nuevo", { exact: true }).click(); await dialog.waitFor();
      await fill("EST-PRUEBA-01");
      await dialog.getByRole("button", { name: "Obtener Datos", exact: true }).click();
      await dialog.getByText(/Validación recibida:/).waitFor();
      assert.equal(await dialog.getByLabel("Lic.:", { exact: true }).inputValue(), "LIC-DEMO-01");
      assert.equal(await dialog.getByLabel("ID dispositivo", { exact: true }).inputValue(), "DISP-PRUEBA-01");
      assert.equal(await dialog.getByLabel("SO RRAA:", { exact: true }).inputValue(), "SO-DEMO");
      await dialog.getByLabel("Activa", { exact: true }).check();
      await dialog.getByRole("button", { name: "oK", exact: true }).click();
      await page.getByText("Datos guardados correctamente.", { exact: true }).waitFor();
      const [station] = getAdminTools(await store.read()).stations;
      assert.equal(station.name, "EST-PRUEBA-01"); assert.equal(station.deviceId, "DISP-PRUEBA-01");
      assert.equal(station.license, "LIC-DEMO-01"); assert.equal(station.rraaClientId, "EMPRESA-DEMO"); assert.equal(station.active, true);
      // The saved pair is taken: the window now names the next free one.
      await page.getByRole("status").filter({ hasText: "Escribe «EST-PRUEBA-02» y pulsa Obtener Datos" }).waitFor();
      // Its installation panel names the practice control, not RRAA.
      await page.getByRole("row").filter({ hasText: "EST-PRUEBA-01" }).click();
      await page.getByText("Estación activa y validada por el control de prueba", { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, "station-list.png") });
    });
    assert.deepEqual(errors, []);
    t.diagnostic(`Synthetic UI evidence: ${output}; external traffic blocked; no operational database or normal browser profile used.`);
  } finally {
    await context?.close(); await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    await app.close();
  }
});
