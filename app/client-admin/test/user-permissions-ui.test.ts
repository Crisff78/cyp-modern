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
import { roleRemittancePermissions } from "../../shared/access.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(root, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined; }
const available = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);
const knownAntivirusOrigin = "http://me.kis.v2.scr.kaspersky-labs.com";
const isKnownAntivirusOrigin = (destination: URL) => destination.origin === knownAntivirusOrigin;

test("antivirus classification accepts only the observed exact origin", () => {
  assert.equal(isKnownAntivirusOrigin(new URL(knownAntivirusOrigin)), true);
  for (const origin of ["https://me.kis.v2.scr.kaspersky-labs.com", "http://me.kis.v2.scr.kaspersky-labs.com:81",
    "http://me.kis.v2.scr.kaspersky-labs.com.example.invalid", "http://example.invalid", "http://gc.kis.v2.scr.kaspersky-labs.com"])
    assert.equal(isKnownAntivirusOrigin(new URL(origin)), false);
});

// Actual connected user catalog, draggable dialog, CSS, auth, Zod and API.
// Only an isolated MemoryStore, synthetic accounts and a fresh browser profile.
test("user permission checkboxes, categories, cancel and backend saves work in the active UI", { skip: available ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-permissions-ui-"));
  const store = new MemoryStore(seed());
  const app = await buildApp({ store, demo: true, secret: "synthetic-permissions-browser-secret-at-least-32-characters", origins: [], collectorUrl: "http://localhost:5174" });
  let browser: any, context: any, server: ReturnType<typeof createServer> | undefined;
  const writes: Array<{ path: string; key: string; body: unknown; status: number }> = [];
  const errors: string[] = [];
  let blockedAntivirusAttempts = 0, unexpectedExternalAttempts = 0;
  let loseNextResponse = false;
  try {
    const login = (email: string, password: string) => app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const adminToken = (await login("admin@cyp.local", "Demo-CyP-2026!")).json().token as string;
    const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object, headers: { authorization: `Bearer ${adminToken}`, "idempotency-key": randomUUID() } });
    const create = async (name: string, role = "admin") => {
      const result = await post("/api/usuarios", { name, email: `qa-${randomUUID()}@example.invalid`, role, password: "Synthetic-Permissions-2026!" });
      assert.equal(result.statusCode, 200, result.body); return result.json();
    };
    const first = await create("Usuario de prueba uno"), second = await create("Usuario de prueba dos"), supervisor = await create("Supervisor de prueba", "supervisor"), cashier = await create("Cajero de prueba", "cashier");
    const reviewedUser = await create("Usuario de permisos paso a paso");
    // A Cajero personalized down to «Entrar al sistema», as an office account with nothing granted yet.
    await store.transaction((state) => { const account = state.accounts.find(({ id }) => id === cashier.id)!; account.permissionMode = "custom"; account.permissionIds = [1]; account.remittancePermissions = []; });
    const cashierRole = await create("Cajero con perfil de rol", "cashier");
    // An account carried over by the 034 migration: «Perfil del rol» with its earlier, referential list.
    const migrated = await create("Cuenta migrada", "supervisor");
    const limited = await create("Administración limitada"), delegate = await create("Administración delegada");
    await store.transaction((state) => { for (const account of state.accounts.filter(({ id }) => [first.id, second.id, reviewedUser.id].includes(id))) { account.permissionMode = "custom"; account.permissionIds = []; account.remittancePermissions = []; } });
    await store.transaction((state) => { const account = state.accounts.find(({ id }) => id === migrated.id)!; account.permissionMode = "role"; account.permissionIds = [1, 2, 140, 141, 400]; account.remittancePermissions = []; });
    assert.equal((await post(`/api/usuarios/${limited.id}/permisos`, { mode: "custom", permissionIds: [1, 10, 101, 103, 104, 107], remittancePermissions: [], revision: 0 })).statusCode, 200);
    const supervisorToken = (await login(supervisor.email, "Synthetic-Permissions-2026!")).json().token;
    const limitedToken = (await login(limited.email, "Synthetic-Permissions-2026!")).json().token, delegateToken = (await login(delegate.email, "Synthetic-Permissions-2026!")).json().token;
    const getProfile = async (id = first.id) => {
      const result = await app.inject({ url: `/api/usuarios/${id}/permisos`, headers: { authorization: `Bearer ${adminToken}` } });
      assert.equal(result.statusCode, 200, result.body); return result.json();
    };
    const fixture = path.join(output, "fixture.tsx"), source = (name: string) => JSON.stringify(path.join(root, "src", name).replaceAll("\\", "/"));
    fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ConnectedCatalog } from ${source("ConnectedCatalog.tsx")};
