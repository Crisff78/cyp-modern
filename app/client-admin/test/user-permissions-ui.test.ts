import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";
import catalog from "../../shared/permission-catalog.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(root, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined; }
const available = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);

// Actual connected user catalog, draggable dialog, CSS, auth, Zod and API.
// Only an isolated MemoryStore, synthetic accounts and a fresh browser profile.
test("user permission checkboxes, categories, cancel and backend saves work in the active UI", { skip: available ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-permissions-ui-"));
  const store = new MemoryStore(seed());
  const app = await buildApp({ store, demo: true, secret: "synthetic-permissions-browser-secret-at-least-32-characters", origins: [], collectorUrl: "http://localhost:5174" });
  let browser: any, context: any, server: ReturnType<typeof createServer> | undefined;
  const writes: Array<{ path: string; key: string; body: unknown; status: number }> = [];
  const errors: string[] = [], external: string[] = [];
  let loseNextResponse = false;
  try {
    const login = (email: string, password: string) => app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const adminToken = (await login("admin@cyp.local", "Demo-CyP-2026!")).json().token as string;
    const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object, headers: { authorization: `Bearer ${adminToken}`, "idempotency-key": randomUUID() } });
    const create = async (name: string, role = "user") => {
      const result = await post("/api/usuarios", { name, email: `qa-${randomUUID()}@example.invalid`, role, password: "Synthetic-Permissions-2026!" });
      assert.equal(result.statusCode, 200, result.body); return result.json();
    };
    const first = await create("Usuario de prueba uno"), second = await create("Usuario de prueba dos"), supervisor = await create("Supervisor de prueba", "supervisor");
    const supervisorToken = (await login(supervisor.email, "Synthetic-Permissions-2026!")).json().token;
    const getProfile = async (id = first.id) => {
      const result = await app.inject({ url: `/api/usuarios/${id}/permisos`, headers: { authorization: `Bearer ${adminToken}` } });
      assert.equal(result.statusCode, 200, result.body); return result.json();
    };
    const fixture = path.join(output, "fixture.tsx"), source = (name: string) => JSON.stringify(path.join(root, "src", name).replaceAll("\\", "/"));
    fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ConnectedCatalog } from ${source("ConnectedCatalog.tsx")};
