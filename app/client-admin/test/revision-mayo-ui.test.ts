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
import { DEMO_PASSWORD } from "../../server/src/demo-credentials.js";
import { businessDate } from "../../server/src/domain.js";

// The review of Mayo (26-10-2026), point by point, in the actual App with a synthetic MemoryStore API.
const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); } catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
}
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);

test("Mayo's review (26-10): Envíos, Caja de remesas, Tasas, escritorio, Soporte técnico and dates by parts", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-revision-mayo-"));
  const state = seed();
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-revision-mayo-secret-at-least-32-characters", origins: [], collectorUrl: "/collector/" });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin", password: DEMO_PASSWORD } })).json().token as string;
  const post = async (url: string, payload: unknown) => {
    const response = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() }, payload });
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`); return response.json();
  };
  const today = businessDate(new Date()), yesterday = businessDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  // A tiny synthetic logo (1×1 PNG).
  const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  // A cashier whose box of yesterday closed with 1,500.00 and gave 500.00 back (descargo): today it opens with 1,000.00.
  const cashier = await post("/api/usuarios", { role: "cashier", name: "Cajero de Mayo", email: "cajero-mayo@example.invalid", password: "Ficticia-Segura-2026!" }) as { id: string };
  await store.transaction((draft) => {
    const at = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    draft.remittances.cashSessions.push({ id: "mayo-caja-ayer", operatorId: cashier.id, currency: "DOP", date: yesterday, openingAmount: 150000, openedBy: "demo-admin", openedAt: at,
      status: "closed", closedBy: "demo-admin", closedAt: at, countedAmount: 150000 });
    draft.remittances.events.push({ id: "mayo-abierta", type: "opened", cashSessionId: "mayo-caja-ayer", operatorId: cashier.id, currency: "DOP", amount: 150000, actorId: "demo-admin", createdAt: at },
      { id: "mayo-cerrada", type: "closed", cashSessionId: "mayo-caja-ayer", operatorId: cashier.id, currency: "DOP", amount: 150000, actorId: "demo-admin", createdAt: at });
    (draft.remittances.cashMovements ??= []).push({ id: "mayo-descargo", type: "discharge", cashSessionId: "mayo-caja-ayer", operatorId: cashier.id, currency: "DOP", amount: 50000, actorId: "demo-admin", createdAt: at });
  });
  let browser: any, server: ReturnType<typeof createServer> | undefined;
  const pageErrors: string[] = [];
  try {
    const module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
    const fixture = path.join(output, "fixture.tsx");
    fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";\nimport App from ${module("App.tsx")};\nimport ${module("styles.css")};\nimport ${module("suggestions-shell.css")};\nimport ${JSON.stringify(localRequire.resolve("leaflet/dist/leaflet.css").replaceAll("\\", "/"))};\nwindow.print = () => {};\ncreateRoot(document.getElementById("root")).render(<App />);\n`, "utf8");
    const [{ build }, { default: react }, { default: tailwind }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href), import(pathToFileURL(localRequire.resolve("@tailwindcss/vite")).href), import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react(), tailwind()], define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.VITE_COLLECTOR_URL": JSON.stringify("/collector/") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, cssCodeSplit: false, sourcemap: false, rollupOptions: { output: { inlineDynamicImports: true } }, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname.startsWith("/api/")) {
          if (url.pathname === "/api/clientes/pagina") pageRequests.push(url);
          const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
          const result = await app.inject({ method: request.method as "GET" | "POST", url: request.url!, headers: request.headers, ...(body ? { payload: body } : {}) });
          response.writeHead(result.statusCode, { "Content-Type": "application/json; charset=utf-8" }); response.end(result.body); return;
        }
        if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end('<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>'); return; }
        if (["/fixture.js", "/fixture.css"].includes(url.pathname)) { response.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css" }); response.end(fs.readFileSync(path.join(output, "dist", url.pathname.slice(1)))); return; }
        response.writeHead(404); response.end();
      } catch { response.writeHead(500); response.end('{"error":{"message":"Synthetic fixture failure"}}'); }
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
    await context.addInitScript(({ auth, origin }: { auth: string; origin: string }) => { if (location.origin === origin) sessionStorage.setItem("cyp-admin-token", auth); }, { auth: token, origin });
    await context.route("**/*", (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on("pageerror", (error: Error) => pageErrors.push(error.message));
    const reset = async () => { await page.goto(origin); await page.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor(); };
    const openNav = async (name: string, window: string) => {
      await reset();
      const option = page.locator(".sidebar").getByRole("button", { name, exact: true });
      const folded = page.locator(`.sidebar .nav-item[aria-label="${name}"]`);
      await option.or(folded).first().waitFor({ state: "attached" });
      if (!await option.isVisible()) await page.locator(".sidebar .nav-group").filter({ has: page.locator(`.nav-item[aria-label="${name}"]`) }).locator(".nav-group-trigger").click();
      await option.click();
      const frame = page.getByRole("dialog", { name: window, exact: true }); await frame.waitFor(); return frame;
    };
    const shot = (name: string) => page.screenshot({ path: path.join(output, `${name}.png`) });

    // A second session (the cashier) in the same page server.
    const cashierPage = async () => {
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "cajero-mayo@example.invalid", password: "Ficticia-Segura-2026!" } });
      assert.equal(login.statusCode, 200, login.body);
      const other = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "es-DO", timezoneId: "America/Santo_Domingo", serviceWorkers: "block" });
      await other.addInitScript(({ auth, origin }: { auth: string; origin: string }) => { if (location.origin === origin) sessionStorage.setItem("cyp-admin-token", auth); }, { auth: login.json().token, origin });
      await other.route("**/*", (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
      const tab = await other.newPage(); tab.setDefaultTimeout(12000); tab.on("pageerror", (error: Error) => pageErrors.push(error.message));
      return { other, tab };
    };
    const openMenu = async (tab: any, group: string, name: string) => {
      const option = tab.locator(".sidebar").getByRole("button", { name, exact: true });
      if (!await option.isVisible().catch(() => false)) await tab.locator(".sidebar").getByRole("button", { name: group, exact: true }).click();
      await option.click();
    };
    // A select inside its label is named with its option too: the field is found by the text of its label.
    const field = (scope: any, label: string) => scope.locator("label").filter({ hasText: new RegExp(`^${label}`) }).locator("input, select").first();
    const openEnvios = async () => {
      await reset();
      await openMenu(page, "REMESAS", "Envíos de dinero");
      const maximize = page.getByRole("button", { name: "Maximizar Envíos de dinero", exact: true });
      if (await maximize.isVisible().catch(() => false)) await maximize.click();
      const workspace = page.getByRole("region", { name: "Envíos de dinero", exact: true });
      await workspace.getByRole("combobox", { name: "Remitente", exact: true }).waitFor();
      const choose = async (label: string, code: string) => { const input = workspace.getByRole("combobox", { name: label, exact: true }); await input.fill(code); await workspace.getByRole("option").filter({ hasText: code }).first().click(); };
      await choose("Remitente", "CL-0001"); await choose("Destinatario", "CL-0002");
      await field(workspace, "Moneda del remitente").selectOption("DOP");
      await field(workspace, "Moneda del destinatario").selectOption("DOP");
      const amount = workspace.getByLabel("Monto a enviar (DOP)", { exact: true });
      await amount.click(); await amount.pressSequentially("1000");
      return workspace;
    };
    const openCaja = async (tab: any) => {
      await tab.goto(origin); await tab.getByRole("button", { name: "Abrir cuenta", exact: true }).waitFor();
      await openMenu(tab, "CUADRES Y REPORTES", "Cuadres Diarios");
      const caja = tab.getByRole("button", { name: "Caja de remesas", exact: true });
      if (await caja.isVisible().catch(() => false)) await caja.click();
      const region = tab.locator(".remittances").filter({ has: tab.getByRole("heading", { name: "Caja de remesas" }) }).last();
      await region.getByRole("form", { name: "Buscar cajas" }).waitFor();
      return region;
    };

    await t.test("4.2: Soporte técnico is a module of the panel on the left, after the others", async () => {
      await reset();
      const modules = await page.locator('nav[aria-label="Navegación principal"] .nav-group-trigger').evaluateAll((items: HTMLElement[]) => items.map((item) => item.getAttribute("aria-label") ?? item.textContent?.trim()));
      assert.equal(modules.at(-1), "Soporte Técnico", modules.join(" | "));
      assert.equal(await page.locator(".sidebar-bottom").getByRole("button", { name: "Soporte Técnico" }).count(), 0, "only one Soporte Técnico");
      await page.locator('nav[aria-label="Navegación principal"]').getByRole("button", { name: "Soporte Técnico", exact: true }).click();
      await page.getByRole("dialog", { name: "Soporte Técnico" }).waitFor();
      await shot("4.2-soporte-tecnico");
      await page.keyboard.press("Escape");
    });

    // Rardiel, 30-10-2026: the logo of the company leaves the escritorio (Gamera's showed there); the portada of CyP goes to the
    // bottom right corner, as in Préstamos SAN, and the logo of CyP stays in the corner of the menu, written «CyP».
    await t.test("4.1: the portada of CyP in the bottom right corner, no logo of the company on the escritorio and «CyP» in the menu", async () => {
      await post("/api/configuracion", { config: { companyLogoDataUrl: LOGO, "general.empresa": "Casa de Cambio Ficticia" } });
      await reset();
      const canvas = (await page.locator(".desktop-canvas").boundingBox())!;
      const cover = page.locator(".desktop-canvas .desktop-cover");
      await page.waitForFunction(() => (document.querySelector(".desktop-cover img") as HTMLImageElement | null)?.complete && (document.querySelector(".desktop-cover img") as HTMLImageElement).naturalWidth > 0);
      const box = (await cover.boundingBox())!;
      assert.ok(box.width >= 300 && canvas.x + canvas.width - (box.x + box.width) <= 48 && canvas.y + canvas.height - (box.y + box.height) <= 48, `portada at ${JSON.stringify(box)}`);
      assert.equal(await page.locator(`img[src="${LOGO}"]`).count(), 0, "no logo of the company on the escritorio");
      assert.equal(await page.getByText("Casa de Cambio Ficticia", { exact: true }).count(), 0);
      assert.equal(await cover.locator("img").getAttribute("alt"), "CyP · Cobros y Pagos");
      assert.equal(await cover.locator("figcaption").innerText(), "Versión: CyP Web v0.1.0");
      const corner = page.locator(".sidebar .brand");
      await corner.locator(".brand-mark").waitFor();
      assert.equal(await corner.locator("img").count(), 0, "the corner keeps the logo of CyP");
      assert.match(await corner.locator(".brand-word").innerText(), /^CyP\s+COBROS Y PAGOS$/);
      await shot("4.1-portada-abajo-a-la-derecha");
    });

    await t.test("1.1.2: without the box of today, «Revisar y confirmar envío» stays off and says why", async () => {
      const workspace = await openEnvios();
      await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
      const review = workspace.getByRole("button", { name: "Revisar y confirmar envío", exact: true });
      await review.waitFor();
      assert.equal(await review.isDisabled(), true);
      assert.match(String(await review.getAttribute("title")), /No hay caja de remesas abierta hoy en DOP/);
      await shot("1.1.2-sin-caja");
      // With the box open (and Actualizar) the same send can go on.
      await post("/api/envios/cajas/abrir", { operatorId: "demo-admin", currency: "DOP", openingAmount: 0 });
      await workspace.getByRole("button", { name: "Actualizar", exact: true }).click();
      await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "Revisar y confirmar envío" && !(button as HTMLButtonElement).disabled));
    });

    await t.test("1.1.1: calculating or changing a datum brings the form back to its top, not to the list", async () => {
      const workspace = await openEnvios();
      const form = workspace.locator(".remittance-send-form");
      const top = () => form.evaluate((element: HTMLElement) => element.scrollTop);
      await form.evaluate((element: HTMLElement) => { element.scrollTop = element.scrollHeight; });
      await workspace.getByRole("button", { name: "Calcular cotización", exact: true }).click();
      await workspace.getByRole("button", { name: "Revisar y confirmar envío", exact: true }).waitFor();
      await page.waitForTimeout(300);
      assert.equal(await top(), 0, "the form is at its top after the quote");
      assert.ok(await workspace.getByRole("combobox", { name: "Remitente", exact: true }).isVisible());
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Revisar y confirmar envío", "Intro goes on to the review");
      await shot("1.1.1-cotizado-arriba");
      await form.evaluate((element: HTMLElement) => { element.scrollTop = 120; });
      await workspace.getByLabel("Nota (opcional)", { exact: true }).fill("Cambio después de cotizar");
      await page.waitForTimeout(300);
      assert.equal(await top(), 0, "the form is at its top after a change");
    });

    await t.test("2.1.1–2.1.3: Caja de remesas finds boxes by date, operator and currency; entrega adicional and descargo", async () => {
      const caja = await openCaja(page);
      const search = caja.getByRole("form", { name: "Buscar cajas" });
      for (const label of ["Fecha", "Operador", "Moneda"]) await field(search, label).waitFor();
      assert.equal(await search.getByLabel("Fecha", { exact: true }).inputValue(), today);
      // Today: only the box of Administración opened above.
      assert.equal(await caja.locator(".remittance-cash-grid article").count(), 1);
      // Yesterday and the cashier: the box closed with its descargo and what passes to today.
      await search.getByLabel("Fecha", { exact: true }).fill(yesterday);
      await field(search, "Operador").selectOption({ label: "Cajero de Mayo" });
      await search.getByRole("button", { name: "Buscar", exact: true }).click();
      const old = caja.locator(".remittance-cash-grid article");
      await old.first().getByText("Descargado al cobrador").waitFor();
      assert.equal(await old.count(), 1);
      const text = await old.first().innerText();
      assert.match(text, /Contado al cierre\s+DOP 1,500\.00/); assert.match(text, /Descargado al cobrador\s+DOP 500\.00/); assert.match(text, /Pasa a la próxima apertura\s+DOP 1,000\.00/);
      await shot("2.1.1-buscar-cajas");
      await field(search, "Moneda").selectOption("EUR");
      await search.getByRole("button", { name: "Buscar", exact: true }).click();
      await caja.getByText(`No hay cajas del ${yesterday} con estos filtros.`).waitFor();
      // Today again, Administración: an entrega adicional of 250.00 is accumulated and expected.
      await search.getByLabel("Fecha", { exact: true }).fill(today);
      await field(search, "Operador").selectOption("demo-admin");
      await field(search, "Moneda").selectOption("DOP");
      await search.getByRole("button", { name: "Buscar", exact: true }).click();
      const box = caja.locator(".remittance-cash-grid article").first();
      await box.getByRole("button", { name: "Entrega adicional", exact: true }).click();
      const add = page.getByRole("dialog", { name: "Entrega adicional · caja DOP" });
      const amount = add.getByLabel("Importe que se entrega", { exact: true }); await amount.click(); await amount.pressSequentially("250");
      await add.getByRole("button", { name: "Revisar entrega", exact: true }).click();
      await page.getByRole("dialog", { name: "Confirmar entrega adicional" }).getByRole("button", { name: "Confirmar", exact: true }).click();
      await box.getByText("DOP 250.00").first().waitFor();
      assert.match(await box.innerText(), /Entregas adicionales\s+DOP 250\.00/);
      assert.match(await box.innerText(), /Efectivo esperado\s+DOP 250\.00/);
      await shot("2.1.2-entrega-adicional");
      // Closing with a descargo: the next opening starts with the count less what was taken.
      await box.getByRole("button", { name: "Contar y cerrar", exact: true }).click();
      const close = page.getByRole("dialog", { name: "Contar caja DOP" });
      const counted = close.getByLabel("Efectivo contado", { exact: true }); await counted.click(); await counted.pressSequentially("250");
      const taken = close.getByLabel("Descargado al cobrador (opcional)", { exact: true }); await taken.click(); await taken.pressSequentially("100");
      await close.getByRole("button", { name: "Revisar cierre", exact: true }).click();
      const confirmClose = page.getByRole("dialog", { name: "Confirmar cierre de caja" });
      assert.match(await confirmClose.innerText(), /próxima apertura empieza con DOP 150\.00/);
      await confirmClose.getByRole("button", { name: "Confirmar", exact: true }).click();
      await box.getByText("Pasa a la próxima apertura").waitFor();
      assert.match(await box.innerText(), /Descargado al cobrador\s+DOP 100\.00/);
      assert.match(await box.innerText(), /Pasa a la próxima apertura\s+DOP 150\.00/);
    });

    await t.test("2.1.4: the cashier opens the day with the close before, and cannot change it", async () => {
      const { other, tab } = await cashierPage();
      try {
        const caja = await openCaja(tab);
        const opening = caja.getByLabel("Efectivo inicial", { exact: true });
        await opening.waitFor();
        assert.equal(await opening.inputValue(), "1,000.00");
        assert.equal(await opening.getAttribute("readonly"), "");
        assert.match(await caja.locator(".remittance-opening-source").innerText(), new RegExp(`Viene del cierre del ${yesterday}\\.`));
        await tab.screenshot({ path: path.join(output, "2.1.4-apertura-fija.png") });
        await caja.getByRole("button", { name: "Revisar apertura", exact: true }).click();
        const confirmOpen = tab.getByRole("dialog", { name: "Abrir caja de remesas" });
        assert.match(await confirmOpen.innerText(), /Efectivo inicial: DOP 1,000\.00/);
        await confirmOpen.getByRole("button", { name: "Confirmar", exact: true }).click();
        await caja.locator(".remittance-cash-grid article").filter({ hasText: "Viene del cierre del" }).waitFor();
        // The server keeps the rule for any other amount.
        const cashierLogin = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "cajero-mayo@example.invalid", password: "Ficticia-Segura-2026!" } })).json().token;
        const refused = await app.inject({ method: "POST", url: "/api/envios/cajas/abrir", headers: { authorization: `Bearer ${cashierLogin}`, "idempotency-key": randomUUID() }, payload: { operatorId: cashier.id, currency: "USD", openingAmount: 0 } });
        assert.equal(refused.statusCode, 200, "a first box in USD is free");
      } finally { await other.close(); }
    });

    await t.test("3.1.1 and 3.1.2: editing a rate saves a new row; the replaced one cannot be edited; Nuevo brings the rate in use", async () => {
      await post("/api/envios/tasas", { currency: "USD", rate: "59.000000", purchaseRate: "59.000000", saleRate: "61.000000", date: today });
      await post("/api/envios/tasas", { currency: "USD", rate: "60.000000", purchaseRate: "60.000000", saleRate: "62.000000", date: today });
      await reset();
      await page.getByRole("button", { name: "Configuración de administración", exact: true }).click();
      await page.getByRole("button", { name: "Tasas de cambio", exact: true }).last().click();
      const grid = page.locator(".exchange-rates-grid");
      await grid.locator("tbody tr").first().waitFor();
      const usd = grid.locator("tbody tr").filter({ hasText: "Dólar Americano" });
      // The history comes after the first rows: wait for both rows of the dollar before counting them.
      await usd.nth(1).waitFor();
      assert.equal(await usd.count(), 2, "the edited rate stays as its own row");
      assert.match(await usd.nth(0).innerText(), /Vigente[\s\S]*60\.000000[\s\S]*62\.000000/);
      assert.match(await usd.nth(1).innerText(), /Sustituida[\s\S]*59\.000000[\s\S]*61\.000000/);
      const edit = page.getByRole("button", { name: "Editar", exact: true });
      await usd.nth(1).click(); assert.equal(await edit.isDisabled(), true, "Editar off on the replaced rate");
      await usd.nth(1).dblclick(); assert.equal(await page.getByRole("dialog", { name: "Datos de la Tasa de Cambio..." }).count(), 0);
      await usd.nth(0).click(); assert.equal(await edit.isDisabled(), false, "Editar on the rate in use");
      assert.match(await page.locator(".exchange-rates-in-use").innerText(), /USD compra 60\.000000 · venta 62\.000000/);
      await shot("3.1.1-tasas");
      await page.getByRole("button", { name: "Nuevo", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Datos de la Tasa de Cambio...", exact: true });
      assert.equal(await dialog.getByLabel("Compra", { exact: true }).inputValue(), "60.000000", "the day starts from the rate in use");
      assert.equal(await dialog.getByLabel("Venta", { exact: true }).inputValue(), "62.000000");
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    });

    await t.test("5.1: in a date, ← → go through day, month and year, and each part is written; from its ends they go on", async () => {
      const caja = await openCaja(page);
      const search = caja.getByRole("form", { name: "Buscar cajas" });
      const date = search.getByLabel("Fecha", { exact: true });
      await date.fill("2026-10-20");
      await search.getByRole("button", { name: "Mostrar/Ocultar filtros", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await date.evaluate((element: HTMLElement) => element === document.activeElement), true, "→ reaches the date");
      await page.keyboard.press("ArrowRight"); await page.keyboard.type("09");
      assert.equal(await date.inputValue(), "2026-09-20", "→ chose the month and 09 was written in it");
      // 09 moved on to the year by itself: ← ← go back to the day.
      await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); await page.keyboard.type("05");
      assert.equal(await date.inputValue(), "2026-09-05", "← ← chose the day");
      // 05 moved on to the month by itself; → goes to the year and the next → leaves for Operador.
      await page.keyboard.press("ArrowRight"); await page.keyboard.type("2025");
      assert.equal(await date.inputValue(), "2025-09-05", "the year written");
      await page.keyboard.press("ArrowRight");
      assert.equal(await field(search, "Operador").evaluate((element: HTMLElement) => element === document.activeElement), true, "→ from the year goes on");
      // A click on the year chooses it.
      const box = (await date.boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.42, box.y + box.height / 2);
      await page.keyboard.type("2024");
      assert.equal(await date.inputValue(), "2024-09-05", "the year clicked is written");
      await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
      assert.equal(await search.getByRole("button", { name: "Mostrar/Ocultar filtros", exact: true }).evaluate((element: HTMLElement) => element === document.activeElement), true, "← from the day goes back");
      await shot("5.1-fecha-por-partes");
    });

    // Rardiel, 30-10-2026: the year is written from left to right (the browser showed 0002, 0020…), with its two last digits
    // (26 is 2026) or the four; in every date of the system, the empty ones too.
    await t.test("5.1: the year is written from left to right: 26 is 2026 and 2026 too, never 0002 or 0020", async () => {
      const caja = await openCaja(page);
      const search = caja.getByRole("form", { name: "Buscar cajas" });
      const date = search.getByLabel("Fecha", { exact: true });
      const toggle = search.getByRole("button", { name: "Mostrar/Ocultar filtros", exact: true });
      const seen: string[] = [];
      const write = async (keys: string) => { for (const key of keys) { await page.keyboard.press(key); seen.push(await date.inputValue()); } };
      await date.fill("2026-10-20");
      await toggle.focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
      await write("25");
      assert.deepEqual(seen, ["2026-10-20", "2025-10-20"], "one digit waits; two are 20xx");
      await write("2024");
      assert.equal(await date.inputValue(), "2024-10-20", `the four digits: ${seen.join(", ")}`);
      // 2, 5 then 2, 0 make 2520 (the same year typed on); 2, 4 start again: 2024. Never 0002, 0020 or 0202.
      assert.deepEqual(seen, ["2026-10-20", "2025-10-20", "2025-10-20", "2520-10-20", "2520-10-20", "2024-10-20"]);
      // An empty date: day and month as always, then the year with its two digits.
      await date.fill("");
      await toggle.focus(); await page.keyboard.press("ArrowRight");
      await page.keyboard.type("0911");
      assert.equal(await date.inputValue(), "", "no year yet");
      await write("26");
      assert.equal(await date.inputValue(), "2026-11-09", "26 is 2026");
      // The year stays chosen: ← goes back to the month.
      await page.keyboard.press("ArrowLeft"); await page.keyboard.type("12");
      assert.equal(await date.inputValue(), "2026-12-09");
      await shot("5.1-anio-de-izquierda-a-derecha");
    });

    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    await app.close();
    for (const name of ["cache", "dist", "fixture.tsx"]) fs.rmSync(path.join(output, name), { recursive: true, force: true });
    t.diagnostic(`Capturas: ${output}`);
  }
});
