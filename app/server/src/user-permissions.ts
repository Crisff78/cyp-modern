import { z } from "zod";
import catalog from "../../shared/permission-catalog.json" with { type: "json" };
import { assertAdmin, DomainError, type Account, type State, type User } from "./domain.js";
import { effectiveAccess, rolePermissionIds, roleRemittancePermissions, REMITTANCE_PERMISSION_KEYS } from "../../shared/access.mjs";
import { assertBootstrapManagedBySelf, assertDelegatesRole, assertManagesAccount } from "./access.js";
import { recordAdminTrace } from "./admin-tools.js";

export const permissionCatalog = catalog;
const permissionIds = catalog.permissions.map(({ id }) => id);
const knownIds = new Set(permissionIds);
export const userPermissionsBody = z.object({
  permissionIds: z.array(z.number().int().min(1).max(501).refine((id) => knownIds.has(id), "El permiso no pertenece al catálogo."))
    .max(permissionIds.length).refine((ids) => new Set(ids).size === ids.length, "No se permiten permisos duplicados."),
  revision: z.number().int().min(0).max(2_147_483_647),
  mode: z.enum(["role", "custom"]).optional(),
  roleExceptions: z.boolean().optional(),
  remittancePermissions: z.array(z.enum(REMITTANCE_PERMISSION_KEYS)).max(REMITTANCE_PERMISSION_KEYS.length)
    .refine((keys) => new Set(keys).size === keys.length, "No se permiten permisos duplicados.").optional(),
}).strict();

// With «Perfil del rol» both saved lists are only a reference, shown so it can be adopted again: the role
// profile is what applies. A reference of Envíos keys counts while it holds a key, because a PostgreSQL
// account without one stores an empty list; otherwise the keys of the role profile are returned.
const savedRemittanceKeys = (account: Account) => (account.permissionMode ?? "role") === "role" && !account.remittancePermissions?.length
  ? roleRemittancePermissions(account.role) : account.remittancePermissions ?? [];
export function accountPermissions(account: Account) {
  return { userId: account.id, permissionIds: [...(account.permissionIds ?? rolePermissionIds(account.role))],
    mode: account.permissionMode ?? "role", remittancePermissions: [...savedRemittanceKeys(account)], revision: account.permissionRevision ?? 0,
    ...(account.roleExceptions ? { roleExceptions: true } : {}) };
}
/** After a role change, a saved copy of the previous role profile is no earlier selection of the account. */
export function dropSavedRoleProfile(account: Account) {
  if ((account.permissionMode ?? "role") !== "role") return;
  const same = (left: readonly (string | number)[], right: readonly (string | number)[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  if (account.permissionIds && same(account.permissionIds, rolePermissionIds(account.role))) delete account.permissionIds;
  if (account.remittancePermissions?.length && same(account.remittancePermissions, roleRemittancePermissions(account.role))) account.remittancePermissions = [];
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
  assertBootstrapManagedBySelf(actor, account.id);
  assertManagesAccount(state, actor, account.id);
  if (actor.role === "collector") assertDelegatesRole(actor, account.role, account.collectorId);
  if (body.revision !== (account.permissionRevision ?? 0))
    throw new DomainError("PERMISSIONS_CHANGED", "Otro operador modificó los permisos. Refresca el catálogo antes de guardar.", 409);
  const next = [...body.permissionIds].sort((a, b) => a - b);
  // Without `mode` (the previous contract) the account keeps its current mode: a stored list never
  // becomes effective silently. Only an explicit `mode: "custom"` applies it.
  const mode = body.mode ?? account.permissionMode ?? "role";
  // Without the keys the saved ones stay, also the reference kept while the account uses its role profile.
  const remittancePermissions = [...(body.remittancePermissions ?? savedRemittanceKeys(account))].sort();
  const roleExceptions = body.roleExceptions ?? account.roleExceptions ?? false;
  const access = effectiveAccess(account.role, { permissionMode: mode, permissionIds: next, remittancePermissions, roleExceptions });
  const previous = effectiveAccess(account.role, account), own = actor.access ?? effectiveAccess(actor.role);
  const addedIds = access.legacy.filter((id) => !previous.legacy.includes(id));
  const addedKeys = access.remittances.filter((key) => !previous.remittances.includes(key));
  if (addedIds.some((id) => !own.legacy.includes(id)) || addedKeys.some((key) => !own.remittances.includes(key)))
    throw new DomainError("PERMISSION_DELEGATION_FORBIDDEN", "No puedes conceder permisos que tu propia cuenta no tiene.", 403);
  // A request that enables an exception must acknowledge it explicitly, even if
  // a different exception was confirmed on this account on an earlier occasion.
  if (mode === "custom" && body.roleExceptions !== true && (addedIds.some((id) => !rolePermissionIds(account.role).includes(id)) ||
      addedKeys.some((key) => !roleRemittancePermissions(account.role).includes(key) && !(account.role === "cashier" && key === "remittances.reports"))))
    throw new DomainError("ROLE_EXCEPTION_CONFIRMATION_REQUIRED", "Confirma la advertencia para agregar permisos fuera del perfil del rol.", 422);
  if (actor.id === account.id && account.role === "admin" && ![1, 10, 101, 106].every((id) => access.legacy.includes(id)))
    throw new DomainError("OWN_ADMIN_ACCESS", "No puedes retirar tu propio acceso ni la administración de permisos. Otro administrador debe revisar ese cambio.", 409);
  if (account.permissionIds === undefined || JSON.stringify(next) !== JSON.stringify(account.permissionIds) ||
      mode !== (account.permissionMode ?? "role") || roleExceptions !== (account.roleExceptions ?? false) || JSON.stringify(remittancePermissions) !== JSON.stringify(account.remittancePermissions ?? [])) {
    if (body.revision === 2_147_483_647) throw new DomainError("PERMISSIONS_CHANGED", "La revisión de permisos requiere atención administrativa.", 409);
    account.permissionIds = next;
    account.permissionMode = mode;
    account.remittancePermissions = remittancePermissions;
    if (roleExceptions) account.roleExceptions = true; else delete account.roleExceptions;
    account.permissionRevision = body.revision + 1;
    account.updatedAt = new Date().toISOString();
    const audit = recordAdminTrace(state, actor, "permissions.changed", "usuarios/permisos", account.id);
    audit.details = { version: 1, previousRevision: body.revision, revision: account.permissionRevision,
      previousMode: previous.mode, mode, roleExceptionsConfirmed: body.roleExceptions === true,
      added: access.legacy.filter((id) => !previous.legacy.includes(id)), removed: previous.legacy.filter((id) => !access.legacy.includes(id)),
      remittancesAdded: access.remittances.filter((key) => !previous.remittances.includes(key)),
      remittancesRemoved: previous.remittances.filter((key) => !access.remittances.includes(key)) };
  }
  // Access is read from the account on every request; never elevate the role or
  // embed these grants in a long-lived token. Existing session identities stay intact.
  return accountPermissions(account);
}
