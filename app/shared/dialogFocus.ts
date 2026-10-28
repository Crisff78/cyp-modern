import { useRef } from "react";
import { focusFirstUseful } from "./keyboard";

/**
 * For a Radix dialog (the sheets of the collector app): it opens with the keyboard on its first useful field, never on
 * the X of its title, and, closed, gives the keyboard back to what opened it (28-10-2026: the collection sheet opened on
 * its X, and what was typed was lost; closing the help left the keyboard nowhere).
 */
export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const opener = useRef<HTMLElement | null>(null);
  return {
    ref,
    onOpenAutoFocus: (event: Event) => {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      if (ref.current && focusFirstUseful(ref.current)) event.preventDefault();
    },
    onCloseAutoFocus: (event: Event) => {
      if (!opener.current?.isConnected) return;
      event.preventDefault();
      opener.current.focus({ preventScroll: true });
    },
  };
}
