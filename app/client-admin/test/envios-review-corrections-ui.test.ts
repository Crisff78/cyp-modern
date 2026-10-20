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
import { createRemittance, openRemittanceCash, quoteRemittance, setCommissionPolicy, setDailyRate } from "../../server/src/remittances.js";
import { DEMO_PASSWORD } from "../../server/src/demo-credentials.js";
import { DEMO_CASHIER_EMAIL, enrichCashierDemo } from "../../server/src/demo-cashier-scenarios.js";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const collectorRoot = path.resolve(adminRoot, "../client-collector");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); } catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
}
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);
const knownBlockedOrigins = ["http://me.kis.v2.scr.kaspersky-labs.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"];
const password = "Clave-ficticia-revision-ventana-2026!";

// Corrections of the review of the Envíos and Cajero branch, with the actual Admin shell and collector terminal,
// styles, API and MemoryStore with synthetic data: the box named by a notice, quotes and errors kept while another
// window saves, operator names, a box closed today, the sections of Cuadres Diarios, the menu after a sign-out,
// the fixed sending window at common laptop sizes and the client field that never moves.
// No .env, shared data, browser download or external HTTP.
test("review of Envíos and Cajero: windows, notices, names and fields", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-envios-review-"));
  const state = seed(), now = new Date(), today = businessDate(now);
  const admin = { id: "demo-admin", name: "Administración", role: "admin" as const };
  setDailyRate(state, admin, { currency: "USD", rate: "60", date: today }, now);
  setDailyRate(state, admin, { currency: "EUR", rate: "65", date: today }, now);
  setCommissionPolicy(state, admin, { transactionCommissionBps: 500, managerCommissionBps: 200 }, now);
  enrichCashierDemo(state, now);
  openRemittanceCash(state, admin, { operatorId: admin.id, currency: "DOP", openingAmount: 0 }, [], now);
  const sender = state.clients.find((client) => client.id === "cli-1")!, recipient = state.clients.find((client) => client.id === "cli-5")!;
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-envios-review-ui-secret-at-least-32", origins: [], collectorUrl: "/collector/" });
  let address = 0;
  const remoteAddress = () => { address += 1; return `10.64.${Math.floor(address / 250) % 250}.${address % 250 + 1}`; };
  const login = async (email: string, secret: string) => {
    const reply = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: remoteAddress(), payload: { email, password: secret } });
    assert.equal(reply.statusCode, 200, reply.body); return reply.json().token as string;
  };
  const adminToken = await login("admin@cyp.local", DEMO_PASSWORD);
  const cashierToken = await login(DEMO_CASHIER_EMAIL, DEMO_PASSWORD);
  const collectorToken = await login("collector@cyp.local", DEMO_PASSWORD);
  const ok = async (method: "GET" | "POST", url: string, payload?: object, token = adminToken) => {
    const reply = await app.inject({ method, url, remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${token}`, ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}) }, ...(payload ? { payload } : {}) });
    assert.equal(reply.statusCode, 200, `${url}: ${reply.body}`); return reply.json();
  };
  const supervisorEmail = `supervisor-${randomUUID()}@example.invalid`;
  await ok("POST", "/api/usuarios", { name: "Supervisora de prueba", email: supervisorEmail, role: "supervisor", password });
  const supervisorToken = await login(supervisorEmail, password);
  // An Admin transfer saved directly in the ledger, from its open box in DOP.
  const adminTransfer = (amount: number, destinationCurrency: "DOP" | "USD" | "EUR" = "DOP") => store.transaction((current) => {
    const input = { sourceCurrency: "DOP" as const, destinationCurrency, amount, commissionBps: 500 };
    return createRemittance(current, admin, { ...input, senderClientId: sender.id, recipientClientId: recipient.id, quote: quoteRemittance(current, input, now).quote }, [], now);
  });
  const requests: string[] = [], pageErrors: string[] = [], external: string[] = [];
  let browser: any, server: ReturnType<typeof createServer> | undefined;
  try {
    const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(localRequire.resolve("@tailwindcss/vite")).href), import(pathToFileURL(playwrightEntry!).href),
    ]);
    for (const surface of ["admin", "collector"] as const) {
      const root = surface === "admin" ? adminRoot : collectorRoot, module = (name: string) => JSON.stringify(path.join(root, "src", name).replaceAll("\\", "/"));
      const fixture = path.join(output, `${surface}.tsx`);
      fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import ${surface === "admin" ? "App" : "{ App }"} from ${module("App.tsx")};
import ${module("styles.css")};
${surface === "admin" ? `import ${module("suggestions-shell.css")};` : ""}
window.print = () => {};
createRoot(document.getElementById("root")).render(<App />);`, "utf8");
      await build({ root, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, `cache-${surface}`), resolve: { dedupe: ["react", "react-dom"] }, plugins: surface === "admin" ? [react(), tailwind()] : [react()],
        define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.BASE_URL": JSON.stringify("/collector/"), "import.meta.env.VITE_COLLECTOR_URL": JSON.stringify("/collector/") }, logLevel: "error",
        build: { outDir: path.join(output, surface), emptyOutDir: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => `${surface}.js`, cssFileName: surface } } });
    }
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
        const surface = url.pathname.startsWith("/collector/") ? "collector" : "admin";
        if (["/admin/", "/collector/"].includes(url.pathname)) {
          response.writeHead(200, { "Content-Type": "text/html" }); response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/${surface}/${surface}.css"><div id="root"></div><script type="module" src="/${surface}/${surface}.js"></script></html>`); return;
        }
        if (url.pathname === `/${surface}/${surface}.js` || url.pathname === `/${surface}/${surface}.css`) {
          response.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css" }); response.end(fs.readFileSync(path.join(output, surface, path.basename(url.pathname)))); return;
        }
        response.writeHead(404); response.end();
      } catch { response.writeHead(500); response.end('{"error":{"message":"Synthetic review fixture failure"}}'); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const listening = server.address(); assert(listening && typeof listening !== "string");
    const origin = `http://127.0.0.1:${listening.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    const block = (context: any) => context.route("**/*", (route: any) => { const target = new URL(route.request().url()); if (target.origin === origin) return route.continue(); external.push(target.origin); return route.abort("blockedbyclient"); });
    const open = async (token: string, viewport = { width: 1440, height: 1000 }) => {
      const context = await browser.newContext({ viewport, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
      await context.addInitScript((token: string) => localStorage.setItem("cyp-admin-token", token), token);
      await block(context);
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on("pageerror", (error: Error) => pageErrors.push(error.message));
      await page.goto(`${origin}/admin/`); await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor();
      return { context, page };
    };
    // Waits are short: a broken correction fails here instead of at the default timeout.
    const waitForFocus = (page: any, selector: string) => page.waitForFunction((selector: string) => document.activeElement?.matches(selector) === true, selector, { timeout: 5000 });
    const choose = async (region: any, label: string, code: string) => {
      const input = region.getByRole("combobox", { name: label, exact: true }); await input.fill(code);
      await region.getByRole("option").filter({ hasText: code }).first().click();
    };
    const confirmIn = async (page: any, title: string) => {
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await dialog.getByRole("button", { name: "Confirmar", exact: true }).click(); await dialog.waitFor({ state: "detached" });
    };
    const box = async (locator: any) => { const value = await locator.boundingBox(); assert.ok(value, "the element is painted"); return value as { x: number; y: number; width: number; height: number }; };
    const inside = (part: { y: number; height: number }, frame: { y: number; height: number }) => part.y >= frame.y - 0.5 && part.y + part.height <= frame.y + frame.height + 0.5;
    // Position inside its window of Envíos, so a scroll of the page does not count as a move of the field.
    const top = (locator: any) => locator.evaluate((element: HTMLElement) => Math.round((element.getBoundingClientRect().top - element.closest(".remittances")!.getBoundingClientRect().top) * 10) / 10);
    const cashPlace = "Reportes & Monitoreo → Cuadres Diarios → Caja de envíos";
    const sendingWindow = async (page: any) => {
      await page.locator(".desktop-launchers").getByRole("button", { name: "ENVÍO DE DINERO", exact: true }).click();
      const envios = page.getByRole("region", { name: "Envíos de Dinero", exact: true });
      await envios.getByRole("combobox", { name: "Remitente", exact: true }).waitFor();
      return envios;
    };
    // Opens a box from Cuadres Diarios → Caja de envíos, choosing its operator and currency by hand.
    const openBox = async (page: any, operatorId: string, currency: string) => {
      await page.locator(".desktop-launchers").getByRole("button", { name: "CUADRES", exact: true }).click();
      const settlements = page.getByRole("dialog", { name: "Cuadres Diarios", exact: true });
      await settlements.getByRole("group", { name: "Secciones de Cuadres Diarios", exact: true }).getByRole("button", { name: "Caja de envíos", exact: true }).click();
      const cash = settlements.getByRole("region", { name: "Caja de envíos", exact: true });
      await cash.getByLabel("Operador").selectOption(operatorId); await cash.getByLabel("Moneda").selectOption(currency);
      await cash.getByRole("button", { name: "Revisar apertura", exact: true }).click();
      await confirmIn(page, "Abrir caja de envíos");
    };

    await t.test("Admin: «Ir a Caja de envíos» prepares the box the notice names and takes the keyboard there", async () => {
      const { context, page } = await open(adminToken);
      try {
        const envios = await sendingWindow(page);
        await envios.getByLabel("Operador del envío").selectOption("demo-cashier"); await envios.getByLabel("Moneda del remitente").selectOption("USD");
        const warning = envios.locator(".remittance-cash-warning");
        assert.equal(await warning.locator("p").innerText(), `No hay caja de envíos abierta hoy en USD para Cajero de práctica. Sin caja abierta no se puede registrar el envío. Ábrela en ${cashPlace}. Si ya está abierta, pulsa Actualizar.`);
        await warning.getByRole("button", { name: "Ir a Caja de envíos", exact: true }).click();
        const cash = page.getByRole("dialog", { name: "Cuadres Diarios", exact: true }).getByRole("region", { name: "Caja de envíos", exact: true });
        await cash.getByRole("button", { name: "Revisar apertura", exact: true }).waitFor();
        assert.deepEqual([await cash.getByLabel("Operador").inputValue(), await cash.getByLabel("Moneda").inputValue()], ["demo-cashier", "USD"]);
        await waitForFocus(page, "[data-cash-opening-amount]");
      } finally { await context.close(); }
    });

    await t.test("Admin: a quote calculated in Envíos stays while the box is opened in Cuadres Diarios", async () => {
      const { context, page } = await open(adminToken);
      try {
        const envios = await sendingWindow(page);
        await choose(envios, "Remitente", sender.code); await choose(envios, "Destinatario", recipient.code);
        await envios.getByLabel("Operador del envío").selectOption("demo-cashier");
        await envios.getByLabel("Moneda del remitente").selectOption("USD"); await envios.getByLabel("Moneda del destinatario").selectOption("DOP");
        await envios.getByLabel("Monto a enviar (USD)", { exact: true }).fill("50");
        await envios.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        const review = envios.getByRole("button", { name: "Revisar y confirmar envío", exact: true }); await review.waitFor();
        const warning = envios.locator(".remittance-cash-warning"); await warning.waitFor();
        await openBox(page, "demo-cashier", "USD");
        // Envíos learns of the box and keeps the quote: opening a box changes no rate nor commission.
        await warning.waitFor({ state: "detached" });
        assert.equal(await review.count(), 1, "the quote calculated before opening the box is still there");
      } finally { await context.close(); }
    });

    await t.test("Admin: an error on view in Envíos stays while another window saves", async () => {
      const { context, page } = await open(adminToken);
      try {
        const envios = await sendingWindow(page);
        await envios.getByLabel("Moneda del remitente").selectOption("EUR");
        const warning = envios.locator(".remittance-cash-warning");
        await warning.getByText(/^No hay caja de envíos abierta hoy en EUR para Administración\./).waitFor();
        // A quote asked without sender.
        await envios.getByLabel("Monto a enviar (EUR)", { exact: true }).fill("10");
        await envios.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        const failure = envios.locator(".remittance-error"); await failure.waitFor();
        assert.equal(await failure.innerText(), "Selecciona un remitente y un destinatario distintos.");
        await openBox(page, admin.id, "EUR");
        await warning.waitFor({ state: "detached" });
        assert.equal(await failure.count(), 1, "the error of Envíos is still on view");
        assert.equal(await failure.innerText(), "Selecciona un remitente y un destinatario distintos.");
      } finally { await context.close(); }
    });

    await t.test("Admin: the badge of the collector settlements (401) shows them although Cuadres Diarios was on Caja de envíos", async () => {
      const { context, page } = await open(adminToken);
      try {
        await page.locator(".desktop-launchers").getByRole("button", { name: "CUADRES", exact: true }).click();
        const settlements = page.getByRole("dialog", { name: "Cuadres Diarios", exact: true });
        const sections = settlements.getByRole("group", { name: "Secciones de Cuadres Diarios", exact: true });
        await sections.getByRole("button", { name: "Caja de envíos", exact: true }).click();
        await settlements.getByRole("region", { name: "Caja de envíos", exact: true }).waitFor();
        await page.getByTitle("Abrir Cuadres Diarios", { exact: true }).click();
        await settlements.locator(".connected-settlements-mdi").waitFor({ timeout: 5000 });
        assert.equal(await sections.getByRole("button", { name: "Cuadres de cobradores", exact: true }).getAttribute("aria-pressed"), "true");
        assert.equal(await settlements.getByRole("region", { name: "Caja de envíos", exact: true }).count(), 0);
      } finally { await context.close(); }
    });

    await t.test("Cajero: a box of today already closed is not offered to open again", async () => {
      const opened = await ok("POST", "/api/envios/cajas/abrir", { operatorId: "demo-cashier", currency: "DOP", openingAmount: 0 }, cashierToken);
      await ok("POST", `/api/envios/cajas/${opened.id}/cerrar`, { countedAmount: 0 }, cashierToken);
      const { context, page } = await open(cashierToken);
      try {
        const envios = await sendingWindow(page);
        const warning = envios.locator(".remittance-cash-warning"); await warning.waitFor();
        assert.equal(await warning.locator("p").innerText(), "La caja de envíos de hoy en DOP de Cajero de práctica ya se cerró y no admite más movimientos: no se pueden registrar más envíos en DOP hasta la jornada siguiente.");
        assert.equal(await warning.getByRole("button").count(), 0, "no way to a box that cannot be opened");
        await page.locator(".desktop-launchers").getByRole("button", { name: "CUADRES", exact: true }).click();
        const cash = page.getByRole("dialog", { name: "Cuadres Diarios", exact: true }).getByRole("region", { name: "Caja de envíos", exact: true });
        await cash.locator("article").filter({ hasText: "DOP · Cajero de práctica" }).getByText(`${today} · Cerrada`, { exact: true }).waitFor();
        assert.equal(await cash.getByLabel("Moneda").inputValue(), "DOP");
        await cash.getByText("La caja de envíos de hoy en DOP de Cajero de práctica ya se cerró. Hay una sola caja por operador, moneda y día: no se puede abrir otra hasta la jornada siguiente.", { exact: true }).waitFor({ timeout: 5000 });
        assert.equal(await cash.getByRole("button", { name: "Revisar apertura", exact: true }).isDisabled(), true);
        // Another currency of the same day can still be opened.
        await cash.getByLabel("Moneda").selectOption("EUR");
        assert.equal(await cash.getByRole("button", { name: "Revisar apertura", exact: true }).isDisabled(), false);
      } finally { await context.close(); }
    });

    let pending: { envioReference: string; reciboReference: string } | undefined;
    const receiptDetail = async (page: any) => {
      await page.locator(".sidebar").getByRole("button", { name: "Pagos de Envíos", exact: true }).click();
      const payouts = page.getByRole("region", { name: "Pagos de Envíos", exact: true });
      await waitForFocus(page, "[data-receipt-search]");
      const reference = payouts.getByRole("button", { name: pending!.reciboReference, exact: true });
      await reference.click();
      const detail = page.getByRole("dialog", { name: `${pending!.envioReference} · ${pending!.reciboReference}`, exact: true });
      await detail.getByRole("heading", { name: "Registro del recibo", exact: true }).waitFor();
      return { reference, detail };
    };
    await t.test("Cajero in Pagos de Envíos: the detail and the printed receipt of another operator's transfer name that operator", async () => {
      pending = await adminTransfer(9_000, "EUR");
      const { context, page } = await open(cashierToken);
      try {
        const { detail } = await receiptDetail(page);
        const summary = await detail.locator("section").filter({ has: page.getByRole("heading", { name: "Registro del recibo", exact: true }) }).innerText();
        assert.match(summary, /Operador\s+Administración/); assert.match(summary, /Registrado por\s+Administración/);
        const popupReady = context.waitForEvent("page");
        await detail.getByRole("button", { name: "Imprimir comprobante", exact: true }).click();
        const popup = await popupReady; await popup.waitForLoadState();
        const printed = await popup.locator("body").innerText(); await popup.close();
        assert.match(printed, /Operador del envío\s+Administración/); assert.match(printed, /Registrado por\s+Administración/);
        assert.equal(printed.includes("demo-admin"), false, "the receipt never carries an internal id");
      } finally { await context.close(); }
    });

    await t.test("Cajero in Pagos de Envíos: «Ir a Caja de envíos» from the detail leaves the keyboard in Caja, not on the receipt behind", async () => {
      const { context, page } = await open(cashierToken);
      try {
        const { reference, detail } = await receiptDetail(page);
        // No box in EUR for the Cajero: it goes to Caja, and the keyboard goes with it.
        await detail.locator(".remittance-cash-warning").getByText(`No tienes caja de envíos abierta hoy en EUR. Sin caja abierta no se puede registrar el pago. Ábrela en ${cashPlace}.`, { exact: true }).waitFor();
        await detail.getByRole("button", { name: "Ir a Caja de envíos", exact: true }).click();
        await detail.waitFor({ state: "detached" });
        const cash = page.getByRole("dialog", { name: "Cuadres Diarios", exact: true }).getByRole("region", { name: "Caja de envíos", exact: true });
        await cash.getByRole("button", { name: "Revisar apertura", exact: true }).waitFor();
        await page.waitForTimeout(300);
        assert.equal(await reference.evaluate((element: Element) => element === document.activeElement), false, "the receipt behind does not take the keyboard back");
        await waitForFocus(page, "[data-cash-opening-amount]");
        assert.equal(await cash.getByLabel("Moneda").inputValue(), "EUR");
        await page.keyboard.press("Enter");
        await page.getByRole("dialog", { name: "Abrir caja de envíos", exact: true }).waitFor();
        assert.equal(await detail.count(), 0, "Enter acts in Caja, not on the receipt behind");
      } finally { await context.close(); }
    });

    await t.test("Supervisor: every box of Cuadres Diarios → Caja de envíos names its operator", async () => {
      const { context, page } = await open(supervisorToken);
      try {
        await page.locator(".sidebar").getByRole("button", { name: "Cuadres Diarios", exact: true }).click();
        const settlements = page.getByRole("dialog", { name: "Cuadres Diarios", exact: true });
        await settlements.getByRole("group", { name: "Secciones de Cuadres Diarios", exact: true }).getByRole("button", { name: "Caja de envíos", exact: true }).click();
        const cash = settlements.getByRole("region", { name: "Caja de envíos", exact: true });
        await cash.locator("article").first().waitFor();
        const titles = (await cash.locator("article h2").allTextContents()).sort();
        assert.deepEqual(titles, ["DOP · Administración", "DOP · Cajero de práctica", "EUR · Administración", "USD · Cajero de práctica"]);
      } finally { await context.close(); }
    });

    await t.test("the side menu opens every group for Administración after the Cajero signs out in the same page", async () => {
      const { context, page } = await open(cashierToken);
      try {
        const groups = () => page.locator('nav[aria-label="Navegación principal"] .nav-group-trigger').evaluateAll((triggers: HTMLElement[]) => triggers.map((trigger) => [trigger.getAttribute("aria-label"), trigger.getAttribute("aria-expanded")]));
        assert.deepEqual(await groups(), [["ENVÍOS", "true"], ["REPORTES & MONITOREO", "true"]]);
        await page.getByRole("button", { name: "Abrir cuenta", exact: true }).click();
        await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
        await page.locator(".demo-role-action", { hasText: "Administrador" }).first().click();
        await page.locator("#admin-login-username").fill("admin@cyp.local");
        await page.locator("#admin-login-password").fill(DEMO_PASSWORD);
        await page.getByRole("button", { name: /Iniciar Sesión/ }).click();
        await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor();
        await page.waitForFunction(() => document.querySelectorAll('nav[aria-label="Navegación principal"] .nav-group-trigger').length === 5, undefined, { timeout: 5000 });
        await page.waitForFunction(() => Array.from(document.querySelectorAll('nav[aria-label="Navegación principal"] .nav-group-trigger')).every((trigger) => trigger.getAttribute("aria-expanded") === "true"), undefined, { timeout: 5000 })
          .catch(() => undefined);
        assert.deepEqual(await groups(), [["ARCHIVOS", "true"], ["COBROS", "true"], ["PAGOS", "true"], ["ENVÍOS", "true"], ["REPORTES & MONITOREO", "true"]]);
      } finally { await context.close(); }
    });

    await t.test("1366×768 with the box notice on view: the sending window keeps its whole form and at least three rows", async () => {
      for (const amount of [11_000, 12_000, 13_000, 14_000, 15_000]) await adminTransfer(amount);
      const { context, page } = await open(adminToken, { width: 1366, height: 768 });
      try {
        await page.locator(".desktop-launchers").getByRole("button", { name: "ENVÍO DE DINERO", exact: true }).click();
        const window = page.getByRole("dialog", { name: "Envíos de Dinero", exact: true });
        const region = window.getByRole("region", { name: "Envíos de Dinero", exact: true });
        const rows = region.locator(".remittance-transfer-table tbody tr"); await rows.nth(4).waitFor();
        await waitForFocus(page, '[data-client-side="sender"] input');
        await region.getByRole("combobox", { name: "Remitente", exact: true }).press("Escape");
        // Administración has no box in USD: the notice is on view, as every morning before opening the box.
        await region.getByLabel("Moneda del remitente").selectOption("USD");
        const warning = region.locator(".remittance-cash-warning"); await warning.waitFor();
        const content = await box(window.locator(".mdi-window-content")), list = await box(region.locator(".remittance-list-area .remittance-table-wrap"));
        const form = await region.locator("form.remittance-send-form").evaluate((element: HTMLElement) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
        let visible = 0;
        for (let index = 0; index < await rows.count(); index++) { const row = await box(rows.nth(index)); if (inside(row, content) && inside(row, list)) visible++; else break; }
        await page.screenshot({ path: path.join(output, "laptop-notice.png") });
        const third = await box(rows.nth(2));
        t.diagnostic(`1366×768 with notice: notice ${Math.round((await box(warning)).height)} px, form ${form.scroll}/${form.client} px, ${visible} full rows; third row ends at ${Math.round(third.y + third.height)}, list at ${Math.round(list.y + list.height)}, window at ${Math.round(content.y + content.height)}.`);
        assert.ok(form.scroll <= form.client + 1, `the empty form does not scroll (${form.scroll} > ${form.client})`);
        assert.ok(visible >= 3, `at least three sends are visible with the notice, not ${visible}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        // The notice keeps one line: its whole text stays in the page and in the title of the shortened line.
        const text = `No hay caja de envíos abierta hoy en USD para Administración. Sin caja abierta no se puede registrar el envío. Ábrela en ${cashPlace}. Si ya está abierta, pulsa Actualizar.`;
        assert.equal(await warning.locator("p").innerText(), text);
        assert.equal(await warning.locator("p").getAttribute("title"), text);
        assert.equal(await warning.getByRole("button", { name: "Ir a Caja de envíos", exact: true }).count(), 1);
      } finally { await context.close(); }
    });

    // 1280×600 is the useful area of a 1920×1080 screen at 150 % (or of a 1366×768 one with the browser bars).
    const shortWindow = async () => {
      const { context, page } = await open(adminToken, { width: 1280, height: 600 });
      await page.locator(".desktop-launchers").getByRole("button", { name: "ENVÍO DE DINERO", exact: true }).click();
      const window = page.getByRole("dialog", { name: "Envíos de Dinero", exact: true });
      const region = window.getByRole("region", { name: "Envíos de Dinero", exact: true });
      await region.locator(".remittance-transfer-table tbody tr").first().waitFor();
      await waitForFocus(page, '[data-client-side="sender"] input');
      const form = region.locator("form.remittance-send-form");
      const measure = () => form.evaluate((element: HTMLElement) => ({ scroll: element.scrollHeight, client: element.clientHeight, top: element.scrollTop, overflow: getComputedStyle(element).overflowY }));
      return { context, page, window, region, form, measure };
    };
    await t.test("1280×600: an open list of clients is drawn over the window and the form never covers the list of sends", async () => {
      const { context, page, window, region, measure } = await shortWindow();
      try {
        const senders = region.getByRole("listbox", { name: "Clientes para remitente", exact: true });
        await region.getByRole("combobox", { name: "Remitente", exact: true }).click(); await senders.waitFor();
        const content = await box(window.locator(".mdi-window-content")), listbox = await box(senders);
        assert.ok(inside(listbox, content), "the list of clients fits in the window");
        assert.equal(await page.evaluate(({ x, y }: { x: number; y: number }) => Boolean(document.elementFromPoint(x, y)?.closest('[role="listbox"]')), { x: listbox.x + listbox.width / 2, y: listbox.y + listbox.height - 4 }), true, "its last row is on top");
        // What is drawn over the bar of the list is that bar or the list of clients, never a field of the form.
        for (const part of [region.getByLabel("Buscar", { exact: true }), region.locator(".remittance-toolbar select")]) {
          const target = await box(part);
          const hit = await page.evaluate(({ x, y }: { x: number; y: number }) => { const element = document.elementFromPoint(x, y); return element?.closest('[role="listbox"]') ? "clients" : element?.closest(".remittance-list-area") ? "list" : element?.closest("form") ? "form" : String(element?.tagName); }, { x: target.x + target.width / 2, y: target.y + target.height / 2 });
          assert.notEqual(hit, "form", "the form is not drawn over the list of sends");
        }
        await page.screenshot({ path: path.join(output, "short-window-open-list.png") });
        const opened = await measure();
        t.diagnostic(`1280×600: form ${opened.scroll}/${opened.client} px, overflow ${opened.overflow}.`);
        assert.ok(opened.scroll > opened.client, "at this size the form scrolls inside");
        assert.equal(opened.overflow, "auto", "an open list does not take the scroll away from the form");
      } finally { await context.close(); }
    });

    await t.test("1280×600: scrolled inside the form, opening the recipient's list keeps the scroll and the field in sight", async () => {
      const { context, region, form, measure } = await shortWindow();
      try {
        await region.getByRole("combobox", { name: "Remitente", exact: true }).press("Escape");
        await region.getByRole("listbox", { name: "Clientes para remitente", exact: true }).waitFor({ state: "detached" });
        const recipientInput = region.getByRole("combobox", { name: "Destinatario", exact: true });
        const offset = await form.evaluate((element: HTMLElement) => { element.scrollTop = Math.min(24, element.scrollHeight - element.clientHeight); return element.scrollTop; });
        assert.ok(offset > 0);
        const formBox = await box(form), before = await box(recipientInput);
        assert.ok(inside(before, formBox), "the recipient is in sight before opening its list");
        await recipientInput.click();
        await region.getByRole("listbox", { name: "Clientes para destinatario", exact: true }).waitFor();
        assert.equal((await measure()).top, offset, "the form keeps its scroll");
        assert.ok(inside(await box(recipientInput), formBox), "the recipient stays in sight while its list is open");
      } finally { await context.close(); }
    });

    const sample = async (input: any) => { await input.page().waitForTimeout(250); return top(input); };
    // Where the sender field is: empty, with a client chosen and after the first key that edits that choice.
    const fieldSteps = async (region: any, code: string) => {
      const input = region.getByRole("combobox", { name: "Remitente", exact: true }); await input.waitFor();
      const empty = await sample(input);
      await input.fill(code); await region.getByRole("option").filter({ hasText: code }).first().click();
      const chosen = await sample(input);
      // With a client chosen, «Registrar cliente nuevo» keeps its place out of sight.
      const create = region.locator('[data-client-side="sender"] .remittance-client-create');
      const reserved = await create.count() === 1 && !(await create.isVisible());
      await input.focus(); await input.press("End"); await input.press("Backspace");
      const edited = await sample(input);
      return { empty, chosen, edited, reserved };
    };
    await t.test("the sender field of the sending window does not move when a client is chosen or its search is edited", async () => {
      const { context, page } = await open(adminToken);
      try {
        const positions = await fieldSteps(await sendingWindow(page), sender.code);
        t.diagnostic(`Administración: ${JSON.stringify(positions)}`);
        assert.deepEqual([positions.chosen, positions.edited, positions.reserved], [positions.empty, positions.empty, true]);
      } finally { await context.close(); }
    });

    await t.test("the sender field of the collector terminal does not move when a client is chosen or its search is edited", async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
      try {
        await context.addInitScript((token: string) => sessionStorage.setItem("cyp-collector-token", token), collectorToken);
        await block(context);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => pageErrors.push(error.message));
        await page.goto(`${origin}/collector/?view=remittances`);
        const own = (await ok("GET", "/api/envios/snapshot", undefined, collectorToken)).clients.find((client: { canSendFrom: boolean; active: boolean }) => client.canSendFrom && client.active);
        const positions = await fieldSteps(page.getByRole("region", { name: "Envíos de Dinero", exact: true }), own.code);
        t.diagnostic(`Collector terminal: ${JSON.stringify(positions)}`);
        assert.deepEqual([positions.chosen, positions.edited, positions.reserved], [positions.empty, positions.empty, true]);
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
    assert.equal(path.dirname(path.resolve(output)), path.resolve(os.tmpdir())); assert(path.basename(output).startsWith("cyp-envios-review-"));
    for (const name of ["cache-admin", "cache-collector", "admin", "collector", "admin.tsx", "collector.tsx"]) {
      const target = path.resolve(output, name); assert(target.startsWith(path.resolve(output) + path.sep)); fs.rmSync(target, { recursive: true, force: true });
    }
    t.diagnostic(`API requests seen by the proxy: ${requests.length}; blocked external origins: ${external.length}; screenshots: ${output}`);
  }
});
