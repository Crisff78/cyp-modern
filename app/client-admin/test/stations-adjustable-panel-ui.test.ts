import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
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
const near = (actual: number, expected: number, label: string, tolerance = 2) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

// Actual ConnectedAdminTools, styles and API over an isolated MemoryStore, inside a box of the size the
// Stations window gives its content: the bar over "Instalación de CyP" shares the space with the list,
// the panel folds away, and both choices are remembered.
test("the installation panel of Stations is resized with its bar, folded away and remembered", {
  skip: process.platform !== "win32" || !fs.existsSync(edge) || !playwrightEntry ? "Installed Edge/Playwright required; no download or real profile used." : false,
}, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-stations-panel-")), store = new MemoryStore(seed());
  const app = await buildApp({ store, demo: true, secret: "stations-panel-ui-secret-at-least-32-characters", origins: [], collectorUrl: "http://localhost:5174",
    demoStationControl: createDemoStationControl() });
  const { token, user } = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } })).json();
  // Enough stations for the list to need more room than the default leaves.
  for (const number of ["01", "02", "03", "04", "05", "06", "07", "08"]) {
    const saved = await app.inject({ method: "POST", url: "/api/estaciones", headers: { authorization: `Bearer ${token}`, "idempotency-key": `stations-panel-${number}` },
      payload: { name: `EST-PRUEBA-${number}`, number: `P-${number}`, deviceId: `DISP-PRUEBA-${number}`, description: "", group: "", type: "", active: true } });
    assert.equal(saved.statusCode, 200, saved.body);
  }
  const fixture = path.join(output, "fixture.tsx");
  const module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
  fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import { ConnectedAdminTools } from ${module("ConnectedAdminTools.tsx")};