import { setToken, api } from ${source("api.ts")};
import ${source("styles.css")};
setToken(${JSON.stringify(adminToken)});
const snapshot = await api("/snapshot");
function Fixture(){
 const [actor,setActor] = useState({id:"demo-admin",canEdit:true});
 window.__qaSupervisor = () => { setToken(${JSON.stringify(supervisorToken)}); setActor({id:${JSON.stringify(supervisor.id)},canEdit:false}); };
 return <main><ConnectedCatalog key={actor.id} page="users" snapshot={snapshot} actorId={actor.id} canManagePermissions={actor.canEdit} onRefresh={()=>{}} /></main>;
}
createRoot(document.getElementById("root")).render(<Fixture />);`, "utf8");
    const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(localRequire.resolve("@tailwindcss/vite")).href), import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react(), tailwind()], define: { "process.env.NODE_ENV": JSON.stringify("production") }, logLevel: "error", build: { target: "esnext", outDir: path.join(output, "dist"), emptyOutDir: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (pathname.startsWith("/api/")) {
          const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
          const result = await app.inject({ method: request.method as "GET" | "POST", url: request.url!, headers: request.headers, ...(body !== undefined ? { payload: body } : {}) });
          if (request.method === "POST") writes.push({ path: pathname, key: String(request.headers["idempotency-key"] ?? ""), body, status: result.statusCode });
          if (request.method === "POST" && pathname.endsWith("/permisos") && loseNextResponse) { loseNextResponse = false; response.writeHead(503, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "Respuesta de guardado perdida en prueba." } })); return; }
          response.writeHead(result.statusCode, { "Content-Type": "application/json" }); response.end(result.body); return;
        }
        if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>'); return; }
        if (["/fixture.js", "/fixture.css"].includes(pathname)) { response.writeHead(200, { "Content-Type": pathname.endsWith(".js") ? "text/javascript" : "text/css" }); response.end(fs.readFileSync(path.join(output, "dist", pathname.slice(1)))); return; }
        const asset = path.join(output, "dist", pathname);
        if (pathname.startsWith("/assets/") && !pathname.includes("..") && fs.existsSync(asset)) { response.writeHead(200); response.end(fs.readFileSync(asset)); return; }
        response.writeHead(404); response.end();
      } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: { message: String(error) } })); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    await context.route("**/*", (route: any) => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort("blockedbyclient"); }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(origin);
    const dialog = () => page.getByRole("dialog", { name: "Permisos del Usuario...", exact: true });
    const checkbox = (id: number) => dialog().getByRole("checkbox", { name: new RegExp(`^Permiso ${id}:`) });
    const category = () => dialog().getByRole("combobox", { name: "Categoría", exact: true });
    const open = async (name = first.name) => {
      await page.getByRole("cell", { name, exact: true }).click();
      await page.getByRole("button", { name: "Permisos", exact: true }).click();
      await dialog().waitFor(); await page.waitForFunction(() => !document.querySelector('.connected-user-permissions-dialog')?.textContent?.includes("Cargando permisos…"));
      assert.equal(await dialog().getByRole("alert").count(), 0);
    };

    await t.test("complete catalog, draggable title, blocked background and category-only bulk toggles", async () => {
      await open();
      assert.equal(await dialog().getByRole("checkbox").count(), 119);
      const names = await dialog().locator("tbody tr").evaluateAll((rows: HTMLTableRowElement[]) => rows.map((row) => ({ id: Number(row.cells[1].textContent), name: row.cells[2].textContent, category: row.cells[3].textContent })));
      assert.deepEqual(names, catalog.permissions);
      assert.deepEqual(await category().locator("option").allTextContents(), catalog.categories);
      const title = dialog().locator(".legacy-dialog-titlebar"), before = await dialog().boundingBox(), bar = await title.boundingBox(); assert(bar && before);
      await page.mouse.move(bar.x + 110, bar.y + 12); await page.mouse.down(); await page.mouse.move(bar.x + 195, bar.y + 42); await page.mouse.up();
      const after = await dialog().boundingBox(); assert(after); assert.ok(after.x > before.x + 70); assert.ok(after.y > before.y + 20);
      const background = await page.getByRole("button", { name: "Permisos", exact: true }).boundingBox(); assert(background);
      assert.equal(await page.evaluate(({ x, y }: { x: number; y: number }) => Boolean(document.elementFromPoint(x, y)?.closest(".legacy-dialog-overlay")), { x: background.x + 2, y: background.y + 2 }), true);
      await category().selectOption("Monitoreo"); await dialog().getByRole("button", { name: "Seleccionar Todos", exact: true }).click();
      assert.equal(await checkbox(500).isChecked(), true); assert.equal(await checkbox(501).isChecked(), true);
      await category().selectOption("Sistema"); await checkbox(2).check();
      await dialog().getByRole("button", { name: "Desmarcar Todos", exact: true }).click();
      await category().selectOption("No definido");
      assert.equal(await checkbox(2).isChecked(), false); assert.equal(await checkbox(501).isChecked(), true);
      await category().selectOption("Otros"); await dialog().getByText("No hay permisos en esta categoría.").waitFor();
      await category().selectOption("No definido");
      await page.screenshot({ path: path.join(output, "permissions-dialog.png") });
      await dialog().getByRole("button", { name: "Cancelar", exact: true }).click(); await dialog().waitFor({ state: "detached" });
      assert.equal(writes.length, 0); assert.deepEqual((await getProfile()).permissionIds, []);
    });
    await t.test("Save persists to the selected user, reopen reloads, Cancel/Escape/X discard unsaved edits", async () => {
      const sessions = structuredClone((await store.read()).adminTools.sessions);
      await open(); await category().selectOption("Monitoreo"); await dialog().getByRole("button", { name: "Seleccionar Todos", exact: true }).click();
      await dialog().getByRole("button", { name: "Guardar", exact: true }).click(); await dialog().waitFor({ state: "detached" });
      assert.equal(writes.length, 1); assert.equal(writes[0].path, `/api/usuarios/${first.id}/permisos`);
      assert.deepEqual(writes[0].body, { permissionIds: [500, 501], revision: 0 }); assert.ok(writes[0].key.length >= 8);
      assert.deepEqual((await getProfile()).permissionIds, [500, 501]); assert.deepEqual((await getProfile(second.id)).permissionIds, []);
      assert.deepEqual((await store.read()).adminTools.sessions, sessions);
      assert.equal(await page.evaluate(() => localStorage.getItem("cyp-admin-token")), adminToken);
      await open(); assert.equal(await checkbox(501).isChecked(), true); await checkbox(501).uncheck(); await page.keyboard.press("Escape");
      await dialog().waitFor({ state: "detached" }); assert.deepEqual((await getProfile()).permissionIds, [500, 501]);
      await open(second.name); assert.equal(await checkbox(501).isChecked(), false); await checkbox(1).check();
      await dialog().getByRole("button", { name: "Cerrar Permisos del Usuario...", exact: true }).click(); await dialog().waitFor({ state: "detached" });
      assert.deepEqual((await getProfile(second.id)).permissionIds, []); assert.equal(writes.length, 1);
    });
    await t.test("a stale editor reports conflict, retains its draft and can reload the newer backend revision", async () => {
      await open(); await checkbox(2).check();
      const profile = await getProfile(); assert.equal((await post(`/api/usuarios/${first.id}/permisos`, { permissionIds: [1], revision: profile.revision })).statusCode, 200);
      await dialog().getByRole("button", { name: "Guardar", exact: true }).click();
      await dialog().getByRole("alert").getByText("Otro operador modificó los permisos. Refresca el catálogo antes de guardar.").waitFor();
      assert.equal(await checkbox(2).isChecked(), true); assert.deepEqual((await getProfile()).permissionIds, [1]);
      await dialog().getByRole("button", { name: "Refrescar", exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.connected-user-permissions-dialog')?.textContent?.includes("Cargando permisos…"));
      assert.equal(await checkbox(1).isChecked(), true); assert.equal(await checkbox(2).isChecked(), false);
      await dialog().getByRole("button", { name: "Cancelar", exact: true }).click();
    });
    await t.test("lost save replies freeze the submitted draft and retry the same key without duplicate writes", async () => {
      await open(); await checkbox(2).check(); const count = writes.length;
      loseNextResponse = true;
      await dialog().getByRole("button", { name: "Guardar", exact: true }).click();
      await dialog().getByRole("button", { name: "Reintentar guardado", exact: true }).waitFor();
      assert.equal(await checkbox(2).isDisabled(), true); assert.equal(await dialog().getByRole("button", { name: "Cancelar", exact: true }).isDisabled(), true);
      const committed = await store.read();
      await dialog().getByRole("button", { name: "Reintentar guardado", exact: true }).click(); await dialog().waitFor({ state: "detached" });
      const attempts = writes.slice(count); assert.equal(attempts.length, 2); assert.equal(attempts[0].key, attempts[1].key); assert.deepEqual(attempts[0].body, attempts[1].body);
      assert.deepEqual(await store.read(), committed); assert.deepEqual((await getProfile()).permissionIds, [1, 2]);
    });
    await t.test("Supervisor can inspect but cannot toggle, bulk-select or submit permissions", async () => {
      await page.evaluate(() => (window as any).__qaSupervisor()); await open(); const count = writes.length;
      assert.equal(await checkbox(1).isDisabled(), true);
      for (const name of ["Seleccionar Todos", "Desmarcar Todos", "Guardar"]) assert.equal(await dialog().getByRole("button", { name, exact: true }).isDisabled(), true);
      await dialog().getByRole("button", { name: "Cancelar", exact: true }).click(); assert.equal(writes.length, count);
    });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    t.diagnostic(`Synthetic UI artifacts: ${output}`);
  } finally {
    await context?.close(); await browser?.close();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await app.close();
  }
});
