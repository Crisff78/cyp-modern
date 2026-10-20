import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch {
  playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
}
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);
type Box = { x: number; y: number; width: number; height: number };
const near = (actual: number, expected: number, label: string, tolerance = 2) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

// The actual App, styles and synthetic frontend store: every desktop window can be resized from its
// borders and corners, maximized and restored, and opens again with the size the user left it at.
// No .env, real API, database, provider or browser download.
test("desktop windows are resized from any border, maximized, restored and remember their size", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-window-resize-"));
  let browser: any, context: any, server: ReturnType<typeof createServer> | undefined;
  const pageErrors: string[] = [], networkAttempts: string[] = [];
  try {
    const fixture = path.join(output, "fixture.tsx");
    const module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
    fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import App from ${module("App.tsx")};
import { mockApi } from ${module("mock.ts")};
import ${module("styles.css")};
import ${module("suggestions-shell.css")};
window.fetch = async (input, options = {}) => {
  const pathname = new URL(String(input), location.origin).pathname;
  if (pathname === "/api/health") return new Response(JSON.stringify({ mode: "real" }));
  if (pathname !== "/api/auth/login") throw new Error("Network API forbidden in UI fixture: " + pathname);
  try { return new Response(JSON.stringify(await mockApi("/auth/login", options))); }
  catch (error) { return new Response(JSON.stringify({error:{message:error.message}}), {status:401}); }
};
createRoot(document.getElementById("root")).render(<App />);
`, "utf8");
    const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href),
      import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(localRequire.resolve("@tailwindcss/vite")).href),
      import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react(), tailwind()], define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.VITE_COLLECTOR_URL": JSON.stringify("/collector/") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.method !== "GET") { networkAttempts.push(`${request.method} ${pathname}`); response.writeHead(405); response.end(); return; }
      if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>'); return; }
      const assets = new Map([["/fixture.js", "text/javascript"], ["/fixture.css", "text/css"]]);
      if (assets.has(pathname)) { response.writeHead(200, { "Content-Type": assets.get(pathname)! }); response.end(fs.readFileSync(path.join(output, "dist", pathname.slice(1)))); return; }
      response.writeHead(404); response.end();
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", serviceWorkers: "block" });
    await context.route("**/*", async (route: any) => {
      const target = new URL(route.request().url());
      if (target.origin !== origin) { if (target.origin !== "http://me.kis.v2.scr.kaspersky-labs.com") networkAttempts.push(target.origin); return route.abort("blockedbyclient"); }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", (error: Error) => pageErrors.push(error.message));
    const signIn = async () => {
      await page.goto(origin);
      await page.getByLabel("Usuario o correo", { exact: true }).fill("admin@cyp.local");
      await page.getByLabel("Contraseña", { exact: true }).fill("Demo-CyP-2026!");
      await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
      await page.getByRole("button", { name: /^Notificaciones,/ }).waitFor();
    };
    const openClients = async () => {
      const clients = page.locator(".sidebar").getByRole("button", { name: "Clientes", exact: true });
      // A reload first restores the authenticated user's permissions; Clientes is a single
      // button of the menu, always on view once they are back.
      await clients.waitFor({ state: "attached" });
      await clients.click();
      const frame = page.getByRole("dialog", { name: "Clientes", exact: true });
      await frame.waitFor();
      return frame;
    };
    const box = async (locator: any): Promise<Box> => { const rect = await locator.boundingBox(); assert(rect); return rect; };
    // Drags the middle of a border or corner by (dx, dy).
    const dragHandle = async (frame: any, edge: string, dx: number, dy: number) => {
      const handle = await box(frame.locator(`.mdi-resize-${edge}`));
      const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2); await page.mouse.move(x + dx, y + dy); await page.mouse.up();
    };
    const desktop = () => box(page.locator("#main-content"));
    await signIn();

    await t.test("each border and corner changes the size and the opposite border stays put", async () => {
      const frame = await openClients();
      assert.equal(await frame.locator(".mdi-resize-handle").count(), 8);
      assert.equal(await frame.evaluate((node: HTMLElement) => getComputedStyle(node).resize), "none");
      const start = await box(frame);
      near(start.width, 860, "default width"); near(start.height, 520, "default height");
      // The strips to resize are clear of the content, so they never lie over its scrollbar.
      const content = await box(frame.locator(".mdi-window-content")), east = await box(frame.locator(".mdi-resize-e")), south = await box(frame.locator(".mdi-resize-s"));
      assert.ok(content.x + content.width <= east.x + 0.5, "the east border is clear of the content");
      assert.ok(content.y + content.height <= south.y + 0.5, "the south border is clear of the content");
      // A click on a border without dragging chooses no size.
      await page.mouse.move(east.x + east.width / 2, east.y + east.height / 2); await page.mouse.down(); await page.mouse.up();
      near((await box(frame)).width, start.width, "a click changes nothing");
      assert.equal(await page.evaluate(() => localStorage.getItem("cyp-admin-window-sizes-v1")), null);
      // The button released out of the page: the next movement arrives without a button and the resize ends.
      const grip = { x: east.x + east.width / 2, y: east.y + east.height / 2 };
      await page.mouse.move(grip.x, grip.y); await page.mouse.down();
      assert.equal(await frame.evaluate((node: HTMLElement) => node.classList.contains("resizing")), true);
      await frame.locator(".mdi-resize-e").evaluate((node: HTMLElement, at: { x: number; y: number }) => { node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: at.x + 70, clientY: at.y, buttons: 0 })); }, grip);
      near((await box(frame)).width, start.width, "a movement without a button resizes nothing");
      assert.equal(await frame.evaluate((node: HTMLElement) => node.classList.contains("resizing")), false);
      await page.mouse.up();
      assert.equal(await page.evaluate(() => localStorage.getItem("cyp-admin-window-sizes-v1")), null);

      await dragHandle(frame, "e", 90, 0);
      let now = await box(frame);
      near(now.width, start.width + 90, "east width"); near(now.x, start.x, "east keeps the left border"); near(now.height, start.height, "east keeps the height");

      await dragHandle(frame, "s", 0, 40);
      now = await box(frame);
      near(now.height, start.height + 40, "south height"); near(now.y, start.y, "south keeps the top border");

      await dragHandle(frame, "w", -50, 0);
      now = await box(frame);
      near(now.x, start.x - 50, "west moves the left border"); near(now.x + now.width, start.x + start.width + 90, "west keeps the right border");

      await dragHandle(frame, "n", 0, -30);
      now = await box(frame);
      near(now.y, start.y - 30, "north moves the top border"); near(now.y + now.height, start.y + start.height + 40, "north keeps the bottom border");

      const before = await box(frame);
      await dragHandle(frame, "se", -60, -45);
      now = await box(frame);
      near(now.width, before.width - 60, "corner width"); near(now.height, before.height - 45, "corner height"); near(now.x, before.x, "corner keeps left"); near(now.y, before.y, "corner keeps top");

      // Never smaller than the minimum, and never out of the desktop.
      await dragHandle(frame, "e", -2000, 0); await dragHandle(frame, "s", 0, -2000);
      now = await box(frame);
      near(now.width, 520, "minimum width"); near(now.height, 300, "minimum height");
      await dragHandle(frame, "se", 3000, 3000);
      now = await box(frame);
      const area = await desktop();
      near(now.x + now.width, area.x + area.width - 8, "stops at the right margin of the desktop"); near(now.y + now.height, area.y + area.height - 8, "stops at the bottom margin of the desktop");
      // The window can still be moved by its title bar after being resized.
      const title = await box(frame.locator(".mdi-window-titlebar"));
      await page.mouse.move(title.x + 80, title.y + 16); await page.mouse.down(); await page.mouse.move(title.x + 60, title.y + 6); await page.mouse.up();
      near((await box(frame)).x, now.x - 20, "moved by the title bar");
      await dragHandle(frame, "se", -260, -120);
    });

    await t.test("the size is remembered when the window is closed, and after a reload", async () => {
      const frame = page.getByRole("dialog", { name: "Clientes", exact: true });
      const left = await box(frame);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cyp-admin-window-sizes-v1") ?? "{}"));
      assert.deepEqual(Object.keys(saved), ["clients"]);
      near(saved.clients.width, left.width, "saved width"); near(saved.clients.height, left.height, "saved height");
      await frame.getByRole("button", { name: "Cerrar Clientes", exact: true }).click();
      assert.equal(await page.locator(".mdi-window").count(), 0);
      let reopened = await openClients();
      let now = await box(reopened);
      near(now.width, left.width, "reopened width"); near(now.height, left.height, "reopened height");
      // A reload still gives an empty desktop: only the size is remembered, not which windows were open.
      await page.reload(); await page.getByRole("button", { name: /^Notificaciones,/ }).waitFor();
      assert.equal(await page.locator(".mdi-window").count(), 0);
      reopened = await openClients();
      now = await box(reopened);
      near(now.width, left.width, "width after reload"); near(now.height, left.height, "height after reload");
      // Another screen keeps its own default size.
      await page.locator(".sidebar").getByRole("button", { name: "Administración", exact: true }).click();
      const panel = await box(page.getByRole("dialog", { name: "Administración", exact: true }));
      near(panel.width, 600, "control panel width"); near(panel.height, 390, "control panel height");
      await page.getByRole("button", { name: "Cerrar Administración", exact: true }).click();
    });

    await t.test("a window is maximized and restored with its button or a double click on its title", async () => {
      const frame = page.getByRole("dialog", { name: "Clientes", exact: true });
      const before = await box(frame), area = await desktop();
      const maximize = frame.getByRole("button", { name: "Maximizar Clientes", exact: true });
      await maximize.click();
      let now = await box(frame);
      near(now.x, area.x + 8, "maximized left"); near(now.y, area.y + 8, "maximized top"); near(now.width, area.width - 16, "maximized width"); near(now.height, area.height - 16, "maximized height");
      assert.equal(await frame.locator(".mdi-resize-handle").count(), 0);
      const restore = frame.getByRole("button", { name: "Restaurar tamaño de Clientes", exact: true });
      await restore.waitFor();
      // It follows the desktop when the browser changes size, and cannot be dragged away.
      await page.setViewportSize({ width: 1280, height: 800 });
      const smaller = await desktop(); now = await box(frame);
      near(now.width, smaller.width - 16, "follows the desktop width"); near(now.height, smaller.height - 16, "follows the desktop height");
      const bar = await box(frame.locator(".mdi-window-titlebar"));
      await page.mouse.move(bar.x + 80, bar.y + 16); await page.mouse.down(); await page.mouse.move(bar.x + 180, bar.y + 90); await page.mouse.up();
      near((await box(frame)).x, smaller.x + 8, "a maximized window does not move");
      await page.setViewportSize({ width: 1440, height: 1000 });
      await restore.click();
      now = await box(frame);
      near(now.x, before.x, "restored left"); near(now.y, before.y, "restored top"); near(now.width, before.width, "restored width"); near(now.height, before.height, "restored height");
      assert.equal(await frame.locator(".mdi-resize-handle").count(), 8);
      // Double click on the title bar does the same; a double click on its buttons does not.
      const title = frame.locator(".mdi-window-titlebar > span");
      await title.dblclick();
      near((await box(frame)).width, area.width - 16, "double click maximizes");
      await title.dblclick();
      near((await box(frame)).width, before.width, "double click restores");
      // Maximizing is not a size to remember: the stored one is still the size the user dragged.
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cyp-admin-window-sizes-v1") ?? "{}"));
      near(saved.clients.width, before.width, "stored width unchanged");
      // The close button keeps its name and still closes.
      await frame.getByRole("button", { name: "Cerrar Clientes", exact: true }).click();
      assert.equal(await page.locator(".mdi-window").count(), 0);
    });

    await t.test("a window opens inside the desktop and broken stored sizes are ignored", async () => {
      await page.evaluate(() => localStorage.setItem("cyp-admin-window-sizes-v1", JSON.stringify({ clients: { width: 3000, height: 2000 }, remittances: "roto" })));
      await page.setViewportSize({ width: 1100, height: 700 });
      await page.reload(); await page.getByRole("button", { name: /^Notificaciones,/ }).waitFor();
      const frame = await openClients();
      const now = await box(frame), area = await desktop();
      assert.ok(now.x >= area.x + 8 - 1 && now.y >= area.y + 8 - 1, "inside the top-left margin");
      assert.ok(now.x + now.width <= area.x + area.width + 1 && now.y + now.height <= area.y + area.height + 1, "inside the desktop");
      await frame.getByRole("button", { name: "Cerrar Clientes", exact: true }).click();
      await page.evaluate(() => localStorage.setItem("cyp-admin-window-sizes-v1", "no es json"));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.reload(); await page.getByRole("button", { name: /^Notificaciones,/ }).waitFor();
      const again = await box(await openClients());
      near(again.width, 860, "default width when the stored data is broken"); near(again.height, 520, "default height when the stored data is broken");
    });
    assert.deepEqual(pageErrors, []); assert.deepEqual(networkAttempts, []);
    t.diagnostic(`Synthetic UI evidence: ${output}; external traffic blocked; no API, database or normal browser profile used.`);
  } finally {
    await context?.close(); await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
  }
});
