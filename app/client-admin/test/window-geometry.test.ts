import test from "node:test";
import assert from "node:assert/strict";
import { DESKTOP_MARGIN, MIN_WINDOW_SIZE, WINDOW_SIZES_KEY, fitWindowSize, readWindowSizes, rememberWindowSize, resizeWindowRect } from "../src/windowGeometry.ts";
import { PANEL_PREFS_KEY, nextPanelSize, readPanelPrefs, writePanelPrefs } from "../src/useAdjustablePanel.ts";

const desktop = { width: 1129, height: 611 };
const start = { x: 144, y: 105, width: 720, height: 440 };
function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
}

test("a window grows and shrinks from each border while the opposite border stays put", () => {
  assert.deepEqual(resizeWindowRect(start, "e", 100, 0, desktop), { ...start, width: 820 });
  assert.deepEqual(resizeWindowRect(start, "s", 0, 50, desktop), { ...start, height: 490 });
  // From the left and from the top the window moves and keeps its right and bottom borders.
  assert.deepEqual(resizeWindowRect(start, "w", -44, 0, desktop), { x: 100, y: 105, width: 764, height: 440 });
  assert.deepEqual(resizeWindowRect(start, "n", 0, -55, desktop), { x: 144, y: 50, width: 720, height: 495 });
  // A corner changes both sizes at once.
  assert.deepEqual(resizeWindowRect(start, "se", 30, 40, desktop), { ...start, width: 750, height: 480 });
  assert.deepEqual(resizeWindowRect(start, "nw", 20, 10, desktop), { x: 164, y: 115, width: 700, height: 430 });
  assert.deepEqual(resizeWindowRect(start, "ne", 25, -15, desktop), { x: 144, y: 90, width: 745, height: 455 });
  assert.deepEqual(resizeWindowRect(start, "sw", -14, 21, desktop), { x: 130, y: 105, width: 734, height: 461 });
});

test("a window never gets smaller than the minimum nor leaves the desktop", () => {
  // Shrinking stops at the minimum; from the left or the top the far border does not move.
  assert.deepEqual(resizeWindowRect(start, "e", -900, 0, desktop), { ...start, width: MIN_WINDOW_SIZE.width });
  assert.deepEqual(resizeWindowRect(start, "s", 0, -900, desktop), { ...start, height: MIN_WINDOW_SIZE.height });
  assert.deepEqual(resizeWindowRect(start, "w", 900, 0, desktop), { x: 144 + 720 - MIN_WINDOW_SIZE.width, y: 105, width: MIN_WINDOW_SIZE.width, height: 440 });
  assert.deepEqual(resizeWindowRect(start, "n", 0, 900, desktop), { x: 144, y: 105 + 440 - MIN_WINDOW_SIZE.height, width: 720, height: MIN_WINDOW_SIZE.height });
  // Growing stops at the margin of the desktop on every side.
  assert.deepEqual(resizeWindowRect(start, "se", 5000, 5000, desktop), { ...start, width: desktop.width - DESKTOP_MARGIN - 144, height: desktop.height - DESKTOP_MARGIN - 105 });
  assert.deepEqual(resizeWindowRect(start, "nw", -5000, -5000, desktop), { x: DESKTOP_MARGIN, y: DESKTOP_MARGIN, width: 144 + 720 - DESKTOP_MARGIN, height: 105 + 440 - DESKTOP_MARGIN });
  // Without a known desktop only the minimum applies; a broken movement changes nothing.
  assert.deepEqual(resizeWindowRect(start, "e", 5000, 0), { ...start, width: 5720 });
  assert.deepEqual(resizeWindowRect(start, "se", Number.NaN, Number.POSITIVE_INFINITY, desktop), start);
});

