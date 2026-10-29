import { ungroupDecimal } from "./decimalText";

// Amounts are typed as written, from left to right (Rardiel, 29-10-2026: «a la hora de ingresar números en
// cualquier pestaña de la aplicación debería poder ser de izquierda a derecha y no de derecha a izquierda»).
// Before, digits came in from the cents (1 = 0.01, docs/IMPORTES-DESDE-CENTAVOS.md).
export const MONEY_ENTRY_HELP =
  "Escribe el importe de izquierda a derecha: 1500 = 1,500.00. El punto separa los centavos (1500.5 = 1,500.50). Las comas se colocan solas.";
export const MONEY_ENTRY_ERROR = "Escribe un importe válido.";
const maximum = BigInt(Number.MAX_SAFE_INTEGER);
// What may be typed, without commas: whole units, then at most one point with up to two decimals.
const TYPED = /^([0-9]*)(?:\.([0-9]{0,2}))?$/;
const MAX_WHOLE_DIGITS = 14;

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

const group = (whole: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function moneyEntryDisplay(value: string): string {
  if (value === "") return "";
  const cents = moneyEntryCents(value);
  if (cents === undefined) return value;
  const [whole, fraction] = moneyEntryValue(cents).split(".");
  return `${group(whole)}.${fraction}`;
}

/** The cents of what is being typed (digits, a point, up to two decimals; commas allowed), or undefined. */
export function moneyTypedCents(typed: string): bigint | undefined {
  if (typed.length > 24) return undefined;
  const parts = TYPED.exec(typed.replace(/,/g, ""));
  if (!parts || parts[1].length > MAX_WHOLE_DIGITS || (!parts[1] && parts[2] === undefined)) return undefined;
  const cents = BigInt(parts[1] || "0") * 100n + BigInt((parts[2] ?? "").padEnd(2, "0"));
  return cents <= maximum ? cents : undefined;
}

/** What is being typed, as typed, with the commas of the thousands: 1500.5 → 1,500.5; 12. → 12. */
export function moneyTypedDisplay(typed: string): string {
  const parts = TYPED.exec(typed.replace(/,/g, ""));
  if (!parts) return typed;
  return group(parts[1]) + (parts[2] === undefined ? "" : `.${parts[2]}`);
}

/** Pasted text is an amount as written: 1500 → 1,500.00; 1000.5 or 1,000.50 → 1,000.50. Anything else is refused whole. */
export function moneyEntryPaste(text: string): string | undefined {
  if (!text || text.length > 24 || text !== text.trim()) return undefined;
  if (/^[0-9]+$/.test(text)) {
    if (text.length > MAX_WHOLE_DIGITS) return undefined;
    const cents = BigInt(text) * 100n;
    return cents <= maximum ? moneyEntryValue(cents) : undefined;
  }
  const cents = moneyEntryCents(text);
  return cents === undefined ? undefined : moneyEntryValue(cents);
}

/** typed: what the field shows while it is written (without commas); value: the exact amount, two decimals. */
export type MoneyEntryEdit = { typed: string; value: string; caret: number };

// Position in the shown text after `count` characters that are not commas.
function shownPosition(shown: string, count: number) {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < shown.length; index += 1) {
    if (shown[index] !== ",") seen += 1;
    if (seen === count) return index + 1;
  }
  return shown.length;
}

/**
 * Types `text` (digits or a point) over the selection [start, end) of what the field shows, from left to right, as in
 * any text field. A deletion removes the character before (backward) or after (forward) the caret. Returns undefined
 * when the result would not be an amount: a letter, a second point, three decimals or more than the largest amount.
 */
export function editMoneyEntry(
  display: string,
  start: number,
  end: number,
  text: string,
  deletion?: "backward" | "forward",
): MoneyEntryEdit | undefined {
  const raw = display.replace(/,/g, "");
  if (!/^[0-9.]*$/.test(text) || !/^[0-9.]*$/.test(raw) || raw.split(".").length > 2) return undefined;
  const count = (position: number) => display.slice(0, position).replace(/,/g, "").length;
  let from = count(Math.min(start, end)),
    to = count(Math.max(start, end));
  if (from === to && deletion === "backward") from = Math.max(0, from - 1);
  if (from === to && deletion === "forward") to = Math.min(raw.length, to + 1);
  const kept = raw.slice(0, from) + raw.slice(to);
  // A point where there already is one takes the caret to the cents instead of adding another point.
  if (text === "." && kept.includes(".")) {
    const cents = moneyTypedCents(raw);
    return cents === undefined ? undefined : { typed: raw, value: moneyEntryValue(cents), caret: shownPosition(moneyTypedDisplay(raw), raw.indexOf(".") + 1) };
  }
  let next = raw.slice(0, from) + text + raw.slice(to),
    caret = from + text.length;
  if (next.startsWith(".")) { next = `0${next}`; caret += 1; }
  const zeros = /^0+(?=[0-9])/.exec(next);
  if (zeros) { next = next.slice(zeros[0].length); caret = Math.max(0, caret - zeros[0].length); }
  if (!next) return { typed: "", value: "", caret: 0 };
  const cents = moneyTypedCents(next);
  if (cents === undefined) return undefined;
  return { typed: next, value: moneyEntryValue(cents), caret: shownPosition(moneyTypedDisplay(next), caret) };
}
