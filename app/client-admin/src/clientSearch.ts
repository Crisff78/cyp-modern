type SearchableClient = {
  id?: string; code?: string; name?: string; alias?: string; identification?: string;
  phone?: string; cellular?: string; note?: string;
};
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
export function matchesClientSearch(client: SearchableClient, query: string) {
  const search = normalized(query);
  if (!search) return true;
  const text = [client.id, client.code, client.name, client.alias, client.identification, client.phone, client.cellular, client.note]
    .filter(Boolean).map((value) => normalized(value!)).join(" ");
  if (text.includes(search)) return true;
  if (/^[+\d\s().-]+$/.test(search)) {
    const digits = search.replace(/\D/g, "");
    return Boolean(digits) && [client.phone, client.cellular].some((value) => (value ?? "").replace(/\D/g, "").includes(digits));
  }
  return false;
}
// Explicit action avoids overwriting notes or copying only the first keystroke.
export function copyPhoneIntoEmptyFields<T extends { phone: string; cellular: string; note: string }>(draft: T): T {
  if (!draft.phone.trim()) return draft;
  return { ...draft, cellular: draft.cellular.trim() ? draft.cellular : draft.phone,
    note: draft.note.trim() ? draft.note : draft.phone };
}
