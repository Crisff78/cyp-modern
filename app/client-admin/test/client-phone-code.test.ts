import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

// Mount the actual dialog alone, using synthetic records and an in-memory save
// spy. This never mounts App, opens a database, reads .env or downloads a browser.
const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch {
  playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
}
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);

test("client phone code works in the actual isolated React dialog", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-client-phone-code-"));
  const sources = ["App.tsx", "clientSearch.ts", "LegacyConnectedUi.tsx"].map((file) => path.join(adminRoot, "src", file));
  const sourceHashes = () => Object.fromEntries(sources.map((file) => [path.basename(file), createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
  const before = sourceHashes();
  let browser: any, context: any, server: ReturnType<typeof createServer> | undefined;
  const pageErrors: string[] = [], blockedExternal: string[] = [], unexpectedRequests: string[] = [];
  try {
    const fixture = path.join(output, "fixture.tsx");
    const appModule = JSON.stringify(path.join(adminRoot, "src/App.tsx").replaceAll("\\", "/"));
    fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import { ClientDataDialog } from ${appModule};
const existing = Object.freeze({id:"synthetic-real-id",code:"EXISTING-01",identification:"SYN-DOC-EDIT",name:"Cliente QA existente",alias:"Alias QA",address:"Dirección QA",location:"Ubicación QA",zone:"Zona QA",routeId:"qa-route",phone:"+509 (41)23-4567",cellular:"000-000-0000 ext. 1",email:"qa@example.invalid",note:"Nota QA conservada",active:true,preferredCurrency:"EUR"});
const client = new URLSearchParams(location.search).get("mode") === "edit" ? existing : undefined;
window.__qaClient = client; window.__qaSaves = []; window.__qaRecords = []; window.__qaClosed = false;
createRoot(document.getElementById("root")).render(<ClientDataDialog client={client} zones={["Zona QA"]} routes={[{id:"qa-route",name:"Ruta QA"}]} defaultCode="00042" onClose={() => {window.__qaClosed = true;}} onSave={draft => {
  const saved = structuredClone(draft); window.__qaSaves.push(saved);
  // The existing dialog contract omits id. The owner keeps identity separately.
  window.__qaRecords.push({...client,id:client?.id || "synthetic-created-id",...saved});
}} />);
`, "utf8");
    const [{ build }, { default: react }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href),
      import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react()], define: { "process.env.NODE_ENV": JSON.stringify("production") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, sourcemap: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    const html = '<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>body{font:14px Arial}button,input,select{margin:4px}.legacy-dialog-overlay{position:fixed;inset:0;display:grid;place-items:center;background:#0003;z-index:100}.legacy-dialog{padding:15px;background:white;min-width:600px;max-height:90vh;overflow:auto}.legacy-dialog-titlebar,.legacy-dialog-actions{display:flex;justify-content:space-between;gap:8px}.client-form{display:grid;gap:4px}.client-form-row{display:flex;gap:8px}.client-form-row>span{width:145px}.client-contact-row{display:flex;gap:8px}.client-contact-row label{display:grid}</style><div id="root"></div><script>window.__qaFetches=[];window.fetch=(...args)=>{window.__qaFetches.push(String(args[0]));return Promise.reject(new Error("Network API is forbidden in the dialog fixture"));};</script><script type="module" src="/fixture.js"></script></html>';
    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.method !== "GET") { unexpectedRequests.push(`${request.method} ${pathname}`); response.writeHead(405); response.end(); return; }
      if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html); return; }
      const assets = new Map([["/fixture.js", "text/javascript; charset=utf-8"], ["/fixture.css", "text/css; charset=utf-8"]]);
      if (assets.has(pathname)) {
        const asset = path.join(output, "dist", pathname.slice(1));
        response.writeHead(200, { "Content-Type": assets.get(pathname)! }); response.end(fs.existsSync(asset) ? fs.readFileSync(asset) : ""); return;
      }
      if (pathname !== "/favicon.ico") unexpectedRequests.push(`${request.method} ${pathname}`);
      response.writeHead(404); response.end();
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-DO", serviceWorkers: "block" });
    await context.route("**/*", async (route: any) => {
      const target = new URL(route.request().url());
      if (target.origin !== origin) { blockedExternal.push(target.origin); return route.abort("blockedbyclient"); }
      if (route.request().method() !== "GET") { unexpectedRequests.push(`${route.request().method()} ${target.pathname}`); return route.abort("blockedbyclient"); }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    page.on("pageerror", (error: Error) => pageErrors.push(error.message));
    const dialog = () => page.getByRole("dialog", { name: "Datos del Cliente...", exact: true });
    const field = (label: string) => dialog().getByLabel(label, { exact: true });
    const usePhone = () => dialog().getByRole("button", { name: "Usar teléfono como código", exact: true });
    const open = async (mode = "new") => { await page.goto(`${origin}/?mode=${mode}`); await dialog().waitFor(); assert.deepEqual(await page.evaluate(() => (window as any).__qaFetches), [], "Importing and mounting only the dialog must not call the API."); };
    const saved = async () => { await page.waitForFunction(() => (window as any).__qaSaves.length === 1); return page.evaluate(() => (window as any).__qaSaves[0]); };

    await t.test("explicit formatted Haiti phone code preserves document, name, currency and separate identity", async () => {
      await open(); assert.equal(await field("Código:").inputValue(), "00042");
      assert.equal(await field("Moneda preferida del cliente").inputValue(), "DOP");
      await field("Cliente:").fill("Cliente QA nuevo"); await field("Cédula / pasaporte:").fill("SYN-DOC-CREATE");
      await field("Moneda preferida del cliente").selectOption("USD"); await field("Teléfono:").fill("+509 (41)23-4567");
      assert.equal(await field("Código:").inputValue(), "00042", "Entering a phone alone must not change the code.");
      await usePhone().click(); assert.equal(await field("Código:").inputValue(), "+50941234567");
      assert.equal(await field("Cédula / pasaporte:").inputValue(), "SYN-DOC-CREATE");
      await dialog().getByRole("button", { name: "Copiar teléfono a campos vacíos", exact: true }).click();
      assert.equal(await field("Celular:").inputValue(), "+509 (41)23-4567");
      assert.equal(await field("Nota:").inputValue(), "+509 (41)23-4567");
      await dialog().getByRole("button", { name: "oK", exact: true }).click();
      const draft = await saved();
      assert.deepEqual(draft, { preferredCurrency: "USD", code: "+50941234567", identification: "SYN-DOC-CREATE", name: "Cliente QA nuevo", alias: "", address: "", location: "", zone: "No Definida", routeId: "qa-route", phone: "+509 (41)23-4567", cellular: "+509 (41)23-4567", email: "", note: "+509 (41)23-4567", active: true });
      assert.equal(Object.hasOwn(draft, "id"), false, "The code is not the actual server identity.");
      assert.equal(await page.evaluate(() => (window as any).__qaRecords[0].id), "synthetic-created-id");
    });
    await t.test("manual code remains unchanged as phone changes before and after the explicit action", async () => {
      await open(); await field("Cliente:").fill("Cliente QA manual"); await field("Cédula / pasaporte:").fill("SYN-DOC-MANUAL");
      await field("Código:").fill("MANUAL-01"); await field("Teléfono:").fill("+509 (41)23-4567");
      assert.equal(await field("Código:").inputValue(), "MANUAL-01");
      await usePhone().click(); assert.equal(await field("Código:").inputValue(), "+50941234567");
      await field("Código:").fill("MANUAL-02"); await field("Teléfono:").fill("+1 (809) 555-1234");
      assert.equal(await field("Código:").inputValue(), "MANUAL-02");
      await dialog().getByRole("button", { name: "oK", exact: true }).click();
      const draft = await saved(); assert.equal(draft.code, "MANUAL-02"); assert.equal(draft.phone, "+1 (809) 555-1234");
      assert.equal(draft.identification, "SYN-DOC-MANUAL"); assert.equal(draft.name, "Cliente QA manual"); assert.equal(draft.preferredCurrency, "DOP");
    });
    await t.test("empty phone disables the action and invalid phone opens an alert without changing code", async () => {
      await open(); assert.equal(await usePhone().isDisabled(), true);
      await field("Teléfono:").fill("   "); assert.equal(await usePhone().isDisabled(), true);
      for (const phone of ["123", "abc +50941234567", "1234567890123456"]) {
        await field("Teléfono:").fill(phone); await usePhone().click();
        const alert = page.getByRole("dialog", { name: "Mensaje", exact: true }); await alert.waitFor();
        assert.match(await alert.innerText(), /Escribe un teléfono válido de 7 a 15 dígitos/);
        assert.equal(await field("Código:").inputValue(), "00042");
        await alert.getByRole("button", { name: "Aceptar", exact: true }).click(); await alert.waitFor({ state: "hidden" });
      }
      assert.deepEqual(await page.evaluate(() => (window as any).__qaSaves), []);
    });
    await t.test("editing hides phone-as-code and preserves existing identity, code and document", async () => {
      await open("edit"); assert.equal(await usePhone().count(), 0);
      await field("Teléfono:").fill("+1 (809) 555-1234");
      await dialog().getByRole("button", { name: "Copiar teléfono a campos vacíos", exact: true }).click();
      assert.equal(await field("Celular:").inputValue(), "000-000-0000 ext. 1"); assert.equal(await field("Nota:").inputValue(), "Nota QA conservada");
      assert.equal(await field("Código:").inputValue(), "EXISTING-01"); assert.equal(await field("Cédula / pasaporte:").inputValue(), "SYN-DOC-EDIT");
      await dialog().getByRole("button", { name: "oK", exact: true }).click();
      const draft = await saved(); assert.equal(draft.code, "EXISTING-01"); assert.equal(draft.identification, "SYN-DOC-EDIT");
      assert.equal(draft.name, "Cliente QA existente"); assert.equal(draft.preferredCurrency, "EUR"); assert.equal(Object.hasOwn(draft, "id"), false);
      assert.equal(await page.evaluate(() => (window as any).__qaClient.id), "synthetic-real-id");
      assert.equal(await page.evaluate(() => (window as any).__qaRecords[0].id), "synthetic-real-id");
    });
    assert.deepEqual(await page.evaluate(() => (window as any).__qaFetches), [], "Importing and mounting only the dialog must not call the API.");
    assert.deepEqual(pageErrors, []); assert.deepEqual(unexpectedRequests, []);
    assert.deepEqual(sourceHashes(), before, "Product source must remain stable during the isolated browser run.");
    t.diagnostic(`Verified source hashes: ${JSON.stringify(before)}`);
    t.diagnostic(`Edge ${browser.version()}; actual ClientDataDialog; in-memory save spy; external attempts blocked: ${blockedExternal.length}; no API calls, HTTP writes or database.`);
  } finally {
    await context?.close(); await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    // Remove only this test's freshly created, verified temporary directory.
    assert.equal(path.dirname(path.resolve(output)), path.resolve(os.tmpdir()));
    assert(path.basename(output).startsWith("cyp-client-phone-code-"));
    fs.rmSync(output, { recursive: true, force: true });
  }
});
