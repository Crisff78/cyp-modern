import labels from "../../shared/account-roles.json" with { type: "json" };

export type AccountRole = keyof typeof labels;
export const ACCOUNT_ROLES = Object.keys(labels) as AccountRole[];
export function isCollectorAccountRole(role: unknown) {
  return typeof role === "string" && role !== "admin" && Object.hasOwn(labels, role);
}
export function isOperationalRole(role: string) {
  return role === "admin" || role === "collector";
}
