import { validatePhone } from "../../shared/inputRules";

// The Clientes window and the server page share this matcher.
export { matchesClientSearch } from "../../shared/clientPage.mjs";
export function clientCodeFromPhone(phone: string) {
  validatePhone(phone, "Teléfono", { required: true });
  const value = phone.trim();
  const digits = value.replace(/\D/g, "");
  return `${value.startsWith("+") ? "+" : ""}${digits}`;
}
// Explicit action avoids overwriting notes or copying only the first keystroke.
export function copyPhoneIntoEmptyFields<T extends { phone: string; cellular: string; note: string }>(draft: T): T {
  if (!draft.phone.trim()) return draft;
  return { ...draft, cellular: draft.cellular.trim() ? draft.cellular : draft.phone,
    note: draft.note.trim() ? draft.note : draft.phone };
}
