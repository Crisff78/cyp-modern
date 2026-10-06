import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

// Real components in an ephemeral loopback composition. The deterministic API
// contains synthetic contacts only; no database, provider, .env or browser download.
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

test("remittance client picker and cross-rate display run in an isolated real browser", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-remittance-picker-"));
  const sources = ["RemittancesWorkspace.tsx", "suggestions.ts", "crossRate.ts", "remittances.css"].map((file) => path.resolve(adminRoot, "../shared/remittances", file));
  const sourceHashes = () => Object.fromEntries(sources.map((file) => [path.basename(file), createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
  const before = sourceHashes();
  let browser: any, context: any, server: ReturnType<typeof createServer> | undefined;
  const pageErrors: string[] = [], blockedExternal: string[] = [];
  try {
    const fixture = path.join(output, "fixture.tsx");
    const workspaceModule = JSON.stringify(path.resolve(adminRoot, "../shared/remittances/RemittancesWorkspace.tsx").replaceAll("\\", "/"));
    fs.writeFileSync(fixture, `import { useState } from "react";
import { createRoot } from "react-dom/client";
import RemittancesWorkspace, { ClientPicker } from ${workspaceModule};
const clients = [
  { id:"a", code:"QA-A", name:"Remitente QA", routeId:"qa", active:true, canSendFrom:true, canReceive:true, preferredCurrency:"USD" },
  { id:"b", code:"QA-B", name:"Destino QA B", routeId:"qa", active:true, canSendFrom:true, canReceive:true, preferredCurrency:"EUR" },
  { id:"c", code:"QA-C", name:"Destino QA C", routeId:"qa", active:true, canSendFrom:true, canReceive:true, preferredCurrency:"EUR" }
];
// These fields model server-only contacts and never enter ClientPicker props.
const contacts = { b:{phone:"+509 (555) 12-34",note:""}, c:{phone:"",note:"Contacto Haití +5095551234"} };
window.__qaCalls = []; window.__qaSelections = []; window.__qaMalformedStatuses = [];
const api = async (request, options = {}) => {
  window.__qaCalls.push({request, method:options.method || "GET"});
  if (options.method && options.method !== "GET") throw new Error("Synthetic fixture forbids mutations");
  const url = new URL(request, location.origin), query = url.searchParams.get("query") || "";
  if (url.pathname !== "/envios/clientes/buscar") throw new Error("Unexpected picker endpoint");
  if (query === "vieja") return new Promise(resolve => { window.__qaOldStarted = true; window.__qaReleaseOld = () => resolve({ids:["b"],hasMore:false}); });
  if (query === "nueva") return {ids:["c"],hasMore:false};
  if (query === "error") throw new Error("Fallo sintético de búsqueda");
  if (query === "json-vacio" || query === "json-nulo") { const response = await fetch("/api" + request); window.__qaMalformedStatuses.push(response.status); return response.json(); }
  const digits = query.replace(/[^0-9]/g, "");
  const ids = clients.filter(client => {
    const privateContact = contacts[client.id];
    return digits.length >= 3 && privateContact ? Object.values(privateContact).some(value => value.replace(/[^0-9]/g, "").includes(digits)) : (client.code + " " + client.name).toLowerCase().includes(query.toLowerCase());
  }).map(client => client.id);
  return {ids,hasMore:false};
};
function PickerFixture() {
  const [query,setQuery] = useState(""), [value,setValue] = useState(""), [senderId,setSender] = useState("a");
  window.__qaSetSender = setSender;
  return <main className="remittances"><h1>Selector sintético</h1><ClientPicker api={api} side="recipient" senderId={senderId} label="Destinatario" clients={clients.filter(client => client.id !== senderId)} value={value} query={query} onQuery={text => {setQuery(text);setValue("");}} onSelect={client => {window.__qaSelections.push(client.id);setValue(client.id);setQuery(client.code + " · " + client.name);}} /><output data-testid="selected">{value}</output></main>;
}
const transfer = (id,sourceRate,destinationRate,receiveAmount) => ({id,sequence:id === "exact"?1:2,envioReference:id === "exact"?"ENV00000001":"ENV00000002",reciboReference:id === "exact"?"REC00000001":"REC00000002",operatingCode:"QA-"+id,senderClientId:"a",recipientClientId:"b",sendingUserId:"qa-admin",registeredBy:"qa-admin",sourceCurrency:"USD",destinationCurrency:"EUR",amount:10000,commissionBps:0,commissionAmount:0,totalAmount:10000,receiveAmount,quote:{date:"2026-10-06",sourceRate,destinationRate,quotedAt:"2026-10-06T12:00:00Z"},note:"",status:"pending",createdAt:"2026-10-06T12:00:00Z",canPay:false,canCancel:false});
const transfers = [transfer("exact","60.000000","75.000000",8000),transfer("approx","1.000000","3.000000",3333)];
const workspaceApi = async (request, options = {}) => {
  window.__qaCalls.push({request,method:options.method || "GET"});
  if (options.method && options.method !== "GET") throw new Error("Synthetic fixture forbids mutations");
  if (request === "/envios/snapshot") return {businessDate:"2026-10-06",currencies:["DOP","USD","EUR"],clients,operators:[{id:"qa-admin",name:"Admin QA",role:"admin"}],rates:[],rateHistory:[],transfers,cashSessions:[]};
  if (request === "/envios") return transfers;
  if (request === "/envios/recibos") return [];
  throw new Error("Unexpected workspace endpoint");
};
createRoot(document.getElementById("root")).render(new URLSearchParams(location.search).get("view") === "workspace" ? <RemittancesWorkspace api={workspaceApi} user={{id:"qa-admin",name:"Admin QA"}} isAdmin={true} /> : <PickerFixture />);
`, "utf8");
    const [{ build }, { default: react }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href),
      import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href),
      import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), resolve: { dedupe: ["react", "react-dom"] }, plugins: [react()], define: { "process.env.NODE_ENV": JSON.stringify("production") }, logLevel: "error", build: { outDir: path.join(output, "dist"), emptyOutDir: false, sourcemap: false, cssCodeSplit: false, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    const html = '<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>body{font:14px Arial;margin:20px}main{max-width:800px}.remittance-client-picker{width:500px}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
      if (pathname === "/api/envios/clientes/buscar") {
        const query = new URL(request.url!, "http://127.0.0.1").searchParams.get("query");
        if (query === "json-vacio" || query === "json-nulo") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(query === "json-vacio" ? {} : { ids: null, hasMore: false })); return; }
        response.writeHead(404); response.end(); return;
      }
      if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html); return; }
      const assets = new Map([["/fixture.js", "text/javascript; charset=utf-8"], ["/fixture.css", "text/css; charset=utf-8"]]);
      if (assets.has(pathname)) { response.writeHead(200, { "Content-Type": assets.get(pathname)! }); response.end(fs.readFileSync(path.join(output, "dist", pathname.slice(1)))); return; }
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
      assert.equal(route.request().method(), "GET", "The isolated browser must not perform writes.");
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    page.on("pageerror", (error: Error) => pageErrors.push(error.message));
    const openPicker = async () => { await page.goto(origin); await page.getByRole("heading", { name: "Selector sintético", exact: true }).waitFor(); };
    const input = () => page.getByRole("combobox", { name: "Destinatario", exact: true });
    const options = () => page.getByRole("option");
    const lookupDone = async (query: string) => {
      await page.waitForFunction((query: string) => (window as any).__qaCalls.some(({ request }: { request: string }) => new URL(request, location.origin).searchParams.get("query") === query), query);
      await page.getByText("Buscando contactos…", { exact: true }).waitFor({ state: "hidden" });
    };
    await t.test("formatted phone and note digits return two IDs without automatic selection", async () => {
      await openPicker(); await input().fill("+509 (555) 12-34"); await lookupDone("+509 (555) 12-34");
      assert.equal(await options().count(), 2); assert.deepEqual(await page.evaluate(() => (window as any).__qaSelections), []);
      assert.equal(await page.getByTestId("selected").innerText(), "");
      await input().fill("5095551234"); await lookupDone("5095551234"); assert.equal(await options().count(), 2);
      const request = await page.evaluate(() => (window as any).__qaCalls.at(-1).request);
      assert.equal(new URL(request, origin).pathname, "/envios/clientes/buscar");
      assert.equal(new URL(request, origin).searchParams.get("side"), "recipient");
      assert.equal(new URL(request, origin).searchParams.get("senderId"), "a");
      const bounds = await input().boundingBox(); assert(bounds && bounds.height >= 48 && bounds.width >= 250);
    });
    await t.test("keyboard and pointer explicitly select distinct clients sharing a contact", async () => {
      await openPicker(); await input().fill("5095551234"); await lookupDone("5095551234");
      await input().press("ArrowDown"); await input().press("ArrowDown"); await input().press("Enter");
      assert.equal(await page.getByTestId("selected").innerText(), "c");
      await input().fill("5095551234"); await lookupDone("5095551234");
      await page.getByRole("option").filter({ hasText: "QA-B · Destino QA B" }).click();
      assert.equal(await page.getByTestId("selected").innerText(), "b");
      assert.deepEqual(await page.evaluate(() => (window as any).__qaSelections), ["c", "b"]);
    });
    await t.test("a late old-query response cannot replace the newer lookup", async () => {
      await openPicker(); await input().fill("vieja"); await page.waitForFunction(() => (window as any).__qaOldStarted === true);
      await input().fill("nueva"); await lookupDone("nueva");
      assert.match(await options().allTextContents().then((rows: string[]) => rows.join(" ")), /Destino QA C/);
      await page.evaluate(async () => { (window as any).__qaReleaseOld(); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.equal(await options().count(), 1); assert.match(await options().first().innerText(), /Destino QA C/);
      assert.deepEqual(await page.evaluate(() => (window as any).__qaSelections), []);
    });
    await t.test("changing sender removes the invalid recipient even if returned IDs contain it", async () => {
      await openPicker(); await input().fill("5095551234"); await lookupDone("5095551234"); assert.equal(await options().count(), 2);
      await page.evaluate(() => (window as any).__qaSetSender("b"));
      await page.waitForFunction(() => (window as any).__qaCalls.some(({ request }: { request: string }) => new URL(request, location.origin).searchParams.get("senderId") === "b"));
      await page.getByText("Buscando contactos…", { exact: true }).waitFor({ state: "hidden" });
      assert.equal(await options().count(), 1); assert.match(await options().first().innerText(), /Destino QA C/);
      assert.deepEqual(await page.evaluate(() => (window as any).__qaSelections), []);
    });
    await t.test("lookup errors stay visible without selecting a client", async () => {
      await openPicker(); await input().fill("error"); await page.getByRole("alert").filter({ hasText: "Fallo sintético de búsqueda" }).waitFor();
      assert.equal(await page.getByTestId("selected").innerText(), ""); assert.equal(await options().count(), 0);
      assert.deepEqual(await page.evaluate(() => (window as any).__qaSelections), []);
    });
    await t.test("HTTP 200 with empty JSON or null IDs shows an alert without selection or page errors", async () => {
      for (const query of ["json-vacio", "json-nulo"]) {
        await openPicker(); await input().fill(query);
        await page.getByRole("alert").filter({ hasText: "La búsqueda devolvió una respuesta inválida" }).waitFor();
        assert.deepEqual(await page.evaluate(() => (window as any).__qaMalformedStatuses), [200]);
        assert.equal(await page.getByTestId("selected").innerText(), ""); assert.equal(await options().count(), 0);
        assert.deepEqual(await page.evaluate(() => (window as any).__qaSelections), []);
        assert.deepEqual(pageErrors, []);
      }
    });
    await t.test("actual Workspace shows exact and approximate cross rates without writes", async () => {
      await page.goto(`${origin}/?view=workspace`);
      await page.getByRole("button", { name: "ENV00000001", exact: true }).click();
      const exact = page.getByRole("dialog", { name: "ENV00000001 · REC00000001", exact: true }); await exact.waitFor();
      assert.match(await exact.innerText(), /1 USD = 0\.8 EUR/);
      await exact.getByRole("button", { name: "Cerrar ENV00000001 · REC00000001", exact: true }).click();
      await page.getByRole("button", { name: "ENV00000002", exact: true }).click();
      const rounded = page.getByRole("dialog", { name: "ENV00000002 · REC00000002", exact: true }); await rounded.waitFor();
      assert.match(await rounded.innerText(), /1 USD ≈ 0\.333333333333 EUR/);
      assert.match(await rounded.innerText(), /tasa mostrada redondeada/);
      assert.equal(await page.evaluate(() => (window as any).__qaCalls.some(({ method }: { method: string }) => method !== "GET")), false);
    });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(sourceHashes(), before, "Product source must remain stable during the isolated browser run.");
    t.diagnostic(`Verified source hashes: ${JSON.stringify(before)}`);
    t.diagnostic(`Edge ${browser.version()}; deterministic synthetic API; external attempts blocked: ${blockedExternal.length}; no mutations or database.`);
  } finally {
    await context?.close(); await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    // Remove only this test's freshly created, verified temp directory.
    assert.equal(path.dirname(path.resolve(output)), path.resolve(os.tmpdir()));
    assert(path.basename(output).startsWith("cyp-remittance-picker-"));
    fs.rmSync(output, { recursive: true, force: true });
  }
});
