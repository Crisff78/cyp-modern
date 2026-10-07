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

// Render the actual App and styles with its existing synthetic frontend store.
// No .env, real API, shared records, database, provider, or browser download.
test("login selection and receipt navigation work in the actual Admin UI", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-login-notifications-"));
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
window.__qaLoginRequests = 0;
window.fetch = async (input, options = {}) => {
  const pathname = new URL(String(input), location.origin).pathname;
  if (pathname === "/api/health") return new Response(JSON.stringify({ mode: "demo" }));
  if (pathname !== "/api/auth/login") throw new Error("Network API forbidden in UI fixture: " + pathname);
  window.__qaLoginRequests++;
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
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-DO", serviceWorkers: "block" });
    await context.route("**/*", async (route: any) => {
      if (new URL(route.request().url()).origin !== origin) { networkAttempts.push(route.request().url()); return route.abort("blockedbyclient"); }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", (error: Error) => pageErrors.push(error.message));
    const chooseAdmin = () => page.getByRole("button", { name: /^Administrador/ });
    const submit = () => page.getByRole("button", { name: "Iniciar Sesión", exact: true });
    const credentials = async (email: string, password = "Demo-CyP-2026!") => {
      await page.getByLabel("Usuario / Correo", { exact: true }).fill(email);
      await page.getByLabel("Contraseña", { exact: true }).fill(password);
      await submit().click();
    };

    await t.test("selection hides credentials; Back resets values; native security constraints remain", async () => {
      await page.goto(origin); await chooseAdmin().waitFor();
      assert.equal(await page.locator("form, input").count(), 0);
      await page.screenshot({ path: path.join(output, "login-selection.png") });
      const collector = page.getByRole("link", { name: /^Terminal del cobrador/ });
      assert.equal(await collector.getAttribute("href"), "/collector/");
      assert.equal(await collector.getAttribute("target"), null);
      await chooseAdmin().focus(); await page.keyboard.press("Enter");
      const email = page.getByLabel("Usuario / Correo", { exact: true }), password = page.getByLabel("Contraseña", { exact: true });
      assert.equal(await chooseAdmin().count(), 0); assert.equal(await collector.count(), 0);
      assert.equal(await email.getAttribute("maxlength"), "200");
      assert.equal(await password.getAttribute("maxlength"), "200");
      assert.equal(await password.getAttribute("minlength"), "3");
      assert.equal(await password.getAttribute("autocomplete"), "current-password");
      await credentials("admin@cyp.local", "x");
      assert.equal(await page.evaluate(() => (window as any).__qaLoginRequests), 0, "Native minimum length must block submission.");
      await credentials("admin@cyp.local", "Incorrecta!+#'");
      await page.getByRole("alert").getByText("Correo o contraseña incorrectos.").waitFor();
      await page.getByRole("button", { name: "Volver", exact: true }).click();
      assert.equal(await page.locator("form, input").count(), 0);
      await chooseAdmin().click();
      assert.equal(await email.inputValue(), ""); assert.equal(await password.inputValue(), "");
      assert.equal(await page.getByRole("alert").count(), 0);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: path.join(output, "login-form-mobile.png") });
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await t.test("collector and suspended accounts retain their Admin guards", async () => {
      await credentials("collector@cyp.local");
      await page.getByRole("heading", { name: "Acceso no autorizado", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem("cyp-admin-token")), null);
      await page.getByRole("button", { name: "Volver al login administrativo" }).click();
      await credentials("suspendido@cyp.local");
      await page.getByRole("alert").getByText("Cuenta o empresa suspendida.").waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem("cyp-admin-token")), null);
      await credentials("admin@cyp.local");
      await page.getByRole("button", { name: /^Notificaciones,/ }).waitFor();
    });
    await t.test("receipt X, Escape and backdrop preserve the bell, focus and scroll for the next receipt", async () => {
      await page.getByRole("button", { name: /^Notificaciones,/ }).click();
      const menu = page.locator(".notifications-menu"), receipt = page.getByRole("dialog", { name: "Recibo confirmado", exact: true });
      const receipts = menu.getByRole("button").filter({ hasText: "Ver recibo" });
      await receipts.first().waitFor(); assert.ok(await receipts.count() >= 2);
      const first = receipts.first(); await first.scrollIntoViewIfNeeded();
      const scroll = await menu.evaluate((node: HTMLElement) => node.scrollTop);
      await first.click(); await receipt.waitFor();
      assert.equal(await menu.getAttribute("data-state"), "open");
      await page.screenshot({ path: path.join(output, "receipt-over-bell.png") });
      await receipt.getByRole("button", { name: "Cerrar", exact: true }).click();
      await receipt.waitFor({ state: "detached" });
      assert.equal(await menu.isVisible(), true);
      assert.equal(await menu.evaluate((node: HTMLElement) => node.scrollTop), scroll);
      await page.waitForFunction(() => document.activeElement?.closest(".notifications-menu") !== null);
      assert.equal(await first.evaluate((node: HTMLElement) => document.activeElement === node), true);
      await receipts.nth(1).click(); await receipt.waitFor();
      await page.keyboard.press("Escape"); await receipt.waitFor({ state: "detached" });
      assert.equal(await menu.isVisible(), true);
      await receipts.first().click(); await receipt.waitFor();
      await page.locator(".notification-receipt-overlay").click({ position: { x: 10, y: 10 } });
      await receipt.waitFor({ state: "detached" }); assert.equal(await menu.isVisible(), true);
      await menu.getByRole("button", { name: "Cerrar", exact: true }).click();
      await menu.waitFor({ state: "detached" });
      await page.getByRole("button", { name: /^Notificaciones,/ }).click();
      await menu.waitFor(); assert.equal(await receipt.count(), 0);
    });
    assert.deepEqual(pageErrors, []); assert.deepEqual(networkAttempts, []);
    t.diagnostic(`Synthetic UI screenshots: ${output}`);
  } finally {
    await context?.close(); await browser?.close();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});
