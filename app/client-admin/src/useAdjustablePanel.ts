// A part of a window whose size the user can adjust by dragging a bar (or with the arrow keys on
// it) and that can be folded away. The choice is remembered per panel in this browser.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

export const PANEL_PREFS_KEY = "cyp-admin-panel-prefs-v1";
const KEY_STEP = 16;
type Store = Pick<Storage, "getItem" | "setItem">;
type PanelPrefs = { size?: number; collapsed?: boolean };
const browserStore = (): Store | undefined => {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
};

export function readPanelPrefs(key: string, store: Store | undefined = browserStore()): PanelPrefs {
  if (!store) return {};
  try {
    const all: unknown = JSON.parse(store.getItem(PANEL_PREFS_KEY) ?? "{}");
    const saved = all && typeof all === "object" && !Array.isArray(all) ? (all as Record<string, unknown>)[key] : undefined;
    if (!saved || typeof saved !== "object") return {};
    const { size, collapsed } = saved as PanelPrefs;
    return { ...(Number.isFinite(size) && size! > 0 && size! < 5000 ? { size: Math.round(size!) } : {}), ...(typeof collapsed === "boolean" ? { collapsed } : {}) };
  } catch { return {}; }
}

export function writePanelPrefs(key: string, prefs: PanelPrefs, store: Store | undefined = browserStore()): void {
  if (!store) return;
  try {
    const parsed: unknown = JSON.parse(store.getItem(PANEL_PREFS_KEY) ?? "{}");
    const all = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, PanelPrefs> : {};
    all[key] = { ...(prefs.size === undefined ? {} : { size: Math.round(prefs.size) }), ...(prefs.collapsed === undefined ? {} : { collapsed: prefs.collapsed }) };
    store.setItem(PANEL_PREFS_KEY, JSON.stringify(all));
  } catch { /* Private mode or full storage: the choice simply is not remembered. */ }
}

// Size after moving the bar by `delta` pixels. `grow` is +1 when moving towards the end of the
// axis makes the panel bigger and -1 when the panel sits after the bar (it grows as the bar moves back).
export function nextPanelSize(start: number, delta: number, grow: 1 | -1, min: number, max: number): number {
  const wanted = start + grow * (Number.isFinite(delta) ? delta : 0);
  return Math.round(Math.min(Math.max(wanted, min), Math.max(min, max)));
}

export type AdjustablePanelOptions = {
  storageKey: string;
  // "y": the bar is horizontal and the panel changes height; "x": vertical bar, the panel changes width.
  axis: "x" | "y";
  grow: 1 | -1;
  panel: RefObject<HTMLElement | null>;
  min: number;
  // Largest size that still leaves room for what is next to the panel, measured when needed.
  max: () => number;
  label: string;
};

export function useAdjustablePanel({ storageKey, axis, grow, panel, min, max, label }: AdjustablePanelOptions) {
  const [prefs, setPrefs] = useState<PanelPrefs>(() => readPanelPrefs(storageKey));
  const drag = useRef<{ pointer: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [limits, setLimits] = useState<{ now: number; max: number }>({ now: prefs.size ?? min, max: Math.max(min, prefs.size ?? min) });
  // The caller may pass a new function on every render; the callbacks below must not change with it.
  const maxRef = useRef(max);
  maxRef.current = max;
  const measure = useCallback(() => {
    const rect = panel.current?.getBoundingClientRect();
    return rect ? (axis === "y" ? rect.height : rect.width) : min;
  }, [axis, min, panel]);
  const refreshLimits = useCallback(() => {
    const next = { now: Math.round(measure()), max: Math.round(Math.max(min, maxRef.current())) };
    setLimits((current) => current.now === next.now && current.max === next.max ? current : next);
  }, [measure, min]);
  useEffect(() => { refreshLimits(); }, [refreshLimits, prefs.size, prefs.collapsed]);
  // What the bar announces follows the panel when its content or the window changes its size.
  useEffect(() => {
    const node = panel.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => refreshLimits());
    observer.observe(node);
    return () => observer.disconnect();
  }, [panel, refreshLimits]);
  const update = useCallback((next: PanelPrefs, persist: boolean) => {
    setPrefs((current) => {
      const merged = { ...current, ...next };
      if (next.size === undefined && Object.hasOwn(next, "size")) delete merged.size;
      if (persist) writePanelPrefs(storageKey, merged);
      return merged;
    });
  }, [storageKey]);
  const setCollapsed = useCallback((collapsed: boolean) => update({ collapsed }, true), [update]);
  const reset = useCallback(() => update({ size: undefined }, true), [update]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || prefs.collapsed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointer: axis === "y" ? event.clientY : event.clientX, size: measure() };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const delta = (axis === "y" ? event.clientY : event.clientX) - drag.current.pointer;
    update({ size: nextPanelSize(drag.current.size, delta, grow, min, maxRef.current()) }, false);
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null; setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setPrefs((current) => { writePanelPrefs(storageKey, current); return current; });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (prefs.collapsed) return;
    const forward = axis === "y" ? "ArrowDown" : "ArrowRight", back = axis === "y" ? "ArrowUp" : "ArrowLeft";
    const limit = Math.max(min, maxRef.current());
    let size: number | undefined;
    if (event.key === forward) size = nextPanelSize(measure(), KEY_STEP, grow, min, limit);
    else if (event.key === back) size = nextPanelSize(measure(), -KEY_STEP, grow, min, limit);
    else if (event.key === "Home") size = min;
    else if (event.key === "End") size = limit;
    if (size === undefined) return;
    event.preventDefault();
    update({ size }, true);
  };

  return {
    size: prefs.collapsed ? null : prefs.size ?? null,
    collapsed: prefs.collapsed === true,
    dragging,
    setCollapsed,
    reset,
    separatorProps: {
      role: "separator" as const,
      tabIndex: prefs.collapsed ? -1 : 0,
      "aria-orientation": axis === "y" ? "horizontal" as const : "vertical" as const,
      "aria-label": label,
      "aria-valuemin": min,
      "aria-valuemax": limits.max,
      "aria-valuenow": Math.min(Math.max(limits.now, min), limits.max),
      "aria-disabled": prefs.collapsed === true || undefined,
      title: "Arrastra para ajustar el tamaño. Doble clic: tamaño inicial.",
      onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish,
      onKeyDown,
      onDoubleClick: reset,
      onFocus: refreshLimits,
    },
  };
}
