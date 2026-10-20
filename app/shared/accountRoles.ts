import labels from "./account-roles.json";
// Persisted account values: keep historical admin/collector codes unchanged.
export type AccountRole = keyof typeof labels;
export const ACCOUNT_ROLES = Object.keys(labels) as AccountRole[];
export const ACCOUNT_ROLE_OPTIONS = ACCOUNT_ROLES.map((value) => ({ value, label: labels[value] }));
export function accountRoleLabel(role: string) {
  return Object.hasOwn(labels, role) ? labels[role as AccountRole] : role;
}
export function isCollectorAccountRole(role: unknown) {
  return typeof role === "string" && role !== "admin" && role !== "cashier" && Object.hasOwn(labels, role);
}
/** What each role can actually do today; shown wherever a role is chosen. */
const access: Record<string, string> = {
  admin: "Perfil administrativo. Sus permisos pueden limitarse por usuario.",
  supervisor: "Solo consulta en Administración; no puede registrar ni modificar.",
  collector: "Trabaja únicamente en la terminal del cobrador, con su ruta.",
  user: "Puede trabajar en Envíos de Dinero cuando Administración le asigne sus permisos. No administra catálogos.",
  cashier: "Atiende Envíos de Dinero para cualquier cliente: envía, paga recibos, cancela sus envíos, da de alta clientes durante un envío y abre y cierra su propia caja. No administra catálogos, tasas ni comisiones.",
  undefined: "Todavía no tiene acceso a ningún módulo. Elige un rol para que la cuenta pueda trabajar.",
};
export function accountRoleAccess(role: string) {
  return access[role] ?? "";
}
export const ACCOUNT_ROLE_SUMMARY = "El rol define el perfil inicial y los permisos personalizados limitan sus acciones. Supervisor conserva solo consulta; Cobrador trabaja con su ruta; Cajero atiende Envíos de Dinero y su propia caja. Usuario puede habilitarse como operador de envíos, sin administración general.";
export function isOperationalRole(role: string) {
  return role === "admin" || role === "collector";
}
