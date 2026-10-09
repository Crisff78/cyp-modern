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
  if (pathname === "/api/health") return new Promise(resolve => { window.__qaResolveHealth = () => resolve(new Response(JSON.stringify({ mode: "real" }))); });
  if (pathname !== "/api/auth/login") throw new Error("Network API forbidden in UI fixture: " + pathname);
  window.__qaLoginRequests++;
  const credentials = JSON.parse(String(options.body || "{}"));
  window.__qaLoginValues = { username: credentials.email, passwordLength: credentials.password?.length ?? 0 };
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
      assert.equal(await email.getAttribute("name"), "username");
      assert.equal(await email.getAttribute("inputmode"), "email");
      assert.equal(await password.getAttribute("name"), "password");
      assert.equal(await page.locator('form[name="admin-login"]').getAttribute("autocomplete"), "on");
      const secret = "NoGuardar!+#'";
      await email.fill("qa-login@example.invalid");
      await password.fill(secret);
      await page.evaluate("window.__qaResolveHealth?.()");
      const requestsBeforeToggle = await page.evaluate(() => (window as any).__qaLoginRequests);
      await page.getByRole("button", { name: "Mostrar contraseña", exact: true }).click();
      assert.equal(await password.getAttribute("type"), "text"); assert.equal(await password.inputValue(), secret);
      assert.equal(await email.inputValue(), "qa-login@example.invalid", "A late server health response must not erase typed or autofilled credentials.");
      await page.getByRole("button", { name: "Ocultar contraseña", exact: true }).click();
      assert.equal(await password.getAttribute("type"), "password");
      assert.equal(await page.evaluate(() => (window as any).__qaLoginRequests), requestsBeforeToggle);
      assert.equal(await page.evaluate((secret: string) => [localStorage, sessionStorage].every((storage) => Object.values(storage).every((value) => !String(value).includes(secret))), secret), true);
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
    await t.test("native form values survive visibility changes and submit without input events", async () => {
      const username = "qa-autofill@example.invalid", secret = "Autofill-Prueba!+#'";
      await page.evaluate(({ username, secret }) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(document.querySelector('[name="username"]'), username);
        setter.call(document.querySelector('[name="password"]'), secret);
      }, { username, secret });
      const before = await page.evaluate(() => (window as any).__qaLoginRequests);
      await page.getByRole("button", { name: "Mostrar contraseña", exact: true }).click();
      assert.equal(await page.getByLabel("Contraseña", { exact: true }).inputValue(), secret);
      assert.equal(await page.getByLabel("Usuario / Correo", { exact: true }).inputValue(), username);
      await page.getByRole("button", { name: "Ocultar contraseña", exact: true }).click();
      assert.equal(await page.evaluate(() => (window as any).__qaLoginRequests), before);
      await submit().click(); await page.getByRole("alert").getByText("Correo o contraseña incorrectos.").waitFor();
      assert.deepEqual(await page.evaluate(() => (window as any).__qaLoginValues), { username, passwordLength: secret.length });
      assert.equal(await page.evaluate((secret: string) => [localStorage, sessionStorage].every((storage) => Object.values(storage).every((value) => !String(value).includes(secret))), secret), true);
      await page.getByRole("button", { name: "Volver", exact: true }).click(); await chooseAdmin().click();
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
    await t.test("native printing supports printer paper and thermal widths, with separate receipts and no MDI controls", async () => {
      await page.getByRole("button", { name: "Cobros", exact: true }).click();
      const view = page.locator(".collections-legacy-view"); await view.waitFor();
      await view.getByTitle("Imprimir", { exact: true }).click();
      await page.getByRole("dialog", { name: "Seleccione...", exact: true }).getByRole("button", { name: "oK", exact: true }).click();
      const ticket = page.getByRole("dialog", { name: "Imprimir Recibo de Cobro...", exact: true }); await ticket.waitFor();
      assert.ok(await ticket.locator(".collection-ticket-preview").count() >= 2);
      assert.equal(await ticket.getByLabel("Papel de impresión", { exact: true }).inputValue(), "auto");
      await page.evaluate(() => { (window as any).__qaPrint = 0; (window as any).__qaOriginalPrint = window.print; window.print = () => { (window as any).__qaPrint++; }; });
      await ticket.getByRole("button", { name: "Imprimir / Guardar PDF", exact: true }).click();
      assert.equal(await page.evaluate(() => (window as any).__qaPrint), 1);
      for (const [paper, millimeters] of [["auto", 72], ["58", 50], ["80", 72]] as const) {
        await ticket.getByLabel("Papel de impresión", { exact: true }).selectOption(paper); await page.emulateMedia({ media: "print" });
        assert.equal(await page.locator("#root").evaluate((node: HTMLElement) => getComputedStyle(node).display), "none");
        assert.equal(await ticket.locator(".collection-ticket-controls").evaluate((node: HTMLElement) => getComputedStyle(node).display), "none");
        assert.equal(await ticket.locator(".collection-ticket-preview-list").evaluate((node: HTMLElement) => getComputedStyle(node).display), "block");
        const size = await ticket.locator(".collection-ticket-preview").first().evaluate((node: HTMLElement) => ({ width: node.getBoundingClientRect().width, scroll: node.scrollWidth, client: node.clientWidth, breakAfter: getComputedStyle(node).breakAfter }));
        assert.ok(Math.abs(size.width - millimeters * 96 / 25.4) < 1); assert.ok(size.scroll <= size.client + 1); assert.equal(size.breakAfter, "page");
        assert.equal(await ticket.locator(".collection-ticket-preview").last().evaluate((node: HTMLElement) => getComputedStyle(node).breakAfter), "auto");
        await page.screenshot({ path: path.join(output, `admin-print-${paper}.png`) }); await page.emulateMedia({ media: "screen" });
      }
      await ticket.getByRole("button", { name: "oK", exact: true }).click();
      await page.emulateMedia({ media: "print" });
      assert.equal(await page.locator("#root").evaluate((node: HTMLElement) => getComputedStyle(node).visibility), "visible", "Receipt CSS must not blank unrelated print views.");
      await page.emulateMedia({ media: "screen" });
      await page.getByRole("button", { name: "Cerrar Cobros", exact: true }).click();
      await page.evaluate(() => { window.print = (window as any).__qaOriginalPrint; });
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
    await t.test("theme toggle sits between Help and Wallet, preserves drafts, persists and keeps print light", async () => {
      const key = "cyp-admin-color-theme";
      await page.locator(".notifications-menu").getByRole("button", { name: "Cerrar", exact: true }).click();
      const themeButton = () => page.locator(".theme-toggle");
      assert.deepEqual(await themeButton().evaluate((node: HTMLElement) => ({ before: node.previousElementSibling?.getAttribute("aria-label"), after: node.nextElementSibling?.getAttribute("aria-label") })), { before: "Qué hay de nuevo", after: "Ventana de Pagos" });
      assert.equal(await themeButton().getAttribute("aria-pressed"), "false");
      const token = await page.evaluate(() => localStorage.getItem("cyp-admin-token"));
      const launchers = page.getByRole("navigation", { name: "Operaciones principales" }).getByRole("button");
      assert.deepEqual(await launchers.allTextContents(), ["COBROS Cargos", "PAGOS Descargos", "REMESAS"]);
      const lightLauncherColors = await launchers.evaluateAll((nodes: HTMLElement[]) => nodes.map((node) => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor, height: node.getBoundingClientRect().height })));
      assert.equal(new Set(lightLauncherColors.map((row: { background: string }) => row.background)).size, 3);
      assert.ok(lightLauncherColors.every((row: { height: number }) => row.height >= 48));
      const loginCount = await page.evaluate(() => (window as any).__qaLoginRequests);
      const lightSidebar = await page.locator(".sidebar").evaluate((node: HTMLElement) => getComputedStyle(node).backgroundColor);
      await page.emulateMedia({ media: "print" });
      const lightPrint = await page.evaluate(() => ({ scheme: getComputedStyle(document.documentElement).colorScheme, body: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color }));
      await page.emulateMedia({ media: "screen" });
      await themeButton().focus(); await page.keyboard.press("Enter");
      assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
      assert.equal(await page.evaluate((key: string) => localStorage.getItem(key), key), "dark");
      assert.equal(await themeButton().getAttribute("aria-label"), "Cambiar a modo claro");
      assert.equal(await themeButton().getAttribute("aria-pressed"), "true");
      const darkLauncherColors = await launchers.evaluateAll((nodes: HTMLElement[]) => nodes.map((node) => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor, height: node.getBoundingClientRect().height })));
      assert.deepEqual(darkLauncherColors, lightLauncherColors);
      await launchers.nth(0).click();
      const chargesWindow = page.locator(".mdi-window").filter({ has: page.getByText("Cargos", { exact: true }) });
      await chargesWindow.waitFor(); await chargesWindow.getByRole("button", { name: "Cerrar Cargos", exact: true }).click();
      await launchers.nth(1).click(); await page.locator(".payouts-legacy-view").waitFor();
      await page.locator(".mdi-window").filter({ has: page.locator(".payouts-legacy-view") }).getByRole("button", { name: "Cerrar Descargos", exact: true }).click();
      assert.notEqual(await page.locator(".sidebar").evaluate((node: HTMLElement) => getComputedStyle(node).backgroundColor), lightSidebar);
      assert.equal(await page.evaluate(() => localStorage.getItem("cyp-admin-token")), token);
      assert.equal(await page.evaluate(() => (window as any).__qaLoginRequests), loginCount);

      const clients = page.getByRole("button", { name: "Clientes", exact: true });
      if (!await clients.isVisible()) await page.getByRole("button", { name: "ARCHIVOS", exact: true }).click();
      await clients.click();
      const mdiWindow = page.locator(".mdi-window").filter({ has: page.locator(".clients-mdi-view") });
      await mdiWindow.waitFor();
      await mdiWindow.getByTitle("Nuevo", { exact: true }).click();
      const form = page.getByRole("dialog", { name: "Datos del Cliente...", exact: true });
      await form.waitFor();
      const name = form.getByLabel("Cliente:", { exact: true });
      await name.fill("Borrador O'Connor & Hijos");
      const colors = await name.evaluate((node: HTMLElement) => {
        const style = getComputedStyle(node), canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        return [style.color, style.backgroundColor].map((color) => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        });
      });
      const luminance = (rgb: number[]) => { const values = rgb.map((value) => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }); return values[0] * .2126 + values[1] * .7152 + values[2] * .0722; };
      const a = luminance(colors[0]), b = luminance(colors[1]), contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      assert.ok(contrast >= 4.5, `Dark input contrast must remain readable (${contrast}).`);
      assert.equal(await name.getAttribute("maxlength"), "160");
      await page.screenshot({ path: path.join(output, "theme-dark-client-dialog.png") });

      const other = await context.newPage(); await other.goto(origin); await other.locator(".theme-toggle").waitFor();
      assert.equal(await other.locator("html").getAttribute("data-theme"), "dark");
      await other.locator(".theme-toggle").click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      assert.equal(await name.inputValue(), "Borrador O'Connor & Hijos", "Theme changes must not unmount or clear an open form.");
      await form.getByRole("button", { name: "Cancelar", exact: true }).click(); await form.waitFor({ state: "detached" });
      await other.close();
      assert.equal(await page.locator(".sidebar").evaluate((node: HTMLElement) => getComputedStyle(node).backgroundColor), lightSidebar);
      await themeButton().click(); await page.reload(); await themeButton().waitFor();
      assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
      await page.emulateMedia({ media: "print" });
      assert.equal(await page.locator("html").evaluate((node: HTMLElement) => getComputedStyle(node).colorScheme), "light");
      assert.deepEqual(await page.evaluate(() => ({ scheme: getComputedStyle(document.documentElement).colorScheme, body: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color })), lightPrint);
      await page.emulateMedia({ media: "screen" });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await themeButton().isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, "theme-dark-mobile.png") });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate("(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(name, value) { if (name === 'cyp-admin-color-theme') throw new DOMException('Storage unavailable', 'SecurityError'); return original.call(this, name, value); }; })()");
      await themeButton().click(); assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
      assert.equal(await page.evaluate(() => localStorage.getItem("cyp-admin-token")), token);
    });
    assert.deepEqual(pageErrors, []); assert.deepEqual(networkAttempts, []);
    t.diagnostic(`Synthetic UI screenshots: ${output}`);
  } finally {
    await context?.close(); await browser?.close();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});