import { PageAccessContext } from ${source("PageAccess.tsx")};
import { hasUnresolvedMovementRequest } from ${source("useMovementRequest.ts")};
import { setToken, api } from ${source("api.ts")};
import ${source("styles.css")};
setToken(${JSON.stringify(adminToken)});
const snapshot = await api("/snapshot");
function Fixture(){
 const [actor,setActor] = useState({id:"demo-admin",canEdit:true});
 window.__qaSupervisor = () => { setToken(${JSON.stringify(supervisorToken)}); setActor({id:${JSON.stringify(supervisor.id)},canEdit:false}); };
 window.__qaActor = (token, id) => { setToken(token); setActor({id,canEdit:true}); };
 window.__qaUnresolved = (id) => hasUnresolvedMovementRequest(id);
 return <main><PageAccessContext.Provider value={{actor:{role:actor.canEdit?'admin':'supervisor'},page:'users'}}><ConnectedCatalog key={actor.id} page="users" snapshot={snapshot} actorId={actor.id} canManagePermissions={actor.canEdit} onRefresh={()=>{}} /></PageAccessContext.Provider></main>;
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
      const destination = new URL(route.request().url());
      if (destination.origin !== origin) {
        // Abort every external request; keep anonymous counts without injected
        // script paths, attributes, URLs or arbitrary origin names in evidence.
        if (isKnownAntivirusOrigin(destination)) blockedAntivirusAttempts += 1;
        else unexpectedExternalAttempts += 1;
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(origin);
    const dialog = () => page.getByRole("dialog", { name: "Permisos del Usuario...", exact: true });
    const checkbox = (id: number) => dialog().getByRole("checkbox", { name: new RegExp(`^Permiso ${id}:`) });
    const category = () => dialog().getByRole("combobox", { name: "Categoría", exact: true });
    const assigned = () => dialog().getByRole("region", { name: "Permisos asignados", exact: true });
    const permissionName = (id: number) => catalog.permissions.find((permission) => permission.id === id)!.name;
    const row = (id: number) => checkbox(id).locator("xpath=ancestor::tr");
    const cancel = async () => {
      await dialog().getByRole("button", { name: "Cancelar", exact: true }).click();
      await dialog().waitFor({ state: "detached" });
    };
    const saveAndStay = async (name = "Guardar") => {
      const reply = page.waitForResponse((response: any) => response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/permisos") && response.status() === 200);
      await dialog().getByRole("button", { name, exact: true }).click();
      await reply;
      await dialog().getByRole("status").filter({ hasText: "Permisos guardados" }).waitFor();
      assert.equal(await dialog().isVisible(), true, "saving must keep the permissions workspace open");
    };
    const saveAndClose = async (name = "Guardar") => { await saveAndStay(name); await cancel(); };
    const open = async (name = first.name) => {
      await page.getByRole("cell", { name, exact: true }).click();
      await page.getByRole("button", { name: "Permisos", exact: true }).click();
      await dialog().waitFor(); await page.waitForFunction(() => !document.querySelector('.connected-user-permissions-dialog')?.textContent?.includes("Cargando permisos…"));
      assert.equal(await dialog().getByRole("alert").count(), 0);
    };

    await t.test("complete catalog, draggable title, blocked background and category-only bulk toggles", async () => {
      await open();
      assert.equal(await dialog().getByRole("checkbox", { name: /^Permiso / }).count(), 119);
      assert.equal(await dialog().getByRole("checkbox", { name: /^Remesas: / }).count(), 14);
      const names = await dialog().locator("tbody tr").filter({ has: page.locator('input[aria-label^="Permiso "]') }).evaluateAll((rows: HTMLTableRowElement[]) => rows.map((row) => ({ id: Number(row.cells[1].textContent), name: row.cells[2].textContent, category: row.cells[3].textContent })));
      assert.deepEqual(names, catalog.permissions);
      assert.deepEqual(await category().locator("option").allTextContents(), [...catalog.categories, "Remesas"]);
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
      await saveAndClose();
      assert.equal(writes.length, 1); assert.equal(writes[0].path, `/api/usuarios/${first.id}/permisos`);
      assert.deepEqual(writes[0].body, { permissionIds: [500, 501], revision: 0, mode: "custom", remittancePermissions: [] }); assert.ok(writes[0].key.length >= 8);
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
      // Refrescar starts the reload on the next render: wait until the newer revision is shown, not only until no load is visible.
      for (const deadline = Date.now() + 5000; Date.now() < deadline && !(await checkbox(1).isChecked());) await page.waitForTimeout(50);
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
      await saveAndClose("Reintentar guardado");
      const attempts = writes.slice(count); assert.equal(attempts.length, 2); assert.equal(attempts[0].key, attempts[1].key); assert.deepEqual(attempts[0].body, attempts[1].body);
      assert.deepEqual(await store.read(), committed); assert.deepEqual((await getProfile()).permissionIds, [1, 2]);
    });
    await t.test("rows, labels and checkboxes toggle once and the assigned review survives category changes without saving", async () => {
      const count = writes.length, before = await getProfile(reviewedUser.id);
      await open(reviewedUser.name);
      assert.equal(await dialog().getByRole("columnheader", { name: "Asignado", exact: true }).count(), 1);
      await category().selectOption("Sistema");
      await row(2).locator("td").nth(1).click();
      assert.equal(await checkbox(2).isChecked(), true, "clicking the code grants the row once");
      assert.equal(await row(2).getByRole("cell", { name: "Por agregar", exact: true }).count(), 1);
      assert.equal(await assigned().getByRole("button", { name: `Quitar permiso: ${permissionName(2)}`, exact: true }).count(), 1);
      await row(2).locator("td").nth(3).click();
      assert.equal(await checkbox(2).isChecked(), false, "clicking the category removes it once");
      await row(2).focus(); await row(2).press("Space");
      assert.equal(await checkbox(2).isChecked(), true, "Space toggles a focused row");
      await row(2).press("Enter");
      assert.equal(await checkbox(2).isChecked(), false, "Enter toggles a focused row");
      await row(2).locator("label").click();
      assert.equal(await checkbox(2).isChecked(), true, "a label's native checkbox click must not be toggled again by its row");
      await checkbox(2).click();
      assert.equal(await checkbox(2).isChecked(), false, "a direct checkbox click must not be toggled again by its row");
      await category().selectOption("Remesas");
      const view = dialog().getByRole("checkbox", { name: "Remesas: Ver envíos de dinero", exact: true });
      const viewRow = view.locator("xpath=ancestor::tr");
      await viewRow.locator("td").nth(1).click(); assert.equal(await view.isChecked(), true);
      await viewRow.locator("label").click(); assert.equal(await view.isChecked(), false);
      await viewRow.focus(); await viewRow.press("Space"); assert.equal(await view.isChecked(), true);
      await category().selectOption("Monitoreo"); await checkbox(501).check();
      assert.equal(await assigned().getByRole("button", { name: "Quitar permiso: Ver envíos de dinero", exact: true }).count(), 1);
      assert.equal(await assigned().getByRole("button", { name: `Quitar permiso: ${permissionName(501)}`, exact: true }).count(), 1);
      assert.match(await assigned().innerText(), /Por agregar/);
      await category().selectOption("Sistema");
      assert.equal(await assigned().getByRole("button", { name: `Quitar permiso: ${permissionName(501)}`, exact: true }).count(), 1, "the review lists selected permissions from every category");
      await page.setViewportSize({ width: 800, height: 700 });
      try {
        const bounds = await dialog().boundingBox(), review = await assigned().boundingBox(); assert(bounds && review);
        assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= 801, "the permissions window stays inside the narrow viewport");
        assert.ok(review.height >= 80, "the review remains visible with its own scroll area");
        const footer = await dialog().getByRole("button", { name: "Cancelar", exact: true }).boundingBox(); assert(footer);
        assert.ok(footer.y >= 0 && footer.y + footer.height <= 701, "the dialog's closing action stays reachable");
        await page.screenshot({ path: path.join(output, "permissions-workspace-narrow.png") });
      } finally { await page.setViewportSize({ width: 1280, height: 900 }); }
      await cancel();
      assert.equal(writes.length, count); assert.deepEqual(await getProfile(reviewedUser.id), before);
    });
    await t.test("consecutive saves stay open with fresh revisions, mark existing grants and preserve the last saved selection on Cancel", async () => {
      const count = writes.length, other = await getProfile(first.id);
      await open(reviewedUser.name); await category().selectOption("Sistema"); await checkbox(2).check();
      await saveAndStay();
      assert.deepEqual(writes[count].body, { permissionIds: [2], revision: 0, mode: "custom", remittancePermissions: [] });
      assert.equal(writes[count].path, `/api/usuarios/${reviewedUser.id}/permisos`);
      assert.equal((await getProfile(reviewedUser.id)).revision, 1);
      assert.equal(await row(2).getByRole("cell", { name: "Ya asignado", exact: true }).count(), 1);
      assert.match(await assigned().innerText(), /Guardado/);
      await category().selectOption("Monitoreo"); await checkbox(501).check();
      assert.equal(await assigned().getByRole("button", { name: `Quitar permiso: ${permissionName(2)}`, exact: true }).count(), 1);
      assert.match(await assigned().innerText(), /Por agregar/);
      await saveAndStay();
      assert.deepEqual(writes[count + 1].body, { permissionIds: [2, 501], revision: 1, mode: "custom", remittancePermissions: [] });
      assert.notEqual(writes[count].key, writes[count + 1].key, "each confirmed change is a new operation, not a retry of the previous save");
      let profile = await getProfile(reviewedUser.id);
      assert.deepEqual(profile.permissionIds, [2, 501]); assert.equal(profile.revision, 2);
      assert.equal(await row(501).getByRole("cell", { name: "Ya asignado", exact: true }).count(), 1);
      await page.screenshot({ path: path.join(output, "permissions-workspace-assigned.png") });
      await assigned().getByRole("button", { name: `Quitar permiso: ${permissionName(2)}`, exact: true }).click();
      await category().selectOption("Sistema"); assert.equal(await checkbox(2).isChecked(), false);
      assert.equal(await row(2).getByRole("cell", { name: "Por quitar", exact: true }).count(), 1);
      await assigned().getByRole("button", { name: `Restaurar permiso: ${permissionName(2)}`, exact: true }).click();
      assert.equal(await checkbox(2).isChecked(), true);
      assert.deepEqual((await getProfile(reviewedUser.id)).permissionIds, [2, 501], "reviewing removal and restoring it does not write");
      await assigned().getByRole("button", { name: `Quitar permiso: ${permissionName(2)}`, exact: true }).click();
      await saveAndStay();
      assert.deepEqual(writes[count + 2].body, { permissionIds: [501], revision: 2, mode: "custom", remittancePermissions: [] });
      assert.equal(new Set(writes.slice(count).map(({ key }) => key)).size, 3);
      assert.equal(await assigned().getByRole("button", { name: `Restaurar permiso: ${permissionName(2)}`, exact: true }).count(), 0);
      profile = await getProfile(reviewedUser.id); assert.deepEqual(profile.permissionIds, [501]); assert.equal(profile.revision, 3);
      await category().selectOption("Monitoreo"); await checkbox(500).check(); await cancel();
      assert.deepEqual(await getProfile(reviewedUser.id), profile, "Cancel discards only the changes made after the latest successful save");
      assert.deepEqual(await getProfile(first.id), other, "another account's grants are untouched");
      assert.equal(writes.length, count + 3);
      await open(reviewedUser.name); await category().selectOption("Monitoreo");
      assert.equal(await checkbox(501).isChecked(), true); assert.equal(await checkbox(500).isChecked(), false);
      assert.equal(await row(501).getByRole("cell", { name: "Ya asignado", exact: true }).count(), 1);
      assert.equal(await assigned().getByRole("button", { name: `Quitar permiso: ${permissionName(501)}`, exact: true }).count(), 1, "the existing grant is shown once after reopening");
      await cancel();
    });
    await t.test("office cashier grants add their read dependency without granting catalog administration", async () => {
      await open(cashier.name);
      assert.equal(await checkbox(101).isDisabled(), true); assert.equal(await checkbox(141).isDisabled(), true);
      assert.equal(await row(101).getByRole("cell", { name: "No disponible para el rol", exact: true }).count(), 1);
      assert.equal(await row(101).getAttribute("title"), "El rol de esta cuenta no permite activar este permiso.");
      await row(101).locator("td").nth(1).click(); await row(101).focus(); await row(101).press("Enter");
      assert.equal(await checkbox(101).isChecked(), false, "a row click or keyboard shortcut cannot bypass the role restriction");
      await category().selectOption("Remesas");
      await dialog().getByRole("checkbox", { name: "Remesas: Registrar envíos de dinero", exact: true }).check();
      assert.equal(await dialog().getByRole("checkbox", { name: "Remesas: Ver envíos de dinero", exact: true }).isChecked(), true);
      assert.equal(await dialog().getByRole("checkbox", { name: "Remesas: Cambiar tasas de remesas", exact: true }).isDisabled(), true);
      await saveAndClose();
      const profile = await getProfile(cashier.id);
      assert.deepEqual(profile.permissionIds, [1]); assert.equal(profile.mode, "custom");
      assert.deepEqual(profile.remittancePermissions, ["remittances.create", "remittances.view"]);
      assert.equal((await store.read()).accounts.find(({ id }) => id === cashier.id)?.role, "cashier");
    });
    await t.test("a Cajero in Perfil del rol shows its initial profile and can only add the reports of Envíos", async () => {
      await open(cashierRole.name);
      assert.equal(await dialog().getByRole("combobox", { name: "Modo de permisos", exact: true }).inputValue(), "role");
      assert.match(await dialog().innerText(), /Se aplica el perfil inicial del rol\./);
      for (const id of [1, 2]) assert.equal(await checkbox(id).isChecked(), true, `legacy ${id}`);
      for (const id of [101, 140, 200, 401]) assert.equal(await checkbox(id).isDisabled(), true, `legacy ${id} stays out of reach`);
      await category().selectOption("Remesas");
      const remittance = (name: string) => dialog().getByRole("checkbox", { name: `Remesas: ${name}`, exact: true });
      for (const name of ["Ver envíos de dinero", "Registrar envíos de dinero", "Ver remesas por entregar", "Entregar dinero al destinatario", "Cancelar envíos pendientes",
        "Registrar clientes durante un envío", "Ver caja de remesas", "Abrir cajas de remesas", "Cerrar su propia caja de remesas"])
        assert.equal(await remittance(name).isChecked(), true, name);
      const reports = remittance("Ver e imprimir reportes de remesas");
      assert.equal(await reports.isChecked(), false); assert.equal(await reports.isDisabled(), false);
      for (const name of ["Ver tasas de remesas", "Cambiar tasas de remesas", "Ver comisiones de remesas", "Cambiar comisiones de remesas"])
        assert.equal(await remittance(name).isDisabled(), true, `${name} is administrative`);
      await reports.check();
      assert.equal(await dialog().getByRole("combobox", { name: "Modo de permisos", exact: true }).inputValue(), "custom");
      await saveAndClose();
      const profile = await getProfile(cashierRole.id);
      assert.equal(profile.mode, "custom"); assert.deepEqual(profile.permissionIds, [1, 2]);
      assert.deepEqual(profile.remittancePermissions, ["remittances.cancel", "remittances.cash.close", "remittances.cash.open", "remittances.cash.view", "remittances.clients.create",
        "remittances.create", "remittances.pay", "remittances.receipts", "remittances.reports", "remittances.view"]);
      assert.equal((await store.read()).accounts.find(({ id }) => id === cashierRole.id)?.role, "cashier");
    });
    // The Cajero saved above uses its profile plus the reports of Envíos.
    const cashierReports = () => dialog().getByRole("checkbox", { name: "Remesas: Ver e imprimir reportes de remesas", exact: true });
    const personalizedCashier = [...roleRemittancePermissions("cashier"), "remittances.reports"].sort();
    await t.test("a personalized account taken to «Perfil del rol» and back, without saving, shows again the selection it was loaded with", async () => {
      await open(cashierRole.name);
      const count = writes.length;
      try {
        const mode = dialog().getByRole("combobox", { name: "Modo de permisos", exact: true });
        assert.equal(await mode.inputValue(), "custom"); assert.equal(await cashierReports().isChecked(), true);
        await mode.selectOption("role"); assert.equal(await cashierReports().isChecked(), false, "the role profile is shown");
        await mode.selectOption("custom"); assert.equal(await cashierReports().isChecked(), true, "back to the personalized selection that was loaded");
      } finally { await dialog().getByRole("button", { name: "Cancelar", exact: true }).click(); await dialog().waitFor({ state: "detached" }); }
      assert.equal(writes.length, count);
    });
    await t.test("«Perfil del rol» keeps the personalized keys of Envíos as an earlier selection that is adopted again with them", async () => {
      await open(cashierRole.name);
      const mode = dialog().getByRole("combobox", { name: "Modo de permisos", exact: true });
      const stored = dialog().getByRole("group", { name: "Selección anterior de permisos", exact: true });
      await mode.selectOption("role");
      const count = writes.length;
      await saveAndClose();
      const { mode: sentMode, permissionIds, remittancePermissions } = writes[count].body as { mode: string; permissionIds: number[]; remittancePermissions: string[] };
      assert.deepEqual([sentMode, permissionIds, remittancePermissions], ["role", [1, 2], personalizedCashier], "the saved lists go back unchanged");
      let profile = await getProfile(cashierRole.id);
      assert.deepEqual([profile.mode, profile.remittancePermissions], ["role", personalizedCashier]);
      await open(cashierRole.name);
      assert.equal(await mode.inputValue(), "role"); assert.equal(await cashierReports().isChecked(), false, "the role profile is what applies");
      assert.match(await stored.innerText(), /Remesas: .*Ver e imprimir reportes de remesas/);
      await stored.getByRole("button", { name: "Aplicar selección anterior", exact: true }).click();
      assert.equal(await mode.inputValue(), "custom"); assert.equal(await cashierReports().isChecked(), true);
      await saveAndClose();
      profile = await getProfile(cashierRole.id);
      assert.deepEqual([profile.mode, profile.permissionIds, profile.remittancePermissions], ["custom", [1, 2], personalizedCashier]);
    });
    await t.test("U1 a migrated account in «Perfil del rol» shows its earlier list, keeps it when saving and adopts it only on request", async () => {
      await open(migrated.name);
      const mode = dialog().getByRole("combobox", { name: "Modo de permisos", exact: true });
      const stored = dialog().getByRole("group", { name: "Selección anterior de permisos", exact: true });
      assert.equal(await mode.inputValue(), "role");
      assert.match(await stored.innerText(), /conserva una selección anterior de 5 permisos que no se aplica mientras use «Perfil del rol»/);
      assert.match(await stored.innerText(), /Códigos: 1, 2, 140, 141, 400\./);
      assert.match(await stored.innerText(), /Fuera del alcance del rol, no se aplicarán: 141\./);
      assert.equal(await checkbox(101).isChecked(), true, "the table shows the role profile, which is what applies");
      await page.screenshot({ path: path.join(output, "permissions-earlier-list.png") });
      const count = writes.length;
      await saveAndClose();
      assert.deepEqual(writes[count].body, { permissionIds: [1, 2, 140, 141, 400], revision: 0, mode: "role", remittancePermissions: [...roleRemittancePermissions("supervisor")].sort() });
      let profile = await getProfile(migrated.id);
      assert.equal(profile.mode, "role"); assert.deepEqual(profile.permissionIds, [1, 2, 140, 141, 400], "saving with the role profile keeps the earlier list");
      await open(migrated.name);
      await stored.getByRole("button", { name: "Aplicar selección anterior", exact: true }).click();
      assert.equal(await mode.inputValue(), "custom");
      for (const id of [1, 2, 140, 400]) assert.equal(await checkbox(id).isChecked(), true, `kept ${id}`);
      for (const id of [101, 141, 500]) assert.equal(await checkbox(id).isChecked(), false, `not in the earlier list or out of reach: ${id}`);
      assert.match(await stored.innerText(), /Al guardar, los permisos marcados la sustituirán\./);
      // U5: the legacy report codes are kept but do not open or hide reports by themselves.
      assert.match(await dialog().innerText(), /Los códigos 410–415 \(reportes del sistema anterior\) se conservan, pero los reportes se abren con «Visualizar Reportes» \(400\)/);
      await saveAndClose();
      profile = await getProfile(migrated.id);
      assert.equal(profile.mode, "custom"); assert.deepEqual(profile.permissionIds, [1, 2, 140, 400]);
      assert.equal((await store.read()).accounts.find(({ id }) => id === migrated.id)?.role, "supervisor");
    });
    await t.test("S1 a limited administrator gets the server's reason when the account has permissions it lacks", async () => {
      const credentials = (await store.read()).accounts.find(({ id }) => id === supervisor.id)?.credentialVersion;
      await page.evaluate(({ token, id }: { token: string; id: string }) => (window as any).__qaActor(token, id), { token: limitedToken, id: limited.id });
      await page.getByRole("cell", { name: supervisor.name, exact: true }).click();
      await page.getByRole("button", { name: "Cambiar Clave", exact: true }).click();
      const password = page.getByRole("dialog", { name: "Cambiar clave de usuario...", exact: true });
      await password.getByLabel("Clave:").fill("Synthetic-Takeover-2026!"); await password.getByLabel("Confirmación:").fill("Synthetic-Takeover-2026!");
      await password.getByRole("button", { name: "Aceptar", exact: true }).click();
      await password.getByRole("alert").getByText("Esa cuenta tiene permisos que la tuya no tiene. Solo puede gestionarla una cuenta que tenga todos sus permisos.", { exact: true }).waitFor();
      assert.equal(await password.getByRole("button", { name: "Aceptar", exact: true }).isEnabled(), true, "a definitive answer, not an operation to retry");
      await password.getByRole("button", { name: "Cancelar", exact: true }).click(); await password.waitFor({ state: "detached" });
      assert.equal((await store.read()).accounts.find(({ id }) => id === supervisor.id)?.credentialVersion, credentials);
    });
    await t.test("U3 Supervisor consults a user's data read-only", async () => {
      await page.evaluate(() => (window as any).__qaSupervisor());
      await page.getByRole("cell", { name: first.name, exact: true }).click();
      await page.getByTitle("Consultar", { exact: true }).click();
      const ficha = page.getByRole("dialog", { name: "Datos de Usuario...", exact: true });
      await ficha.getByText("Solo consulta: tu cuenta no tiene permiso para modificar este registro.", { exact: true }).waitFor();
      const name = ficha.getByLabel("Nombre", { exact: true });
      assert.equal(await name.inputValue(), first.name); assert.equal(await name.isDisabled(), true);
      assert.equal(await ficha.getByLabel("Rol", { exact: true }).isDisabled(), true);
      assert.equal(await ficha.getByRole("button", { name: "Aceptar", exact: true }).count(), 0);
      await ficha.getByRole("button", { name: "Cerrar", exact: true }).click(); await ficha.waitFor({ state: "detached" });
    });
    await t.test("Supervisor can inspect but cannot toggle, bulk-select or submit permissions", async () => {
      await page.evaluate(() => (window as any).__qaSupervisor()); await open(); const count = writes.length;
      assert.equal(await checkbox(1).isDisabled(), true);
      const original = await checkbox(1).isChecked();
      await row(1).locator("td").nth(1).click(); await row(1).focus(); await row(1).press("Space");
      assert.equal(await checkbox(1).isChecked(), original, "read-only inspection also blocks the new whole-row interaction");
      for (const name of ["Seleccionar Todos", "Desmarcar Todos", "Guardar"]) assert.equal(await dialog().getByRole("button", { name, exact: true }).isDisabled(), true);
      await dialog().getByText("Tu cuenta no tiene permiso para modificar permisos («Modificar permisos de usuario», 106).", { exact: true }).waitFor();
      await dialog().getByRole("button", { name: "Cancelar", exact: true }).click(); assert.equal(writes.length, count);
    });
    await t.test("U9 a retry refused because the permission was withdrawn lets the dialog close and keeps the attempt", async () => {
      await page.evaluate(({ token, id }: { token: string; id: string }) => (window as any).__qaActor(token, id), { token: delegateToken, id: delegate.id });
      await open(second.name); await checkbox(500).check(); const count = writes.length;
      loseNextResponse = true;
      await dialog().getByRole("button", { name: "Guardar", exact: true }).click();
      const retry = dialog().getByRole("button", { name: "Reintentar guardado", exact: true }), cancel = dialog().getByRole("button", { name: "Cancelar", exact: true });
      await retry.waitFor();
      assert.equal(await cancel.isDisabled(), true); assert.equal(await page.evaluate((id: string) => (window as any).__qaUnresolved(id), delegate.id), true);
      // Another administrator withdraws «Modificar permisos de usuario» while the result is unknown.
      const all = catalog.permissions.map(({ id }) => id), current = await getProfile(delegate.id);
      assert.equal((await post(`/api/usuarios/${delegate.id}/permisos`, { mode: "custom", permissionIds: all.filter((id) => id !== 106), remittancePermissions: [], revision: current.revision })).statusCode, 200);
      await retry.click();
      await dialog().getByRole("alert").getByText(/No se pudo confirmar si la operación anterior quedó registrada: pide a Administración que lo revise\. Puedes cerrar esta ventana/).waitFor();
      assert.equal(await cancel.isDisabled(), false, "the dialog can be closed");
      assert.equal(await page.evaluate((id: string) => (window as any).__qaUnresolved(id), delegate.id), false, "its window can be closed too");
      await cancel.click(); await dialog().waitFor({ state: "detached" });
      await page.getByRole("cell", { name: second.name, exact: true }).click(); await page.getByRole("button", { name: "Permisos", exact: true }).click();
      await retry.waitFor();
      assert.equal(await checkbox(500).isChecked(), true); assert.equal(await checkbox(500).isDisabled(), true, "the kept attempt stays frozen");
      // With the permission back, the same key recovers the saved result instead of writing twice.
      const restored = await getProfile(delegate.id);
      assert.equal((await post(`/api/usuarios/${delegate.id}/permisos`, { mode: "role", permissionIds: all, remittancePermissions: [], revision: restored.revision })).statusCode, 200);
      await saveAndClose("Reintentar guardado");
      const attempts = writes.slice(count);
      assert.deepEqual(attempts.map(({ status }) => status), [200, 403, 200]);
      assert.equal(new Set(attempts.map(({ key }) => key)).size, 1);
      assert.deepEqual((await getProfile(second.id)).permissionIds, [500]);
    });
    assert.deepEqual(errors, []); assert.equal(unexpectedExternalAttempts, 0, "The application must not attempt any unexpected external request.");
    t.diagnostic(`Blocked known antivirus attempts: ${blockedAntivirusAttempts}; unexpected external attempts: ${unexpectedExternalAttempts}; no external URLs recorded or requests sent.`);
    t.diagnostic(`Synthetic UI artifacts: ${output}`);
  } finally {
    await context?.close(); await browser?.close();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await app.close();
  }
});
