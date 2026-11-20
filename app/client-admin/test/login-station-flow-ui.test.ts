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
import { registerPublicWeb } from "../../server/src/public-web.js";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const existingCache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(existingCache) ? fs.readdirSync(existingCache).map((name) => path.join(existingCache, name, "node_modules/playwright/index.mjs")).find((file) => fs.existsSync(file)) : undefined; }

// The public build serves the collector under /collector/. A plain `pnpm build` leaves it at the root, and this test
// would only see a blank page: it is skipped, saying how to make the build it needs. The office must also hand its
// session over to /collector/ (VITE_COLLECTOR_URL), which `pnpm build:public` sets; that is not looked for here.
const collectorIndex = path.join(adminRoot, "../client-collector/dist/index.html");
const publicBuilds = fs.existsSync(path.join(adminRoot, "dist/index.html")) && fs.existsSync(collectorIndex)
  && fs.readFileSync(collectorIndex, "utf8").includes('"/collector/assets/');

// Run against both public web builds, with a fresh browser profile and an isolated in-memory server.
test("station selection is part of sign-in across the office and collector portals", {
  skip: !fs.existsSync(edge) || !playwrightEntry || !publicBuilds ? "Requires both public web builds (pnpm build:public) and installed Edge/Playwright" : false,
  timeout: 180000,
}, async () => {
  const listener = createServer((req, res) => app.server.emit("request", req, res));
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const state = seed();
  state.adminTools.stations = ["A", "B", "C"].map(code => ({
    ...state.adminTools.stations[0], id: "fixture-" + code, number: code, name: "Puesto " + code, active: code !== "C",
  }));
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, publicWeb: true, publicOrigin: origin, origins: [origin],
    collectorUrl: origin + "/collector/", secret: "only-in-memory-isolated-browser-test-secret" });
  let browser: any;
  try {
    await registerPublicWeb(app);
    await app.ready();
    const { chromium } = await import(pathToFileURL(playwrightEntry!).href);
    browser = await chromium.launch({ executablePath: edge, headless: true });
    const profile = async (width: number) => {
      const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: "block" });
      await context.route("**/*", (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      return context;
    };
    const makePage = async (context: any, path: string) => {
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      await page.goto(origin + path);
      const station = page.getByRole("combobox", { name: "Estación", exact: true });
      await station.getByRole("option", { name: "B · Puesto B", exact: true }).waitFor({ state: "attached" });
      assert.equal(await station.getByRole("option", { name: "C · Puesto C" }).count(), 0);
      const password = page.locator('[name="password"]');
      const fieldBox = await station.boundingBox(), passwordBox = await password.boundingBox();
      assert.ok(fieldBox && passwordBox && fieldBox.y >= passwordBox.y + passwordBox.height);
      const submit = page.getByRole("button", { name: "Iniciar sesión", exact: true });
      const enter = async (username: string, secret = "Demo-CyP-2026!") => {
        await page.locator('[name="username"]').fill(username);
        await password.fill(secret);
        await submit.click();
      };
      const desktop = async (code: string) => {
        await page.getByRole("button", { name: new RegExp("^Ver estaciones.*Estación actual: " + code) }).waitFor();
        assert.equal(await page.getByRole("dialog", { name: "Estaciones disponibles" }).count(), 0);
      };
      return { page, station, password, submit, enter, desktop };
    };
    const same = await profile(1280);
    const office = await makePage(same, "/");
    await office.station.selectOption("B");
    await office.enter("admin", "incorrecta-ficticia");
    await office.page.getByRole("alert").filter({ hasText: "incorrectos" }).waitFor();
    assert.equal((await store.read()).adminTools.installations.length, 0);

    let logins = 0, sends = 0;
    office.page.on("request", (req: any) => { if (new URL(req.url()).pathname === "/api/auth/login") logins++; });
    await office.page.route("**/api/estaciones/fixture-B/instalaciones", async (route: any) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      if (++sends === 1) await route.fulfill({ status: 503, json: { error: { message: "Prueba de respuesta perdida" } } });
      else await route.fulfill({ response });
    });
    await office.enter("admin");
    await office.page.getByRole("alert").filter({ hasText: "respuesta perdida" }).waitFor();
    assert.ok(await office.password.isDisabled());
    assert.equal(await office.page.evaluate(() => sessionStorage.getItem("cyp-admin-token")), null);
    await office.submit.click();
    await office.desktop("B");
    assert.equal(logins, 1);
    assert.equal(sends, 2);
    assert.equal((await store.read()).adminTools.installations.length, 1);

    const collector = await makePage(same, "/");
    assert.equal(await collector.station.inputValue(), "B");
    await collector.enter("collector.demo", "incorrecta-ficticia");
    await collector.page.getByRole("alert").filter({ hasText: "incorrectos" }).waitFor();
    assert.equal(await collector.station.inputValue(), "B");
    await collector.enter("collector.demo");
    await collector.desktop("B");
    assert.match(collector.page.url(), /\/collector\//);

    const fresh = await profile(390);
    const mobile = await makePage(fresh, "/collector/");
    await mobile.station.selectOption("A");
    await mobile.enter("collector.demo");
    await mobile.page.getByRole("alert").filter({ hasText: "permiso de edición" }).waitFor();
    assert.equal((await store.read()).adminTools.installations.length, 1);
    await mobile.page.getByRole("button", { name: "Cambiar cuenta" }).click();
    await mobile.enter("admin");
    await mobile.desktop("A");
    assert.equal(new URL(mobile.page.url()).pathname, "/");
    assert.equal((await store.read()).adminTools.installations.length, 2);

    const different = await makePage(fresh, "/");
    await different.station.selectOption("B");
    await different.enter("admin");
    await different.page.getByRole("alert").filter({ hasText: "vinculado a A" }).waitFor();
    await different.station.selectOption("");
    await different.submit.click();
    await different.desktop("A");
    assert.equal((await store.read()).adminTools.installations.length, 2);

    await store.transaction(s => {
      const previous = s.adminTools.installations.find(row => row.stationId === "fixture-A");
      assert.ok(previous);
      previous.status = "revoked";
    });
    const stale = await makePage(fresh, "/");
    assert.equal(await stale.station.inputValue(), "A");
    await stale.enter("admin");
    await stale.page.getByRole("alert").filter({ hasText: "ya no está vinculada" }).waitFor();
    assert.equal(await stale.station.inputValue(), "");
    await stale.submit.click();
    await stale.page.getByRole("button", { name: /Ver estaciones.*no tiene una estación activa vinculada/ }).waitFor();
    assert.equal((await store.read()).adminTools.installations.filter(row => row.status === "active").length, 1);
  } finally {
    await browser?.close();
    listener.closeAllConnections();
    await new Promise<void>(resolve => listener.close(() => resolve()));
    await app.close();
  }
});
