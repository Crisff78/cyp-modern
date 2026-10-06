export const INPUT_LIMITS = {
  id: 80,
  name: 160,
  phone: 40,
  address: 240,
  email: 200,
  note: 2000,
  userNickname: 120,
  userNote: 1000,
  password: 200,
  rate: 19,
  quantity: 64,
  freeNote: 500,
} as const;

const singleLineControls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const multilineControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
// Match z.email() in the server's installed Zod version.
const emailPattern = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

export function validateText(value: string, label: string, maximum: number, options: { required?: boolean; multiline?: boolean } = {}) {
  if (value.trim().length > maximum) throw new Error(`${label} admite un máximo de ${maximum} caracteres.`);
  if (options.required && !value.trim()) throw new Error(`Completa ${label.toLocaleLowerCase()}.`);
  if ((options.multiline ? multilineControls : singleLineControls).test(value))
    throw new Error(`${label} contiene caracteres de control no permitidos.`);
}

export function validatePhone(value: string, label = "Teléfono", options: { required?: boolean } = {}) {
  validateText(value, label, INPUT_LIMITS.phone, options);
  const phone = value.trim();
  if (!phone && !options.required) return;
  if (!/^\+?(?=[\d ().-]*\d)[\d ().-]+(?:\s*(?:ext\.?|extension|extensión|x|#)\s*\d{1,6})?$/iu.test(phone))
    throw new Error(`${label} debe contener dígitos; admite +, espacios, paréntesis, guiones y una extensión, como +18095550123 ext2.`);
}

export function validEmail(value: string, required = false) {
  if (value.trim().length > INPUT_LIMITS.email || singleLineControls.test(value)) return false;
  const email = value.trim();
  return !email ? !required : emailPattern.test(email);
}

export function validateEmail(value: string, label = "Correo", options: { required?: boolean } = {}) {
  validateText(value, label, INPUT_LIMITS.email, options);
  if (!validEmail(value, options.required)) throw new Error(`Escribe un ${label.toLocaleLowerCase()} válido.`);
}

export function isDecimalDraft(value: string, options: { wholeDigits?: number; decimalDigits?: number } = {}) {
  const { wholeDigits = 14, decimalDigits = 2 } = options;
  return value === value.trim() && new RegExp(`^0*\\d{0,${wholeDigits}}(?:\\.\\d{0,${decimalDigits}})?$`).test(value);
}

export function isIntegerDraft(value: string, maximumDigits = 2) {
  return value === value.trim() && new RegExp(`^\\d{0,${maximumDigits}}$`).test(value);
}

export function isPositiveRate(value: string) {
  if (value !== value.trim() || !/^\d{1,12}(?:\.\d{1,6})?$/.test(value)) return false;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")) > 0n;
}

export function parseDay(value: string, label: string) {
  if (value === "") return 0;
  if (value !== value.trim() || !/^\d{1,2}$/.test(value) || Number(value) > 31)
    throw new Error(`${label} debe ser un entero entre 0 y 31.`);
  return Number(value);
}

export function assertCentsLimit(cents: number, label: string, maximum = 1_000_000_000) {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > maximum)
    throw new Error(`${label} está fuera del rango permitido de centavos.`);
  return cents;
}