test("the size to open a window with fits the desktop of today", () => {
  assert.deepEqual(fitWindowSize({ width: 900, height: 500 }, desktop), { width: 900, height: 500 });
  assert.deepEqual(fitWindowSize({ width: 3000, height: 2000 }, desktop), { width: desktop.width - 2 * DESKTOP_MARGIN, height: desktop.height - 2 * DESKTOP_MARGIN });
  assert.deepEqual(fitWindowSize({ width: 10, height: 10 }, desktop), MIN_WINDOW_SIZE);
  assert.deepEqual(fitWindowSize({ width: Number.NaN, height: 480 }, desktop), { width: MIN_WINDOW_SIZE.width, height: 480 });
  // A desktop smaller than the minimum window: the minimum wins, the style sheet clips it.
  assert.deepEqual(fitWindowSize({ width: 800, height: 600 }, { width: 400, height: 250 }), MIN_WINDOW_SIZE);
});

test("the sizes chosen by the user are remembered per screen and bad data is ignored", () => {
  const store = memoryStore();
  assert.deepEqual(readWindowSizes(store), {});
  rememberWindowSize("stations", { width: 1000.4, height: 560.6 }, store);
  rememberWindowSize("clients", { width: 900, height: 500 }, store);
  rememberWindowSize("stations", { width: 1010, height: 570 }, store);
  assert.deepEqual(readWindowSizes(store), { stations: { width: 1010, height: 570 }, clients: { width: 900, height: 500 } });
  assert.deepEqual(Object.keys(JSON.parse(store.data.get(WINDOW_SIZES_KEY)!)), ["stations", "clients"]);
  for (const broken of ["no es json", "[]", "null", "42", JSON.stringify({ stations: { width: "ancho", height: 500 }, groups: { width: -5, height: 400 }, pcps: { width: 99999, height: 400 }, traces: null, clients: { width: 800, height: 450 } })]) {
    const damaged = memoryStore({ [WINDOW_SIZES_KEY]: broken });
    assert.deepEqual(readWindowSizes(damaged), broken.startsWith("{") ? { clients: { width: 800, height: 450 } } : {});
  }
  // A browser without storage (private mode) does not break anything.
  assert.deepEqual(readWindowSizes({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} }), {});
  assert.doesNotThrow(() => rememberWindowSize("stations", { width: 900, height: 500 }, { getItem: () => null, setItem: () => { throw new Error("full"); } }));
});

test("an adjustable panel follows the bar between its limits", () => {
  // The panel is below the bar: moving the bar up (negative) makes it taller.
  assert.equal(nextPanelSize(200, -60, -1, 80, 400), 260);
  assert.equal(nextPanelSize(200, 60, -1, 80, 400), 140);
  assert.equal(nextPanelSize(200, 500, -1, 80, 400), 80);
  assert.equal(nextPanelSize(200, -500, -1, 80, 400), 400);
  // The panel is before the bar: moving the bar forward makes it wider.
  assert.equal(nextPanelSize(210, 40, 1, 160, 420), 250);
  assert.equal(nextPanelSize(210, Number.NaN, 1, 160, 420), 210);
  // No room at all: the minimum is kept.
  assert.equal(nextPanelSize(200, -50, -1, 80, 20), 80);
});

test("the size and the folded state of a panel are remembered per panel", () => {
  const store = memoryStore();
  assert.deepEqual(readPanelPrefs("stations.installation", store), {});
  writePanelPrefs("stations.installation", { size: 231.6, collapsed: false }, store);
  writePanelPrefs("other.panel", { collapsed: true }, store);
  assert.deepEqual(readPanelPrefs("stations.installation", store), { size: 232, collapsed: false });
  assert.deepEqual(readPanelPrefs("other.panel", store), { collapsed: true });
  for (const broken of ["no es json", "[]", JSON.stringify({ "stations.installation": { size: "alto", collapsed: "sí" } }), JSON.stringify({ "stations.installation": { size: -4 } })])
    assert.deepEqual(readPanelPrefs("stations.installation", memoryStore({ [PANEL_PREFS_KEY]: broken })), {});
  assert.doesNotThrow(() => writePanelPrefs("stations.installation", { size: 200 }, { getItem: () => "no es json", setItem: () => { throw new Error("full"); } }));
});
