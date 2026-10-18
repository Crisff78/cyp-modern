import { z } from "zod";
import catalog from "../../shared/permission-catalog.json" with { type: "json" };
import { assertAdmin, DomainError, type Account, type State, type User } from "./domain.js";
import { effectiveAccess, rolePermissionIds, roleRemittancePermissions, REMITTANCE_PERMISSION_KEYS } from "../../shared/access.mjs";

export const permissionCatalog = catalog;
const permissionIds = catalog.permissions.map(({ id }) => id);
const knownIds = new Set(permissionIds);
export const userPermissionsBody = z.object({
  permissionIds: z.array(z.number().int().min(1).max(501).refine((id) => knownIds.has(id), "El permiso no pertenece al catálogo."))
    .max(permissionIds.length).refine((ids) => new Set(ids).size === ids.length, "No se permiten permisos duplicados."),
  revision: z.number().int().min(0).max(2_147_483_647),
  mode: z.enum(["role", "custom"]).optional(),
  remittancePermissions: z.array(z.enum(REMITTANCE_PERMISSION_KEYS)).max(REMITTANCE_PERMISSION_KEYS.length)
    .refine((keys) => new Set(keys).size === keys.length, "No se permiten permisos duplicados.").optional(),
}).strict();

export function accountPermissions(account: Account) {
  return { userId: account.id, permissionIds: [...(account.permissionIds ?? rolePermissionIds(account.role))],
    mode: account.permissionMode ?? "role", remittancePermissions: [...((account.permissionMode ?? "role") === "role" ? roleRemittancePermissions(account.role) : account.remittancePermissions ?? [])], revision: account.permissionRevision ?? 0 };
}
export function permissionsForAccount(state: State, userId: string) {
  const account = state.accounts.find(({ id }) => id === userId);
  if (!account) throw new DomainError("NOT_FOUND", "La cuenta no existe.", 404);
  return accountPermissions(account);
}
export function updateAccountPermissions(state: State, actor: User, userId: string, body: z.infer<typeof userPermissionsBody>) {
  assertAdmin(actor);
  const account = state.accounts.find(({ id }) => id === userId);
  if (!account) throw new DomainError("NOT_FOUND", "La cuenta no existe.", 404);
  if (body.revision !== (account.permissionRevision ?? 0))
    throw new DomainError("PERMISSIONS_CHANGED", "Otro operador modificó los permisos. Refresca el catálogo antes de guardar.", 409);
  const next = [...body.permissionIds].sort((a, b) => a - b);
  const mode = body.mode ?? "custom";
  const remittancePermissions = [...(body.remittancePermissions ?? ((account.permissionMode ?? "role") === "role" ? roleRemittancePermissions(account.role) : account.remittancePermissions ?? []))].sort();
  const access = effectiveAccess(account.role, { permissionMode: mode, permissionIds: next, remittancePermissions });
  if (actor.id === account.id && account.role === "admin" && ![1, 10, 101, 106].every((id) => access.legacy.includes(id)))
    throw new DomainError("OWN_ADMIN_ACCESS", "No puedes retirar tu propio acceso ni la administración de permisos. Otro administrador debe revisar ese cambio.", 409);
  if (account.permissionIds === undefined || JSON.stringify(next) !== JSON.stringify(account.permissionIds) ||
      mode !== (account.permissionMode ?? "role") || JSON.stringify(remittancePermissions) !== JSON.stringify(account.remittancePermissions ?? [])) {
    if (body.revision === 2_147_483_647) throw new DomainError("PERMISSIONS_CHANGED", "La revisión de permisos requiere atención administrativa.", 409);
    account.permissionIds = next;
    account.permissionMode = mode;
    account.remittancePermissions = remittancePermissions;
    account.permissionRevision = body.revision + 1;
    account.updatedAt = new Date().toISOString();
  }
  // Access is read from the account on every request; never elevate the role or
  // embed these grants in a long-lived token. Existing session identities stay intact.
  return accountPermissions(account);
}
