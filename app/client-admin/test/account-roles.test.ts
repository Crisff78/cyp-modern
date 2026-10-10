import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ACCOUNT_ROLE_OPTIONS, isCollectorAccountRole } from "../../shared/accountRoles";
import { canAccessAdmin, canAccessCollector, enrichUserRole } from "../src/types";
import { buildApp } from "../../server/src/app.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";
import { randomUUID } from "node:crypto";

test("role options and portal guards distinguish eligible accounts without granting Admin", () => {
  assert.deepEqual(ACCOUNT_ROLE_OPTIONS.map((row) => row.label), ["No definido", "Admin", "Supervisor", "Cobrador", "Usuario"]);
  for (const role of ["undefined", "user"]) {
    const actor = enrichUserRole({ id: "QA", name: "QA", role });
    assert.equal(canAccessAdmin(actor), false); assert.equal(canAccessCollector(actor), false);
  }
  for (const role of ["undefined", "supervisor", "collector", "user"]) assert.equal(isCollectorAccountRole(role), true);
  for (const role of ["admin", "ADMIN", "SUPERADMIN", "ROLE_ADMIN", "unknown", "", "__proto__", undefined, null, 1, {}, []]) assert.equal(isCollectorAccountRole(role), false);
});

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined; }
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);

test("actual user forms and collector picker persist real API references in an isolated browser", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-account-roles-"));
  const state = seed(); state.collectors[0].name = "Cobrador QA";
  state.collectors.push({ ...state.collectors[0], id: "qa-inactive-collector", name: "Cobrador inactivo QA", active: false });
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-role-ui-secret-at-least-32-characters", origins: [], collectorUrl: "http://localhost:5174" });
  const { token, user } = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } })).json();
  const samples: Record<string, { id: string; name: string; email: string }> = {};
  for (const role of ["admin", "supervisor", "collector", "user", "undefined"]) {
    const result = await app.inject({ method: "POST", url: "/api/usuarios", headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() }, payload: { name: `Cuenta QA ${role}`, email: `qa-${role}@example.invalid`, role, password: "Qa3+#'", ...(role === "collector" ? { collectorId: "col-1" } : {}) } });
    assert.equal(result.statusCode, 200, result.body); samples[role] = result.json();
  }
  const otherAccount = await app.inject({ method: "POST", url: "/api/usuarios", headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() }, payload: { name: "Cuenta de otro cobrador QA", email: "qa-other@example.invalid", role: "collector", collectorId: "col-2", password: "Qa3+#'" } });
  assert.equal(otherAccount.statusCode, 200, otherAccount.body);
  const disabledAccount = await app.inject({ method: "POST", url: "/api/usuarios", headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() }, payload: { name: "Cuenta inactiva QA", email: "qa-disabled@example.invalid", role: "user", password: "Qa3+#'" } });
  assert.equal(disabledAccount.statusCode, 200, disabledAccount.body);
  const disabled = await app.inject({ method: "POST", url: `/api/usuarios/${disabledAccount.json().id}/estado`, headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() }, payload: { status: "disabled" } });
  assert.equal(disabled.statusCode, 200, disabled.body);
  await store.transaction((current) => { current.collectors[0].accountId = samples.user.id; });
  let browser: any, context: any, server: ReturnType<typeof createServer> | undefined;
  const pageErrors: string[] = [], external: string[] = [], writes: string[] = [];
  try {
    const fixture = path.join(output, "fixture.tsx"), module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
    fs.writeFileSync(fixture, `import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConnectedCatalog } from ${module("ConnectedCatalog.tsx")};
import AccountModal from ${module("Users.tsx")};
import { remittancesApi } from ${module("remittancesApi.ts")};
import ${module("styles.css")};
function Fixture({ initial }) {
 const [view,setView]=useState(new URLSearchParams(location.search).get("view") || "users");
 const [snapshot,setSnapshot]=useState(initial);
 const refresh=()=>{void remittancesApi("/snapshot").then(setSnapshot)};
 return <main>{view === "closed" ? <p>Ventana cerrada</p> : view === "auxiliary" ? <AccountModal operation={{type:"create"}} snapshot={snapshot} actorId=${JSON.stringify(user.id)} onClose={()=>setView("closed")} onComplete={async()=>{}} /> : <ConnectedCatalog key={view} page={view} snapshot={snapshot} actorId=${JSON.stringify(user.id)} onRefresh={refresh} />}</main>;
}
remittancesApi("/snapshot").then(initial=>createRoot(document.getElementById("root")).render(<Fixture initial={initial} />));`, "utf8");
    const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(localRequire.resolve("@tailwindcss/vite")).href), import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react(), tailwind()], define: { "process.env.NODE_ENV": JSON.stringify("production") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    server = createServer(async (req, res) => {
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      try {
        if (pathname.startsWith("/api/")) {
          const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const result = await app.inject({ method: req.method as "GET" | "POST", url: req.url!, headers: req.headers, ...(chunks.length ? { payload: JSON.parse(Buffer.concat(chunks).toString("utf8")) } : {}) });
          if (req.method === "POST") writes.push(pathname);
          res.writeHead(result.statusCode, { "Content-Type": "application/json" }); res.end(result.body); return;
        }
        if (pathname === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end('<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>'); return; }
        const assets = new Map([["/fixture.js", "text/javascript"], ["/fixture.css", "text/css"]]);
        if (assets.has(pathname)) { res.writeHead(200, { "Content-Type": assets.get(pathname)! }); res.end(fs.readFileSync(path.join(output, "dist", pathname.slice(1)))); return; }
        res.writeHead(404); res.end();
      } catch { res.writeHead(500); res.end('{"error":{"message":"Synthetic fixture error"}}'); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-DO", serviceWorkers: "block" });
    await context.addInitScript((value: string) => localStorage.setItem("cyp-admin-token", value), token);
    await context.route("**/*", async (route: any) => { const target = new URL(route.request().url()); if (target.origin !== origin) { external.push(target.origin); return route.abort("blockedbyclient"); } return route.continue(); });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => pageErrors.push(error.message));
    const open = async (view: string) => { await page.goto(`${origin}/?view=${view}`); await (view === "auxiliary" ? page.getByRole("dialog", { name: "Nueva cuenta", exact: true }) : page.getByRole("region", { name: view === "users" ? "Usuarios" : "Cobradores", exact: true })).waitFor(); };
    const roleLabels = async (select: any) => select.locator("option").allTextContents();
    await t.test("main user creation accepts a username without email and edits its identity and role", async () => {
      await open("users"); await page.getByTitle("Nuevo", { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Datos de Usuario...", exact: true }), role = dialog.getByLabel("Rol", { exact: true });
      assert.equal(await role.inputValue(), "undefined"); assert.deepEqual(await roleLabels(role), ACCOUNT_ROLE_OPTIONS.map((row) => row.label));
      assert.equal(await dialog.getByLabel("Cobrador asociado", { exact: true }).count(), 0);
      await role.selectOption("collector");
      const association = dialog.getByLabel("Cobrador asociado", { exact: true });
      assert.equal(await association.inputValue(), "");
      assert.equal(await association.locator('option[value="qa-inactive-collector"]').count(), 0);
      await association.selectOption("col-1"); await role.selectOption("undefined");
      assert.equal(await association.count(), 0);
      await dialog.getByLabel("Nombre", { exact: true }).fill("Cuenta nueva QA");
      const username = dialog.getByLabel("Usuario / correo", { exact: true });
      assert.equal(await username.getAttribute("type"), "text");
      await username.fill("qa.new");
      assert.equal(await username.evaluate((input: HTMLInputElement) => input.checkValidity()), true);
      const password = dialog.getByLabel("Contraseña inicial (mínimo 3 caracteres)", { exact: true });
      assert.equal(await password.getAttribute("maxlength"), "200"); assert.equal(await password.getAttribute("minlength"), "3");
      await password.fill("Qa3+#'"); await dialog.getByRole("button", { name: "oK", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      const created = (await store.read()).accounts.find((row) => row.email === "qa.new")!; assert.equal(created.role, "undefined");
      await page.getByRole("row").filter({ hasText: created.email }).click(); await page.getByTitle("Editar", { exact: true }).click();
      assert.equal(await role.inputValue(), "undefined"); await role.selectOption("supervisor");
      await username.fill("qa.edited");
      await dialog.getByRole("button", { name: "oK", exact: true }).click(); await dialog.waitFor({ state: "detached" });
      const edited = (await store.read()).accounts.find((row) => row.id === created.id)!;
      assert.equal(edited.role, "supervisor"); assert.equal(edited.email, "qa.edited");
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "qa.edited", password: "Qa3+#'" } });
      assert.equal(login.statusCode, 200); assert.equal(login.json().user.id, created.id);
      await page.getByRole("row").filter({ hasText: edited.email }).click(); await page.getByTitle("Editar", { exact: true }).click();
      assert.equal(await role.inputValue(), "supervisor"); await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    });
    await t.test("account picker excludes Admin, blocks the parent, and Cancel/OK keep draft and persisted state separate", async () => {
      await open("collectors"); await page.getByRole("row").filter({ hasText: "Cobrador QA" }).click(); await page.getByTitle("Editar", { exact: true }).click();
      const parent = page.getByRole("dialog", { name: "Datos de Cobrador...", exact: true }), field = parent.getByLabel("Cuenta", { exact: true });
      await parent.getByText(samples.user.email, { exact: true }).waitFor();
      assert.ok(await parent.getByText(/El usuario o correo, rol y contraseña/).isVisible());
      assert.equal(await field.inputValue(), samples.user.name); assert.equal(await field.getAttribute("readonly"), "");
      const launch = () => parent.getByRole("button", { name: "Seleccionar cuenta", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Seleccionar cuenta del cobrador...", exact: true });
      await launch(); await picker.getByText(samples.supervisor.email, { exact: true }).waitFor();
      assert.equal(await picker.getByText(samples.admin.email, { exact: true }).count(), 0);
      assert.equal(await picker.getByText("qa-other@example.invalid", { exact: true }).count(), 0);
      assert.equal(await picker.getByText("qa-disabled@example.invalid", { exact: true }).count(), 0);
      for (const role of ["undefined", "supervisor", "collector", "user"]) assert.equal(await picker.getByText(samples[role].email, { exact: true }).count(), 1);
      const before = writes.length;
      await parent.getByLabel("Nombre", { exact: true }).evaluate((node: HTMLInputElement) => node.focus());
      assert.equal(await picker.evaluate((node: HTMLElement) => node.contains(document.activeElement)), true);
      await picker.getByRole("row").filter({ hasText: samples.supervisor.email }).click();
      await picker.getByRole("button", { name: "Cancelar", exact: true }).click(); await picker.waitFor({ state: "detached" });
      assert.equal(await field.inputValue(), samples.user.name); assert.equal(writes.length, before);
      await launch(); await picker.getByText(samples.supervisor.email, { exact: true }).waitFor();
      await picker.getByLabel("Buscar:", { exact: true }).fill("Cuenta QA supervisor");
      await picker.getByRole("row").filter({ hasText: samples.supervisor.email }).click();
      await page.screenshot({ path: path.join(output, "collector-account-picker.png") });
      await picker.getByRole("button", { name: "OK", exact: true }).click(); await picker.waitFor({ state: "detached" });
      assert.equal(await field.inputValue(), samples.supervisor.name); assert.equal(await field.getAttribute("title"), samples.supervisor.id);
      assert.equal((await store.read()).collectors[0].accountId, samples.user.id); assert.equal(writes.length, before);
      await parent.getByRole("button", { name: "oK", exact: true }).click(); await parent.waitFor({ state: "detached" });
      assert.equal((await store.read()).collectors[0].accountId, samples.supervisor.id);
      await page.getByRole("row").filter({ hasText: "Cobrador QA" }).click(); await page.getByTitle("Editar", { exact: true }).click();
      await launch(); await picker.getByText(samples.collector.email, { exact: true }).waitFor();
      await picker.getByRole("row").filter({ hasText: samples.collector.email }).click(); await picker.getByRole("button", { name: "OK", exact: true }).click();
      await parent.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal((await store.read()).collectors[0].accountId, samples.supervisor.id);
    });
    await t.test("auxiliary user form accepts a username, retains the three-character minimum and explicit collector link", async () => {
      await open("auxiliary"); const dialog = page.getByRole("dialog", { name: "Nueva cuenta", exact: true }), role = dialog.getByLabel("Rol", { exact: true });
      assert.equal(await role.inputValue(), "undefined"); assert.deepEqual(await roleLabels(role), ACCOUNT_ROLE_OPTIONS.map((row) => row.label));
      await role.selectOption("collector");
      const association = dialog.getByLabel("Cobrador asignado", { exact: true });
      assert.equal(await association.inputValue(), "");
      assert.equal(await association.getAttribute("required"), "");
      assert.equal(await association.locator('option[value="qa-inactive-collector"]').count(), 0);
      await dialog.getByLabel("Nombre", { exact: true }).fill("Cuenta auxiliar sin correo QA");
      const username = dialog.getByLabel("Usuario / correo", { exact: true });
      assert.equal(await username.getAttribute("type"), "text");
      assert.equal(await username.getAttribute("autocomplete"), "username");
      await username.fill("qa.auxiliary"); await association.selectOption("col-1");
      const password = dialog.getByLabel("Contraseña (3 caracteres mínimo)", { exact: true });
      await password.fill("Qa"); assert.equal(await password.evaluate((input: HTMLInputElement) => input.checkValidity()), false);
      await password.fill("Qa3"); await dialog.getByRole("button", { name: "Crear cuenta", exact: true }).click();
      await page.getByText("Ventana cerrada", { exact: true }).waitFor();
      const saved = (await store.read()).accounts.find((row) => row.email === "qa.auxiliary")!;
      assert.equal(saved.role, "collector"); assert.equal(saved.collectorId, "col-1");
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "qa.auxiliary", password: "Qa3" } });
      assert.equal(login.statusCode, 200); assert.equal(login.json().user.id, saved.id);
    });
    await t.test("historical inactive collector remains visible but cannot be selected as a new association", async () => {
      await store.transaction((current) => { current.accounts.find((row) => row.id === samples.collector.id)!.collectorId = "qa-inactive-collector"; });
      await open("users"); await page.getByRole("row").filter({ hasText: samples.collector.email }).click(); await page.getByTitle("Editar", { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Datos de Usuario...", exact: true });
      const association = dialog.getByLabel("Cobrador asociado", { exact: true });
      assert.equal(await association.inputValue(), "qa-inactive-collector");
      const archived = association.locator('option[value="qa-inactive-collector"]');
      assert.equal(await archived.getAttribute("disabled"), "", await archived.evaluate((node: HTMLOptionElement) => node.outerHTML)); assert.match(await archived.textContent(), /Inactivo/);
      const count = writes.length; await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      assert.equal(writes.length, count); assert.equal((await store.read()).accounts.find((row) => row.id === samples.collector.id)?.collectorId, "qa-inactive-collector");
    });
    assert.deepEqual(pageErrors, []);
    // The host antivirus may inject this script into the ephemeral profile.
    // Every external request stays blocked; record only its origin, without attrs.
    const antivirusOrigin = "http://me.kis.v2.scr.kaspersky-labs.com";
    assert.deepEqual(external.filter((blockedOrigin) => blockedOrigin !== antivirusOrigin), [], "The application must not attempt any external request.");
    t.diagnostic(`Blocked antivirus script attempts: ${external.length}; no external request was sent.`);
    t.diagnostic(`Synthetic role UI screenshot: ${output}`);
  } finally {
    await context?.close(); await browser?.close(); if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); await app.close();
  }
});
