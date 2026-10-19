import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";
import { getAdminTools } from "../../server/src/admin-tools.js";
import { DEMO_PASSWORD } from "../../server/src/demo-credentials.js";
import type { RemittancePermission } from "../../shared/access.mjs";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); } catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
}
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);
// Known attempts the shell makes or the host injects; they are blocked like any other external request.
const knownBlockedOrigins = ["http://me.kis.v2.scr.kaspersky-labs.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"];

// Actual Admin shell, styles, API and MemoryStore with synthetic data and synthetic accounts with
// personalized permissions: each screen offers what the server allows and says what it cannot show.
// No .env, shared data, browser download or external HTTP.
test("the admin panel follows the effective permissions of each account (U2–U9)", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-admin-access-"));
  const state = seed(), now = new Date().toISOString();
  // Synthetic cash: col-1 collected 1,000.00 and deposited it (accepted); col-2 collected 500.00 without
  // depositing; col-1 has a further deposit still waiting to be accepted.
  state.movements.push(
    { id: "qa-col-1", collectorId: "col-1", type: "collection", amount: 100_000, currency: "DOP", createdAt: now, actorId: "demo-collector" },
    { id: "qa-dep-1", collectorId: "col-1", type: "deposit", amount: 100_000, currency: "DOP", createdAt: now, actorId: "demo-collector", acceptedAt: now, acceptedBy: "demo-admin" },
    { id: "qa-col-2", collectorId: "col-2", type: "collection", amount: 50_000, currency: "DOP", createdAt: now, actorId: "demo-admin" },
    { id: "qa-dep-pending", collectorId: "col-1", type: "deposit", amount: 20_000, currency: "DOP", createdAt: now, actorId: "demo-collector" },
  );
  // A synthetic PCP in its group.
  const tools = getAdminTools(state);
  tools.pcpGroups.push({ id: "qa-pcp-group", name: "Grupo sintético" });
  tools.pcps.push({ id: "qa-pcp", number: "QA-001", name: "PCP sintético", groupId: "qa-pcp-group", address: "Dirección sintética", phone: "", active: true });
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-admin-access-secret-at-least-32-chars", origins: [], collectorUrl: "/collector/" });
  // Each request comes from its own loopback address so the per-address rate limits never mix steps.
  let address = 0;
  const remoteAddress = () => { address += 1; return `10.64.${Math.floor(address / 250) % 250}.${address % 250 + 1}`; };
  const password = "Synthetic-Access-2026!";
  const login = async (email: string, secret = password) => {
    const reply = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: remoteAddress(), payload: { email, password: secret } });
    assert.equal(reply.statusCode, 200, reply.body); return reply.json().token as string;
  };
  const adminToken = await login("admin@cyp.local", DEMO_PASSWORD);
  const supervisorEmail = `qa-supervisor-${randomUUID()}@example.invalid`;
  const post = async (url: string, payload: object) => {
    const reply = await app.inject({ method: "POST", url, payload, remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${adminToken}`, "idempotency-key": randomUUID() } });
    assert.equal(reply.statusCode, 200, `${url}: ${reply.body}`); return reply.json();
  };
  const grant = async (id: string, permissionIds: number[], remittancePermissions: RemittancePermission[] = []) => {
    const current = await app.inject({ url: `/api/usuarios/${id}/permisos`, remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${adminToken}` } });
    await post(`/api/usuarios/${id}/permisos`, { mode: "custom", permissionIds, remittancePermissions, revision: current.json().revision });
  };
  // A synthetic account with personalized permissions, signed in.
  const account = async (permissionIds: number[], role = "admin", remittancePermissions: RemittancePermission[] = []) => {
    const email = `qa-${randomUUID()}@example.invalid`;
    const created = await post("/api/usuarios", { name: `Cuenta ${permissionIds.join("-")}`, email, role, password });
    await grant(created.id, permissionIds, remittancePermissions);
    return { id: created.id as string, token: await login(email) };
  };
  await post("/api/usuarios", { name: "Supervisor de consulta", email: supervisorEmail, role: "supervisor", password });
  const supervisorToken = await login(supervisorEmail);
  const requests: string[] = [], pageErrors: string[] = [], external: string[] = [];
  let browser: any, server: ReturnType<typeof createServer> | undefined;
  try {
    const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(localRequire.resolve("@tailwindcss/vite")).href), import(pathToFileURL(playwrightEntry!).href),
    ]);
    const module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
    const fixture = path.join(output, "admin.tsx");
    fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import App from ${module("App.tsx")};
