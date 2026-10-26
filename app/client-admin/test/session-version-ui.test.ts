import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

// Observations of 2026-10-26: (1) closing the browser or the tab left the session open for whoever
// came next; (2) people with a tab open kept seeing an old version of the published demo.
const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedRoot = path.resolve(adminRoot, "../shared");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined; }
const available = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);

test("the session ends with its tab and an open tab learns about a new version", { skip: available ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-session-version-ui-"));
  const cleanup: (() => Promise<void>)[] = [];
  try {
    const shared = (name: string) => JSON.stringify(path.join(sharedRoot, name).replaceAll("\\", "/"));
    const fixture = path.join(output, "fixture.tsx");
    fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import { NewVersionNotice } from ${shared("NewVersionNotice.tsx")};
import { startSessionLifetime } from ${shared("sessionLifetime.ts")};
import { ADMIN_TOKEN_KEY, COLLECTOR_TOKEN_KEY } from ${shared("sessionHandoff.ts")};
startSessionLifetime([ADMIN_TOKEN_KEY, COLLECTOR_TOKEN_KEY]);
sessionStorage.setItem("qa-loads", String(Number(sessionStorage.getItem("qa-loads") || 0) + 1));
const token = () => sessionStorage.getItem(ADMIN_TOKEN_KEY);
createRoot(document.getElementById("root")).render(<><p id="state">{token() ? "con sesión" : "sin sesión"}</p><NewVersionNotice pageUrl="/" isSignedIn={() => Boolean(token())} /></>);`, "utf8");
    const [{ build }, { default: react }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), plugins: [react()], resolve: { dedupe: ["react", "react-dom"] }, define: { "process.env.NODE_ENV": JSON.stringify("production") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, sourcemap: false, rollupOptions: { output: { inlineDynamicImports: true } }, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js" } } });
    let published = 1;
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><div id="root"></div><script type="module" crossorigin src="/fixture.js?v=${published}"></script></html>`);
        return;
      }
      if (pathname === "/fixture.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(fs.readFileSync(path.join(output, "dist", "fixture.js"))); return; }
      response.writeHead(404); response.end();
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address(); assert(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
    const browser = await chromium.launch({ executablePath: edge, headless: true }); cleanup.push(() => browser.close());
    const context = await browser.newContext({ serviceWorkers: "block", locale: "es-DO" }); cleanup.push(() => context.close());
    // A token left in localStorage by a version before this change, and a switch that plays the browser
    // reopening a tab that was closed an hour ago (it brings back its sessionStorage, with an old heartbeat).
    await context.addInitScript(() => {
      if (!sessionStorage.getItem("qa-legacy-done")) { localStorage.setItem("cyp-admin-token", "legacy-token"); sessionStorage.setItem("qa-legacy-done", "1"); }
      if (sessionStorage.getItem("qa-restore") === "1") { sessionStorage.removeItem("qa-restore"); sessionStorage.setItem("cyp-session-alive", String(Date.now() - 3_600_000)); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.message));
    const state = () => page.locator("#state").textContent();
    const notice = page.getByRole("status").filter({ hasText: "Hay una versión nueva del sistema" });

    await t.test("a token kept by an older version in localStorage no longer opens a session", async () => {
      await page.goto(origin); assert.equal(await state(), "sin sesión");
      assert.equal(await page.evaluate(() => localStorage.getItem("cyp-admin-token")), null);
    });

    await t.test("reloading the tab keeps the session", async () => {
      await page.evaluate(() => sessionStorage.setItem("cyp-admin-token", "qa-token"));
      await page.reload(); assert.equal(await state(), "con sesión");
      await page.reload(); assert.equal(await state(), "con sesión");
    });

    await t.test("a tab closed and reopened by the browser starts signed out", async () => {
      await page.evaluate(() => sessionStorage.setItem("qa-restore", "1"));
      await page.reload(); assert.equal(await state(), "sin sesión");
      assert.equal(await page.evaluate(() => sessionStorage.getItem("cyp-admin-token")), null);
    });

    await t.test("signed in: a new version shows the notice and «Actualizar ahora» loads it", async () => {
      await page.evaluate(() => sessionStorage.setItem("cyp-admin-token", "qa-token"));
      await page.reload(); assert.equal(await state(), "con sesión");
      await page.waitForTimeout(400);
      assert.equal(await notice.count(), 0, "nothing new published: no notice");
      // The first return to the tab checks at once (later ones, at most once a minute).
      published = 2;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await notice.waitFor();
      assert.equal(await state(), "con sesión", "it waits for the person instead of reloading");
      await notice.getByRole("button", { name: "Actualizar ahora", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('script[type="module"]')?.getAttribute("src") === "/fixture.js?v=2");
      assert.equal(await state(), "con sesión");
      assert.equal(await notice.count(), 0);
    });

    await t.test("signed out: a new version reloads the sign-in page by itself", async () => {
      await page.evaluate(() => sessionStorage.removeItem("cyp-admin-token"));
      await page.reload(); assert.equal(await state(), "sin sesión");
      const loads = Number(await page.evaluate(() => sessionStorage.getItem("qa-loads")));
      published = 3;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForFunction((before: number) => Number(sessionStorage.getItem("qa-loads")) > before && document.querySelector('script[type="module"]')?.getAttribute("src") === "/fixture.js?v=3", loads);
      assert.equal(await notice.count(), 0);
    });

    assert.deepEqual(errors, []);
  } finally {
    for (const close of cleanup.reverse()) await close().catch(() => undefined);
    fs.rmSync(output, { recursive: true, force: true });
  }
});
