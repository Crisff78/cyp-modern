import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import {
  editMoneyEntry,
  MONEY_ENTRY_ERROR,
  MONEY_ENTRY_HELP,
  moneyEntryCents,
  moneyEntryDisplay,
  moneyEntryPaste,
  moneyEntryValue,
} from "./moneyEntry";

type MoneyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "inputMode" | "pattern" | "step" | "maxLength"
> & {
  value: string | number;
  onValueChange?: (value: string) => void;
  onInvalidEntry?: () => void;
};

/** The display is grouped, but consumers always receive an exact ungrouped decimal amount. */
export function MoneyInput({
  value,
  onValueChange,
  onInvalidEntry,
  onKeyDown,
  onPaste,
  onFocus,
  onBlur,
  onSelect,
  min,
  max,
  title,
  ...props
}: MoneyInputProps) {
  const input = useRef<HTMLInputElement>(null),
    caret = useRef<number | null>(null);
  const previousValue = useRef(value);
  const fractionPosition = useRef<number | null>(null);
  const [error, setError] = useState("");
  const errorId = useId(),
    display = moneyEntryDisplay(String(value));
  const editable = !props.readOnly && !props.disabled;
  const reject = () => {
    setError(MONEY_ENTRY_ERROR);
    input.current?.setCustomValidity(onInvalidEntry ? "" : MONEY_ENTRY_ERROR);
    onInvalidEntry?.();
  };
  const accept = (next: string, position?: number) => {
    const cents = next === "" ? undefined : moneyEntryCents(next);
    const ceiling =
      max === undefined ? undefined : moneyEntryCents(String(max));
    if (
      next !== "" &&
      (cents === undefined || (ceiling !== undefined && cents > ceiling))
    ) {
      reject();
      return;
    }
    setError("");
    input.current?.setCustomValidity("");
    caret.current = position ?? moneyEntryDisplay(next).length;
    onValueChange?.(next);
    // A zero or a rejected update may keep the same React value.
    if (input.current) {
      input.current.value = moneyEntryDisplay(next);
      input.current.setSelectionRange(caret.current, caret.current);
    }
  };
  const edit = (text: string, deletion?: "backward" | "forward") => {
    const element = input.current;
    if (!element) return;
    const next = editMoneyEntry(
      display,
      element.selectionStart ?? display.length,
      element.selectionEnd ?? display.length,
      text,
      deletion,
    );
    if (!next) {
      reject();
      return;
    }
    if (deletion && moneyEntryDisplay(next.value) === display) return;
    accept(next.value, next.caret);
  };
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const externallyCorrected =
      previousValue.current !== value &&
      (value === "" || moneyEntryCents(String(value)) !== undefined);
    previousValue.current = value;
    if (externallyCorrected && error) setError("");
    // Error text belongs to the description, never to the field's accessible name.
    if (
      !props["aria-label"] &&
      !props["aria-labelledby"] &&
      element.labels?.[0]
    ) {
      const label = element.labels[0].cloneNode(true) as HTMLLabelElement;
      label
        .querySelectorAll("input, select, textarea, [data-money-entry-error]")
        .forEach((child) => child.remove());
      element.setAttribute(
        "aria-label",
        label.textContent?.trim() ?? "Importe",
      );
    }
    const amount = moneyEntryCents(String(value)),
      floor = min === undefined ? undefined : moneyEntryCents(String(min));
    const ceiling =
      max === undefined ? undefined : moneyEntryCents(String(max));
    element.setCustomValidity(
      (onInvalidEntry || externallyCorrected ? "" : error) ||
        (editable && value !== "" && amount === undefined
          ? MONEY_ENTRY_ERROR
          : editable &&
              amount !== undefined &&
              floor !== undefined &&
              amount < floor
            ? `El importe mínimo es ${moneyEntryDisplay(String(min))}.`
            : editable &&
                amount !== undefined &&
                ceiling !== undefined &&
                amount > ceiling
              ? `El importe máximo es ${moneyEntryDisplay(String(max))}.`
              : ""),
    );
    if (caret.current !== null && element === document.activeElement)
      element.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  return (
    <>
      <input
        {...props}
        ref={input}
        type="text"
        inputMode="numeric"
        autoComplete={props.autoComplete ?? "off"}
        spellCheck={false}
        data-money-input="cents"
        value={display}
        placeholder={props.placeholder ?? "0.00"}
        title={title ? `${title} ${MONEY_ENTRY_HELP}` : MONEY_ENTRY_HELP}
        aria-invalid={Boolean(error) || props["aria-invalid"] || undefined}
        aria-describedby={
          [props["aria-describedby"], error ? errorId : ""]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onFocus={(event) => {
          fractionPosition.current = null;
          onFocus?.(event);
        }}
        onBlur={(event) => {
          fractionPosition.current = null;
          onBlur?.(event);
        }}
        onSelect={(event) => {
          onSelect?.(event);
        }}
        onPointerDown={() => {
          fractionPosition.current = null;
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (
            event.defaultPrevented ||
            !editable ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.nativeEvent.isComposing
          )
            return;
          if (/^[0-9]$/.test(event.key)) {
            event.preventDefault();
            if (
              fractionPosition.current !== null &&
              moneyEntryCents(String(value)) !== undefined
            ) {
              if (fractionPosition.current >= 2) {
                reject();
                return;
              }
              const [whole, fraction] = moneyEntryValue(
                moneyEntryCents(String(value))!,
              ).split(".");
              const position = fractionPosition.current;
              const next = `${whole}.${fraction.slice(0, position)}${event.key}${fraction.slice(position + 1)}`;
              fractionPosition.current = position + 1;
              accept(next, moneyEntryDisplay(next).indexOf(".") + position + 2);
            } else edit(event.key);
          } else if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            fractionPosition.current = null;
            edit("", event.key === "Backspace" ? "backward" : "forward");
          } else if (event.key === ".") {
            event.preventDefault();
            fractionPosition.current = 0;
            if (value === "") accept("0.00");
            const element = event.currentTarget,
              position = element.value.indexOf(".") + 1;
            element.setSelectionRange(position, position + 1);
          } else if (event.key.length === 1) {
            event.preventDefault();
            reject();
          } else fractionPosition.current = null;
        }}
        onPaste={(event) => {
          if (!editable) return;
          // Validate the entire clipboard before the browser can truncate it.
          event.preventDefault();
          fractionPosition.current = null;
          const next = moneyEntryPaste(event.clipboardData.getData("text"));
          if (next === undefined) {
            reject();
            return;
          }
          onPaste?.(event);
          accept(next);
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (editable) reject();
        }}
        onChange={(event) => {
          if (!editable) return;
          // Mobile keyboards, autofill and speech need the same rules without keydown.
          const nextText = event.target.value,
            native = event.nativeEvent as InputEvent;
          fractionPosition.current = null;
          if (nextText === "") {
            accept("");
            return;
          }
          if (
            native.inputType === "insertFromPaste" ||
            native.inputType === "insertReplacementText" ||
            (native.data && native.data.length > 1)
          ) {
            const next = moneyEntryPaste(nextText);
            if (next === undefined) {
              event.target.value = display;
              reject();
            } else accept(next);
            return;
          }
          let start = 0,
            oldEnd = display.length,
            newEnd = nextText.length;
          while (
            start < oldEnd &&
            start < newEnd &&
            display[start] === nextText[start]
          )
            start += 1;
          while (
            oldEnd > start &&
            newEnd > start &&
            display[oldEnd - 1] === nextText[newEnd - 1]
          ) {
            oldEnd -= 1;
            newEnd -= 1;
          }
          const inserted = nextText.slice(start, newEnd);
          if (inserted.length > 1 && start === 0 && oldEnd === display.length) {
            const next = moneyEntryPaste(nextText);
            if (next === undefined) {
              event.target.value = display;
              reject();
            } else accept(next);
            return;
          }
          const next = editMoneyEntry(display, start, oldEnd, inserted);
          if (!next) {
            event.target.value = display;
            reject();
          } else accept(next.value, next.caret);
        }}
      />
      {error && (
        <small
          id={errorId}
          data-money-entry-error
          role="alert"
          style={{
            display: "block",
            color: "var(--danger, #b42318)",
            fontSize: "0.75rem",
          }}
        >
          {error}
        </small>
      )}
    </>
  );
}
