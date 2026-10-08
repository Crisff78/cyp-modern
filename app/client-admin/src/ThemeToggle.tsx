import { useEffect, useLayoutEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyColorTheme, parseColorTheme, savedColorTheme, saveColorTheme, THEME_STORAGE_KEY } from "./theme";
import "./theme.css";

export function ThemeToggle() {
  const [theme, setTheme] = useState(savedColorTheme);
  useLayoutEffect(() => applyColorTheme(theme), [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null)
        setTheme(parseColorTheme(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const dark = theme === "dark";
  const label = dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  return <button type="button" className="icon-button theme-toggle" aria-label={label} title={label} aria-pressed={dark}
    onClick={() => {
      const next = dark ? "light" : "dark";
      saveColorTheme(next);
      setTheme(next);
    }}>
    {dark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
  </button>;
}
