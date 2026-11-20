import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const collectorRoot = path.resolve(adminRoot, "../client-collector");
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwright: string | undefined;
try { playwright = localRequire.resolve("playwright"); }
catch {
  if (fs.existsSync(cache)) playwright = fs.readdirSync(cache).map(dir => path.join(cache, dir, "node_modules/playwright/index.mjs")).find(file => fs.existsSync(file));
}
// The public build serves the collector under /collector/. A plain `pnpm build` leaves it at the root, and this test
// would only see a blank page: it is skipped, saying how to make the build it needs.
const collectorIndex = path.join(collectorRoot, "dist/index.html");
const publicBuilds = fs.existsSync(path.join(adminRoot, "dist/index.html")) && fs.existsSync(collectorIndex)
  && fs.readFileSync(collectorIndex, "utf8").includes('"/collector/assets/');
const available = playwright && fs.existsSync(edge) && publicBuilds;
const origin = "http://127.0.0.1:52999";
const centerY = (box: { y: number; height: number }) => box.y + box.height / 2;

test("the office and collector logins fit the viewport and keep the password eye centered and keyboard accessible", {
  skip: available ? false : "Requires both public web builds (pnpm build:public) and installed Edge/Playwright",
}, async () => {
  const { chromium } = await import(pathToFileURL(playwright!).href);
  const browser = await chromium.launch({ executablePath: edge });
  let loginRequests = 0;
  try {
    for (const portal of ["admin", "collector"]) {
      const base = portal === "admin" ? "/" : "/collector/";
      const dist = path.join(portal === "admin" ? adminRoot : collectorRoot, "dist");
      for (const theme of portal === "admin" ? ["light", "dark"] : ["light"]) {
        const page = await browser.newPage({ serviceWorkers: "block" });
        await page.addInitScript((value: string) => localStorage.setItem("cyp-admin-color-theme", value), theme);
        // Render the production assets, intercepting all network calls before they leave the browser.
        await page.route("**/*", (route: any) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) return route.abort();
          if (url.pathname.startsWith("/api/")) {
            if (url.pathname === "/api/auth/login") loginRequests++;
            return route.fulfill({ json: url.pathname.endsWith("/estaciones") ? [{ number: "QA-01", name: "Estación de prueba de recepción y entrega" }] : {} });
          }
          if (!url.pathname.startsWith(base)) return route.abort();
          const file = path.resolve(dist, url.pathname.slice(base.length) || "index.html");
          if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
          return route.fulfill({ path: file });
        });
        const password = page.locator('input[name="password"]');
        const button = page.getByRole("button", { name: /^(Mostrar|Ocultar) contraseña$/ });
        const station = page.getByRole("combobox", { name: "Estación", exact: true });
        const submit = page.getByRole("button", { name: "Iniciar sesión", exact: true });
        for (const [width, height] of [[1240, 640], [360, 640], [1440, 900]]) {
          await page.setViewportSize({ width, height });
          await page.goto(origin + base);
          await station.getByRole("option", { name: /QA-01/ }).waitFor({ state: "attached" });
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          if (portal === "admin") assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
          const extent = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, scroll: window.scrollY,
          }));
          const view = portal + " " + width + "×" + height + " " + theme;
          assert.equal(extent.scroll, 0, "first view: " + view);
          assert.ok(extent.width <= width && extent.height <= height + 1, "page fits: " + view + " " + JSON.stringify(extent));
          for (const control of [page.locator('input[name="username"]'), password, station, submit]) {
            const bounds = await control.boundingBox();
            assert.ok(bounds && bounds.height >= 44 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1, "control visible: " + view);
          }
          await station.selectOption("QA-01");
          const helpBox = await page.locator(".login-station-field small").boundingBox();
          const submitBox = await submit.boundingBox();
          assert.ok(helpBox && submitBox && helpBox.y + helpBox.height <= submitBox.y && submitBox.y + submitBox.height <= height + 1,
            "station choice and submit visible together: " + view);
          await password.fill("prueba-local");
          await password.press("Tab");
          assert.ok(await button.evaluate((el: HTMLElement) => el === document.activeElement));
          for (const visible of [false, true]) {
            const [field, hit, icon] = await Promise.all([password.boundingBox(), button.boundingBox(), button.locator("svg").boundingBox()]);
            assert.ok(field && hit && icon);
            const scenario = portal + " " + width + " " + theme + " visible=" + visible;
            assert.ok(Math.abs(centerY(icon) - centerY(field)) <= 0.5, "icon alignment: " + scenario);
            assert.ok(Math.abs(centerY(hit) - centerY(field)) <= 0.5, "button alignment: " + scenario);
            assert.ok(Math.abs(icon.x + icon.width / 2 - hit.x - hit.width / 2) <= 0.5);
            assert.ok(Math.abs(hit.x + hit.width - field.x - field.width) <= 0.5);
            assert.ok(hit.width >= 44 && hit.height >= 44 && hit.height <= field.height + 0.5);
            assert.ok(await password.evaluate((el: HTMLElement) => parseFloat(getComputedStyle(el).paddingRight)) >= hit.width);
            assert.equal(await password.getAttribute("type"), visible ? "text" : "password");
            assert.equal(await password.inputValue(), "prueba-local");
            await button.press(visible ? "Space" : "Enter");
          }
          assert.equal(await password.getAttribute("type"), "password");
        }
        // A short viewport can scroll through a taller form, including the catalog recovery action.
        await page.setViewportSize({ width: 320, height: 390 });
        await page.route("**/api/auth/estaciones", (route: any) => route.fulfill({ status: 503, json: {} }));
        await page.goto(origin + base);
        const retry = page.getByRole("button", { name: "Reintentar", exact: true });
        await retry.waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await submit.scrollIntoViewIfNeeded();
        const shortBox = await submit.boundingBox();
        assert.ok(shortBox && shortBox.y >= 0 && shortBox.y + shortBox.height <= 391);
        await page.unroute("**/api/auth/estaciones");
        await retry.click();
        await station.getByRole("option", { name: /QA-01/ }).waitFor({ state: "attached" });
        await page.close();
      }
    }
    assert.equal(loginRequests, 0);
  } finally {
    await browser.close();
  }
});
