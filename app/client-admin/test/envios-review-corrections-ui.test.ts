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
// window saves, operator names, a box closed today, the sections of Cuadres diarios, the menu after a sign-out,
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
    // Every section of the menu starts closed: the option is reached by opening its section.
    const menuOption = async (page: any, name: string) => {
      const option = page.locator(".sidebar").getByRole("button", { name, exact: true });
      const folded = page.locator(`.sidebar .nav-item[aria-label="${name}"]`);
      // Wait until the menu of the account is drawn: the option on view or folded in its section.
      await option.or(folded).first().waitFor({ state: "attached" });
      if (!await option.isVisible()) await page.locator(".sidebar .nav-group").filter({ has: page.locator(`.nav-item[aria-label="${name}"]`) }).locator(".nav-group-trigger").click();
      return option;
    };
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
    const cashPlace = "Cuadres y reportes → Cuadres diarios → Caja de remesas";
    const sendingWindow = async (page: any) => {
      await (await menuOption(page, "Envíos de dinero")).click();
      const envios = page.getByRole("region", { name: "Envíos de dinero", exact: true });
      await envios.getByRole("combobox", { name: "Remitente", exact: true }).waitFor();
      return envios;
    };
    // Opens a box from Cuadres diarios → Caja de remesas, choosing its operator and currency by hand.
    const openBox = async (page: any, operatorId: string, currency: string) => {
      await (await menuOption(page, "Cuadres diarios")).click();
      const settlements = page.getByRole("dialog", { name: "Cuadres diarios", exact: true });
      await settlements.getByRole("group", { name: "Secciones de Cuadres diarios", exact: true }).getByRole("button", { name: "Caja de remesas", exact: true }).click();
      const cash = settlements.getByRole("region", { name: "Caja de remesas", exact: true });
      await cash.getByLabel("Operador").selectOption(operatorId); await cash.getByLabel("Moneda").selectOption(currency);
      await cash.getByRole("button", { name: "Revisar apertura", exact: true }).click();
      await confirmIn(page, "Abrir caja de remesas");
    };

    await t.test("Admin: «Ir a Caja de remesas» prepares the box the notice names and takes the keyboard there", async () => {
      const { context, page } = await open(adminToken);
      try {
        const envios = await sendingWindow(page);
        await envios.getByLabel("Operador del envío").selectOption("demo-cashier"); await envios.getByLabel("Moneda del remitente").selectOption("USD");
        const warning = envios.locator(".remittance-cash-warning");
        assert.equal(await warning.locator("p").innerText(), `No hay caja de remesas abierta hoy en USD para Cajero de práctica. Sin caja abierta no se puede registrar el envío. Ábrela en ${cashPlace}. Si ya está abierta, pulsa Actualizar.`);
        await warning.getByRole("button", { name: "Ir a Caja de remesas", exact: true }).click();
        const cash = page.getByRole("dialog", { name: "Cuadres diarios", exact: true }).getByRole("region", { name: "Caja de remesas", exact: true });
        await cash.getByRole("button", { name: "Revisar apertura", exact: true }).waitFor();
        assert.deepEqual([await cash.getByLabel("Operador").inputValue(), await cash.getByLabel("Moneda").inputValue()], ["demo-cashier", "USD"]);
        await waitForFocus(page, "[data-cash-opening-amount]");
      } finally { await context.close(); }
    });

    await t.test("Admin: a quote calculated in Envíos stays while the box is opened in Cuadres diarios", async () => {
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
        await warning.getByText(/^No hay caja de remesas abierta hoy en EUR para Administración\./).waitFor();
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

    await t.test("Admin: the badge of the collector settlements (401) shows them although Cuadres diarios was on Caja de remesas", async () => {
      const { context, page } = await open(adminToken);
      try {
        await (await menuOption(page, "Cuadres diarios")).click();
        const settlements = page.getByRole("dialog", { name: "Cuadres diarios", exact: true });
        const sections = settlements.getByRole("group", { name: "Secciones de Cuadres diarios", exact: true });
        await sections.getByRole("button", { name: "Caja de remesas", exact: true }).click();
        await settlements.getByRole("region", { name: "Caja de remesas", exact: true }).waitFor();
        await page.getByTitle("Abrir Cuadres diarios", { exact: true }).click();
        await settlements.locator(".connected-settlements-mdi").waitFor({ timeout: 5000 });
        assert.equal(await sections.getByRole("button", { name: "Cuadres de cobradores", exact: true }).getAttribute("aria-pressed"), "true");
        assert.equal(await settlements.getByRole("region", { name: "Caja de remesas", exact: true }).count(), 0);
      } finally { await context.close(); }
    });

    await t.test("Cajero: a box of today already closed is not offered to open again", async () => {
      const opened = await ok("POST", "/api/envios/cajas/abrir", { operatorId: "demo-cashier", currency: "DOP", openingAmount: 0 }, cashierToken);
      await ok("POST", `/api/envios/cajas/${opened.id}/cerrar`, { countedAmount: 0 }, cashierToken);
      const { context, page } = await open(cashierToken);
      try {
        const envios = await sendingWindow(page);
        const warning = envios.locator(".remittance-cash-warning"); await warning.waitFor();
        assert.equal(await warning.locator("p").innerText(), "La caja de remesas de hoy en DOP de Cajero de práctica ya se cerró y no admite más movimientos: no se pueden registrar más envíos en DOP hasta la jornada siguiente.");
        assert.equal(await warning.getByRole("button").count(), 0, "no way to a box that cannot be opened");
        await (await menuOption(page, "Cuadres diarios")).click();
        const cash = page.getByRole("dialog", { name: "Cuadres diarios", exact: true }).getByRole("region", { name: "Caja de remesas", exact: true });
        await cash.locator("article").filter({ hasText: "DOP · Cajero de práctica" }).getByText(`${today} · Cerrada`, { exact: true }).waitFor();
        assert.equal(await cash.getByLabel("Moneda").inputValue(), "DOP");
        await cash.getByText("La caja de remesas de hoy en DOP de Cajero de práctica ya se cerró. Hay una sola caja por operador, moneda y día: no se puede abrir otra hasta la jornada siguiente.", { exact: true }).waitFor({ timeout: 5000 });
        assert.equal(await cash.getByRole("button", { name: "Revisar apertura", exact: true }).isDisabled(), true);
        // Another currency of the same day can still be opened.
        await cash.getByLabel("Moneda").selectOption("EUR");
        assert.equal(await cash.getByRole("button", { name: "Revisar apertura", exact: true }).isDisabled(), false);
      } finally { await context.close(); }
    });

    let pending: { envioReference: string; reciboReference: string } | undefined;
    const receiptDetail = async (page: any) => {
      await (await menuOption(page, "Entregas de dinero")).click();
      const payouts = page.getByRole("region", { name: "Entregas de dinero", exact: true });
      await waitForFocus(page, "[data-receipt-search]");
      const reference = payouts.getByRole("button", { name: pending!.reciboReference, exact: true });
      await reference.click();
      const detail = page.getByRole("dialog", { name: `${pending!.envioReference} · ${pending!.reciboReference}`, exact: true });
      await detail.getByRole("heading", { name: "Registro del recibo", exact: true }).waitFor();
      return { reference, detail };
    };
    await t.test("Cajero in Entregas de dinero: the detail and the printed receipt of another operator's transfer name that operator", async () => {
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

    await t.test("Cajero in Entregas de dinero: «Ir a Caja de remesas» from the detail leaves the keyboard in Caja, not on the receipt behind", async () => {
      const { context, page } = await open(cashierToken);
      try {
        const { reference, detail } = await receiptDetail(page);
        // No box in EUR for the Cajero: it goes to Caja, and the keyboard goes with it.
        await detail.locator(".remittance-cash-warning").getByText(`No tienes caja de remesas abierta hoy en EUR. Sin caja abierta no se puede registrar la entrega. Ábrela en ${cashPlace}.`, { exact: true }).waitFor();
        await detail.getByRole("button", { name: "Ir a Caja de remesas", exact: true }).click();
        await detail.waitFor({ state: "detached" });
        const cash = page.getByRole("dialog", { name: "Cuadres diarios", exact: true }).getByRole("region", { name: "Caja de remesas", exact: true });
        await cash.getByRole("button", { name: "Revisar apertura", exact: true }).waitFor();
        await page.waitForTimeout(300);
        assert.equal(await reference.evaluate((element: Element) => element === document.activeElement), false, "the receipt behind does not take the keyboard back");
        await waitForFocus(page, "[data-cash-opening-amount]");
        assert.equal(await cash.getByLabel("Moneda").inputValue(), "EUR");
        await page.keyboard.press("Enter");
        await page.getByRole("dialog", { name: "Abrir caja de remesas", exact: true }).waitFor();
        assert.equal(await detail.count(), 0, "Enter acts in Caja, not on the receipt behind");
      } finally { await context.close(); }
    });

    await t.test("Supervisor: every box of Cuadres diarios → Caja de remesas names its operator", async () => {
      const { context, page } = await open(supervisorToken);
      try {
        await (await menuOption(page, "Cuadres diarios")).click();
        const settlements = page.getByRole("dialog", { name: "Cuadres diarios", exact: true });
        await settlements.getByRole("group", { name: "Secciones de Cuadres diarios", exact: true }).getByRole("button", { name: "Caja de remesas", exact: true }).click();
        const cash = settlements.getByRole("region", { name: "Caja de remesas", exact: true });
        await cash.locator("article").first().waitFor();
        const titles = (await cash.locator("article h2").allTextContents()).sort();
        assert.deepEqual(titles, ["DOP · Administración", "DOP · Cajero de práctica", "EUR · Administración", "USD · Cajero de práctica"]);
      } finally { await context.close(); }
    });

    await t.test("the side menu starts closed and each account finds it as it left it, also when another signs in on the same page", async () => {
      const { context, page } = await open(cashierToken);
      try {
        const groups = () => page.locator('nav[aria-label="Navegación principal"] .nav-group-trigger').evaluateAll((triggers: HTMLElement[]) => triggers.map((trigger) => [trigger.getAttribute("aria-label"), trigger.getAttribute("aria-expanded")]));
        const signIn = async (email: string) => {
          await page.getByRole("button", { name: "Abrir cuenta", exact: true }).click();
          await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
          // One sign-in page for every account: no choice of portal before it.
          assert.equal(await page.getByRole("button", { name: /^Administrador/ }).count(), 0);
          await page.locator("#admin-login-username").fill(email);
          await page.locator("#admin-login-password").fill(DEMO_PASSWORD);
          await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
          await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor();
        };
        assert.deepEqual(await groups(), [["REMESAS", "false"], ["CUADRES Y REPORTES", "false"]]);
        await page.locator(".sidebar").getByRole("button", { name: "REMESAS", exact: true }).click();
        await signIn("admin@cyp.local");
        await page.waitForFunction(() => document.querySelectorAll('nav[aria-label="Navegación principal"] .nav-group-trigger').length === 7, undefined, { timeout: 5000 });
        // The two sections with a single screen are buttons that open it: they never unfold.
        assert.deepEqual(await groups(), [["Configuración de administración", null], ["Clientes", null], ["COBROS", "false"], ["PAGOS", "false"], ["REMESAS", "false"], ["CUADRES Y REPORTES", "false"], ["MONITOREO", "false"]]);
        await page.locator(".sidebar").getByRole("button", { name: "COBROS", exact: true }).click();
        await signIn(DEMO_CASHIER_EMAIL);
        await page.waitForFunction(() => document.querySelectorAll('nav[aria-label="Navegación principal"] .nav-group-trigger').length === 2, undefined, { timeout: 5000 });
        assert.deepEqual(await groups(), [["REMESAS", "true"], ["CUADRES Y REPORTES", "false"]]);
        await signIn("admin@cyp.local");
        await page.waitForFunction(() => document.querySelectorAll('nav[aria-label="Navegación principal"] .nav-group-trigger').length === 7, undefined, { timeout: 5000 });
        assert.equal((await groups()).find(([name]: [string]) => name === "COBROS")?.[1], "true");
      } finally { await context.close(); }
    });

    await t.test("1366×768 with the box notice on view: the sending window keeps its whole form and at least three rows", async () => {
      for (const amount of [11_000, 12_000, 13_000, 14_000, 15_000]) await adminTransfer(amount);
      const { context, page } = await open(adminToken, { width: 1366, height: 768 });
      try {
        await (await menuOption(page, "Envíos de dinero")).click();
        const window = page.getByRole("dialog", { name: "Envíos de dinero", exact: true });
        const region = window.getByRole("region", { name: "Envíos de dinero", exact: true });
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
        const text = `No hay caja de remesas abierta hoy en USD para Administración. Sin caja abierta no se puede registrar el envío. Ábrela en ${cashPlace}. Si ya está abierta, pulsa Actualizar.`;
        assert.equal(await warning.locator("p").innerText(), text);
        assert.equal(await warning.locator("p").getAttribute("title"), text);
        assert.equal(await warning.getByRole("button", { name: "Ir a Caja de remesas", exact: true }).count(), 1);
      } finally { await context.close(); }
    });

    // 1280×600 is the useful area of a 1920×1080 screen at 150 % (or of a 1366×768 one with the browser bars).
    const shortWindow = async () => {
      const { context, page } = await open(adminToken, { width: 1280, height: 600 });
      await (await menuOption(page, "Envíos de dinero")).click();
      const window = page.getByRole("dialog", { name: "Envíos de dinero", exact: true });
      const region = window.getByRole("region", { name: "Envíos de dinero", exact: true });
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
        const positions = await fieldSteps(page.getByRole("region", { name: "Envíos de dinero", exact: true }), own.code);
        t.diagnostic(`Collector terminal: ${JSON.stringify(positions)}`);
        assert.deepEqual([positions.chosen, positions.edited, positions.reserved], [positions.empty, positions.empty, true]);
      } finally { await context.close(); }
    });

    // Corrections of the review of the merge with PR 37 (modeless receipt windows, filters and focus).
    const receiptOf = (page: any, transfer: { envioReference: string; reciboReference: string }) => {
      const title = `${transfer.envioReference} · ${transfer.reciboReference}`;
      return { title, detail: page.getByRole("dialog", { name: title, exact: true }) };
    };
    const receiptShown = (detail: any) => detail.getByRole("heading", { name: "Registro del recibo", exact: true }).waitFor();
    const activeWindow = (page: any, name: string) => page.locator(`section.mdi-window[aria-label="${name}"]`).evaluate((element: Element) => element.classList.contains("focused"));
    await t.test("Admin, sending window: Buscar and Estado survive «Limpiar formulario» and a confirmed send, and the cursor returns to Remitente with a receipt open", async () => {
      const shown = await adminTransfer(4_000);
      const { context, page } = await open(adminToken);
      try {
        const envios = await sendingWindow(page);
        const search = envios.getByLabel("Buscar", { exact: true }), status = envios.locator(".remittance-toolbar select");
        await search.fill(shown.envioReference); await status.selectOption("pending");
        // The receipt of an earlier send stays open, set aside behind the window while the next one is captured.
        await envios.getByRole("button", { name: shown.envioReference, exact: true }).click();
        const { detail } = receiptOf(page, shown); await receiptShown(detail);
        await page.getByRole("dialog", { name: "Envíos de dinero", exact: true }).locator(".mdi-window-titlebar > span").click({ position: { x: 5, y: 8 } });
        await envios.getByRole("button", { name: "Limpiar formulario", exact: true }).click();
        await waitForFocus(page, '[data-client-side="sender"] input');
        assert.deepEqual([await search.inputValue(), await status.inputValue()], [shown.envioReference, "pending"], "«Limpiar formulario» empties only the capture");
        await choose(envios, "Remitente", sender.code); await choose(envios, "Destinatario", recipient.code);
        await envios.getByLabel("Moneda del remitente").selectOption("DOP"); await envios.getByLabel("Moneda del destinatario").selectOption("DOP");
        await envios.getByLabel("Monto a enviar (DOP)", { exact: true }).fill("150");
        await envios.getByRole("button", { name: "Calcular cotización", exact: true }).click();
        await envios.getByRole("button", { name: "Revisar y confirmar envío", exact: true }).click();
        await confirmIn(page, "Confirmar envío");
        const print = page.getByRole("dialog", { name: "¿Quieres imprimir el recibo?", exact: true });
        await print.getByRole("button", { name: "No imprimir", exact: true }).click(); await print.waitFor({ state: "detached" });
        await waitForFocus(page, '[data-client-side="sender"] input');
        assert.equal(await envios.getByRole("listbox", { name: "Clientes para remitente", exact: true }).count(), 0, "the cursor waits in the sender without unfolding its catalog");
        assert.equal(await envios.getByRole("combobox", { name: "Remitente", exact: true }).inputValue(), "", "the confirmed send emptied the capture");
        assert.equal(await detail.isVisible(), true, "the earlier receipt is still open");
        assert.deepEqual([await search.inputValue(), await status.inputValue()], [shown.envioReference, "pending"], "a confirmed send keeps the filters of the list below");
      } finally { await context.close(); }
    });

    await t.test("Admin: closing a receipt with Escape or × gives the keyboard back to its reference and makes its window the active one again", async () => {
      const shown = await adminTransfer(4_500);
      const { context, page } = await open(adminToken);
      try {
        const envios = await sendingWindow(page);
        const reference = envios.getByRole("button", { name: shown.envioReference, exact: true });
        const { title, detail } = receiptOf(page, shown);
        for (const close of ["Escape", "×"] as const) {
          await reference.focus(); await page.keyboard.press("Enter");
          await receiptShown(detail); await waitForFocus(page, ".remittance-receipt-window");
          assert.equal(await activeWindow(page, "Envíos de dinero"), false, "the receipt is the active window");
          if (close === "Escape") await page.keyboard.press("Escape");
          else await detail.getByRole("button", { name: `Cerrar ${title}`, exact: true }).click();
          await detail.waitFor({ state: "detached" });
          assert.equal(await reference.evaluate((element: Element) => element === document.activeElement), true, `${close} gives the keyboard back to ${shown.envioReference}`);
          await page.waitForFunction(() => document.querySelector('section.mdi-window[aria-label="Envíos de dinero"]')?.classList.contains("focused") === true, undefined, { timeout: 5000 }).catch(() => undefined);
          assert.equal(await activeWindow(page, "Envíos de dinero"), true, `after ${close} the sending window is the active one`);
        }
      } finally { await context.close(); }
    });

    await t.test("Admin: the minimized receipts of Envíos and Entregas de dinero do not cover each other, and choosing a reference again restores its receipt", async () => {
      const sent = await adminTransfer(4_600), paid = await adminTransfer(4_700);
      const { context, page } = await open(adminToken);
      try {
        const envios = await sendingWindow(page);
        const sentReference = envios.getByRole("button", { name: sent.envioReference, exact: true });
        const first = receiptOf(page, sent), second = receiptOf(page, paid);
        await sentReference.click(); await receiptShown(first.detail);
        await first.detail.getByRole("button", { name: `Minimizar ${first.title}`, exact: true }).click(); await first.detail.waitFor({ state: "hidden" });
        await (await menuOption(page, "Entregas de dinero")).click();
        const payouts = page.getByRole("region", { name: "Entregas de dinero", exact: true });
        await payouts.getByRole("button", { name: paid.reciboReference, exact: true }).click(); await receiptShown(second.detail);
        await second.detail.getByRole("button", { name: `Minimizar ${second.title}`, exact: true }).click(); await second.detail.waitFor({ state: "hidden" });
        const restoreFirst = page.getByRole("button", { name: `Restaurar ${first.title}`, exact: true }), restoreSecond = page.getByRole("button", { name: `Restaurar ${second.title}`, exact: true });
        const [a, b] = [await box(restoreFirst), await box(restoreSecond)];
        assert.ok(a.y + a.height <= b.y || b.y + b.height <= a.y || a.x + a.width <= b.x || b.x + b.width <= a.x, `the restore buttons do not overlap: ${JSON.stringify([a, b])}`);
        for (const [title, part] of [[first.title, a], [second.title, b]] as const)
          assert.equal(await page.evaluate(({ x, y }: { x: number; y: number }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), { x: part.x + part.width / 2, y: part.y + part.height / 2 }), `Restaurar ${title}`, "each restore button is the one under the pointer");
        await page.screenshot({ path: path.join(output, "minimized-receipts.png") });
        // Choosing the reference of the minimized receipt again brings it back on top, with the keyboard.
        await (await menuOption(page, "Envíos de dinero")).click();
        await sentReference.click();
        await first.detail.waitFor({ state: "visible", timeout: 5000 });
        await waitForFocus(page, ".remittance-receipt-window");
        assert.equal(await restoreFirst.count(), 0, "its restore button is gone");
        assert.equal(await restoreSecond.count(), 1, "the other minimized receipt waits in its place");
        const zIndex = (locator: any) => locator.evaluate((element: Element) => Number(getComputedStyle(element).zIndex));
        assert.ok(await zIndex(first.detail) > await zIndex(page.getByRole("dialog", { name: "Envíos de dinero", exact: true })), "the receipt is on top of its window");
      } finally { await context.close(); }
    });

    await t.test("the collector terminal: Buscar hides the capture without losing it; «Volver a la captura» shows the draft and «Nuevo envío» starts another", async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
      try {
        await context.addInitScript((token: string) => sessionStorage.setItem("cyp-collector-token", token), collectorToken);
        await block(context);
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => pageErrors.push(error.message));
        await page.goto(`${origin}/collector/?view=remittances`);
        const own = (await ok("GET", "/api/envios/snapshot", undefined, collectorToken)).clients.find((client: { canSendFrom: boolean; active: boolean }) => client.canSendFrom && client.active);
        const workspace = page.getByRole("region", { name: "Envíos de dinero", exact: true });
        const form = workspace.getByRole("form", { name: "Nuevo envío", exact: true });
        await choose(workspace, "Remitente", own.code);
        const amount = workspace.getByLabel(/^Monto a enviar \(/); await amount.fill("1500");
        const selection = workspace.locator('[data-client-side="sender"] .remittance-client-selection');
        const chosen = await selection.innerText(); assert.match(chosen, /^Seleccionado: /);
        const search = workspace.getByLabel("Buscar", { exact: true }); await search.fill("ENV");
        await form.waitFor({ state: "detached" });
        await workspace.getByRole("button", { name: "Volver a la captura", exact: true }).click();
        await form.waitFor();
        assert.deepEqual([await amount.inputValue(), await selection.innerText(), await search.inputValue()], ["1500", chosen, "ENV"], "the draft comes back as it was, and the search stays");
        await waitForFocus(page, '[data-client-side="sender"] input');
        assert.equal(await workspace.getByRole("listbox", { name: "Clientes para remitente", exact: true }).count(), 0, "the cursor waits in the sender without unfolding its catalog over the draft");
        await search.focus(); await form.waitFor({ state: "detached" });
        await workspace.getByRole("button", { name: "Nuevo envío", exact: true }).click(); await form.waitFor();
        assert.deepEqual([await amount.inputValue(), await search.inputValue()], ["", ""], "«Nuevo envío» clears the draft and the filters");
        assert.equal(await workspace.getByRole("button", { name: "Volver a la captura", exact: true }).count(), 0);
      } finally { await context.close(); }
    });

    await t.test("Admin: the review of a cancellation or a payment asked from a receipt does not bring its window over the receipt", async () => {
      const toCancel = await adminTransfer(4_800), toPay = await adminTransfer(4_900);
      const { context, page } = await open(adminToken);
      try {
        const zIndex = (locator: any) => locator.evaluate((element: Element) => Number(getComputedStyle(element).zIndex));
        const onTop = async (receipt: any, name: string, moment: string) => {
          assert.ok(await zIndex(receipt) > await zIndex(page.getByRole("dialog", { name, exact: true })), `${moment}: the receipt stays above ${name}`);
          assert.equal(await activeWindow(page, name), false, `${moment}: ${name} is not the active window`);
        };
        const envios = await sendingWindow(page);
        const cancel = receiptOf(page, toCancel);
        await envios.getByRole("button", { name: toCancel.envioReference, exact: true }).click(); await receiptShown(cancel.detail);
        await cancel.detail.getByLabel("Motivo de cancelación", { exact: true }).fill("Revisión del orden de las ventanas");
        await cancel.detail.getByRole("button", { name: "Revisar cancelación", exact: true }).click();
        await page.getByRole("dialog", { name: "Cancelar envío pendiente", exact: true }).waitFor();
        await onTop(cancel.detail, "Envíos de dinero", "reviewing the cancellation");
        await confirmIn(page, "Cancelar envío pendiente");
        await cancel.detail.locator(".remittance-status.cancelled").waitFor();
        await onTop(cancel.detail, "Envíos de dinero", "after the cancellation");
        await (await menuOption(page, "Entregas de dinero")).click();
        const payouts = page.getByRole("region", { name: "Entregas de dinero", exact: true });
        const pay = receiptOf(page, toPay);
        await payouts.getByRole("button", { name: toPay.reciboReference, exact: true }).click(); await receiptShown(pay.detail);
        await pay.detail.getByRole("button", { name: "Registrar entrega", exact: true }).click();
        await page.getByRole("dialog", { name: "Confirmar entrega al destinatario", exact: true }).waitFor();
        await onTop(pay.detail, "Entregas de dinero", "reviewing the payment");
        await confirmIn(page, "Confirmar entrega al destinatario");
        await pay.detail.locator(".remittance-status.paid").waitFor();
        await onTop(pay.detail, "Entregas de dinero", "after the payment");
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
