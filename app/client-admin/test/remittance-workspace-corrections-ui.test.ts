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
import { businessDate } from "../../server/src/domain.js";
import { setDailyRate } from "../../server/src/remittances.js";
import { DEMO_PASSWORD } from "../../server/src/demo-credentials.js";
import { rolePermissionIds, roleRemittancePermissions } from "../../shared/access.mjs";

// Corrections W1–W8 of the PR 36 review (shared window of Envíos and collector terminal), with the real
// RemittancesWorkspace, the real collector terminal, the real API and MemoryStore with synthetic data only.
// The loopback proxy can hold back or alter one answer to reproduce an uncertain or unverifiable result.
const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const collectorRoot = path.resolve(adminRoot, "../client-collector");
const sharedRoot = path.resolve(adminRoot, "../shared/remittances");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); } catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
}
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);
const knownBlockedOrigins = ["http://me.kis.v2.scr.kaspersky-labs.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"];
const password = "Clave-ficticia-ventana-2026!";

test("shared Envíos window and collector terminal: corrections W1–W8 and the frozen names and operators sent by the server", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-workspace-corrections-"));
  const state = seed(), now = new Date();
  setDailyRate(state, { id: "demo-admin", name: "Administración", role: "admin" }, { currency: "USD", rate: "60", date: businessDate(now) }, now);
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-workspace-corrections-secret-32", origins: [], collectorUrl: "/collector/" });
  let address = 0;
  const remoteAddress = () => { address += 1; return `10.71.${Math.floor(address / 250) % 250}.${address % 250 + 1}`; };
  const login = async (email: string, secret = password) => {
    const reply = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: remoteAddress(), payload: { email, password: secret } });
    assert.equal(reply.statusCode, 200, reply.body); return reply.json().token as string;
  };
  const admin = await login("admin@cyp.local", DEMO_PASSWORD);
  const call = async (method: "GET" | "POST", url: string, payload?: object, token = admin) => {
    const reply = await app.inject({ method, url, remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${token}`, ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}) }, ...(payload ? { payload } : {}) });
    assert.equal(reply.statusCode, 200, `${url}: ${reply.body}`); return reply.json();
  };
  const account = async (role: string, extra: Record<string, unknown> = {}) => {
    const email = `${role}-${randomUUID()}@example.invalid`;
    const row = await call("POST", "/api/usuarios", { name: `Cuenta ${role} ${address}`, email, role, password, ...extra });
    return { id: row.id as string, name: row.name as string, token: await login(email) };
  };
  const grant = async (id: string, permissionIds: number[], remittancePermissions: string[]) => {
    const { revision } = await call("GET", `/api/usuarios/${id}/permisos`);
    await call("POST", `/api/usuarios/${id}/permisos`, { mode: "custom", permissionIds, remittancePermissions, revision });
  };
  const cashier = async () => { const row = await account("cashier"); await call("POST", "/api/envios/cajas/abrir", { operatorId: row.id, currency: "DOP", openingAmount: 0 }); return row; };
  await call("POST", "/api/envios/cajas/abrir", { operatorId: "demo-admin", currency: "DOP", openingAmount: 0 });
  // POST /api/envios: what the window sent, and the next answers the proxy holds back ("drop") or alters ("tamper").
  const createBodies: Record<string, unknown>[] = [], createHooks: ("drop" | "tamper")[] = [];
  const requests: string[] = [], pageErrors: string[] = [], external: string[] = [];
  let browser: any, server: ReturnType<typeof createServer> | undefined;
  try {
    const [{ build }, { default: react }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href), import(pathToFileURL(playwrightEntry!).href),
    ]);
    const shared = (name: string) => JSON.stringify(path.join(sharedRoot, name).replaceAll("\\", "/"));
    fs.writeFileSync(path.join(output, "workspace.tsx"), `import { createRoot } from "react-dom/client";
import RemittancesWorkspace from ${shared("RemittancesWorkspace.tsx")};
import { createStrictApi } from ${shared("strictApi.ts")};
const token = () => sessionStorage.getItem("qa-token");
const api = createStrictApi(token, () => false);
void (async () => {
  const me = await fetch("/api/auth/me", { headers: { Authorization: "Bearer " + token() } }).then((reply) => reply.json());
  const fixed = new URLSearchParams(location.search).get("layout") === "fixed";
  createRoot(document.getElementById("root")).render(fixed
    ? <RemittancesWorkspace api={api} user={me} isAdmin={me.role === "admin"} sections={["envios"]} fixedForm />
    : <RemittancesWorkspace api={api} user={me} isAdmin={me.role === "admin"} />);
})();`);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache-workspace"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react()],
      define: { "process.env.NODE_ENV": JSON.stringify("production") }, logLevel: "error",
      build: { outDir: path.join(output, "workspace"), emptyOutDir: false, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } }, lib: { entry: path.join(output, "workspace.tsx"), formats: ["es"], fileName: () => "workspace.js", cssFileName: "workspace" } } });
    const collectorModule = (name: string) => JSON.stringify(path.join(collectorRoot, "src", name).replaceAll("\\", "/"));
    fs.writeFileSync(path.join(output, "collector.tsx"), `import { createRoot } from "react-dom/client";
import { App } from ${collectorModule("App.tsx")};
import ${collectorModule("styles.css")};
createRoot(document.getElementById("root")).render(<App />);`);
    await build({ root: collectorRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache-collector"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react()],
      define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.BASE_URL": JSON.stringify("/collector/") }, logLevel: "error",
      build: { outDir: path.join(output, "collector"), emptyOutDir: false, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } }, lib: { entry: path.join(output, "collector.tsx"), formats: ["es"], fileName: () => "collector.js", cssFileName: "collector" } } });
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname.startsWith("/api/")) {
          requests.push(`${request.method} ${url.pathname}`);
          const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const payload = chunks.length ? Buffer.concat(chunks).toString() : undefined;
          const create = request.method === "POST" && url.pathname === "/api/envios", hook = create ? createHooks.shift() : undefined;
          if (create) createBodies.push(JSON.parse(payload ?? "{}"));
          // Held back before reaching the API: nothing is saved and the window cannot know it.
          if (hook === "drop") { response.writeHead(502, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "Puerta de enlace sintética sin respuesta." } })); return; }
          const result = await app.inject({ method: request.method as "GET" | "POST", url: url.pathname + url.search,
            headers: { authorization: request.headers.authorization ?? "", "idempotency-key": String(request.headers["idempotency-key"] ?? ""), ...(request.headers["content-type"] ? { "content-type": request.headers["content-type"] } : {}) },
            ...(payload ? { payload } : {}) });
          let body = result.body;
          // Saved by the API, but answered with a field the window cannot match with what it sent.
          if (hook === "tamper" && result.statusCode === 200) body = JSON.stringify({ ...result.json(), registeredBy: "otra-cuenta-sintetica" });
          response.writeHead(result.statusCode, { "Content-Type": "application/json" }); response.end(body); return;
        }
        if (url.pathname === "/" || url.pathname === "/collector/") {
          const surface = url.pathname === "/" ? "workspace" : "collector";
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/${surface}/${surface}.css"><style>body{margin:0;font:14px Arial}</style><div id="root"></div><script type="module" src="/${surface}/${surface}.js"></script></html>`); return;
        }
        const asset = url.pathname.match(/^\/(workspace|collector)\/(workspace|collector)\.(js|css)$/);
        if (asset && asset[1] === asset[2]) { response.writeHead(200, { "Content-Type": asset[3] === "js" ? "text/javascript" : "text/css" }); response.end(fs.readFileSync(path.join(output, asset[1], `${asset[2]}.${asset[3]}`))); return; }
        response.writeHead(404); response.end();
      } catch (failure) { response.writeHead(500); response.end(JSON.stringify({ error: { message: String(failure) } })); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const where = server.address(); assert(where && typeof where !== "string"); const origin = `http://127.0.0.1:${where.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    const open = async (token: string, { layout = "fixed", viewport = { width: 1280, height: 900 }, collector = false, clock = false } = {}) => {
      const context = await browser.newContext({ viewport, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
      await context.addInitScript(({ token, collector }: { token: string; collector: boolean }) => sessionStorage.setItem(collector ? "cyp-collector-token" : "qa-token", token), { token, collector });
      await context.route("**/*", (route: any) => { const target = new URL(route.request().url()); if (target.origin === origin) return route.continue(); external.push(target.origin); return route.abort("blockedbyclient"); });
      const page = await context.newPage(); page.setDefaultTimeout(8000); page.on("pageerror", (error: Error) => pageErrors.push(error.message));
      if (clock) await page.clock.install();
      await page.goto(collector ? `${origin}/collector/` : `${origin}/?layout=${layout}`);
      const workspace = page.getByRole("region", { name: "Envíos de dinero", exact: true });
      if (!collector) await workspace.getByRole("combobox", { name: "Remitente", exact: true }).waitFor();
      return { context, page, workspace };
    };
    const group = (workspace: any, side: "remitente" | "destinatario") => workspace.getByRole("group", { name: `Datos del ${side}`, exact: true });
    const lookupSettled = (page: any) => page.getByText("Buscando contactos…", { exact: true }).waitFor({ state: "hidden" });
    const choose = async (page: any, workspace: any, label: "Remitente" | "Destinatario", code: string) => {
      await workspace.getByRole("combobox", { name: label, exact: true }).fill(code); await lookupSettled(page);
      await workspace.getByRole("option").filter({ hasText: code }).first().click();
    };
    const quickClient = async (page: any, workspace: any, side: "remitente" | "destinatario", values: { name: string; identification: string; phone?: string }) => {
      await group(workspace, side).getByRole("button", { name: "Registrar cliente nuevo", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: `Nuevo ${side}`, exact: true });
      await dialog.getByLabel("Cliente:", { exact: true }).fill(values.name);
      await dialog.getByLabel("Cédula o pasaporte:", { exact: true }).fill(values.identification);
      if (values.phone) await dialog.getByLabel("Teléfono:", { exact: true }).fill(values.phone);
      await dialog.getByLabel("Ruta:", { exact: true }).selectOption({ label: "Zona Colonial" });
      await dialog.getByRole("button", { name: "Usar estos datos", exact: true }).click(); await dialog.waitFor({ state: "detached" });
    };
    const review = async (page: any, workspace: any, amount = "100") => {
      await workspace.getByLabel("Monto a enviar (DOP)", { exact: true }).fill((amount.includes(".") ? amount : `${amount}.00`));
      await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
      await workspace.getByRole("button", { name: "Revisar y confirmar envío", exact: true }).click();
      return page.getByRole("dialog", { name: "Confirmar envío", exact: true });
    };
    const focused = (locator: any) => locator.evaluate((element: Element) => element === document.activeElement);
    const transfers = async () => (await store.read()).remittances.transfers.length;

    await t.test("W1 a new recipient whose phone is rewritten with other separators is confirmed and offers its receipt", async () => {
      const desk = await cashier();
      const { context, page, workspace } = await open(desk.token);
      try {
        await choose(page, workspace, "Remitente", "CL-0001");
        await quickClient(page, workspace, "destinatario", { name: "Destinatario nuevo W1", identification: "QA-W1-DESTINO", phone: "8095550101" });
        const phone = workspace.getByLabel("Teléfono del destinatario", { exact: true });
        assert.equal(await phone.inputValue(), "8095550101"); await phone.fill("809-555-0101");
        const before = await transfers(), dialog = await review(page, workspace);
        await dialog.getByRole("button", { name: "Aceptar", exact: true }).click();
        const print = page.getByRole("dialog", { name: "¿Quieres imprimir el recibo?", exact: true });
        await print.waitFor();
        assert.equal(await transfers(), before + 1);
        assert.equal(Object.hasOwn(createBodies.at(-1)!, "recipientPhone"), false, "the same digits are not a new phone for this transfer");
        const saved = (await store.read()).remittances.transfers.at(-1)!;
        assert.equal(saved.recipientContact?.phone, "8095550101");
        await print.getByRole("button", { name: "No imprimir", exact: true }).click();
      } finally { await context.close(); }
    });

    await t.test("W1 an answer 200 that does not match what was sent unlocks the window, names the saved reference and shows it in the list", async () => {
      const desk = await cashier();
      const { context, page, workspace } = await open(desk.token);
      try {
        await choose(page, workspace, "Remitente", "CL-0001"); await choose(page, workspace, "Destinatario", "CL-0003");
        const before = await transfers(), dialog = await review(page, workspace);
        createHooks.push("tamper");
        await dialog.getByRole("button", { name: "Aceptar", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        const saved = (await store.read()).remittances.transfers.at(-1)!;
        assert.equal(await transfers(), before + 1);
        await workspace.getByRole("alert").filter({ hasText: saved.envioReference }).waitFor();
        await workspace.getByRole("button", { name: saved.envioReference, exact: true }).waitFor();
        assert.equal(await workspace.getByRole("combobox", { name: "Remitente", exact: true }).inputValue(), "", "the data of the saved transfer is not offered again");
        assert.equal(await page.getByRole("dialog", { name: "¿Quieres imprimir el recibo?", exact: true }).count(), 0, "an unverified answer is not printed");
      } finally { await context.close(); }
    });

    await t.test("W5 an uncertain transfer whose retry is refused for lack of permission does not keep the window locked", async () => {
      const desk = await cashier();
      const { context, page, workspace } = await open(desk.token);
      try {
        await choose(page, workspace, "Remitente", "CL-0001"); await choose(page, workspace, "Destinatario", "CL-0002");
        const before = await transfers(), dialog = await review(page, workspace);
        createHooks.push("drop");
        await dialog.getByRole("button", { name: "Aceptar", exact: true }).click();
        const retry = dialog.getByRole("button", { name: "Reintentar misma operación", exact: true }); await retry.waitFor();
        assert.equal(await dialog.getByRole("button", { name: "Cancelar", exact: true }).isDisabled(), true, "an uncertain result keeps the window locked");
        await grant(desk.id, [1, 2], ["remittances.view"]);
        const refused = page.waitForResponse((reply: any) => reply.request().method() === "POST" && new URL(reply.url()).pathname === "/api/envios");
        await retry.click(); assert.equal((await refused).status(), 403);
        await dialog.getByRole("alert").filter({ hasText: /permiso/ }).waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll("dialog[open] button")].some((button) => button.textContent === "Cancelar" && !(button as HTMLButtonElement).disabled));
        await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); await dialog.waitFor({ state: "detached" });
        assert.equal(await transfers(), before);
      } finally { await context.close(); }
    });

    await t.test("S10 a retry after an uncertain transfer ends with the definitive answer for a document of an inactive record", async () => {
      await store.transaction((current) => { const client = current.clients.find(({ id }) => id === "cli-7")!; client.identification = "QA-INACTIVO-W"; client.active = false; });
      const desk = await cashier();
      const { context, page, workspace } = await open(desk.token);
      try {
        await quickClient(page, workspace, "remitente", { name: "Remitente repetido", identification: "QA-INACTIVO-W" });
        await choose(page, workspace, "Destinatario", "CL-0002");
        const dialog = await review(page, workspace);
        createHooks.push("drop");
        await dialog.getByRole("button", { name: "Aceptar", exact: true }).click();
        const retry = dialog.getByRole("button", { name: "Reintentar misma operación", exact: true }); await retry.waitFor();
        const answer = page.waitForResponse((reply: any) => reply.request().method() === "POST" && new URL(reply.url()).pathname === "/api/envios");
        await retry.click(); assert.equal((await answer).status(), 409);
        await dialog.getByRole("alert").filter({ hasText: /inactiva/ }).waitFor();
        await dialog.getByRole("button", { name: "Aceptar", exact: true }).waitFor();
        assert.equal(await dialog.getByRole("button", { name: "Cancelar", exact: true }).isDisabled(), false);
      } finally { await context.close(); }
    });

    await t.test("W2 Enter moves from a readonly field to the next one and never lands on, or activates, an action button", async () => {
      const { context, page, workspace } = await open(admin);
      try {
        const outcome: Record<string, unknown> = {};
        const where = () => page.evaluate(() => { const element = document.activeElement as HTMLElement | null; return element ? `${element.tagName}:${element.tagName === "BUTTON" ? element.textContent : element.closest("label")?.firstChild?.textContent ?? ""}` : ""; });
        await workspace.getByRole("textbox", { name: "Comisión (%)", exact: true }).focus(); await page.keyboard.press("Enter");
        outcome["Enter in a readonly field"] = await where();
        await workspace.getByLabel("Monto a enviar (DOP)", { exact: true }).focus(); await page.keyboard.press("Enter");
        outcome["Enter in Monto, before the money received"] = await where();
        await quickClient(page, workspace, "destinatario", { name: "Destinatario con teclado", identification: "QA-W2-TECLADO" });
        await workspace.getByLabel("Teléfono del destinatario", { exact: true }).focus();
        await page.keyboard.press("Shift+Enter"); outcome["one Shift+Enter from the phone"] = await where();
        await page.keyboard.press("Shift+Enter");
        outcome["the new recipient after two Shift+Enter"] = await workspace.getByText("Nuevo destinatario: Destinatario con teclado", { exact: true }).count();
        assert.deepEqual(outcome, {
          "Enter in a readonly field": "SELECT:Moneda del destinatario", "Enter in Monto, before the money received": "SELECT:Moneda del destinatario",
          "one Shift+Enter from the phone": "INPUT:Remitente", "the new recipient after two Shift+Enter": 1,
        });
      } finally { await context.close(); }
    });

    await t.test("W3 Enter never chooses a client the user did not pick: empty search, server matches outside the view and the chosen client", async () => {
      await store.transaction((current) => { current.clients.find(({ id }) => id === "cli-8")!.name = "Zeta Uno QA"; });
      const { context, page, workspace } = await open(admin);
      try {
        // The three cases are compared at the end as one table, so a regression shows each of them.
        const outcome: Record<string, unknown> = {};
        const sender = workspace.getByRole("combobox", { name: "Remitente", exact: true });
        assert.equal(await focused(sender), true);
        await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
        outcome["two Enter on the empty sender"] = await sender.inputValue();
        // A client saved after the view loaded is found by the server but is not in this view.
        await store.transaction((current) => { current.clients.push({ ...structuredClone(current.clients.find(({ id }) => id === "cli-8")!), id: "cli-zeta-2", code: "CL-9002", name: "Zeta Dos QA" }); });
        await sender.fill("Zeta"); await lookupSettled(page);
        const notice = workspace.getByText(/Hay clientes recientes que todavía no están en esta vista/);
        await notice.waitFor(); assert.equal(await workspace.getByRole("listbox").getByRole("option").count(), 1);
        outcome["notice with the list open"] = await notice.evaluate((element: Element) => { const box = element.getBoundingClientRect(); const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return top && element.contains(top) ? "visible" : "covered"; });
        await sender.press("Enter");
        outcome["Enter while matches are missing from the view"] = await sender.inputValue();
        // Coming back to the chosen client and pressing Enter keeps the currencies and the quote.
        await choose(page, workspace, "Remitente", "CL-0001"); await choose(page, workspace, "Destinatario", "CL-0002");
        await workspace.getByLabel("Moneda del remitente").selectOption("USD");
        await workspace.getByLabel("Monto a enviar (USD)", { exact: true }).fill("10.00");
        await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        await workspace.getByRole("button", { name: "Revisar y confirmar envío", exact: true }).waitFor();
        await sender.focus(); await lookupSettled(page); await sender.press("Enter");
        outcome["Enter on the chosen sender"] = { currency: await workspace.getByLabel("Moneda del remitente").inputValue(), quotes: await workspace.getByRole("button", { name: "Revisar y confirmar envío", exact: true }).count() };
        assert.deepEqual(outcome, {
          "two Enter on the empty sender": "", "notice with the list open": "visible",
          "Enter while matches are missing from the view": "Zeta", "Enter on the chosen sender": { currency: "USD", quotes: 1 },
        });
      } finally { await context.close(); }
    });

    await t.test("W4 «Registrar cliente nuevo» stays in place while the search runs, so the field does not move", async () => {
      const { context, page, workspace } = await open(admin, { layout: "pwa", viewport: { width: 390, height: 844 } });
      try {
        const sender = workspace.getByRole("combobox", { name: "Remitente", exact: true });
        // Every frame records where the field is drawn while the search runs (a plain script: no helpers from the test build).
        await page.evaluate(`(() => { const input = document.querySelector('[data-client-side="sender"] input'); window.__qaTops = new Set();
          (function sample() { window.__qaTops.add(Math.round(input.getBoundingClientRect().top + scrollY)); window.__qaSampler = requestAnimationFrame(sample); })(); })()`);
        await sender.pressSequentially("Colm", { delay: 120 }); await lookupSettled(page);
        const tops: number[] = await page.evaluate(`(() => { cancelAnimationFrame(window.__qaSampler); return [...window.__qaTops]; })()`);
        assert.deepEqual(tops.length, 1, `the sender field moved: ${tops.join(", ")}`);
      } finally { await context.close(); }
    });

    await t.test("W6 the quick client capture starts in Cliente and gives the focus back when cancelled", async () => {
      const { context, page, workspace } = await open(admin);
      try {
        const create = group(workspace, "remitente").getByRole("button", { name: "Registrar cliente nuevo", exact: true });
        await create.click();
        const dialog = page.getByRole("dialog", { name: "Nuevo remitente", exact: true }); await dialog.waitFor();
        await page.waitForFunction(() => document.activeElement?.closest("dialog") !== null);
        assert.equal(await focused(dialog.getByLabel("Cliente:", { exact: true })), true, "the capture starts in Cliente");
        await dialog.getByRole("button", { name: "Cancelar", exact: true }).click(); await dialog.waitFor({ state: "detached" });
        assert.equal(await focused(create), true, "the focus goes back to «Registrar cliente nuevo»");
        await create.click(); await dialog.waitFor(); await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
        assert.equal(await focused(create), true, "Escape also gives the focus back");
      } finally { await context.close(); }
    });

    await t.test("W7 the final review shows the document and the route of the new records it will create", async () => {
      const { context, page, workspace } = await open(admin);
      try {
        await quickClient(page, workspace, "remitente", { name: "Remitente revisado", identification: "QA-W7-REMITENTE" });
        await quickClient(page, workspace, "destinatario", { name: "Destinatario revisado", identification: "QA-W7-DESTINO" });
        const dialog = await review(page, workspace), text = await dialog.innerText();
        for (const expected of ["QA-W7-REMITENTE", "QA-W7-DESTINO", "Zona Colonial"]) assert.match(text, new RegExp(expected), expected);
        await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      } finally { await context.close(); }
    });

    await t.test("S16 «Operador del envío» offers only the operators that can register a transfer", async () => {
      const payer = await account("cashier"); await grant(payer.id, [1, 2], ["remittances.receipts"]);
      const desk = await cashier();
      const { context, workspace } = await open(admin);
      try {
        const options = await workspace.getByLabel("Operador del envío").locator("option").allTextContents();
        assert.ok(options.includes(desk.name), `a cashier sends: ${JSON.stringify([desk.name, options])}`); assert.equal(options.includes(payer.name), false, "an account that only pays receipts does not send");
      } finally { await context.close(); }
    });

    await t.test("S13 the list, the search and the payment confirmation use the names saved with each transfer", async () => {
      const desk = await cashier();
      const quote = await call("GET", "/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=10000", undefined, desk.token);
      const saved = await call("POST", "/api/envios", { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 10000, quote: quote.quote, senderClientId: "cli-4", recipientClientId: "cli-6" }, desk.token);
      await store.transaction((current) => { current.clients.find(({ id }) => id === "cli-6")!.name = "Nombre posterior QA"; });
      const { context, page, workspace } = await open(admin, { layout: "pwa" });
      try {
        const row = workspace.getByRole("row").filter({ has: page.getByRole("button", { name: saved.envioReference, exact: true }) });
        await row.waitFor(); assert.match(await row.innerText(), /Juan Hernández/); assert.doesNotMatch(await row.innerText(), /Nombre posterior QA/);
        await workspace.getByLabel("Buscar", { exact: true }).fill("Juan Hernández"); await row.waitFor();
        await workspace.getByRole("navigation", { name: "Secciones de remesas", exact: true }).getByRole("button", { name: "Entregas", exact: true }).click();
        await workspace.getByLabel("Buscar", { exact: true }).fill(saved.reciboReference);
        await workspace.getByRole("button", { name: saved.reciboReference, exact: true }).click();
        await page.getByRole("dialog", { name: `${saved.envioReference} · ${saved.reciboReference}`, exact: true }).getByRole("button", { name: "Registrar entrega", exact: true }).click();
        const pay = page.getByRole("dialog", { name: "Confirmar entrega al destinatario", exact: true });
        assert.match(await pay.innerText(), /Juan Hernández/);
        await pay.getByRole("button", { name: "Volver", exact: true }).click();
      } finally { await context.close(); }
    });

    await t.test("W8 the collector terminal without «Mi ruta» opens on an allowed view, its bar has no gaps and each poll reads once", async () => {
      const collector = await account("collector", { collectorId: "col-2" });
      await grant(collector.id, rolePermissionIds("collector").filter((id) => id !== 300), roleRemittancePermissions("collector"));
      const { context, page } = await open(collector.token, { collector: true, viewport: { width: 390, height: 844 }, clock: true });
      try {
        const bar = page.getByRole("navigation", { name: "Navegación principal", exact: true });
        await bar.getByRole("button").first().waitFor();
        assert.deepEqual(await bar.getByRole("button").allTextContents(), ["Pagos", "Recibos", "Remesas", "Reportes", "Mi bolsillo"]);
        await page.waitForLoadState("networkidle"); await page.locator(".cash-pill").waitFor();
        const outcome: Record<string, unknown> = {};
        outcome["views marked as shown"] = await bar.locator('[aria-current="page"]').count();
        outcome["view drawn"] = await page.locator("#main > :not(.content-end):not(.error-banner)").count() > 0;
        // The last button reaches the end of the bar: no empty slot is left for the missing view.
        outcome["gap after the last button"] = await bar.evaluate((nav: Element) => { const box = nav.getBoundingClientRect(), last = nav.lastElementChild!.getBoundingClientRect(); return Math.round(Math.abs(box.right - parseFloat(getComputedStyle(nav).paddingRight) - last.right)); });
        // Each poll of 30 s reads the session once and the operational view once.
        await page.waitForLoadState("networkidle"); const start = requests.length;
        await page.clock.fastForward(30_000); await page.waitForLoadState("networkidle"); await page.waitForTimeout(300);
        outcome["poll"] = requests.slice(start);
        // A change of permissions reaches the terminal at the next poll, which still reads each thing once.
        await grant(collector.id, rolePermissionIds("collector").filter((id) => id !== 300 && id !== 320), roleRemittancePermissions("collector"));
        const changed = requests.length;
        await page.clock.fastForward(30_000); await page.waitForLoadState("networkidle"); await page.waitForTimeout(300);
        await bar.getByRole("button", { name: "Recibos", exact: true }).waitFor({ state: "detached" });
        outcome["poll that brings new permissions"] = requests.slice(changed);
        assert.deepEqual(outcome, {
          "views marked as shown": 1, "view drawn": true, "gap after the last button": 0,
          "poll": ["GET /api/auth/me", "GET /api/snapshot"], "poll that brings new permissions": ["GET /api/auth/me", "GET /api/snapshot"],
        });
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
    // Remove only this test's freshly created temporary directory.
    assert.equal(path.dirname(path.resolve(output)), path.resolve(os.tmpdir())); assert(path.basename(output).startsWith("cyp-workspace-corrections-"));
    fs.rmSync(output, { recursive: true, force: true });
  }
});
