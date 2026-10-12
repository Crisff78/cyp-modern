import labels from "./account-roles.json";
// Persisted account values: keep historical admin/collector codes unchanged.
export type AccountRole = keyof typeof labels;
export const ACCOUNT_ROLES = Object.keys(labels) as AccountRole[];
export const ACCOUNT_ROLE_OPTIONS = ACCOUNT_ROLES.map((value) => ({ value, label: labels[value] }));
export function accountRoleLabel(role: string) {
  return Object.hasOwn(labels, role) ? labels[role as AccountRole] : role;
}
export function isCollectorAccountRole(role: unknown) {
  return typeof role === "string" && role !== "admin" && Object.hasOwn(labels, role);
}
/** What each role can actually do today; shown wherever a role is chosen. */
const access: Record<string, string> = {
  admin: "Puede hacer todo: registrar, modificar, cerrar cuadres y configurar.",
  supervisor: "Solo consulta en Administración; no puede registrar ni modificar.",
  collector: "Trabaja únicamente en la terminal del cobrador, con su ruta.",
  user: "Todavía no tiene acceso a ningún módulo.",
  undefined: "Todavía no tiene acceso a ningún módulo. Elige un rol para que la cuenta pueda trabajar.",
};
export function accountRoleAccess(role: string) {
  return access[role] ?? "";
}
export const ACCOUNT_ROLE_SUMMARY = "Lo que una cuenta puede hacer lo define su rol. Admin: todo. Supervisor: solo consulta. Cobrador: solo la terminal del cobrador. Usuario y No definido: sin acceso todavía.";
export function isOperationalRole(role: string) {
  return role === "admin" || role === "collector";
}
