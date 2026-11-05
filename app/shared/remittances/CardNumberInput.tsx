import { useLayoutEffect, useRef } from "react";
import { CARD_NUMBER_MESSAGE, cardNumberCaret, cardNumberDigits, formatCardNumber, isMaskedCardNumber, maskedCardNumber } from "./cardNumberEntry";

/** The complete number exists only in this unnamed DOM control while editing.
 * React state, callbacks, form serialization and restored intents contain at most its last four digits. */
export function CardNumberInput({ last4, onLast4Change, onInvalid, invalid, locked = false }: {
  last4: string; onLast4Change: (last4: string, error?: string) => void;
  onInvalid: () => void; invalid?: boolean; locked?: boolean;
}) {
  const field = useRef<HTMLInputElement>(null);
  const notify = useRef(onLast4Change);
  useLayoutEffect(() => { notify.current = onLast4Change; });
  useLayoutEffect(() => {
    const input = field.current;
    if (input && (locked || isMaskedCardNumber(input.value) || (!input.value && last4))) {
      input.value = maskedCardNumber(last4); input.defaultValue = maskedCardNumber(last4);
    }
  }, [last4, locked]);
  useLayoutEffect(() => {
    const input = field.current!;
    const hide = () => {
      if (!input.value || isMaskedCardNumber(input.value)) return;
      const digits = cardNumberDigits(input.value);
      input.value = digits?.length === 16 ? maskedCardNumber(digits.slice(-4)) : "";
      if (digits?.length !== 16) notify.current("", CARD_NUMBER_MESSAGE);
    };
    const visibility = () => { if (document.visibilityState === "hidden") hide(); };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
      input.value = ""; input.defaultValue = "";
    };
  }, []);
  const edit = (input: HTMLInputElement, candidate: string, caret: number) => {
    if (locked) { input.value = maskedCardNumber(last4); return; }
    const digits = cardNumberDigits(candidate);
    if (digits === undefined) {
      input.value = ""; onLast4Change("", CARD_NUMBER_MESSAGE); return;
    }
    const digitCount = candidate.slice(0, caret).replace(/ /g, "").length;
    input.value = formatCardNumber(digits);
    const position = cardNumberCaret(input.value, digitCount);
    input.setSelectionRange(position, position);
    onLast4Change(digits.length === 16 ? digits.slice(-4) : "");
    // Autofill can dispatch a change without focusing this control.
    if (document.activeElement !== input) {
      input.value = digits.length === 16 ? maskedCardNumber(digits.slice(-4)) : "";
      if (digits.length && digits.length !== 16) onLast4Change("", CARD_NUMBER_MESSAGE);
    }
  };
  return <input ref={field} type="text" inputMode="numeric" autoComplete="off" autoCapitalize="off" spellCheck={false}
    maxLength={19} defaultValue={maskedCardNumber(last4)} disabled={locked} aria-invalid={invalid || undefined}
    placeholder="0000 0000 0000 0000" title={CARD_NUMBER_MESSAGE}
    onFocus={(event) => { if (isMaskedCardNumber(event.currentTarget.value)) event.currentTarget.select(); }}
    onKeyDown={(event) => {
      const input = event.currentTarget;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length === 1 && !/^[0-9 ]$/.test(event.key)) { event.preventDefault(); onInvalid(); return; }
      if (isMaskedCardNumber(input.value)) {
        if (event.key === "Backspace" || event.key === "Delete") { event.preventDefault(); edit(input, "", 0); }
        else if (event.key.length === 1) { input.value = ""; input.setSelectionRange(0, 0); }
        return;
      }
      const start = input.selectionStart ?? 0, end = input.selectionEnd ?? start;
      if (start !== end) return;
      if (event.key === "Backspace" && input.value[start - 1] === " ") {
        event.preventDefault(); edit(input, input.value.slice(0, start - 2) + input.value.slice(start), start - 2);
      } else if (event.key === "Delete" && input.value[start] === " ") {
        event.preventDefault(); edit(input, input.value.slice(0, start) + input.value.slice(start + 2), start);
      }
    }}
    onPaste={(event) => {
      event.preventDefault();
      const input = event.currentTarget, previous = isMaskedCardNumber(input.value) ? "" : input.value;
      const start = previous ? input.selectionStart ?? previous.length : 0;
      const end = previous ? input.selectionEnd ?? start : 0;
      const pasted = event.clipboardData.getData("text");
      const candidate = previous.slice(0, start) + pasted + previous.slice(end);
      if (cardNumberDigits(candidate) === undefined) { onInvalid(); return; }
      edit(input, candidate, start + pasted.length);
    }}
    onChange={(event) => edit(event.currentTarget, event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
    onBlur={(event) => {
      const input = event.currentTarget;
      if (!input.value || isMaskedCardNumber(input.value)) return;
      const digits = cardNumberDigits(input.value);
      if (digits?.length === 16) {
        const suffix = digits.slice(-4);
        if (suffix !== last4) onLast4Change(suffix);
      } else { input.value = ""; onLast4Change("", CARD_NUMBER_MESSAGE); }
    }} />;
}
