import { ungroupDecimal } from "./decimalText";

export const MONEY_ENTRY_HELP =
  "Escribe desde los centavos: 1 = 0.01; 100000 = 1,000.00. Las comas y los dos decimales se colocan automáticamente.";
export const MONEY_ENTRY_ERROR = "Escribe un importe válido.";
const maximum = BigInt(Number.MAX_SAFE_INTEGER);

/** Decimal values in application state remain units, never reinterpreted as keystrokes. */
export function moneyEntryCents(value: string): bigint | undefined {
  if (!value || value.length > 24) return undefined;
  const clean = ungroupDecimal(value);
  if (clean === undefined) return undefined;
  const [whole, fraction = ""] = clean.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= maximum ? cents : undefined;
}

export function moneyEntryValue(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function moneyEntryDisplay(value: string): string {
  if (value === "") return "";
  const cents = moneyEntryCents(value);
  if (cents === undefined) return value;
  const [whole, fraction] = moneyEntryValue(cents).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

/** Bare pasted digits follow the keypad; an explicit decimal/grouping is already an amount. */
export function moneyEntryPaste(text: string): string | undefined {
  if (!text || text.length > 24 || text !== text.trim()) return undefined;
  if (/^[0-9]+$/.test(text)) {
    if (text.length > 16) return undefined;
    const cents = BigInt(text);
    return cents <= maximum ? moneyEntryValue(cents) : undefined;
  }
  const cents = moneyEntryCents(text);
  return cents === undefined ? undefined : moneyEntryValue(cents);
}

export type MoneyEntryEdit = { value: string; caret: number };

/** Edit the digit stream, then restore the caret by counting digits from the right. */
export function editMoneyEntry(
  display: string,
  start: number,
  end: number,
  text: string,
  deletion?: "backward" | "forward",
): MoneyEntryEdit | undefined {
  if (
    (display && moneyEntryCents(display) === undefined) ||
    !/^[0-9]*$/.test(text)
  )
    return undefined;
  if (deletion && moneyEntryCents(display) === 0n && !text)
    return { value: "", caret: 0 };
  const digits = display.replace(/[.,]/g, "");
  const count = (position: number) =>
    display.slice(0, position).replace(/[.,]/g, "").length;
  let from = count(start),
    to = count(end);
  if (from === to && deletion === "backward") from = Math.max(0, from - 1);
  if (from === to && deletion === "forward")
    to = Math.min(digits.length, to + 1);
  const raw = digits.slice(0, from) + text + digits.slice(to);
  if (raw.length > 40) return undefined;
  if (!raw) return { value: "", caret: 0 };
  const cents = BigInt(raw);
  if (cents > maximum) return undefined;
  const value = moneyEntryValue(cents),
    formatted = moneyEntryDisplay(value);
  let remaining = digits.length - to,
    caret = formatted.length;
  while (caret > 0 && remaining > 0) {
    caret -= 1;
    if (/[0-9]/.test(formatted[caret])) remaining -= 1;
  }
  return { value, caret };
}
