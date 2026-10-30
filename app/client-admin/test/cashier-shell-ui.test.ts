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
// Known attempts the shell makes or the host injects; they are blocked like any other external request.
const knownBlockedOrigins = ["http://me.kis.v2.scr.kaspersky-labs.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"];

// Actual Admin shell and collector terminal, styles, API and MemoryStore with synthetic data:
// Envíos de dinero only sends, Entregas de dinero pays and the box of envíos lives in Cuadres Diarios.
// No .env, shared data, browser download or external HTTP.
test("Envíos de dinero, Entregas de dinero and Cuadres Diarios work for Admin and Cajero; the collector terminal keeps its sections", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-cashier-shell-"));
  const state = seed(), now = new Date(), today = businessDate(now);
  const admin = { id: "demo-admin", name: "Administración", role: "admin" as const };
  setDailyRate(state, admin, { currency: "USD", rate: "60", date: today }, now);
  setCommissionPolicy(state, admin, { transactionCommissionBps: 500, managerCommissionBps: 200 }, now);
  enrichCashierDemo(state, now);
  const sender = state.clients.find((client) => client.id === "cli-1")!, recipient = state.clients.find((client) => client.id === "cli-5")!;
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-cashier-shell-secret-at-least-32-chars", origins: [], collectorUrl: "/collector/" });
  // Each request comes from its own loopback address so the per-address rate limits never mix steps.
  let address = 0;
  const remoteAddress = () => { address += 1; return `10.63.${Math.floor(address / 250) % 250}.${address % 250 + 1}`; };
  const login = async (email: string, password: string) => {
    const reply = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: remoteAddress(), payload: { email, password } });
    assert.equal(reply.statusCode, 200, reply.body); return reply.json().token as string;
  };
  const adminToken = await login("admin@cyp.local", DEMO_PASSWORD);
  const cashierToken = await login(DEMO_CASHIER_EMAIL, DEMO_PASSWORD);
  const collectorToken = await login("collector@cyp.local", DEMO_PASSWORD);
  const ok = async (method: "GET" | "POST", url: string, payload?: object, token = adminToken) => {
    const reply = await app.inject({ method, url, remoteAddress: remoteAddress(), headers: { authorization: `Bearer ${token}`, ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}) }, ...(payload ? { payload } : {}) });
    assert.equal(reply.statusCode, 200, `${url}: ${reply.body}`); return reply.json();
  };
  // An Admin transfer saved directly in the ledger (its box in the source currency must be open).
  const adminTransfer = (amount: number, destinationCurrency: "DOP" | "USD" = "DOP") => store.transaction((current) => {
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
        build: { outDir: path.join(output, surface), emptyOutDir: false, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } }, lib: { entry: fixture, formats: ["es"], fileName: () => `${surface}.js`, cssFileName: surface } } });
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
      } catch { response.writeHead(500); response.end('{"error":{"message":"Synthetic cashier shell fixture failure"}}'); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const listening = server.address(); assert(listening && typeof listening !== "string");
    const origin = `http://127.0.0.1:${listening.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    const open = async (token: string, viewport = { width: 1440, height: 1000 }) => {
      const context = await browser.newContext({ viewport, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
      await context.addInitScript((token: string) => sessionStorage.setItem("cyp-admin-token", token), token);
      await context.route("**/*", (route: any) => { const target = new URL(route.request().url()); if (target.origin === origin) return route.continue(); external.push(target.origin); return route.abort("blockedbyclient"); });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on("pageerror", (error: Error) => pageErrors.push(error.message));
      await page.goto(`${origin}/admin/`); await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor();
      return { context, page };
    };
    // Groups of the side menu with their items, as the menu names them.
    const menu = (page: any) => page.locator('nav[aria-label="Navegación principal"] .nav-group').evaluateAll((groups: HTMLElement[]) => groups.map((group) =>
      [group.querySelector(".nav-group-trigger")?.getAttribute("aria-label"), Array.from(group.querySelectorAll(".nav-group-items .nav-item"), (item) => item.getAttribute("aria-label"))]));
    // The windows open from the side menu: open the section that holds the option, then the option.
    const openFromMenu = async (page: any, name: string) => {
      const option = page.locator(".sidebar").getByRole("button", { name, exact: true });
      const folded = page.locator(`.sidebar .nav-item[aria-label="${name}"]`);
      await option.or(folded).first().waitFor({ state: "attached" });
      if (!await option.isVisible()) await page.locator(".sidebar .nav-group").filter({ has: page.locator(`.nav-item[aria-label="${name}"]`) }).locator(".nav-group-trigger").click();
      await option.click();
    };
    // The quick buttons above the desktop were removed: everything opens from the menu.
    const launchers = (page: any) => page.locator(".desktop-launchers").count();
    const focused = (locator: any) => locator.evaluate((element: Element) => element === document.activeElement);
    const waitForFocus = (page: any, selector: string) => page.waitForFunction((selector: string) => document.activeElement?.matches(selector) === true, selector);
    const choose = async (region: any, label: string, code: string) => {
      const input = region.getByRole("combobox", { name: label, exact: true }); await input.fill(code);
      await region.getByRole("option").filter({ hasText: code }).first().click();
    };
    const send = async (page: any, region: any, amount: string, destination: "DOP" | "USD") => {
      await choose(region, "Remitente", sender.code); await choose(region, "Destinatario", recipient.code);
      await region.getByLabel("Moneda del remitente").selectOption("DOP"); await region.getByLabel("Moneda del destinatario").selectOption(destination);
      await region.getByLabel("Monto a enviar (DOP)", { exact: true }).fill((amount.includes(".") ? amount : `${amount}.00`));
      await region.getByRole("button", { name: "Calcular cotización", exact: true }).click();
      await region.getByRole("button", { name: "Revisar y confirmar envío", exact: true }).click();
      const saved = page.waitForResponse((reply: any) => reply.request().method() === "POST" && new URL(reply.url()).pathname === "/api/envios");
      await page.getByRole("dialog", { name: "Confirmar envío", exact: true }).getByRole("button", { name: "Aceptar", exact: true }).click();
      const reply = await saved; assert.equal(reply.status(), 200);
      const print = page.getByRole("dialog", { name: "¿Quieres imprimir el recibo?", exact: true }); await print.waitFor();
      await print.getByRole("button", { name: "No imprimir", exact: true }).click();
      return reply.json() as Promise<{ id: string; envioReference: string; reciboReference: string }>;
    };
    const confirmIn = async (page: any, title: string) => {
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await dialog.getByRole("button", { name: "Confirmar", exact: true }).click(); await dialog.waitFor({ state: "detached" });
    };
    const cashPlace = "Cuadres y reportes → Cuadres Diarios → Caja de remesas";
    let adminSent: { id: string; envioReference: string; reciboReference: string };

    await t.test("Admin: the REMESAS group, a sending window without sections and its box notice leading to Cuadres Diarios → Caja de remesas", async () => {
      const { context, page } = await open(adminToken);
      try {
        const groups = await menu(page);
        // Remesas holds only the two remittance windows; the cash for collectors goes with Pagos.
        assert.deepEqual(groups.find(([name]: [string]) => name === "REMESAS")?.[1], ["Envíos de dinero", "Entregas de dinero"]);
        assert.deepEqual(groups.find(([name]: [string]) => name === "PAGOS")?.[1], ["Descargos", "Pagos", "Entregas de Dinero a Cobradores"]);
        const trigger = page.locator(".sidebar").getByRole("button", { name: "REMESAS", exact: true });
        assert.equal(await trigger.getAttribute("data-short-label"), "RE"); assert.equal(await trigger.getAttribute("aria-expanded"), "false", "every section starts closed");
        assert.equal(await launchers(page), 0, "no quick buttons above the desktop");
        assert.equal(await page.getByTitle("Abrir Cuadres Diarios", { exact: true }).count(), 1, "the settlement badge stays for 401");
        assert.equal(await page.getByText(/cobradores en calle$/).count(), 1);
        await openFromMenu(page, "Envíos de dinero");
        const envios = page.getByRole("region", { name: "Envíos de dinero", exact: true });
        const senderInput = envios.getByRole("combobox", { name: "Remitente", exact: true }); await senderInput.waitFor();
        await waitForFocus(page, '[data-client-side="sender"] input');
        assert.equal(await focused(senderInput), true, "the cursor starts in the sender");
        assert.equal(await envios.getByRole("navigation", { name: "Secciones de remesas", exact: true }).count(), 0);
        assert.equal(await envios.getByRole("button", { name: "Nuevo envío", exact: true }).count(), 0);
        assert.equal(await envios.getByRole("button", { name: "Limpiar formulario", exact: true }).count(), 1);
        const warning = envios.locator(".remittance-cash-warning");
        assert.equal(await warning.locator("p").innerText(), `No hay caja de remesas abierta hoy en DOP para Administración. Sin caja abierta no se puede registrar el envío. Ábrela en ${cashPlace}. Si ya está abierta, pulsa Actualizar.`);
        await warning.getByRole("button", { name: "Ir a Caja de remesas", exact: true }).click();
        const settlements = page.getByRole("dialog", { name: "Cuadres Diarios", exact: true });
        const sections = settlements.getByRole("group", { name: "Secciones de Cuadres Diarios", exact: true });
        assert.equal(await sections.getByRole("button", { name: "Caja de remesas", exact: true }).getAttribute("aria-pressed"), "true");
        assert.equal(await sections.getByRole("button", { name: "Cuadres de cobradores", exact: true }).getAttribute("aria-pressed"), "false");
        const cash = settlements.getByRole("region", { name: "Caja de remesas", exact: true });
        assert.equal(await settlements.locator(".connected-settlements-mdi").count(), 0, "only the shown section is mounted");
        // Administración chooses the operator; it starts on its own account.
        assert.equal(await cash.locator("select").first().inputValue(), admin.id);
        await cash.getByRole("button", { name: "Revisar apertura", exact: true }).click();
        await confirmIn(page, "Abrir caja de remesas");
        await cash.locator("article").filter({ hasText: "DOP · Administración" }).waitFor();
        await page.screenshot({ path: path.join(output, "admin-cash-section.png") });
        // The other open window learns of the new box without pressing Actualizar.
        await warning.waitFor({ state: "detached" });
        await sections.getByRole("button", { name: "Cuadres de cobradores", exact: true }).click();
        await settlements.locator(".connected-settlements-mdi").getByRole("button", { name: "Generar cuadre", exact: true }).waitFor();
        assert.equal(await cash.count(), 0);
        assert.equal(await sections.getByRole("button", { name: "Cuadres de cobradores", exact: true }).getAttribute("aria-pressed"), "true");
      } finally { await context.close(); }
    });

    await t.test("Admin: Remesas → Entregas de dinero finds the transfer, asks for the box in the destination currency and then delivers", async () => {
      const { context, page } = await open(adminToken);
      try {
        await openFromMenu(page, "Envíos de dinero");
        const envios = page.getByRole("region", { name: "Envíos de dinero", exact: true });
        adminSent = await send(page, envios, "600", "USD");
        await waitForFocus(page, '[data-client-side="sender"] input');
        assert.equal(await envios.getByRole("combobox", { name: "Remitente", exact: true }).inputValue(), "");
        // Remesas is already open (Envíos de dinero was opened from it) and shows both windows.
        assert.equal(await page.locator(".sidebar").getByRole("button", { name: "REMESAS", exact: true }).getAttribute("aria-expanded"), "true");
        await page.locator(".sidebar").getByRole("button", { name: "Entregas de dinero", exact: true }).click();
        const payouts = page.getByRole("region", { name: "Entregas de dinero", exact: true });
        await payouts.getByRole("heading", { name: "Entregas de dinero", level: 1 }).waitFor();
        assert.equal(await payouts.getByRole("navigation", { name: "Secciones de remesas", exact: true }).count(), 0);
        assert.equal(await page.getByRole("search", { name: "Buscar envío para entregar", exact: true }).count(), 0, "the cash for collectors has no remittance search");
        const search = payouts.getByLabel("Buscar", { exact: true });
        await waitForFocus(page, "[data-receipt-search]");
        await search.fill(adminSent.reciboReference); assert.equal(await payouts.locator(".remittance-toolbar select").inputValue(), "pending");
        const reference = payouts.getByRole("button", { name: adminSent.reciboReference, exact: true });
        await reference.click();
        const detail = page.getByRole("dialog", { name: `${adminSent.envioReference} · ${adminSent.reciboReference}`, exact: true });
        await detail.locator(".remittance-cash-warning").getByText(`No tienes caja de remesas abierta hoy en USD. Sin caja abierta no se puede registrar la entrega. Ábrela en ${cashPlace}.`, { exact: true }).waitFor();
        assert.equal(await detail.getByRole("button", { name: "Ir a Caja de remesas", exact: true }).count(), 1);
        assert.equal(await detail.getByRole("button", { name: "Revisar cancelación", exact: true }).count(), 0, "Entregas de dinero only pays");
        await detail.getByRole("button", { name: `Cerrar ${adminSent.envioReference} · ${adminSent.reciboReference}`, exact: true }).click();
        await waitForFocus(page, "[data-receipt-search]");
        await ok("POST", "/api/envios/cajas/abrir", { operatorId: admin.id, currency: "USD", openingAmount: 100_000 });
        await payouts.getByRole("button", { name: "Actualizar", exact: true }).click();
        await page.waitForFunction(() => document.querySelector('section[aria-label="Entregas de dinero"] .remittance-heading button')?.textContent === "Actualizar");
        await reference.click();
        await detail.getByRole("button", { name: "Registrar entrega", exact: true }).waitFor();
        assert.equal(await detail.locator(".remittance-cash-warning").count(), 0);
        await detail.getByRole("button", { name: "Registrar entrega", exact: true }).click();
        await confirmIn(page, "Confirmar entrega al destinatario");
        await detail.locator(".remittance-status.paid").waitFor();
        const paid = (await store.read()).remittances.transfers.find((row) => row.id === adminSent.id)!;
        assert.equal(paid.status, "paid"); assert.equal(paid.paidBy, admin.id);
        await detail.getByRole("button", { name: `Cerrar ${adminSent.envioReference} · ${adminSent.reciboReference}`, exact: true }).click();
        await waitForFocus(page, "[data-receipt-search]");
        assert.equal(await focused(search), true, "the cursor returns to Buscar");
      } finally { await context.close(); }
    });

    await t.test("1366×768: the sending window shows its whole empty form and at least three rows, without horizontal scroll", async () => {
      for (const amount of [11_000, 12_000, 13_000, 14_000]) await adminTransfer(amount);
      const { context, page } = await open(adminToken, { width: 1366, height: 768 });
      try {
        await openFromMenu(page, "Envíos de dinero");
        const window = page.getByRole("dialog", { name: "Envíos de dinero", exact: true });
        const region = window.getByRole("region", { name: "Envíos de dinero", exact: true });
        const rows = region.locator(".remittance-transfer-table tbody tr"); await rows.nth(4).waitFor();
        // The sender has the cursor without unfolding the catalog over the form; a click shows its clients and Escape folds them.
        const senderInput = region.getByRole("combobox", { name: "Remitente", exact: true });
        await waitForFocus(page, '[data-client-side="sender"] input');
        const clients = region.getByRole("listbox", { name: "Clientes para remitente", exact: true });
        assert.equal(await clients.count(), 0, "opening the window does not unfold the client list over the form");
        await senderInput.click(); await clients.waitFor();
        await senderInput.press("Escape"); await clients.waitFor({ state: "detached" });
        const box = async (locator: any) => { const value = await locator.boundingBox(); assert.ok(value, "the element is painted"); return value as { x: number; y: number; width: number; height: number }; };
        const inside = (part: { y: number; height: number }, frame: { y: number; height: number }) => part.y >= frame.y - 0.5 && part.y + part.height <= frame.y + frame.height + 0.5;
        const content = await box(window.locator(".mdi-window-content")), list = await box(region.locator(".remittance-list-area .remittance-table-wrap"));
        for (const [name, part] of [["Remitente", region.getByRole("combobox", { name: "Remitente", exact: true })], ["Calcular cotización", region.getByRole("button", { name: "Calcular cotización", exact: true })],
          ["Limpiar formulario", region.getByRole("button", { name: "Limpiar formulario", exact: true })], ["Buscar", region.getByLabel("Buscar", { exact: true })]] as const)
          assert.ok(inside(await box(part), content), `«${name}» is inside the window`);
        const form = await region.locator("form.remittance-send-form").evaluate((element: HTMLElement) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
        let visible = 0;
        for (let index = 0; index < await rows.count(); index++) { const row = await box(rows.nth(index)); if (inside(row, content) && inside(row, list)) visible++; else break; }
        await page.screenshot({ path: path.join(output, "laptop-sending-window.png") });
        t.diagnostic(`1366×768: content ${Math.round(content.width)}×${Math.round(content.height)}, form ${form.scroll}/${form.client} px, ${visible} full rows.`);
        assert.ok(form.scroll <= form.client + 1, `the empty form does not scroll (${form.scroll} > ${form.client})`);
        assert.ok(visible >= 3, `at least three sends are visible at the default size, not ${visible}`);
        // An open list of clients is drawn whole over the list of sends, not cut by the form.
        await senderInput.press("ArrowDown"); await clients.waitFor();
        const listbox = await box(clients);
        assert.ok(inside(listbox, content), "the list of clients fits in the window");
        assert.equal(await page.evaluate(({ x, y }: { x: number; y: number }) => Boolean(document.elementFromPoint(x, y)?.closest('[role="listbox"]')), { x: listbox.x + listbox.width / 2, y: listbox.y + listbox.height - 4 }), true, "its last row is on top");
        await senderInput.press("Escape");
        for (const selector of [".mdi-window-content", 'section[aria-label="Envíos de dinero"]', ".remittance-list-area .remittance-table-wrap"])
          assert.equal(await window.locator(selector).first().evaluate((element: HTMLElement) => element.scrollWidth <= element.clientWidth + 1), true, `${selector} has no horizontal scroll`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      } finally { await context.close(); }
    });

    await t.test("Cajero: REMESAS menu, a top bar without collector tools, sends, pays another operator's receipt and opens and closes only its own box", async () => {
      const pending = await adminTransfer(10_000);
      const { context, page } = await open(cashierToken);
      try {
        assert.deepEqual(await menu(page), [["REMESAS", ["Envíos de dinero", "Entregas de dinero"]], ["CUADRES Y REPORTES", ["Cuadres Diarios"]], ["Soporte Técnico", []]]);
        // The first time every section is closed; the account finds them as it left them.
        const section = (name: string) => page.locator(".sidebar").getByRole("button", { name, exact: true });
        for (const name of ["REMESAS", "CUADRES Y REPORTES"]) assert.equal(await section(name).getAttribute("aria-expanded"), "false", name);
        await section("REMESAS").click(); assert.equal(await section("REMESAS").getAttribute("aria-expanded"), "true");
        await page.reload(); await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor();
        assert.equal(await section("REMESAS").getAttribute("aria-expanded"), "true", "remembered for this account");
        assert.equal(await section("CUADRES Y REPORTES").getAttribute("aria-expanded"), "false");
        assert.equal(await launchers(page), 0, "no quick buttons above the desktop");
        assert.equal(await page.getByText(/cobradores en calle$/).count(), 0);
        assert.equal(await page.getByTitle("Abrir Cuadres Diarios", { exact: true }).count(), 0, "no collector settlement badge without 401");
        for (const name of ["Buscar en tu operación", "Configuración de administración", "Facturas", "Ventana de Pagos", "Hacer copia de respaldo"]) assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0, name);
        await page.locator("body").press("Control+k");
        assert.equal(await page.getByRole("dialog", { name: "Encuentra lo que necesitas", exact: true }).count(), 0, "nothing to search");
        await page.getByRole("button", { name: "Abrir cuenta", exact: true }).click();
        const account = page.getByRole("dialog", { name: "Tu espacio de trabajo", exact: true });
        assert.match(await account.innerText(), /Cajero/); await page.keyboard.press("Escape"); await account.waitFor({ state: "detached" });

        await openFromMenu(page, "Envíos de dinero");
        const envios = page.getByRole("region", { name: "Envíos de dinero", exact: true });
        await envios.getByRole("combobox", { name: "Remitente", exact: true }).waitFor();
        assert.equal(await envios.getByLabel("Operador del envío").count(), 0, "the Cajero always sends as itself");
        const warning = envios.locator(".remittance-cash-warning");
        assert.equal(await warning.locator("p").innerText(), `No hay caja de remesas abierta hoy en DOP para Cajero de práctica. Sin caja abierta no se puede registrar el envío. Ábrela en ${cashPlace}. Si ya está abierta, pulsa Actualizar.`);
        await warning.getByRole("button", { name: "Ir a Caja de remesas", exact: true }).click();
        const settlements = page.getByRole("dialog", { name: "Cuadres Diarios", exact: true });
        const cash = settlements.getByRole("region", { name: "Caja de remesas", exact: true });
        await cash.getByText("No hay cajas de envíos. Abre tu caja antes de operar.", { exact: true }).waitFor();
        assert.equal(await settlements.getByRole("group", { name: "Secciones de Cuadres Diarios", exact: true }).count(), 0, "a single section has no switch");
        assert.equal(await settlements.locator(".connected-settlements-mdi").count(), 0, "no collector settlements without 401");
        const operator = cash.getByLabel("Operador");
        assert.equal(await operator.inputValue(), "Cajero de práctica"); assert.equal(await operator.getAttribute("readonly"), "");
        await cash.getByLabel("Efectivo inicial", { exact: true }).fill("500.00");
        await cash.getByRole("button", { name: "Revisar apertura", exact: true }).click();
        await confirmIn(page, "Abrir caja de remesas");
        const box = cash.locator("article").filter({ hasText: "DOP · Cajero de práctica" }); await box.getByText(`${today} · Abierta`, { exact: true }).waitFor();
        await warning.waitFor({ state: "detached" });

        await openFromMenu(page, "Envíos de dinero");
        const own = await send(page, envios, "100", "DOP");
        assert.equal((await store.read()).remittances.transfers.find((row) => row.id === own.id)?.sendingUserId, "demo-cashier");

        await page.locator(".sidebar").getByRole("button", { name: "Entregas de dinero", exact: true }).click();
        const payouts = page.getByRole("region", { name: "Entregas de dinero", exact: true });
        await waitForFocus(page, "[data-receipt-search]");
        await payouts.getByRole("button", { name: pending.reciboReference, exact: true }).click();
        const detail = page.getByRole("dialog", { name: `${pending.envioReference} · ${pending.reciboReference}`, exact: true });
        await detail.getByRole("button", { name: "Registrar entrega", exact: true }).click();
        await confirmIn(page, "Confirmar entrega al destinatario");
        await detail.locator(".remittance-status.paid").waitFor();
        assert.equal((await store.read()).remittances.transfers.find((row) => row.id === pending.id)?.paidBy, "demo-cashier", "the Cajero pays a receipt of another operator");
        await detail.getByRole("button", { name: `Cerrar ${pending.envioReference} · ${pending.reciboReference}`, exact: true }).click();

        await openFromMenu(page, "Cuadres Diarios");
        await cash.getByRole("button", { name: "Actualizar", exact: true }).click();
        await page.waitForFunction(() => document.querySelector('section[aria-label="Caja de remesas"] .remittance-heading button')?.textContent === "Actualizar");
        const expected = (await box.locator(".remittance-total dd").innerText()).replace(/^DOP /, "").replaceAll(",", "");
        await box.getByRole("button", { name: "Contar y cerrar", exact: true }).click();
        const count = page.getByRole("dialog", { name: "Contar caja DOP", exact: true });
        await count.getByLabel("Efectivo contado", { exact: true }).fill(expected);
        await count.getByRole("button", { name: "Revisar cierre", exact: true }).click();
        await confirmIn(page, "Confirmar cierre de caja");
        await box.getByText(`${today} · Cerrada`, { exact: true }).waitFor();
        const closed = (await store.read()).remittances.cashSessions.find((row) => row.operatorId === "demo-cashier" && row.currency === "DOP" && row.date === today)!;
        assert.equal(closed.status, "closed"); assert.equal(closed.closedBy, "demo-cashier");
        assert.equal(String(closed.countedAmount), expected.replace(".", ""), "closed with the exact count");
        await page.screenshot({ path: path.join(output, "cashier-closed-box.png") });
      } finally { await context.close(); }
    });

    await t.test("Cajero with the reports of its operations: Reportes draws only the heading of Envíos de dinero", async () => {
      const keys = ["remittances.view", "remittances.create", "remittances.receipts", "remittances.pay", "remittances.cancel", "remittances.clients.create",
        "remittances.cash.view", "remittances.cash.open", "remittances.cash.close", "remittances.reports"];
      const { revision } = await ok("GET", "/api/usuarios/demo-cashier/permisos");
      await ok("POST", "/api/usuarios/demo-cashier/permisos", { mode: "custom", permissionIds: [1, 2], remittancePermissions: keys, revision });
      const { context, page } = await open(cashierToken);
      try {
        await page.locator(".sidebar").getByRole("button", { name: "CUADRES Y REPORTES", exact: true }).waitFor();
        assert.deepEqual((await menu(page)).find(([name]: [string]) => name === "CUADRES Y REPORTES")?.[1], ["Cuadres Diarios", "Reportes"]);
        await page.locator(".sidebar").getByRole("button", { name: "CUADRES Y REPORTES", exact: true }).click();
        await page.locator(".sidebar").getByRole("button", { name: "Reportes", exact: true }).click();
        const launcher = page.getByRole("dialog", { name: "Reportes", exact: true });
        await launcher.getByRole("button", { name: "Montos y cantidad de envíos", exact: true }).waitFor();
        assert.equal(await launcher.getByRole("button", { name: "Reporte consolidado de comisiones", exact: true }).count(), 0, "Viewing operation reports does not expose the internal commission split.");
        assert.deepEqual(await launcher.locator(".control-panel-section-heading > span").allTextContents(), ["-- Remesas --"]);
      } finally { await context.close(); }
    });

    await t.test("the collector terminal keeps its four sections and its «Nuevo envío»", async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
      try {
        await context.addInitScript((token: string) => sessionStorage.setItem("cyp-collector-token", token), collectorToken);
        await context.route("**/*", (route: any) => { const target = new URL(route.request().url()); if (target.origin === origin) return route.continue(); external.push(target.origin); return route.abort("blockedbyclient"); });
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", (error: Error) => pageErrors.push(error.message));
        await page.goto(`${origin}/collector/?view=remittances`);
        const workspace = page.getByRole("region", { name: "Envíos de dinero", exact: true });
        const sections = workspace.getByRole("navigation", { name: "Secciones de remesas", exact: true });
        await sections.getByRole("button").first().waitFor();
        assert.deepEqual(await sections.getByRole("button").allTextContents(), ["Envíos", "Entregas", "Caja"], "the terminal keeps its sections; its reports open from its own Reportes view");
        await workspace.getByRole("button", { name: "Nuevo envío", exact: true }).waitFor();
        assert.equal(await page.locator(".remittances-fixed, .remittance-cash-warning").count(), 0, "the terminal keeps its own layout and its Caja section");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
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
    assert.equal(path.dirname(path.resolve(output)), path.resolve(os.tmpdir())); assert(path.basename(output).startsWith("cyp-cashier-shell-"));
    for (const name of ["cache-admin", "cache-collector", "admin", "collector", "admin.tsx", "collector.tsx"]) {
      const target = path.resolve(output, name); assert(target.startsWith(path.resolve(output) + path.sep)); fs.rmSync(target, { recursive: true, force: true });
    }
    t.diagnostic(`API requests seen by the proxy: ${requests.length}; blocked external origins: ${external.length}; screenshots: ${output}`);
  }
});
