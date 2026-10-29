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
const edge = path.join(
  process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
  "Microsoft/Edge/Application/msedge.exe",
);
const cache = path.join(
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"),
  "npm-cache/_npx",
);
let playwrightEntry: string | undefined;
try {
  playwrightEntry = require.resolve("playwright");
} catch {
  playwrightEntry = fs.existsSync(cache)
    ? fs
        .readdirSync(cache)
        .map((entry) =>
          path.join(cache, entry, "node_modules/playwright/index.mjs"),
        )
        .find((entry) => fs.existsSync(entry))
    : undefined;
}

test(
  "real money controls are typed from left to right, with mobile input, strict paste, cash change and the collector keypad",
  {
    skip:
      process.platform === "win32" && fs.existsSync(edge) && playwrightEntry
        ? false
        : "Installed Windows Edge and Playwright required; no download attempted.",
  },
  async () => {
    const output = fs.mkdtempSync(
      path.join(os.tmpdir(), "cyp-money-entry-ui-"),
    );
    const module = (relative: string) =>
      JSON.stringify(path.resolve(root, relative).replaceAll("\\", "/"));
    const fixture = path.join(output, "fixture.tsx");
    fs.writeFileSync(
      fixture,
      `import { useState } from "react"; import { createRoot } from "react-dom/client";
import { MoneyInput } from ${module("../shared/MoneyInput.tsx")};
import { PaymentFields, paymentDraftFor, paymentInput } from ${module("../shared/remittances/PaymentFields.tsx")};
import { CollectionSheet } from ${module("../client-collector/src/CollectionSheet.tsx")};
function Test(){ const [amount,setAmount]=useState(""), [saved,setSaved]=useState(""), [submits,setSubmits]=useState(0), [payment,setPayment]=useState(paymentDraftFor(90000)), [collector,setCollector]=useState(false);
return <main><form onSubmit={e=>{e.preventDefault();setSaved(amount);setSubmits(count=>count+1)}}><label>Monto<MoneyInput required value={amount} onValueChange={setAmount}/></label><output aria-label="Valor exacto">{amount}</output><button>Guardar monto</button><output aria-label="Guardado">{saved}</output><output aria-label="Envíos del formulario">{submits}</output></form>
<label>Limitado<MoneyInput max="1000" value="1000.00" onValueChange={()=>{}}/></label>
<PaymentFields total={90000} currency="DOP" value={payment} onChange={setPayment}/><button onClick={()=>{try{setSaved(String(paymentInput(90000,payment).tenderedAmount))}catch{setSaved("bloqueado")}}}>Validar pago</button>
<button onClick={()=>setCollector(true)}>Abrir cobrador</button>{collector&&<CollectionSheet actorId="qa-money" operation={{id:"qa-money-charge",clientName:"Cliente de prueba",concept:"Prueba",outstanding:100000,kind:"collection"}} online={false} onClose={()=>setCollector(false)} onSuccess={()=>{}}/>}</main>}
createRoot(document.getElementById("root")).render(<Test/>);`,
    );
    let browser: any, server: ReturnType<typeof createServer> | undefined;
    try {
      const [{ build }, { default: react }, { chromium }] = await Promise.all([
        import(pathToFileURL(require.resolve("vite")).href),
        import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href),
        import(pathToFileURL(playwrightEntry!).href),
      ]);
      await build({
        root,
        configFile: false,
        envFile: false,
        publicDir: false,
        cacheDir: path.join(output, "cache"),
        plugins: [react()],
        resolve: { dedupe: ["react", "react-dom"] },
        logLevel: "error",
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        build: {
          outDir: output,
          emptyOutDir: false,
          lib: {
            entry: fixture,
            formats: ["es"],
            fileName: () => "fixture.js",
          },
        },
      });
      server = createServer((request, response) => {
        if (request.url === "/fixture.js") {
          response.setHeader("Content-Type", "text/javascript");
          response.end(fs.readFileSync(path.join(output, "fixture.js")));
        } else {
          response.setHeader("Content-Type", "text/html");
          response.end(
            '<!doctype html><html lang="es"><meta charset="utf-8"><div id="root"></div><script type="module" src="/fixture.js"></script></html>',
          );
        }
      });
      await new Promise<void>((resolve) =>
        server!.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      assert(address && typeof address !== "string");
      const origin = `http://127.0.0.1:${address.port}`;
      browser = await chromium.launch({ executablePath: edge, headless: true });
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.route("**/*", (route: any) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      await page.goto(origin);
      const amount = page.getByLabel("Monto", { exact: true });
      await amount.click();
      // From left to right, as any number (Rardiel, 29-10-2026): 1500 is 1,500.00.
      for (const [digit, expected] of [
        ["1", "1"],
        ["0", "10"],
        ["0", "100"],
        ["0", "1,000"],
      ]) {
        await amount.press(digit);
        assert.equal(await amount.inputValue(), expected);
      }
      assert.equal(
        await page.getByLabel("Valor exacto").textContent(),
        "1000.00",
      );
      await page
        .getByRole("button", { name: "Guardar monto", exact: true })
        .click();
      assert.equal(await page.getByLabel("Guardado").textContent(), "1000.00");
      assert.equal(
        await page.getByLabel("Envíos del formulario").textContent(),
        "1",
      );
      // Leaving the field shows the whole amount; coming back, Backspace deletes from the right as in any field.
      assert.equal(await amount.inputValue(), "1,000.00", "after saving, the field shows the whole amount");
      await amount.press("End");
      await amount.press("Backspace");
      assert.equal(await amount.inputValue(), "1,000.0");
      assert.equal(await page.getByLabel("Valor exacto").textContent(), "1000.00", "the amount did not change");
      await amount.press("ControlOrMeta+A");
      await amount.pressSequentially("1234567");
      assert.equal(await amount.inputValue(), "1,234,567");
      await amount.press(".");
      await amount.pressSequentially("05");
      assert.equal(await amount.inputValue(), "1,234,567.05");
      assert.equal(await page.getByLabel("Valor exacto").textContent(), "1234567.05");
      await amount.press("7");
      assert.equal(await amount.inputValue(), "1,234,567.05");
      assert.equal(
        await amount.getAttribute("aria-invalid"),
        "true",
        "A third explicit decimal cannot silently replace a cent.",
      );
      const paste = async (control: any, text: string) =>
        control.evaluate((element: HTMLInputElement, value: string) => {
          const data = new DataTransfer();
          data.setData("text/plain", value);
          element.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            }),
          );
        }, text);
      await paste(amount, "2,345.67");
      assert.equal(await amount.inputValue(), "2,345.67");
      await paste(amount, "1000");
      assert.equal(await amount.inputValue(), "1,000.00", "pasted digits are units, as written");
      for (const invalid of [
        "1e3",
        "1,25",
        "1;DROP TABLE",
        "90,071,992,547,409.92",
        "0".repeat(30),
      ]) {
        await paste(amount, invalid);
        assert.equal(await amount.inputValue(), "1,000.00");
        assert.equal(await amount.getAttribute("aria-invalid"), "true");
      }
      await page
        .getByRole("button", { name: "Guardar monto", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Envíos del formulario").textContent(),
        "1",
        "An invalid paste cannot resubmit the old amount.",
      );
      await amount.press("ControlOrMeta+A");
      await amount.press("Backspace");
      await amount.evaluate((element: HTMLInputElement) => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(element, "7");
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: "7",
          }),
        );
      });
      assert.equal(
        await amount.inputValue(),
        "7",
        "Mobile input without keydown is also typed from the left.",
      );
      const tendered = page.getByLabel("Dinero recibido (DOP)");
      await tendered.press("ControlOrMeta+A");
      await tendered.pressSequentially("1000");
      assert.equal(await tendered.inputValue(), "1,000", "while it is written the field shows what was typed");
      assert.match(
        await page.getByLabel("Devuelta (DOP)").inputValue(),
        /100\.00/,
      );
      await paste(tendered, "1e3");
      await page
        .getByRole("button", { name: "Validar pago", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Guardado").textContent(),
        "bloqueado",
      );
      const limited = page.getByLabel("Limitado");
      await limited.press("End");
      await limited.press("1");
      assert.equal(await limited.inputValue(), "1,000.00");
      assert.equal(await limited.getAttribute("aria-invalid"), "true");
      await page
        .getByRole("button", { name: "Abrir cobrador", exact: true })
        .click();
      const keypad = page.getByLabel("Teclado de importe");
      // The keypad also types from the left, with its point for the cents.
      await keypad.getByRole("button", { name: "1", exact: true }).click();
      for (let index = 0; index < 3; index++)
        await keypad.getByRole("button", { name: "0", exact: true }).click();
      assert.equal(await page.locator("#collection-amount").inputValue(), "1,000");
      await keypad.getByRole("button", { name: "Separador decimal", exact: true }).click();
      await keypad.getByRole("button", { name: "5", exact: true }).click();
      assert.equal(await page.locator("#collection-amount").inputValue(), "1,000.5");
      await keypad.getByRole("button", { name: "Borrar último dígito", exact: true }).click();
      await keypad.getByRole("button", { name: "Borrar último dígito", exact: true }).click();
      assert.equal(await page.locator("#collection-amount").inputValue(), "1,000");
      await page.screenshot({
        path: path.join(output, "money-entry.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
    } finally {
      if (browser) await browser.close();
      if (server)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  },
);
