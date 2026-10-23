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
  supervisor: "Por defecto solo consulta. Administración puede autorizar acciones adicionales con una advertencia.",
  collector: "Por defecto trabaja en la app del cobrador con su ruta. Los permisos adicionales no cambian la asignación de sus movimientos.",
  client: "Por defecto no tiene acceso de trabajo. Solo podrá usar las funciones que Administración le autorice expresamente.",
  cashier: "Por defecto atiende remesas de cualquier cliente y su propia caja. Para cambiar tasas, comisiones u otras funciones necesita permisos adicionales autorizados.",
  undefined: "No tiene permisos iniciales. Puedes elegir un rol o autorizar permisos individuales; el nombre de la cuenta no define su rol.",
};
export function accountRoleAccess(role: string) {
  return access[role] ?? "";
}
export const ACCOUNT_ROLE_SUMMARY = "El rol aporta los permisos iniciales. Administración puede quitar permisos o agregar otros con una advertencia y guardarlos para esa cuenta. La asignación de rutas, cajas y movimientos sigue aplicándose.";
export function isOperationalRole(role: string) {
  return role === "admin" || role === "collector";
}
