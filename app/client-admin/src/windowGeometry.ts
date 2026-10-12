// Geometry of the desktop windows: resizing from any border, and the sizes the user chose,
// remembered per screen in this browser. Pure functions, so they can be tested without a DOM.

export type WindowRect = { x: number; y: number; width: number; height: number };
export type WindowSize = { width: number; height: number };
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_EDGES: readonly ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
// Same limits as the style sheet: .mdi-window min-width / min-height, and the 8 px a window keeps
// from each side of the desktop (.desktop-canvas .mdi-window caps it at 100% - 16px).
export const MIN_WINDOW_SIZE: WindowSize = { width: 520, height: 300 };
export const DESKTOP_MARGIN = 8;

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

// New rectangle after dragging one border or corner by (dx, dy). The opposite border stays where
// it was. The window never gets smaller than `min` nor leaves the desktop (`desktop` is the size of
// the area where windows live; without it only the minimum applies).
export function resizeWindowRect(start: WindowRect, edge: ResizeEdge, dx: number, dy: number, desktop?: WindowSize, min: WindowSize = MIN_WINDOW_SIZE): WindowRect {
  const moveX = finite(dx, 0), moveY = finite(dy, 0);
  let { x, y, width, height } = start;
  const right = start.x + start.width, bottom = start.y + start.height;
  if (edge.includes("e")) {
    const limit = desktop ? desktop.width - DESKTOP_MARGIN - start.x : Number.POSITIVE_INFINITY;
    width = clamp(start.width + moveX, min.width, limit);
  }
  if (edge.includes("w")) {
    x = clamp(start.x + moveX, DESKTOP_MARGIN, right - min.width);
    width = right - x;
  }
  if (edge.includes("s")) {
    const limit = desktop ? desktop.height - DESKTOP_MARGIN - start.y : Number.POSITIVE_INFINITY;
    height = clamp(start.height + moveY, min.height, limit);
  }
  if (edge.includes("n")) {
    y = clamp(start.y + moveY, DESKTOP_MARGIN, bottom - min.height);
    height = bottom - y;
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

// Size to open a window with: the one the user left it at, never smaller than the minimum nor
// bigger than what fits on the desktop today (the screen may be smaller than last time).
export function fitWindowSize(wanted: WindowSize, desktop?: WindowSize, min: WindowSize = MIN_WINDOW_SIZE): WindowSize {
  const maxWidth = desktop ? desktop.width - 2 * DESKTOP_MARGIN : Number.POSITIVE_INFINITY;
  const maxHeight = desktop ? desktop.height - 2 * DESKTOP_MARGIN : Number.POSITIVE_INFINITY;
  return { width: Math.round(clamp(finite(wanted.width, min.width), min.width, maxWidth)), height: Math.round(clamp(finite(wanted.height, min.height), min.height, maxHeight)) };
}

// ---------------------------------------------------------------------------------------------
// Remembered sizes. Only numbers are stored, under one key; anything unreadable is ignored.
// ---------------------------------------------------------------------------------------------
export const WINDOW_SIZES_KEY = "cyp-admin-window-sizes-v1";
const MAX_REMEMBERED = 5000;
type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | undefined => {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
};

export function readWindowSizes(store: Store | undefined = browserStore()): Record<string, WindowSize> {
  if (!store) return {};
  try {
    const parsed: unknown = JSON.parse(store.getItem(WINDOW_SIZES_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const sizes: Record<string, WindowSize> = {};
    for (const [page, value] of Object.entries(parsed as Record<string, unknown>)) {
      const size = value as Partial<WindowSize> | null;
      if (size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width! > 0 && size.height! > 0 && size.width! <= MAX_REMEMBERED && size.height! <= MAX_REMEMBERED)
        sizes[page] = { width: Math.round(size.width!), height: Math.round(size.height!) };
    }
    return sizes;
  } catch { return {}; }
}

export function rememberWindowSize(page: string, size: WindowSize, store: Store | undefined = browserStore()): void {
  if (!store || !page) return;
  try {
    const sizes = readWindowSizes(store);
    sizes[page] = { width: Math.round(size.width), height: Math.round(size.height) };
    store.setItem(WINDOW_SIZES_KEY, JSON.stringify(sizes));
  } catch { /* Private mode or full storage: the size simply is not remembered. */ }
}
