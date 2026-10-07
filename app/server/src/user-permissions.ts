import { z } from "zod";
import catalog from "../../shared/permission-catalog.json" with { type: "json" };
import { assertAdmin, DomainError, type Account, type State, type User } from "./domain.js";

export const permissionCatalog = catalog;
const permissionIds = catalog.permissions.map(({ id }) => id);
const knownIds = new Set(permissionIds);
export const userPermissionsBody = z.object({
  permissionIds: z.array(z.number().int().min(1).max(501).refine((id) => knownIds.has(id), "El permiso no pertenece al catálogo."))
    .max(permissionIds.length).refine((ids) => new Set(ids).size === ids.length, "No se permiten permisos duplicados."),
  revision: z.number().int().min(0).max(2_147_483_647),
}).strict();

export function accountPermissions(account: Account) {
  return { userId: account.id, permissionIds: [...(account.permissionIds ?? (account.role === "admin" ? permissionIds : []))], revision: account.permissionRevision ?? 0 };
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
  if (account.permissionIds === undefined || JSON.stringify(next) !== JSON.stringify(account.permissionIds)) {
    account.permissionIds = next;
    account.permissionRevision = body.revision + 1;
    account.updatedAt = new Date().toISOString();
  }
  // Legacy assignments never change the account's role, credentials or sessions.
  return accountPermissions(account);
}
