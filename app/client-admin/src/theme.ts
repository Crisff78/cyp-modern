export type ColorTheme = "light" | "dark";
export const THEME_STORAGE_KEY = "cyp-admin-color-theme";

export function parseColorTheme(value: unknown): ColorTheme {
  return value === "dark" ? "dark" : "light";
}

export function savedColorTheme(): ColorTheme {
  try { return parseColorTheme(window.localStorage.getItem(THEME_STORAGE_KEY)); }
  catch { return "light"; }
}

export function applyColorTheme(theme: ColorTheme) {
  document.documentElement.dataset.theme = theme;
}

export function saveColorTheme(theme: ColorTheme) {
  applyColorTheme(theme);
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); }
  catch { /* The control still works when browser storage is unavailable. */ }
}

// Apply the saved preference before React renders the login or desktop.
if (typeof window !== "undefined" && typeof document !== "undefined")
  applyColorTheme(savedColorTheme());
