import type { KeyboardEvent } from "react";

/** Enter moves through capture fields; financial confirmation remains an explicit action. */
export function advanceCaptureField(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type === "checkbox" || target.type === "radio") return;
  event.preventDefault();
  const fields = [...event.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>("input,select,textarea,button")]
    .filter((field) => !field.disabled && !(field instanceof HTMLInputElement && (field.readOnly || field.type === "hidden")) && field.getClientRects().length > 0 && field.getAttribute("role") !== "option");
  const index = fields.indexOf(target);
  fields[index + (event.shiftKey ? -1 : 1)]?.focus();
}
