import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { seed } from "../../server/src/seed.js";
import { MemoryStore } from "../../server/src/store.js";
import { DEMO_PASSWORD } from "../../server/src/demo-credentials.js";
import { keyboardHarness } from "./keyboard-harness.js";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRequire = createRequire(path.join(adminRoot, "package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe");
let playwrightEntry: string | undefined;
try { playwrightEntry = localRequire.resolve("playwright"); } catch {
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx");
  playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map((entry) => path.join(cache, entry, "node_modules/playwright/index.mjs")).find((entry) => fs.existsSync(entry)) : undefined;
}
const canRunBrowser = process.platform === "win32" && fs.existsSync(edge) && Boolean(playwrightEntry);

// The keyboard never gets lost, and it starts where the pointer is (Rardiel, 28-10-2026: «cuando le doy click a la
// pantalla … y le doy con el teclado … la pantalla se queda sin hacer nada»; «debe poder empezar a usar el teclado justo
// donde yo tenga el mouse»). This test uses the mouse on purpose: a click on the background, then the keys; the pointer
// over a window, the menu or a field, then the keys.
test("The keyboard is never lost: after a click on the background the first key puts it back, where the pointer is", { skip: canRunBrowser ? false : "Installed Windows Edge and Playwright required; no download attempted." }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cyp-teclado-raton-"));
  const app = await buildApp({ store: new MemoryStore(seed()), demo: true, secret: "synthetic-keyboard-pointer-secret-at-least-32-chars", origins: [], collectorUrl: "/collector/" });
  const harness = await keyboardHarness({ app, adminRoot, output, playwrightEntry: playwrightEntry!, edge, localRequire, idempotencyKey: randomUUID });
  try {
    // A big screen, so the windows open in cascade and the one behind can be seen.
    const { page, keys, focused, waitFor, menuTo } = await harness.signedOut({ width: 1920, height: 1200 });
    await waitFor(() => document.activeElement?.id === "admin-login-username");
    await page.keyboard.type("admin@cyp.local"); await keys("Enter");
    await page.keyboard.type(DEMO_PASSWORD); await keys("Enter");
    await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")));
    const inWindow = (title: string) => waitFor((name: string) => document.activeElement?.closest(".mdi-window")?.getAttribute("aria-label") === name, title);
    const lost = () => page.evaluate(`(() => { const a = document.activeElement; return !a || a === document.body || a.matches("#main-content"); })()`) as Promise<boolean>;
    // A point of the page where the pointer is over the given thing and over nothing that takes the keyboard.
    const spotOver = async (selector: string) => {
      const spot = await page.evaluate(`(() => {
        const target = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((item) => item.getClientRects().length).pop();
        if (!target) return null;
        const box = target.getBoundingClientRect();
        for (let y = box.top + 8; y < box.bottom - 4; y += 6) for (let x = box.left + 8; x < box.right - 4; x += 6) {
          const hit = document.elementFromPoint(x, y);
          if (hit && target.contains(hit) && !hit.closest('button,a,input,select,textarea,label,[tabindex]:not([tabindex="-1"]),tr')) return { x, y };
        }
        return null;
      })()`) as { x: number; y: number } | null;
      assert.ok(spot, `a free point over ${selector}`);
      return spot!;
    };
    // A click on the background of the desktop, where no window is: nothing takes the keyboard.
    const clickBackground = async () => {
      const spot = await page.evaluate(`(() => {
        for (let y = window.innerHeight - 12; y > 120; y -= 15) for (let x = window.innerWidth - 12; x > 300; x -= 15) {
          const hit = document.elementFromPoint(x, y);
          if (hit && hit.closest("main") && !hit.closest(".mdi-window,button,a,input,select,textarea,[tabindex]:not(#main-content)")) return { x, y };
        }
        return null;
      })()`) as { x: number; y: number } | null;
      assert.ok(spot, "a free point of the desktop");
      await page.mouse.click(spot!.x, spot!.y); await page.waitForTimeout(150);
    };

    await menuTo("Clientes"); await keys("Enter"); await inWindow("Clientes");
    await keys("Shift+Tab");
    for (let step = 0; step < 60 && !(await page.evaluate(`Boolean(document.activeElement?.closest("[data-keyboard-menu]"))`)); step += 1) await keys("Shift+Tab");
    await menuTo("Cargos"); await keys("Enter"); await inWindow("Cargos");

    await t.test("a click on the background and ↓: the keyboard goes back into the window in front", async () => {
      await clickBackground();
      assert.equal(await lost(), true, "the click left the keyboard nowhere");
      await keys("ArrowDown");
      await inWindow("Cargos");
    });

    await t.test("the pointer over the window behind and Tab: the keyboard starts there and brings it to the front", async () => {
      await clickBackground();
      const spot = await spotOver('.mdi-window[aria-label="Clientes"]');
      await page.mouse.move(spot.x, spot.y);
      await keys("Tab");
      await inWindow("Clientes");
      await waitFor(() => document.querySelector('.mdi-window[aria-label="Clientes"]')?.classList.contains("focused") === true);
    });

    await t.test("the pointer over the menu and Enter: the keyboard starts in the menu, and Enter does not open anything", async () => {
      await clickBackground();
      const windows = await page.evaluate(`document.querySelectorAll(".mdi-window").length`);
      const spot = await spotOver(".sidebar");
      await page.mouse.move(spot.x, spot.y);
      await keys("Enter");
      await waitFor(() => Boolean(document.activeElement?.closest("[data-keyboard-menu]")));
      assert.equal(await page.evaluate(`document.querySelectorAll(".mdi-window").length`), windows);
    });

    await t.test("the pointer over a field and an arrow: the keyboard starts in that very field, and nothing is typed", async () => {
      // Cargos to the front again, the same way (the pointer over it and a key), so its field is in sight.
      await clickBackground();
      const window = await spotOver('.mdi-window[aria-label="Cargos"]');
      await page.mouse.move(window.x, window.y);
      await keys("Tab");
      await waitFor(() => document.querySelector('.mdi-window[aria-label="Cargos"]')?.classList.contains("focused") === true);
      await clickBackground();
      const field = page.locator('.mdi-window[aria-label="Cargos"] .charges-filter-panel input[type="date"]').first();
      const before = await field.inputValue();
      const box = (await field.boundingBox())!;
      await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
      await keys("ArrowRight");
      assert.equal((await focused()).label, "Fecha Inicial:");
      assert.equal(await field.inputValue(), before);
    });

    await t.test("Esc with the keyboard nowhere keeps its meaning: the window in front closes", async () => {
      await keys("ArrowRight"); // back into the window
      await clickBackground();
      const front = await page.evaluate(`document.querySelector(".mdi-window.focused")?.getAttribute("aria-label")`) as string;
      await keys("Escape");
      await waitFor((title: string) => !document.querySelector(`.mdi-window[aria-label="${title}"]`), front);
    });
  } finally { await harness.close(); await app.close(); }
});
