import type { KeyboardEvent } from "react";

/** Enter moves through capture fields; financial confirmation remains an explicit action. */
export function advanceCaptureField(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type === "checkbox" || target.type === "radio") return;
  event.preventDefault();
  // Only capture fields: Enter never leaves the focus on a button, where the next Enter would press it.
  // The current field keeps its place even when it is readonly, so Enter goes on from there.
  const fields = [...event.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")]
    .filter((field) => field === target || (!field.disabled && !(field instanceof HTMLInputElement && (field.readOnly || field.type === "hidden")) && field.getClientRects().length > 0 && field.getAttribute("role") !== "option"));
  const index = fields.indexOf(target);
  fields[index + (event.shiftKey ? -1 : 1)]?.focus();
}
