import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";
import { getAdminTools } from "../../server/src/admin-tools.js";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const existingCache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(existingCache) ? fs.readdirSync(existingCache).map((name) => path.join(existingCache, name, "node_modules/playwright/index.mjs")).find((file) => fs.existsSync(file)) : undefined; }

// Real connected UI and installation routes; fresh Edge context, owned loopback
// listener, MemoryStore and fictional stations. No RRAA validator or screenshots.
test("CyP browser installation proves persistence, reviewed mutations and exact uncertain retry in isolation", {
  skip: process.platform !== "win32" || !fs.existsSync(edge) || !playwrightEntry ? "Installed Windows Edge/Playwright required; no download or normal profile used." : false,
  // Windows bundling plus first Edge startup/cleanup can exceed two minutes;
  // individual UI assertions retain their ten-second timeout below.
  timeout: 240000,
}, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-installation-ui-"));
  const state = seed(), station = (suffix: string) => ({
    id: `fictional-installation-station-${suffix}`, number: suffix, name: `QA-CYP-${suffix}`,
    deviceId: `FICTIONAL-RRAA-${suffix}`, description: "Synthetic isolated UI fixture", group: "", type: "",
    license: "", version: "", active: false,
  });
  getAdminTools(state).stations = [station("A"), station("B"), station("C")];
  const originalStations = structuredClone(getAdminTools(state).stations), store = new MemoryStore(state);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let browser: any, context: any;
  const writes: Array<{ path: string; body: string; key: string; status: number }> = [];
  let loseRegistrationResponse = false, externalAttempts = 0, unexpectedPageErrors = 0, installationReads = 0;
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname.startsWith("/api/")) {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString("utf8");
        const result = await app!.inject({ method: request.method as "GET" | "POST", url: request.url!, headers: request.headers,
          ...(body ? { payload: JSON.parse(body) } : {}) });
        if (request.method === "POST") writes.push({ path: pathname, body, key: String(request.headers["idempotency-key"] ?? ""), status: result.statusCode });
        if (request.method === "GET" && pathname.endsWith("/instalaciones")) installationReads++;
        if (loseRegistrationResponse && request.method === "POST" && pathname.endsWith("/instalaciones") && result.statusCode === 200) {
          loseRegistrationResponse = false;
          response.writeHead(503, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Respuesta de registro sin confirmar en la prueba aislada." } })); return;
        }
        response.writeHead(result.statusCode, { "Content-Type": "application/json" }); response.end(result.body); return;
      }
      if (pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end('<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root" style="height:850px"></div><script type="module" src="/fixture.js"></script></html>'); return;
      }
      const mime = { "/fixture.js": "text/javascript", "/fixture.css": "text/css" }[pathname];
      if (mime) { response.writeHead(200, { "Content-Type": mime }); response.end(fs.readFileSync(path.join(output, "dist", pathname.slice(1)))); return; }
      response.writeHead(404); response.end();
    } catch { if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "Fallo de fixture aislado." } })); }
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    app = await buildApp({ store, demo: true, secret: "synthetic-installation-browser-secret-at-least-32-characters", origins: [origin], collectorUrl: "/collector/", buildVersion: "isolated-ui-fixture" });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
    assert.equal(login.statusCode, 200);
    const { token, user } = login.json();
    assert.equal(user.role, "admin");
    const fixture = path.join(output, "fixture.tsx"), module = (name: string) => JSON.stringify(path.join(adminRoot, "src", name).replaceAll("\\", "/"));
    fs.writeFileSync(fixture, `import { createRoot } from "react-dom/client";
import { ConnectedAdminTools } from ${module("ConnectedAdminTools.tsx")};
import { remittancesApi } from ${module("remittancesApi.ts")};
import ${module("styles.css")};
remittancesApi("/snapshot").then(snapshot => createRoot(document.getElementById("root")).render(<ConnectedAdminTools page="stations" snapshot={snapshot} user={${JSON.stringify({ id: user.id, role: user.role })}} onRefresh={() => {}} />));`, "utf8");
    const [{ build }, { default: react }, { chromium }] = await Promise.all([
      import(pathToFileURL(localRequire.resolve("vite")).href), import(pathToFileURL(localRequire.resolve("@vitejs/plugin-react")).href), import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root: adminRoot, configFile: false, envFile: false, publicDir: false, resolve: { dedupe: ["react", "react-dom"] }, plugins: [react()], logLevel: "error",
      define: { "process.env.NODE_ENV": JSON.stringify("production") }, build: { outDir: path.join(output, "dist"), emptyOutDir: false, cssCodeSplit: false,
        lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    browser = await chromium.launch({ executablePath: edge, headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 950 }, serviceWorkers: "block" });
    await context.addInitScript((value: string) => localStorage.setItem("cyp-admin-token", value), token);
    await context.route("**/*", (route: any) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalAttempts++; return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000); page.on("pageerror", () => unexpectedPageErrors++);
    const panel = page.getByRole("region", { name: "Instalaciones propias de CyP", exact: true });
    const storedKeys = () => page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("cyp-station-installation-v1", 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error("Read fixture IDB failed"));
      });
      try {
        const records = await new Promise<any[]>((resolve, reject) => {
          const transaction = database.transaction("keys", "readonly"), request = transaction.objectStore("keys").getAll();
          let result: any[] = []; request.onsuccess = () => { result = request.result; };
          transaction.oncomplete = () => resolve(result); transaction.onabort = () => reject(new Error("Read fixture IDB failed"));
        });
        return await Promise.all(records.map(async (record) => {
          let exportDenied = false;
          try { await crypto.subtle.exportKey("pkcs8", record.privateKey); } catch (failure) { exportDenied = failure instanceof DOMException && failure.name === "InvalidAccessError"; }
          // No CryptoKey, proof, nonce, token or SPKI is returned from the browser.
          return { stationId: record.stationId, installationId: record.installationId, origin: record.origin,
            extractable: record.privateKey.extractable, type: record.privateKey.type, usages: [...record.privateKey.usages],
            algorithm: record.privateKey.algorithm.name, curve: record.privateKey.algorithm.namedCurve, exportDenied };
        }));
      } finally { database.close(); }
    });
    const selectStation = async (suffix: string, target = page) => {
      await target.getByRole("row").filter({ hasText: `QA-CYP-${suffix}` }).click();
      await target.getByRole("region", { name: "Instalaciones propias de CyP", exact: true }).getByLabel("Estación CyP", { exact: true }).waitFor();
      await target.waitForFunction((name: string) => Array.from(document.querySelectorAll(".cyp-installation-fields input")).some((input) => (input as HTMLInputElement).value === name), `QA-CYP-${suffix}`);
      await target.getByRole("button", { name: "Obtener Datos de CyP", exact: true }).waitFor({ state: "visible" });
    };
    let installationA = "", installationB = "";
    await t.test("initial query creates no key or challenge; registration requires review", async () => {
      await page.goto(origin); await panel.getByText("Sin instalaciones registradas.", { exact: true }).waitFor();
      assert.equal((await storedKeys()).length, 0);
      await panel.getByRole("button", { name: "Obtener Datos de CyP", exact: true }).click();
      await panel.getByRole("alert").filter({ hasText: "Registra este navegador" }).waitFor();
      assert.equal((await storedKeys()).length, 0); assert.equal(writes.length, 0);
      await panel.getByRole("button", { name: "Registrar este navegador", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Registrar este navegador en CyP", exact: true }); await review.waitFor();
      installationA = await review.getByLabel("ID de instalación CyP", { exact: true }).inputValue();
      assert.match(installationA, /^CYP-INST-[a-f0-9]{64}$/);
      assert.equal(getAdminTools(await store.read()).installations.length, 0); assert.equal(writes.length, 0);
      await review.getByRole("button", { name: "Volver", exact: true }).click();
      await panel.getByRole("button", { name: "Registrar este navegador", exact: true }).click();
      assert.equal(await review.getByLabel("ID de instalación CyP", { exact: true }).inputValue(), installationA);
      await review.getByRole("button", { name: "Confirmar registro", exact: true }).click();
      await panel.getByText("Este navegador quedó registrado en CyP para esta estación.", { exact: true }).waitFor();
      await panel.getByText("Este navegador", { exact: true }).waitFor();
      assert.equal(getAdminTools(await store.read()).installations.length, 1);
      assert.equal(await panel.getByLabel("ID de instalación CyP", { exact: true }).getAttribute("readonly"), "");
      assert.equal(await panel.getByLabel("ID dispositivo RRAA", { exact: true }).inputValue(), "FICTIONAL-RRAA-A");
      const key = (await storedKeys())[0];
      assert.equal(key.installationId, installationA); assert.equal(key.origin, origin);
      assert.equal(key.extractable, false); assert.equal(key.type, "private"); assert.deepEqual(key.usages, ["sign"]);
      assert.equal(key.algorithm, "ECDSA"); assert.equal(key.curve, "P-256"); assert.equal(key.exportDenied, true);
    });
    await t.test("reload preserves identity without registration; own query leaves RRAA station unchanged", async () => {
      const beforeWrites = writes.length, beforeRegistrations = getAdminTools(await store.read()).installations.length;
      await page.reload(); await panel.getByText("Este navegador", { exact: true }).waitFor();
      assert.equal(await panel.getByLabel("ID de instalación CyP", { exact: true }).inputValue(), installationA);
      assert.equal(writes.length, beforeWrites); assert.equal(getAdminTools(await store.read()).installations.length, beforeRegistrations);
      await panel.getByRole("button", { name: "Obtener Datos de CyP", exact: true }).click();
      await panel.getByText("Datos de CyP consultados. La estación y su estado RRAA se conservan.", { exact: true }).waitFor();
      const data = panel.getByLabel("Datos obtenidos de CyP", { exact: true });
      assert.equal(await data.getByLabel("Código de estación", { exact: true }).inputValue(), "QA-CYP-A");
      assert.equal(await data.getByLabel("Estado de la estación", { exact: true }).inputValue(), "Inactiva");
      assert.equal(await data.getByLabel("Validación RRAA registrada", { exact: true }).inputValue(), "No validada");
      assert.equal(await data.getByLabel("Versión CyP", { exact: true }).inputValue(), "isolated-ui-fixture");
      assert.equal(await data.getByRole("textbox").count(), 6); // No license field in own query.
      assert.deepEqual(getAdminTools(await store.read()).stations, originalStations);
    });
    await t.test("lost successful register response freezes intents; exact body/proof/key retry returns one registration", async () => {
      await selectStation("B"); await panel.getByText("Sin instalaciones registradas.", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Registrar este navegador", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Registrar este navegador en CyP", exact: true }); await review.waitFor();
      installationB = await review.getByLabel("ID de instalación CyP", { exact: true }).inputValue();
      assert.notEqual(installationB, installationA);
      loseRegistrationResponse = true;
      await review.getByRole("button", { name: "Confirmar registro", exact: true }).click();
      await review.getByRole("alert").filter({ hasText: "Respuesta de registro sin confirmar" }).waitFor();
      const commits = () => writes.filter((write) => write.path === `/api/estaciones/${station("B").id}/instalaciones`);
      assert.equal(commits().length, 1); assert.equal(commits()[0].status, 200);
      assert.equal(getAdminTools(await store.read()).installations.filter((row) => row.stationId === station("B").id).length, 1);
      assert.equal(await panel.getByRole("button", { name: "Obtener Datos de CyP", exact: true }).isDisabled(), true);
      assert.equal(await page.getByLabel("Buscar", { exact: true }).isDisabled(), true);
      assert.equal(await review.getByRole("button", { name: "Volver", exact: true }).isDisabled(), true);
      await page.getByRole("row").filter({ hasText: "QA-CYP-A" }).evaluate((element: HTMLElement) => element.click());
      assert.equal(await panel.getByLabel("Estación CyP", { exact: true }).inputValue(), "QA-CYP-B");
      const reads = installationReads;
      await review.getByRole("button", { name: "Refrescar instalaciones", exact: true }).click();
      await review.getByText(/Estado observado en el listado: Vigente/).waitFor();
      assert.ok(installationReads > reads); assert.equal(commits().length, 1);
      await review.getByRole("button", { name: "Reintentar la misma solicitud", exact: true }).click();
      await panel.getByText("Este navegador quedó registrado en CyP para esta estación.", { exact: true }).waitFor();
      assert.equal(commits().length, 2);
      assert.ok(commits()[0].body === commits()[1].body, "retry body includes exactly the same challenge, proof and confirmation");
      assert.ok(commits()[0].key === commits()[1].key && commits()[0].key.length >= 8, "retry retains the caller-owned operation key");
      assert.equal(getAdminTools(await store.read()).installations.filter((row) => row.stationId === station("B").id).length, 1);
      assert.equal(writes.filter((write) => write.path === `/api/estaciones/${station("B").id}/instalaciones/desafios`).length, 1);
    });
    await t.test("revoke requires note and second review; a revoked key stays unchanged and cannot query", async () => {
      await panel.getByText("Este navegador", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Revocar…", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Revocar instalación de CyP", exact: true }); await review.waitFor();
      await review.getByRole("button", { name: "Revisar revocación", exact: true }).click();
      await review.getByRole("alert").filter({ hasText: "Escribe un motivo" }).waitFor();
      await review.getByLabel("Motivo", { exact: true }).fill("Perfil ficticio retirado por revisión de prueba.");
      await review.getByRole("button", { name: "Revisar revocación", exact: true }).click();
      const confirmation = page.getByRole("dialog", { name: "Confirmar revocación de instalación", exact: true }); await confirmation.waitFor();
      assert.equal(await confirmation.locator("textarea").getAttribute("readonly"), "");
      assert.equal(getAdminTools(await store.read()).installations.find((row) => row.installationId === installationB)?.status, "active");
      assert.equal(writes.filter((write) => write.path.endsWith("/revocar")).length, 0);
      await confirmation.getByRole("button", { name: "Confirmar revocación", exact: true }).click();
      await panel.getByText("Instalación revocada en CyP.", { exact: true }).waitFor();
      await panel.getByText(/La clave de este perfil está revocada/).waitFor();
      const beforeQueries = writes.filter((write) => write.path.endsWith("/datos")).length;
      await panel.getByRole("button", { name: "Obtener Datos de CyP", exact: true }).click();
      await panel.getByRole("alert").filter({ hasText: /revocada/i }).waitFor();
      assert.equal(writes.filter((write) => write.path.endsWith("/datos")).length, beforeQueries);
      assert.equal(await panel.getByLabel("ID de instalación CyP", { exact: true }).inputValue(), installationB);
      assert.equal((await storedKeys()).find((key: any) => key.stationId === station("B").id).installationId, installationB);
      assert.deepEqual(getAdminTools(await store.read()).stations, originalStations);
    });
    await t.test("simultaneous explicit key creation in two tabs keeps one persisted identity without registering", async () => {
      const other = await context.newPage(); other.setDefaultTimeout(10000); other.on("pageerror", () => unexpectedPageErrors++);
      try {
        await other.goto(origin); await other.getByRole("region", { name: "Instalaciones propias de CyP", exact: true }).getByText("Este navegador", { exact: true }).waitFor();
        await Promise.all([selectStation("C"), selectStation("C", other)]);
        const otherPanel = other.getByRole("region", { name: "Instalaciones propias de CyP", exact: true });
        await panel.getByText("Sin instalaciones registradas.", { exact: true }).waitFor();
        await otherPanel.getByText("Sin instalaciones registradas.", { exact: true }).waitFor();
        const beforeWrites = writes.length;
        await Promise.all([panel.getByRole("button", { name: "Registrar este navegador", exact: true }).click(), otherPanel.getByRole("button", { name: "Registrar este navegador", exact: true }).click()]);
        const firstReview = page.getByRole("dialog", { name: "Registrar este navegador en CyP", exact: true });
        const otherReview = other.getByRole("dialog", { name: "Registrar este navegador en CyP", exact: true });
        await Promise.all([firstReview.waitFor(), otherReview.waitFor()]);
        assert.equal(await firstReview.getByLabel("ID de instalación CyP", { exact: true }).inputValue(), await otherReview.getByLabel("ID de instalación CyP", { exact: true }).inputValue());
        assert.equal((await storedKeys()).filter((key: any) => key.stationId === station("C").id).length, 1);
        assert.equal(writes.length, beforeWrites); assert.equal(getAdminTools(await store.read()).installations.length, 2);
        await firstReview.getByRole("button", { name: "Volver", exact: true }).click();
        await otherReview.getByRole("button", { name: "Volver", exact: true }).click();
      } finally { await other.close(); }
    });
    assert.equal(unexpectedPageErrors, 0);
    assert.equal(writes.filter((write) => write.path.endsWith("/validar")).length, 0);
    assert.deepEqual(getAdminTools(await store.read()).stations, originalStations);
    t.diagnostic(`Fresh browser/MemoryStore, exact loopback origin, ${externalAttempts} external attempts blocked; no provider, screenshots or shared data.`);
  } finally {
    await context?.close(); await browser?.close();
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await app?.close();
  }
});
