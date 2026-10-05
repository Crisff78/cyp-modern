import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * CYP-QA-041 acceptance regression against the real mounted workspace.
 * The caller owns the visible Edge session and supplies an isolated loopback
 * app with a populated synthetic cash report. No real printer or mutation.
 */
export async function verifyRemittanceOutput(page, { origin, outputDir, pauseMs = 3000 }) {
  const address = new URL(origin);
  assert.equal(address.hostname, "127.0.0.1", "An isolated loopback fixture is required");
  assert.equal(new URL(page.url()).origin, address.origin);
  assert.ok(pauseMs >= 3000, "Respect the visible browser observation interval");
  await fs.mkdir(outputDir, { recursive: true });
  const workspace = page.locator("section.remittances");
  const print = workspace.getByRole("button", { name: "Imprimir", exact: true });
  const exportCsv = workspace.getByRole("button", { name: "Exportar CSV", exact: true });
  const popupMessage = "Permite abrir la ventana de impresión para este sitio.";
  const apiMessage = "QA sintética: no pudimos actualizar los envíos.";
  const csvMessage = "QA sintética: descarga temporalmente bloqueada.";
  const criteria = [];
  const alerts = () => workspace.getByRole("alert").allTextContents();
  const check = (name, value, evidence = {}) => {
    criteria.push({ name, passed: Boolean(value), evidence });
    assert.ok(value, name);
  };
  const pause = () => page.waitForTimeout(pauseMs);
  const pageErrors = [];
  const apiMutationMethods = [];
  const onError = (error) => pageErrors.push(error.message);
  const onRequest = (request) => {
    if (request.url().startsWith(`${address.origin}/api/`) && !["GET", "HEAD"].includes(request.method())) apiMutationMethods.push(request.method());
  };
  page.on("pageerror", onError);
  page.on("request", onRequest);

  await print.waitFor();
  check("Populated cash report is mounted", await workspace.locator("table tbody tr td").count() > 1);
  await page.evaluate(() => {
    const nativeOpen = window.open.bind(window);
    const nativeObjectUrl = URL.createObjectURL.bind(URL);
    window.__qa041 = { blockPopup: true, blockCsv: false, printed: [], nativeOpen, nativeObjectUrl };
    window.open = (...args) => {
      if (window.__qa041.blockPopup) return null;
      const popup = nativeOpen(...args);
      if (popup) popup.print = () => window.__qa041.printed.push({
        title: popup.document.title,
        text: popup.document.body.textContent,
        html: popup.document.documentElement.outerHTML,
        boldDataNodes: popup.document.querySelectorAll("tbody b").length,
      });
      return popup;
    };
    URL.createObjectURL = (...args) => {
      if (window.__qa041.blockCsv) throw new Error("QA sintética: descarga temporalmente bloqueada.");
      return nativeObjectUrl(...args);
    };
  });

  const successfulPrint = async () => {
    await page.evaluate(() => { window.__qa041.blockPopup = false; });
    await pause();
    const popupPromise = page.waitForEvent("popup");
    await print.click();
    const popup = await popupPromise;
    await pause();
    check("Native print popup is visible", !popup.isClosed());
    await popup.close(); // Only the synthetic print preview; retain the main Edge window.
  };
  const successfulDownload = async (filename) => {
    await page.evaluate(() => { window.__qa041.blockCsv = false; });
    await pause();
    const downloadPromise = page.waitForEvent("download");
    await exportCsv.click();
    const download = await downloadPromise;
    check("Native CSV download completes", await download.failure() === null);
    const destination = path.join(outputDir, filename);
    await download.saveAs(destination);
    const bytes = await fs.readFile(destination);
    check("CSV retains UTF-8 BOM and populated content", bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) && bytes.length > 100);
    return { filename: download.suggestedFilename(), bytes: bytes.length };
  };

  try {
    await pause();
    await print.click();
    await workspace.getByRole("alert").filter({ hasText: popupMessage }).waitFor();
    check("Blocked print is actionable and invokes no printer", (await alerts()).includes(popupMessage) && await page.evaluate(() => window.__qa041.printed.length) === 0);
    await successfulPrint();
    check("Successful print retry clears the obsolete popup warning", !(await alerts()).includes(popupMessage), { alerts: await alerts() });
    check("Only one virtual print was invoked", await page.evaluate(() => window.__qa041.printed.length) === 1);

    await page.evaluate(() => { window.__qa041.blockCsv = true; });
    await pause();
    await exportCsv.click();
    await workspace.getByRole("alert").filter({ hasText: csvMessage }).waitFor();
    check("CSV failure is reported", (await alerts()).includes(csvMessage));
    const firstDownload = await successfulDownload("cash-after-csv-retry.csv");
    check("Successful CSV retry clears only the output warning", !(await alerts()).includes(csvMessage));

    // Hold a fresh snapshot request so that an independent output failure can
    // coexist with the API failure; this catches blanket setError("") fixes.
    let releaseSnapshot;
    let snapshotObserved;
    const held = new Promise((resolve) => { releaseSnapshot = resolve; });
    const observed = new Promise((resolve) => { snapshotObserved = resolve; });
    const snapshotPattern = `${address.origin}/api/envios/snapshot`;
    const snapshotRoute = async (route) => {
      snapshotObserved();
      await held;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "QA_041_READ_FAILURE", message: apiMessage } }) });
    };
    await page.route(snapshotPattern, snapshotRoute);
    try {
      await pause();
      await workspace.getByRole("button", { name: "Actualizar", exact: true }).click();
      await Promise.race([observed, page.waitForTimeout(10000).then(() => { throw new Error("Synthetic snapshot request was not observed"); })]);
      await page.evaluate(() => { window.__qa041.blockPopup = true; });
      await pause();
      await print.click();
      await workspace.getByRole("alert").filter({ hasText: popupMessage }).waitFor();
      releaseSnapshot();
      await workspace.getByRole("alert").filter({ hasText: apiMessage }).waitFor();
      const concurrentAlerts = await alerts();
      check("API and output failures remain independently visible", concurrentAlerts.includes(apiMessage) && concurrentAlerts.includes(popupMessage), { alerts: concurrentAlerts });
      await successfulPrint();
      const printRetryAlerts = await alerts();
      check("Printing success retains the independent API error", printRetryAlerts.includes(apiMessage) && !printRetryAlerts.includes(popupMessage), { alerts: printRetryAlerts });
      const secondDownload = await successfulDownload("cash-with-independent-api-error.csv");
      check("CSV success also retains the independent API error", (await alerts()).includes(apiMessage));
      await pause();
      await workspace.getByRole("navigation", { name: "Secciones de Envíos" }).getByRole("button", { name: "Caja", exact: true }).click();
      check("Navigation preserves the existing error-reset behavior", (await alerts()).length === 0);
      const printed = await page.evaluate(() => window.__qa041.printed);
      check("Printing uses text-safe output and never a physical printer", printed.length === 2 && printed.every((item) => item.boldDataNodes === 0));
      check("No unhandled JavaScript errors", pageErrors.length === 0, { pageErrors });
      check("Only read API requests were issued", apiMutationMethods.length === 0, { apiMutationMethods });
      const result = { id: "CYP-QA-041", checkedAt: new Date().toISOString(), criteria, firstDownload, secondDownload, printed, physicalPrint: false, origin: address.origin, apiMutationMethods };
      await fs.writeFile(path.join(outputDir, "receipt-041.json"), JSON.stringify(result, null, 2), "utf8");
      return result;
    } finally {
      releaseSnapshot();
      await page.unroute(snapshotPattern, snapshotRoute);
    }
  } catch (failure) {
    await fs.writeFile(path.join(outputDir, "receipt-041-failed.json"), JSON.stringify({ id: "CYP-QA-041", checkedAt: new Date().toISOString(), criteria, failure: failure.message, pageErrors }, null, 2), "utf8");
    throw failure;
  } finally {
    page.off("pageerror", onError);
    page.off("request", onRequest);
    await page.evaluate(() => {
      if (window.__qa041) {
        window.open = window.__qa041.nativeOpen;
        URL.createObjectURL = window.__qa041.nativeObjectUrl;
      }
    });
  }
}
