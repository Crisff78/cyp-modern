import type { KeyboardEvent } from "react";

/** Enter moves through capture fields; financial confirmation remains an explicit action. */
export function advanceCaptureField(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type === "checkbox" || target.type === "radio") return;
  event.preventDefault();
  // Field by field; the current field keeps its place even when it is readonly, so Enter goes on from there.
  const fields = [...event.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")]
    .filter((field) => field === target || (!field.disabled && !(field instanceof HTMLInputElement && (field.readOnly || field.type === "hidden")) && field.getClientRects().length > 0 && field.getAttribute("role") !== "option"));
  const index = fields.indexOf(target);
  const next = fields[index + (event.shiftKey ? -1 : 1)];
  if (next) { next.focus(); return; }
  // After the last field Enter never stays still (Rardiel, 28-10-2026): it goes to the button of the form without
  // pressing it («Calcular cotización», «Usar estos datos»); the next Enter presses it. Money keeps its confirmation.
  if (!event.shiftKey) event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled),button:not([type]):not(:disabled)')?.focus();
}