import { remittancesApi } from ${module("remittancesApi.ts")};
import ${module("styles.css")};
remittancesApi("/snapshot").then(snapshot => createRoot(document.getElementById("root")).render(<ConnectedAdminTools page="stations" snapshot={snapshot} user={${JSON.stringify({ id: user.id, role: user.role })}} onRefresh={() => {}} />));`, "utf8");
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
        // The box has the size of the content of the default Stations window (860 x 580).
        if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root" style="width:842px;height:528px"></div><script type="module" src="/fixture.js"></script></html>'); return; }
        const mime = { "/fixture.js": "text/javascript", "/fixture.css": "text/css" }[pathname];
        if (mime) { response.writeHead(200, { "Content-Type": mime }); response.end(fs.readFileSync(path.join(output, "dist", pathname.slice(1)))); return; }
        response.writeHead(404); response.end();
      } catch { response.writeHead(500); response.end(); }
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    await context.addInitScript((token: string) => localStorage.setItem("cyp-admin-token", token), token);
    await context.route("**/*", (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
    const page = await context.newPage(); page.setDefaultTimeout(8000); page.on("pageerror", (error: Error) => errors.push(error.message));
    const panel = page.getByRole("region", { name: "Instalaciones propias de CyP", exact: true });
    const bar = page.getByRole("separator", { name: "Ajustar el alto de Instalación de CyP", exact: true });
    const list = page.locator(".stations-grid-panel");
    const height = async (locator: any) => { const rect = await locator.boundingBox(); assert(rect); return rect.height as number; };
    const rows = async () => list.locator("tbody tr").evaluateAll((nodes: HTMLElement[], frame: { top: number; bottom: number }) =>
      nodes.filter((node) => { const rect = node.getBoundingClientRect(); return rect.top >= frame.top - 1 && rect.bottom <= frame.bottom + 1; }).length,
      await list.locator(".legacy-mdi-table-wrap").evaluate((node: HTMLElement) => { const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.top + node.clientHeight }; }));
    const drag = async (dy: number) => {
      const rect = await bar.boundingBox(); assert(rect);
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + dy / 2); await page.mouse.move(x, y + dy); await page.mouse.up();
    };
    const inlineHeight = () => panel.evaluate((node: HTMLElement) => node.style.height);
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("cyp-admin-panel-prefs-v1") ?? "{}"));
    const open = async () => { await page.goto(origin); await panel.getByText("Sin instalaciones registradas.", { exact: true }).waitFor(); };

    await t.test("it opens unfolded with its previous size and one bar to adjust it", async () => {
      await open();
      assert.equal(await page.getByRole("status").count(), 1, "the note of the window is still the only status");
      assert.equal(await bar.getAttribute("aria-orientation"), "horizontal");
      assert.equal(await bar.getAttribute("tabindex"), "0");
      assert.equal(await inlineHeight(), "");
      const toggle = panel.getByRole("button", { name: "Ocultar", exact: true });
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      const barBox = await bar.boundingBox(), toggleBox = await toggle.boundingBox(); assert(barBox && toggleBox);
      assert.ok(barBox.y + barBox.height <= toggleBox.y + 0.5, "the bar does not lie over the button that folds the panel");
      near(Number(await bar.getAttribute("aria-valuenow")), await height(panel), "the bar announces the height of the panel", 1);
      assert.equal(Number(await bar.getAttribute("aria-valuemin")), 96);
      assert.deepEqual(await stored(), {});
    });

    await t.test("dragging the bar gives the space to the list or to the panel, between their limits", async () => {
      const panelBefore = await height(panel), listBefore = await height(list), rowsBefore = await rows();
      await drag(90);
      near(await height(panel), panelBefore - 90, "the panel gives 90 px"); near(await height(list), listBefore + 90, "the list takes them");
      assert.ok(await rows() > rowsBefore, "more rows of the list are in view");
      const saved = await stored();
      assert.deepEqual(Object.keys(saved), ["stations.installation"]); assert.deepEqual(Object.keys(saved["stations.installation"]), ["size"]);
      near(saved["stations.installation"].size, panelBefore - 90, "the chosen height is stored");
      await drag(-40);
      near(await height(panel), panelBefore - 50, "the panel takes 40 px back");
      // The panel never gets smaller than its minimum, and the list always keeps some rows.
      await drag(900);
      near(await height(panel), 96, "minimum height of the panel");
      await drag(-900);
      near(await height(list), 84, "minimum height of the list");
      assert.equal(Number(await bar.getAttribute("aria-valuenow")), Math.round(await height(panel)));
    });

    await t.test("the arrow keys move the bar, Home and End go to the limits and a double click restores the default", async () => {
      await drag(120);
      const start = await height(panel);
      await bar.focus();
      await page.keyboard.press("ArrowDown");
      near(await height(panel), start - 16, "arrow down makes the panel smaller");
      await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp");
      near(await height(panel), start + 16, "arrow up makes it bigger");
      await page.keyboard.press("Home");
      near(await height(panel), 96, "Home is the minimum");
      await page.keyboard.press("End");
      near(await height(list), 84, "End leaves the list its minimum");
      await bar.dblclick();
      assert.equal(await inlineHeight(), "");
      assert.deepEqual(await stored(), { "stations.installation": {} });
    });

    await t.test("the chosen size comes back after a reload", async () => {
      await drag(70);
      const chosen = await height(panel);
      await open();
      near(await height(panel), chosen, "same height after the reload");
      near((await stored())["stations.installation"].size, chosen, "stored height");
    });

    await t.test("a stored height never leaves the list without rows when the window gets smaller", async () => {
      await drag(-900);
      near(await height(list), 84, "the list is at its minimum");
      const tall = await height(panel);
      // Same as pulling the bottom border of the window up by 120 px.
      await page.evaluate(() => { document.getElementById("root")!.style.height = "408px"; });
      near(await height(list), 84, "the list keeps its rows");
      near(await height(panel), tall - 120, "the panel gives the room back");
      await page.evaluate(() => { document.getElementById("root")!.style.height = "528px"; });
      near(await height(panel), tall, "and takes it again");
    });

    await t.test("the panel folds away, the list takes the room, and that is remembered too", async () => {
      const listBefore = await height(list);
      await panel.getByRole("button", { name: "Ocultar", exact: true }).click();
      const show = panel.getByRole("button", { name: "Mostrar", exact: true });
      assert.equal(await show.getAttribute("aria-expanded"), "false");
      assert.equal(await bar.count(), 0);
      assert.equal(await panel.locator(".cyp-installation-fields").count(), 0);
      assert.equal(await panel.getByRole("button", { name: "Obtener Datos de CyP", exact: true }).count(), 0);
      assert.ok(await height(panel) < 48, "only the heading is left");
      assert.ok(await height(list) > listBefore + 100, "the list takes the room");
      assert.equal(await page.getByText("Instalación de CyP", { exact: true }).isVisible(), true);
      assert.equal((await stored())["stations.installation"].collapsed, true);
      await page.goto(origin);
      await show.waitFor();
      assert.equal(await panel.locator(".cyp-installation-fields").count(), 0);
      await show.click();
      await panel.getByLabel("Estación CyP", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Obtener Datos de CyP", exact: true }).waitFor();
      assert.equal(await bar.count(), 1);
      assert.equal((await stored())["stations.installation"].collapsed, false);
    });
    assert.deepEqual(errors, []);
    t.diagnostic(`Synthetic UI evidence: ${output}; external traffic blocked; no operational database or normal browser profile used.`);
  } finally {
    await context?.close(); await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    await app.close();
  }
});
