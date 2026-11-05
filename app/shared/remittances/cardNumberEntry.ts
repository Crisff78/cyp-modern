export const CARD_NUMBER_MESSAGE = "Escribe los 16 dígitos de la tarjeta.";

/** Entry-only helpers. Full numbers must never be added to a payment, pending intent or API body. */
export function cardNumberDigits(value: string): string | undefined {
  if (!/^[0-9 ]{0,19}$/.test(value)) return undefined;
  const digits = value.replace(/ /g, "");
  return digits.length <= 16 ? digits : undefined;
}
export const formatCardNumber = (digits: string) => digits.match(/.{1,4}/g)?.join(" ") ?? "";
export const maskedCardNumber = (last4: string) => /^[0-9]{4}$/.test(last4) ? `•••• •••• •••• ${last4}` : "";
export const isMaskedCardNumber = (value: string) => /^•••• •••• •••• [0-9]{4}$/.test(value);

export function cardNumberCaret(formatted: string, digitCount: number): number {
  let offset = 0, seen = 0;
  while (offset < formatted.length && seen < digitCount) {
    if (formatted[offset] !== " ") seen++;
    offset++;
  }
  return offset;
}