import ${module("styles.css")};
import ${module("suggestions-shell.css")};
window.print = () => {};
createRoot(document.getElementById("root")).render(<App />);`, "utf8");
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react(), tailwind()],
      define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.VITE_COLLECTOR_URL": JSON.stringify("/collector/") }, logLevel: "error",
      build: { outDir: path.join(output, "admin"), emptyOutDir: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => "admin.js", cssFileName: "admin" } } });
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname.startsWith("/api/")) {
          const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
          requests.push(`${request.method} ${url.pathname}`);
          const result = await app.inject({ method: request.method as "GET" | "POST", url: url.pathname + url.search, remoteAddress: remoteAddress(),
            headers: { authorization: request.headers.authorization ?? "", "idempotency-key": String(request.headers["idempotency-key"] ?? ""), ...(request.headers["content-type"] ? { "content-type": request.headers["content-type"] } : {}) },
            ...(chunks.length ? { payload: Buffer.concat(chunks).toString() } : {}) });
          response.writeHead(result.statusCode, { "Content-Type": "application/json" }); response.end(result.body); return;
        }
        if (url.pathname === "/admin/") {
          response.writeHead(200, { "Content-Type": "text/html" }); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/admin/admin.css"><div id="root"></div><script type="module" src="/admin/admin.js"></script></html>'); return;
        }
        if (url.pathname === "/admin/admin.js" || url.pathname === "/admin/admin.css") {
          response.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css" }); response.end(fs.readFileSync(path.join(output, "admin", path.basename(url.pathname)))); return;
        }
        response.writeHead(404); response.end();
      } catch { response.writeHead(500); response.end('{"error":{"message":"Synthetic admin access fixture failure"}}'); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const listening = server.address(); assert(listening && typeof listening !== "string");
    const origin = `http://127.0.0.1:${listening.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    const open = async (token: string) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
      await context.addInitScript((token: string) => localStorage.setItem("cyp-admin-token", token), token);
      await context.route("**/*", (route: any) => { const target = new URL(route.request().url()); if (target.origin === origin) return route.continue(); external.push(target.origin); return route.abort("blockedbyclient"); });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on("pageerror", (error: Error) => pageErrors.push(error.message));
      await page.goto(`${origin}/admin/`); await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor();
      return { context, page };
    };
    const sidebar = (page: any) => page.locator(".sidebar");
    const menuItem = async (page: any, group: string, item: string) => {
      const trigger = sidebar(page).getByRole("button", { name: group, exact: true });
      if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
      await sidebar(page).getByRole("button", { name: item, exact: true }).click();
    };
    const windowNamed = (page: any, name: string) => page.getByRole("dialog", { name, exact: true });
    const controlPanelTile = async (page: any, tile: string) => {
      await menuItem(page, "ARCHIVOS", "Admin.");
      await windowNamed(page, "Panel de Control").getByRole("button", { name: tile, exact: true }).click();
    };
    // Reads the account again as the 30-second refresh does.
    const refresh = async (page: any) => {
      const read = page.waitForResponse((reply: any) => new URL(reply.url()).pathname === "/api/snapshot");
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("cyp-user-permissions-updated")));
      await read; await page.waitForTimeout(150);
    };
    const notifications = async (page: any) => {
      await page.getByRole("button", { name: /^Notificaciones, \d+ pendientes$/ }).click();
      return page.getByRole("dialog", { name: "Tu operación al día", exact: true });
    };

    await t.test("U4: the bell reports collections without deposit only when it can see deposits and closed days", async () => {
      const full = await open(adminToken);
      try {
        const menu = await notifications(full.page);
        const notice = menu.getByRole("button").filter({ hasText: "Hay cobros sin depósito confirmado" });
        await notice.waitFor();
        assert.match(await notice.innerText(), /Luis Pérez: RD\$\s?500\.00/);
        assert.doesNotMatch(await notice.innerText(), /Cobrador: /, "the accepted deposit settles col-1");
      } finally { await full.context.close(); }
      const viewer = await account([1, 10, 320]);
      const limited = await open(viewer.token);
      try {
        const menu = await notifications(limited.page);
        await menu.getByText("Últimos recibos de cobradores", { exact: true }).waitFor();
        assert.equal(await menu.getByText("Hay cobros sin depósito confirmado").count(), 0, "the deposits it cannot see are not «missing»");
        await limited.page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" });
        assert.equal(await limited.page.getByRole("button", { name: "Notificaciones, 0 pendientes", exact: true }).count(), 1);
      } finally { await limited.context.close(); }
    });

    await t.test("U6: the side menu keeps the groups the Supervisor opened when the session refreshes", async () => {
      const { context, page } = await open(supervisorToken);
      try {
        const files = sidebar(page).getByRole("button", { name: "ARCHIVOS", exact: true });
        assert.equal(await files.getAttribute("aria-expanded"), "false", "Supervisor starts with Reportes & Monitoreo");
        await files.click(); assert.equal(await files.getAttribute("aria-expanded"), "true");
        await refresh(page); await refresh(page);
        assert.equal(await files.getAttribute("aria-expanded"), "true");
        assert.equal(await sidebar(page).getByRole("button", { name: "Clientes", exact: true }).isVisible(), true);
      } finally { await context.close(); }
    });

    await t.test("U3 and U9: Supervisor consults a client's ficha and location read-only, without save buttons", async () => {
      const { context, page } = await open(supervisorToken);
      try {
        await menuItem(page, "ARCHIVOS", "Clientes");
        const clients = windowNamed(page, "Clientes");
        await clients.getByTitle("Consultar", { exact: true }).click();
        const ficha = page.getByRole("dialog", { name: "Datos del Cliente...", exact: true });
        await ficha.waitFor();
        assert.equal(await ficha.getByRole("textbox", { name: "Cliente:" }).isDisabled(), true);
        assert.notEqual(await ficha.getByRole("textbox", { name: "Dirección:" }).inputValue(), undefined);
        assert.equal(await ficha.getByRole("button", { name: "oK", exact: true }).count(), 0);
        await ficha.getByText("Solo consulta: tu cuenta no tiene permiso para modificar clientes.").waitFor();
        await ficha.getByRole("button", { name: "Cerrar", exact: true }).click(); await ficha.waitFor({ state: "detached" });
        await clients.getByTitle("Mapa", { exact: true }).click();
        const map = page.getByRole("dialog", { name: "Ubicación del Cliente...", exact: true });
        await map.waitFor();
        assert.equal(await map.getByRole("button", { name: /^Guardar/ }).count(), 0);
        await map.getByText(/Solo consulta: guardar la ubicación requiere «Modificar cliente» \(142\)/).waitFor();
      } finally { await context.close(); }
    });

    await t.test("U3: Supervisor consults a PCP read-only from Admin.", async () => {
      const { context, page } = await open(supervisorToken);
      try {
        await controlPanelTile(page, "PCPs");
        const pcps = windowNamed(page, "Puntos de Cobros y Pagos");
        await pcps.getByRole("row").filter({ hasText: "PCP sintético" }).click();
        await pcps.getByTitle("Consultar", { exact: true }).click();
        const ficha = page.getByRole("dialog", { name: "Datos del PCP...", exact: true });
        await ficha.waitFor();
        assert.equal(await ficha.getByRole("textbox", { name: "Nombre del PCP" }).inputValue(), "PCP sintético");
        assert.equal(await ficha.getByRole("textbox", { name: "Nombre del PCP" }).isDisabled(), true);
        assert.equal(await ficha.getByRole("button", { name: "oK", exact: true }).count(), 0);
        await ficha.getByRole("button", { name: "Cerrar", exact: true }).click(); await ficha.waitFor({ state: "detached" });
      } finally { await context.close(); }
    });

    await t.test("U8 and S8: with 170 and 172 the PCP window loads without 160/111 and the activity stays with 173", async () => {
      const editor = await account([1, 10, 170, 172]);
      const { context, page } = await open(editor.token);
      try {
        await controlPanelTile(page, "PCPs");
        const pcps = windowNamed(page, "Puntos de Cobros y Pagos");
        await pcps.getByRole("row").filter({ hasText: "PCP sintético" }).waitFor();
        assert.equal(await pcps.getByRole("alert").count(), 0, "a missing auxiliary list does not break the window");
        await pcps.getByText("Sin «Visualizar Grupos de PCPs» (160) no se muestran los grupos de los PCPs.", { exact: false }).waitFor();
        await pcps.getByRole("row").filter({ hasText: "PCP sintético" }).click();
        await pcps.getByTitle("Editar", { exact: true }).click();
        const ficha = page.getByRole("dialog", { name: "Datos del PCP...", exact: true });
        await ficha.waitFor();
        assert.equal(await ficha.getByRole("checkbox", { name: "Activo" }).isDisabled(), true, "inactivating needs 173");
        assert.equal(await ficha.getByRole("textbox", { name: "Nombre del PCP" }).isDisabled(), false);
        assert.equal(await ficha.getByRole("combobox", { name: "Grupo" }).inputValue(), "qa-pcp-group");
        await ficha.getByRole("textbox", { name: "Dirección" }).fill("Dirección sintética revisada");
        const saved = page.waitForResponse((reply: any) => reply.request().method() === "POST" && new URL(reply.url()).pathname === "/api/pcps/qa-pcp");
        await ficha.getByRole("button", { name: "oK", exact: true }).click();
        assert.equal((await saved).status(), 200); await ficha.waitFor({ state: "detached" });
        const pcp = (await store.read()).adminTools?.pcps.find(({ id }: { id: string }) => id === "qa-pcp");
        assert.equal(pcp?.address, "Dirección sintética revisada"); assert.equal(pcp?.active, true); assert.equal(pcp?.groupId, "qa-pcp-group");
      } finally { await context.close(); }
    });

    await t.test("U9: without 116 «Cerrar sesión» is not offered in Sesiones", async () => {
      const viewer = await account([1, 10, 115]);
      const { context, page } = await open(viewer.token);
      try {
        await controlPanelTile(page, "Sesiones");
        const sessions = windowNamed(page, "Listado de Sesiones");
        await sessions.getByRole("row").filter({ hasText: "Activa" }).filter({ hasNotText: "(esta sesión)" }).first().click();
        assert.equal(await sessions.getByTitle("Cerrar sesión", { exact: true }).isDisabled(), true);
      } finally { await context.close(); }
    });

    await t.test("U7: «Aceptar depósito» follows 334, as the server does, without asking for 332", async () => {
      const acceptor = await account([1, 10, 330, 334]);
      const { context, page } = await open(acceptor.token);
      try {
        await menuItem(page, "COBROS", "Depósitos por Cobradores");
        const deposits = windowNamed(page, "Depósitos por Cobradores");
        await deposits.locator("tbody tr").filter({ hasText: /200.00/ }).first().click();
        const accept = deposits.getByTitle("Aceptar depósito", { exact: true });
        assert.equal(await accept.isDisabled(), false);
        await accept.click();
        await page.getByRole("dialog", { name: "Confirm", exact: true }).getByRole("button", { name: "Sí", exact: true }).click();
        const breakdown = page.getByRole("dialog", { name: "Desglose de denominaciones", exact: true });
        await breakdown.getByLabel("Aceptar cantidad 200", { exact: true }).fill("1");
        const accepted = page.waitForResponse((reply: any) => reply.request().method() === "POST" && new URL(reply.url()).pathname === "/api/depositos/qa-dep-pending/aceptar");
        await breakdown.getByRole("button", { name: "Aceptar depósito", exact: true }).click();
        assert.equal((await accepted).status(), 200, "the server accepts it with 330 and 334");
        await breakdown.waitFor({ state: "detached" });
        assert.ok((await store.read()).movements.find(({ id }) => id === "qa-dep-pending")?.acceptedAt);
      } finally { await context.close(); }
    });

    await t.test("U2: uploading a charges file follows 304, not 301", async () => {
      for (const [ids, enabled] of [[[1, 10, 300, 301], false], [[1, 10, 300, 304], true]] as const) {
        const importer = await account([...ids]);
        const { context, page } = await open(importer.token);
        try {
          await menuItem(page, "COBROS", "Cargos");
          const upload = windowNamed(page, "Cargos").getByRole("button", { name: "Subir archivo de cargos", exact: true });
          assert.equal(await upload.isDisabled(), !enabled, `codes ${ids.join(",")}`);
        } finally { await context.close(); }
      }
    });

    await t.test("U5: a report opened without the permission of its data says so instead of showing zeros silently", async () => {
      const reader = await account([1, 10, 400]);
      for (const [token, expected] of [[reader.token, true], [adminToken, false]] as const) {
        const { context, page } = await open(token);
        try {
          await menuItem(page, "REPORTES & MONITOREO", "Reportes");
          await windowNamed(page, "Reportes").getByRole("button", { name: "Cobros Res.", exact: true }).click();
          const report = windowNamed(page, "Reporte de Cobros Resumido");
          await report.getByRole("button", { name: /Refrescar/ }).first().waitFor();
          const note = report.getByText("Este reporte usa datos que tu cuenta no tiene permiso para consultar: «Visualizar Cobros» (320). Se muestra sin esos datos.", { exact: true });
          assert.equal(await note.count(), expected ? 1 : 0);
        } finally { await context.close(); }
      }
    });

    await t.test("U9: the collector card offers «Ir al cuadre diario» only with 401", async () => {
      const viewer = await account([1, 10, 150]);
      for (const [token, offered] of [[viewer.token, false], [adminToken, true]] as const) {
        const { context, page } = await open(token);
        try {
          const menu = await notifications(page);
          await menu.getByRole("button").filter({ hasText: "Marta Reyes" }).first().click();
          await page.getByText("Últimos movimientos", { exact: true }).waitFor();
          assert.equal(await page.getByRole("button", { name: "Ir al cuadre diario" }).count(), offered ? 1 : 0);
        } finally { await context.close(); }
      }
    });

    await t.test("U9: an account that loses its access during the session is signed out with the reason", async () => {
      const desk = await account([1], "user", ["remittances.view"]);
      const { context, page } = await open(desk.token);
      try {
        await grant(desk.id, [1], []);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent("cyp-user-permissions-updated")));
        await page.getByText(/Si tu acceso cambió, solicita a Administración que revise tus permisos\./).first().waitFor();
        await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => localStorage.getItem("cyp-admin-token")), null);
      } finally { await context.close(); }
    });

    await t.test("no page errors and no external requests", async () => {
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(external.filter((target) => !knownBlockedOrigins.includes(target)), []);
    });
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    await app.close();
    // Delete only this test's verified temporary build inputs and outputs.
    assert.equal(path.dirname(path.resolve(output)), path.resolve(os.tmpdir())); assert(path.basename(output).startsWith("cyp-admin-access-"));
    fs.rmSync(output, { recursive: true, force: true });
    t.diagnostic(`API requests seen by the proxy: ${requests.length}; blocked external origins: ${external.length}`);
  }
});
