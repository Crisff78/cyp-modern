import labels from "./account-roles.json";
// Persisted account values: keep historical admin/collector codes unchanged.
export type AccountRole = keyof typeof labels;
export const ACCOUNT_ROLES = Object.keys(labels) as AccountRole[];
export const ACCOUNT_ROLE_OPTIONS = ACCOUNT_ROLES.map((value) => ({ value, label: labels[value] }));
export function accountRoleLabel(role: string) {
  return Object.hasOwn(labels, role) ? labels[role as AccountRole] : role;
}
export function isCollectorAccountRole(role: unknown) {
  return typeof role === "string" && role !== "admin" && role !== "cashier" && role !== "client" && Object.hasOwn(labels, role);
}
/** What each role can actually do today; shown wherever a role is chosen. */
const access: Record<string, string> = {
  admin: "Puede usar todo el sistema. Se le pueden quitar permisos uno por uno.",
  supervisor: "Solo mira: ve la información, pero no puede registrar ni cambiar nada.",
  collector: "Trabaja solo en la app del cobrador, con su ruta.",
  client: "Cliente del negocio. Por ahora no puede entrar a la oficina ni a la app del cobrador.",
  cashier: "Atiende remesas de cualquier cliente: envía y entrega dinero, cancela sus envíos, registra clientes nuevos y abre y cierra su propia caja. No cambia tasas ni comisiones.",
  undefined: "Todavía no puede entrar a nada. Elige un rol para que la cuenta pueda trabajar.",
};
export function accountRoleAccess(role: string) {
  return access[role] ?? "";
}
export const ACCOUNT_ROLE_SUMMARY = "El rol dice qué puede hacer cada cuenta. Los permisos personalizados quitan o añaden acciones dentro de lo que el rol permite. Supervisor solo mira; Cobrador trabaja su ruta; Cajero atiende remesas y su propia caja; Cliente todavía no puede entrar.";
export function isOperationalRole(role: string) {
  return role === "admin" || role === "collector";
}
