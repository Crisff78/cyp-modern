import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const collectorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client-collector");
const localRequire = createRequire(path.join(collectorRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined; }
const available = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);

test("Collector login supports password visibility/autofill without saving secrets or bypassing roles", { skip: available ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-collector-login-ui-"));
  const cleanup: (() => Promise<void>)[] = [];
  const errors: string[] = [], network: string[] = [];
  try {
    const module = (name: string) => JSON.stringify(path.join(collectorRoot, "src", name).replaceAll("\\", "/"));
    const fixture = path.join(output, "fixture.tsx");
    fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import { App } from ${module("App.tsx")};
import ${module("styles.css")};
window.__qaLogins = 0;
window.fetch = async (input, options = {}) => {
  if (new URL(String(input), location.origin).pathname !== "/api/auth/login") throw new Error("Unexpected API in isolated login fixture");
  window.__qaLogins++;
  return new Response(JSON.stringify({token:"qa-forbidden-admin",user:{id:"qa-admin",name:"Admin QA",role:"admin",isActive:true,hasWorkPermission:true}}));
};
createRoot(document.getElementById("root")).render(<App />);`, "utf8");
    const [{ build }, { default: react }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root: collectorRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), plugins: [react()], resolve: { dedupe: ["react", "react-dom"] }, define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.BASE_URL": JSON.stringify("/collector/") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, sourcemap: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.method !== "GET") { network.push(`${request.method} ${pathname}`); response.writeHead(405); response.end(); return; }
      if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end('<h1>Selecciona tu acceso</h1>'); return; }
      if (pathname === "/collector/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>'); return; }
      const assets = new Map([["/fixture.js", "text/javascript"], ["/fixture.css", "text/css"]]);
      if (assets.has(pathname)) { response.writeHead(200, { "Content-Type": assets.get(pathname)! }); response.end(fs.readFileSync(path.join(output, "dist", pathname.slice(1)))); return; }
      response.writeHead(404); response.end();
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address(); assert(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
    const browser = await chromium.launch({ executablePath: edge, headless: true }); cleanup.push(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", locale: "es-DO" }); cleanup.push(() => context.close());
    await context.route("**/*", async (route: any) => {
      const target = new URL(route.request().url());
      if (target.origin !== origin) {
        // Existing optional web fonts are blocked too; the UI uses its fallback.
        if (!["fonts.googleapis.com", "fonts.gstatic.com"].includes(target.hostname)) network.push(route.request().url());
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(`${origin}/collector/`);
    const email = page.getByLabel("Usuario / Email", { exact: true }), password = page.getByLabel("Contraseña", { exact: true });
    await email.waitFor();
    assert.equal(await email.getAttribute("name"), "username"); assert.equal(await email.getAttribute("autocomplete"), "username");
    assert.equal(await email.getAttribute("inputmode"), "email"); assert.equal(await email.getAttribute("maxlength"), "200");
    assert.equal(await password.getAttribute("name"), "password"); assert.equal(await password.getAttribute("maxlength"), "200");
    assert.equal(await password.getAttribute("autocomplete"), "current-password"); assert.equal(await password.getAttribute("required"), "");
    const secret = "NoGuardar-PWA!+#'";
    await email.fill("qa-admin@example.invalid"); await password.fill(secret);
    await page.getByRole("button", { name: "Mostrar contraseña", exact: true }).click();
    assert.equal(await password.getAttribute("type"), "text"); assert.equal(await password.inputValue(), secret);
    await page.getByRole("button", { name: "Ocultar contraseña", exact: true }).click();
    assert.equal(await password.getAttribute("type"), "password"); assert.equal(await page.evaluate("window.__qaLogins"), 0);
    assert.equal(await page.evaluate((secret: string) => [localStorage, sessionStorage].every((storage) => Object.values(storage).every((value) => !String(value).includes(secret))), secret), true);
    await page.getByRole("button", { name: "Entrar a mi ruta", exact: true }).click();
    await page.getByText("Esta cuenta corresponde a administración. Entra con una cuenta de cobrador.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem("cyp-collector-token")), null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, "collector-login-mobile.png") });
    await page.getByRole("button", { name: "Volver", exact: true }).click();
    await page.getByRole("heading", { name: "Selecciona tu acceso" }).waitFor(); assert.equal(await page.locator("input,form").count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(network, []); t.diagnostic(`Synthetic PWA screenshot: ${output}`);
  } finally { for (const close of cleanup.reverse()) await close(); }
});
