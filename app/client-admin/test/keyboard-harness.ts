import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import type { NodeRequire } from "node:module";

// Shared by the keyboard-only tests (teclado-*.test.ts): the real Admin shell built with Vite, served next to the API
// (Fastify inject over a MemoryStore), and an Edge page driven only with page.keyboard. Every trusted pointer event
// on the page is counted: a test that clicked anything fails in assertNoPointer().
const SIMPLE_KEY = /^(?:Shift\+)?(?:Enter|Tab|Escape|Space| |ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Backspace|Delete)$/;
type Options = { app: { inject: (options: any) => Promise<any> }; adminRoot: string; output: string; playwrightEntry: string; edge: string; localRequire: NodeRequire; idempotencyKey: () => string };

export async function keyboardHarness({ app, adminRoot, output, playwrightEntry, edge, localRequire }: Options) {
  const requests: { method: string; path: string; status: number }[] = [];
  const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([
    import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
    import(pathToFileURL(localRequire.resolve("@tailwindcss/vite")).href), import(pathToFileURL(playwrightEntry).href),
  ]);
  const module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
  const fixture = path.join(output, "admin.tsx");
  fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import App from ${module("App.tsx")};
import ${module("styles.css")};
import ${module("suggestions-shell.css")};
createRoot(document.getElementById("root")).render(<App />);`, "utf8");
  await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react(), tailwind()],
    define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.BASE_URL": JSON.stringify("/admin/"), "import.meta.env.VITE_COLLECTOR_URL": JSON.stringify("/collector/") }, logLevel: "error",
    build: { outDir: path.join(output, "admin"), emptyOutDir: false, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } }, lib: { entry: fixture, formats: ["es"], fileName: () => "admin.js", cssFileName: "admin" } } });
  let address = 0;
  const remoteAddress = () => { address += 1; return `10.64.${Math.floor(address / 250) % 250}.${address % 250 + 1}`; };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const result = await app.inject({ method: request.method as "GET" | "POST", url: url.pathname + url.search, remoteAddress: remoteAddress(),
          headers: { authorization: request.headers.authorization ?? "", "idempotency-key": String(request.headers["idempotency-key"] ?? ""), ...(request.headers["content-type"] ? { "content-type": request.headers["content-type"] } : {}) },
          ...(chunks.length ? { payload: Buffer.concat(chunks).toString() } : {}) });
        requests.push({ method: request.method ?? "GET", path: url.pathname, status: result.statusCode });
        response.writeHead(result.statusCode, { "Content-Type": "application/json" }); response.end(result.body); return;
      }
      if (url.pathname === "/admin/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/admin/admin.css"><div id="root"></div><script type="module" src="/admin/admin.js"></script></html>`); return; }
      if (url.pathname === "/admin/admin.js" || url.pathname === "/admin/admin.css") { response.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css" }); response.end(fs.readFileSync(path.join(output, "admin", path.basename(url.pathname)))); return; }
      response.writeHead(404); response.end();
    } catch { response.writeHead(500); response.end('{"error":{"message":"Synthetic keyboard fixture failure"}}'); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const listening = server.address(); assert(listening && typeof listening !== "string");
  const origin = `http://127.0.0.1:${listening.port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const pageErrors: string[] = [], external: string[] = [];
  let page: any;

  const signedOut = async (viewport = { width: 1440, height: 1000 }) => {
    const context = await browser.newContext({ viewport, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
    await context.addInitScript(() => {
      const counted = window as unknown as { __pointer: number };
      counted.__pointer = 0;
      for (const type of ["pointerdown", "mousedown"]) document.addEventListener(type, (event) => { if (event.isTrusted) counted.__pointer += 1; }, true);
      window.print = () => {};
    });
    await context.route("**/*", (route: any) => { const target = new URL(route.request().url()); if (target.origin === origin) return route.continue(); external.push(target.origin); return route.abort("blockedbyclient"); });
    page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", (error: Error) => pageErrors.push(error.message));
    await page.goto(`${origin}/admin/`);
    await page.getByLabel("Usuario o correo", { exact: true }).waitFor();
    return {
      page, requests,
      /** Presses keys one after another, leaving the screen a moment after each. */
      // Only the simple keys of CyP: no F key and no combination with Ctrl or Alt.
      keys: async (...names: string[]) => { for (const name of names) { assert.match(name, SIMPLE_KEY, `${name} is not a simple key`); await page.keyboard.press(name); await page.waitForTimeout(120); } },
      /** The element with the keyboard: its type and the name a person reads next to it. */
      // Plain JavaScript text: the transpiler would add helpers (__name) that the page does not have.
      focused: () => page.evaluate(`(() => {
        const element = document.activeElement;
        const own = (label) => label ? [...label.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join("").replace(/\\s+/g, " ").trim() : "";
        const label = element?.getAttribute("aria-label") || own(element?.id ? document.querySelector('label[for="' + element.id + '"]') : null) || own(element?.closest("label")) || (element?.textContent ?? "").replace(/\\s+/g, " ").trim();
        return { label, type: element?.type ?? "", tag: element?.tagName ?? "", inside: element?.closest('[role="dialog"],dialog')?.getAttribute("aria-label") ?? "" };
      })()`) as Promise<{ label: string; type: string; tag: string; inside: string }>,
      // On a timeout it says where the keyboard was, which is what tells the cause.
      waitFor: (predicate: (arg: any) => boolean, arg?: unknown) => page.waitForFunction(predicate, arg, { timeout: 15000 }).catch(async (error: Error) => {
        const where = await page.evaluate(`(() => { const a = document.activeElement; const alerts = [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent.trim()).filter(Boolean).join(" | "); return (a ? a.tagName + " «" + ((a.getAttribute("aria-label") || a.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60)) + "» in «" + (a.closest('[role="dialog"],dialog')?.getAttribute("aria-label") ?? "") + "»" : "none") + (alerts ? " · alerts: " + alerts : ""); })()`);
        throw new Error(`${error.message}\nwaiting for: ${predicate.toString()}\nkeyboard at: ${where}`);
      }),
      /** Back to the menu (Shift+Tab, when a window is open), then its arrows until the option (→ opens its section). */
      menuTo: async (name: string) => {
        for (let step = 0; step < 120 && !(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")))); step += 1) { await page.keyboard.press("Shift+Tab"); await page.waitForTimeout(40); }
        for (let step = 0; step < 60; step += 1) {
          const next = await page.evaluate((target: string) => {
            const active = document.activeElement;
            if (!active?.closest("[data-keyboard-menu]")) return "lost";
            if (active.getAttribute("aria-label") === target) return "done";
            const group = active.closest(".nav-group");
            const holds = group && [...group.querySelectorAll(".nav-item")].some((item) => item.getAttribute("aria-label") === target);
            return holds && active.getAttribute("aria-expanded") === "false" ? "ArrowRight" : "ArrowDown";
          }, name);
          if (next === "done") return;
          assert.notEqual(next, "lost", `the keyboard left the menu looking for ${name}`);
          await page.keyboard.press(next); await page.waitForTimeout(80);
        }
        assert.fail(`${name} is not in the menu`);
      },
      /** Tab until the element with the keyboard satisfies the condition (written in plain JavaScript). */
      // The condition runs in the page: what it needs from the test goes in `value` (its second argument).
      // `key`: "Shift+Tab" to go back (up the window).
      tabTo: async (condition: (element: Element, value?: any) => boolean, limit = 80, value?: unknown, key: "Tab" | "Shift+Tab" = "Tab") => {
        for (let step = 0; step < limit; step += 1) {
          if (await page.evaluate(`(${condition.toString()})(document.activeElement, ${JSON.stringify(value ?? null)})`)) return;
          await page.keyboard.press(key); await page.waitForTimeout(40);
        }
        assert.fail(`Tab never reached: ${condition.toString()}`);
      },
    };
  };
  return {
    signedOut,
    /** No click and no pointer on the page, no error of the page and no request outside the fixture. */
    assertNoPointer: async () => {
      assert.equal(await page.evaluate(() => (window as unknown as { __pointer: number }).__pointer), 0, "a pointer event reached the page");
      assert.deepEqual(pageErrors, []);
      assert.deepEqual([...new Set(external)].filter((item) => !["http://me.kis.v2.scr.kaspersky-labs.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"].includes(item)), []);
    },
    close: async () => { await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}
