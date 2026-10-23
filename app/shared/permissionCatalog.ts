import catalog from "./permission-catalog.json" with { type: "json" };
import { REMITTANCE_PERMISSION_KEYS, rolePermissionIds, type PermissionMode, type RemittancePermission } from "./access.mjs";

export type PermissionCategory = "No definido" | "Sistema" | "Archivos" | "Edición" | "Reportes y Procesamiento" | "Monitoreo" | "Otros";
export type PermissionDefinition = Readonly<{ id: number; name: string; category: PermissionCategory }>;
export type PermissionCatalog = Readonly<{ categories: readonly PermissionCategory[]; permissions: readonly PermissionDefinition[] }>;
export type UserPermissions = Readonly<{ userId: string; permissionIds: readonly number[]; revision: number; mode?: PermissionMode; remittancePermissions?: readonly RemittancePermission[]; roleExceptions?: boolean }>;

// The legacy catalog has gaps between its codes; do not synthesize missing names.
export const PERMISSION_CATEGORIES = catalog.categories as readonly PermissionCategory[];
export const PERMISSION_CATALOG = catalog.permissions as readonly PermissionDefinition[];
export const PERMISSION_IDS: ReadonlySet<number> = new Set(PERMISSION_CATALOG.map(({ id }) => id));
export function defaultPermissionIds(role: string): number[] {
  return rolePermissionIds(role);
}
export function isUserPermissions(value: unknown, userId: string): value is UserPermissions {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<UserPermissions>;
  return data.userId === userId && Number.isInteger(data.revision) && Number(data.revision) >= 0 &&
    Array.isArray(data.permissionIds) && data.permissionIds.every((id) => Number.isInteger(id) && PERMISSION_IDS.has(id)) &&
    new Set(data.permissionIds).size === data.permissionIds.length &&
    (data.mode === undefined || data.mode === "role" || data.mode === "custom") &&
    (data.roleExceptions === undefined || typeof data.roleExceptions === "boolean") &&
    (data.remittancePermissions === undefined || (Array.isArray(data.remittancePermissions) &&
      data.remittancePermissions.every((key) => REMITTANCE_PERMISSION_KEYS.includes(key)) &&
      new Set(data.remittancePermissions).size === data.remittancePermissions.length));
}
