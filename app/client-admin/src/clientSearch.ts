import { validatePhone } from "../../shared/inputRules";

type SearchableClient = {
  id?: string; code?: string; name?: string; alias?: string; identification?: string;
  phone?: string; cellular?: string; note?: string;
};
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
function notePhoneDigits(note: string) {
  // Words, punctuation and newlines separate numbers. Two long number blocks
  // are separate phones, even when separated only by phone formatting marks.
  return (note.match(/\+?\d[\d\t ().-]*\d|\d/g) ?? [])
    .flatMap((run) => run.split(/(?<=\d{7})[\t ().-]+(?=\d{7})/))
    .map((run) => run.replace(/\D/g, ""))
    .filter((digits) => digits.length >= 7 && digits.length <= 15);
}
export function matchesClientSearch(client: SearchableClient, query: string) {
  const search = normalized(query);
  if (!search) return true;
  const text = [client.id, client.code, client.name, client.alias, client.identification, client.phone, client.cellular, client.note]
    .filter(Boolean).map((value) => normalized(value!)).join(" ");
  if (text.includes(search)) return true;
  if (/^[+\d\s().-]+$/.test(search)) {
    const digits = search.replace(/\D/g, "");
    return Boolean(digits) && ([client.phone, client.cellular].some((value) => (value ?? "").replace(/\D/g, "").includes(digits))
      || notePhoneDigits(client.note ?? "").some((phone) => phone.includes(digits)));
  }
  return false;
}
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
