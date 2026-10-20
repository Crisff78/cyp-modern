import type { ClipboardEvent } from "react";

/** Validate the entire paste before maxLength can silently truncate an amount or identifier. */
export function restrictPaste(
  event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  accepts: (value: string) => boolean,
  onReject: () => void,
) {
  const input = event.currentTarget;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const candidate = input.value.slice(0, start) + event.clipboardData.getData("text") + input.value.slice(end);
  if (!accepts(candidate)) { event.preventDefault(); onReject(); }
}
