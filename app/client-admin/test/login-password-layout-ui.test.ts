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
const available = playwright && fs.existsSync(edge) && [adminRoot, collectorRoot].every(root => fs.existsSync(path.join(root, "dist/index.html")));
const origin = "http://127.0.0.1:52999";
const centerY = (box: { y: number; height: number }) => box.y + box.height / 2;

test("the password eye is centered and keyboard accessible in the built office and collector logins", {
  skip: available ? false : "Requires both public web builds and installed Edge/Playwright",
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
            return route.fulfill({ json: url.pathname.endsWith("/estaciones") ? [] : {} });
          }
          if (!url.pathname.startsWith(base)) return route.abort();
          const file = path.resolve(dist, url.pathname.slice(base.length) || "index.html");
          if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
          return route.fulfill({ path: file });
        });
        await page.goto(origin + base);
        if (portal === "admin") assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
        const password = page.locator('input[name="password"]');
        const button = page.getByRole("button", { name: /^(Mostrar|Ocultar) contraseña$/ });
        for (const width of [390, 1280]) {
          await page.setViewportSize({ width, height: 850 });
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
        await page.close();
      }
    }
    assert.equal(loginRequests, 0);
  } finally {
    await browser.close();
  }
});
