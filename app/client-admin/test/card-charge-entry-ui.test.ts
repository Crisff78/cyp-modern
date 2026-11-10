import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = require.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map(entry => path.join(cache, entry, "node_modules/playwright/index.mjs")).find(fs.existsSync) : undefined; }

test("card charges replace the preset by typing, clicking or touching, without clearing it first", {
  skip: process.platform === "win32" && fs.existsSync(edge) && playwrightEntry ? false : "Installed Windows Edge and Playwright required; no download attempted.",
}, async t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-card-charge-entry-"));
  const module = (relative: string) => JSON.stringify(path.resolve(root, relative).replaceAll("\\", "/"));
  const fixture = path.join(output, "fixture.tsx");
  fs.writeFileSync(fixture, `import {StrictMode,useState} from "react";import {createRoot} from "react-dom/client";
import {CardChargeDialog} from ${module("../shared/remittances/CardChargeDialog.tsx")};
import {installKeyboard} from ${module("../shared/keyboard.ts")};
import ${module("../shared/remittances/remittances.css")};
installKeyboard();
function Test(){const[initial,setInitial]=useState(null),[saved,setSaved]=useState("");return <main>
<button onClick={()=>setInitial(0)}>Débito sin cargo</button><button onClick={()=>setInitial(275)}>Crédito sugerido</button>
<output aria-label="Cargo aceptado">{saved}</output>
{initial!==null&&<CardChargeDialog total={11000} currency="DOP" cardType={initial===0?"debit":"credit"} initialAmount={initial} locked={false} onClose={()=>setInitial(null)} onAccept={amount=>{setSaved(String(amount));setInitial(null)}}/>}</main>}
createRoot(document.getElementById("root")).render(<StrictMode><Test/></StrictMode>);`);
  let browser: any, server: ReturnType<typeof createServer> | undefined;
  const errors: string[] = [];
  try {
    const [{ build }, { default: react }, { chromium }] = await Promise.all([
      import(pathToFileURL(require.resolve("vite")).href), import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href), import(pathToFileURL(playwrightEntry!).href),
    ]);
    await build({ root, configFile: false, envFile: false, publicDir: false, cacheDir: path.join(output, "cache"), plugins: [react()], resolve: { dedupe: ["react", "react-dom"] }, logLevel: "error", define: { "process.env.NODE_ENV": JSON.stringify("development") }, build: { outDir: output, emptyOutDir: false, lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.js", cssFileName: "fixture" } } });
    server = createServer((request, response) => {
      if (request.url === "/fixture.js" || request.url === "/fixture.css") {
        response.setHeader("Content-Type", request.url.endsWith(".js") ? "text/javascript" : "text/css");
        response.end(fs.readFileSync(path.join(output, request.url.slice(1))));
      } else {
        response.setHeader("Content-Type", "text/html");
        response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>');
      }
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath: edge, headless: true });
    for (const mobile of [false, true]) for (const preset of ["Débito sin cargo", "Crédito sugerido"]) await t.test(`${mobile ? "touch" : "desktop"}: ${preset}`, async () => {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile, isMobile: mobile, serviceWorkers: "block" });
      try {
        await context.route("**/*", (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
        const page = await context.newPage(); page.setDefaultTimeout(10000); page.on("pageerror", (error: Error) => errors.push(error.message)); await page.goto(origin);
        const dialog = page.getByRole("dialog", { name: "Cargo adicional por tarjeta", exact: true });
        const amount = dialog.getByLabel("Cargo adicional (DOP)", { exact: true });
        const accept = dialog.getByRole("button", { name: "Aceptar cargo", exact: true });
        const open = async () => { await page.getByRole("button", { name: preset, exact: true }).click(); await amount.waitFor(); };
        const type = async (text: string) => {
          // Native input without keydown also covers the path used by a phone keyboard.
          for (const char of text) if (mobile) await page.keyboard.insertText(char); else await page.keyboard.type(char);
        };
        await open();
        await type("15.25"); // No fill(), Ctrl+A, selection manipulation or deletion.
        assert.equal(await amount.inputValue(), "15.25", "typing replaces the suggested amount or zero immediately");
        assert.match(await dialog.locator(".remittance-payment-total").innerText(), /125\.25/);
        await accept.click(); assert.equal(await page.getByLabel("Cargo aceptado").textContent(), "1525");

        await open();
        if (mobile) await amount.tap(); else await amount.click();
        await type("3.50");
        assert.equal(await amount.inputValue(), "3.50", "clicking an already focused preset must not leave its zeros behind");
        await amount.press("Backspace"); assert.equal(await amount.inputValue(), "3.5");
        await amount.press("Backspace"); assert.equal(await amount.inputValue(), "3.");
        await amount.press("Backspace"); assert.equal(await amount.inputValue(), "3");
        await amount.press("Backspace"); assert.equal(await amount.inputValue(), "");
        assert.equal(await accept.isDisabled(), true, "an empty amount is never accepted as zero");
        await type("0.05"); assert.equal(await amount.inputValue(), "0.05");
        await accept.click(); assert.equal(await page.getByLabel("Cargo aceptado").textContent(), "5");

        await open();
        await type("10");
        await amount.press("Tab"); await page.keyboard.press("Shift+Tab");
        await type("12.75"); assert.equal(await amount.inputValue(), "12.75", "returning by Tab selects the previous amount for replacement");
        await amount.press("Enter");
        assert.equal(await dialog.isVisible(), true, "Enter advances without accepting a financial amount");
        await amount.click(); await type("0");
        assert.equal(await amount.inputValue(), "0"); assert.equal(await accept.isEnabled(), true);
        await accept.click(); assert.equal(await page.getByLabel("Cargo aceptado").textContent(), "0");

        await open();
        await type("24.50");
        // After the first replacement, ordinary cursor editing must still work.
        await amount.press("Home"); await amount.press("Delete");
        assert.equal(await amount.inputValue(), "4.50");
        await amount.press("End"); await amount.press("1");
        assert.equal(await amount.inputValue(), "4.50"); assert.equal(await accept.isDisabled(), true, "a third decimal is rejected, never silently rounded");
        await amount.press("ControlOrMeta+A"); await type("1500.25");
        assert.equal(await amount.inputValue(), "1,500.25"); assert.equal(await accept.isEnabled(), true);
        await page.screenshot({ path: path.join(output, `${mobile ? "touch" : "desktop"}-${preset.startsWith("Débito") ? "debit" : "credit"}.png`) });
        await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
        assert.equal(await page.getByLabel("Cargo aceptado").textContent(), "0", "cancelling leaves the accepted amount unchanged");
      } finally { await context.close(); }
    });
    assert.deepEqual(errors, []);
    console.log(`Card charge entry evidence: ${output}`);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  }
});
