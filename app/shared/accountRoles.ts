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
export function isOperationalRole(role: string) {
  return role === "admin" || role === "collector";
}
