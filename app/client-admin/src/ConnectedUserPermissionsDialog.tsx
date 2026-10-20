import { useEffect, useId, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { LegacyDialog, handleKeyboardActivation } from "./LegacyConnectedUi";
import { api, getToken } from "./api";
import { isMockToken } from "./mock";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";
import { PERMISSION_CATALOG, PERMISSION_CATEGORIES, isUserPermissions, type PermissionCategory, type UserPermissions } from "../../shared/permissionCatalog";
import "./connected-user-permissions.css";
import { effectiveAccess, rolePermissionIds, roleRemittancePermissions, REMITTANCE_PERMISSIONS, REMITTANCE_PERMISSION_KEYS, REMITTANCE_PERMISSION_DEPENDENCIES, type PermissionMode, type RemittancePermission } from "../../shared/access.mjs";

// The keys stay "remittances.*"; the dialog shows the name of the module.
const REMITTANCE_CATEGORY = "Remesas";
type DialogCategory = PermissionCategory | typeof REMITTANCE_CATEGORY;
const sortedIds = (ids: readonly number[]) => [...new Set(ids)].sort((a, b) => a - b);
const sameIds = (left: readonly number[], right: readonly number[]) => JSON.stringify(sortedIds(left)) === JSON.stringify(sortedIds(right));
const sortedKeys = (keys: readonly RemittancePermission[]) => [...new Set(keys)].sort();
const sameKeys = (left: readonly RemittancePermission[], right: readonly RemittancePermission[]) => JSON.stringify(sortedKeys(left)) === JSON.stringify(sortedKeys(right));
const remittanceName = (key: RemittancePermission) => REMITTANCE_PERMISSIONS.find((permission) => permission.key === key)?.name ?? key;

export function ConnectedUserPermissionsDialog({ userId, userName, userRole, actorId, canEdit = true, onClose }: Readonly<{
  userId: string;
  userName: string;
  userRole: string;
  actorId: string;
  canEdit?: boolean;
  onClose: () => void;
}>) {
  const scope = `user-permissions:${userId}`;
  const controlId = useId();
  const pending = pendingMovementDraft<UserPermissions>(actorId, scope);
  const request = useMovementRequest(actorId, scope);
  // The lists saved for the account. With «Perfil del rol» they are only a reference (for example the list kept
  // by the 034 migration, or the personalized one before choosing the role profile): the table shows the role
  // profile, and saving sends those lists back unchanged, the codes and the keys of Envíos alike.
  const [storedIds, setStoredIds] = useState<readonly number[] | null>(pending?.mode === "role" ? pending.permissionIds : null);
  const [storedKeys, setStoredKeys] = useState<readonly RemittancePermission[] | null>(pending?.mode === "role" ? pending.remittancePermissions ?? null : null);
  const [loadedMode, setLoadedMode] = useState<PermissionMode | null>(null);
  const [assignedIds, setAssignedIds] = useState<readonly number[]>(pending ? pending.mode === "role" ? rolePermissionIds(userRole) : pending.permissionIds : []);
  const [mode, setMode] = useState<PermissionMode>(pending?.mode ?? "role");
  const [remittanceKeys, setRemittanceKeys] = useState<readonly RemittancePermission[]>(pending ? pending.mode === "role" ? roleRemittancePermissions(userRole) : pending.remittancePermissions ?? [] : []);
  const [revision, setRevision] = useState(pending?.revision ?? 0);
  const [category, setCategory] = useState<DialogCategory>("No definido");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const locked = loading || !ready || !canEdit || request.locked;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setReady(false);
    setLoadError("");
    void api<unknown>(`/usuarios/${encodeURIComponent(userId)}/permisos`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (!isUserPermissions(result, userId)) throw new Error("El servidor no devolvió permisos válidos para este usuario.");
      const submitted = pendingMovementDraft<UserPermissions>(actorId, scope);
      const nextMode = submitted?.mode ?? result.mode ?? "role";
      setMode(nextMode);
      setLoadedMode(result.mode ?? "role");
      setStoredIds(submitted?.mode === "role" ? submitted.permissionIds : result.permissionIds);
      setStoredKeys(submitted?.mode === "role" ? submitted.remittancePermissions ?? null : result.remittancePermissions ?? null);
      setAssignedIds(nextMode === "role" ? rolePermissionIds(userRole) : submitted?.permissionIds ?? result.permissionIds);
      setRemittanceKeys(nextMode === "role" ? roleRemittancePermissions(userRole) : submitted?.remittancePermissions ?? result.remittancePermissions ?? []);
      setRevision(submitted?.revision ?? result.revision);
      setReady(true);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los permisos.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [userId, userRole, actorId, scope, reload]);

  const visible = category === "No definido" ? PERMISSION_CATALOG : category === REMITTANCE_CATEGORY ? [] : PERMISSION_CATALOG.filter((permission) => permission.category === category);
  const visibleRemittances = category === "No definido" || category === REMITTANCE_CATEGORY ? REMITTANCE_PERMISSIONS : [];
  const ceiling = effectiveAccess(userRole, { permissionMode: "custom", permissionIds: PERMISSION_CATALOG.map(({ id }) => id), remittancePermissions: REMITTANCE_PERMISSION_KEYS });
  const requiredOwn = userId === actorId ? [1, 10, 101, 106] : [];
  const assigned = new Set(assignedIds);
  // A saved list different from the role profile is shown and can be adopted explicitly, never silently lost.
  // The keys of Envíos count too: for Cajero and Usuario they are almost all a personalization can change.
  const roleKeys = roleRemittancePermissions(userRole);
  const storedReach = storedIds?.filter((id) => ceiling.legacy.includes(id)) ?? [];
  const storedOutOfReach = storedIds?.filter((id) => !ceiling.legacy.includes(id)) ?? [];
  const storedKeysDiffer = storedKeys !== null && !sameKeys(storedKeys, roleKeys);
  const storedKeysOutOfReach = storedKeysDiffer ? storedKeys!.filter((key) => !ceiling.remittances.includes(key)) : [];
  const adoptedIds = sortedIds([...storedReach, ...requiredOwn]);
  // Without a saved list of its own the keys of Envíos start from the role profile.
  const adoptedKeys = sortedKeys(storedKeysDiffer ? storedKeys!.filter((key) => ceiling.remittances.includes(key)) : roleKeys);
  const showStored = ((storedIds !== null && !sameIds(storedIds, rolePermissionIds(userRole))) || storedKeysDiffer) && (mode === "role" || loadedMode === "role");
  const storedCount = (storedIds?.length ?? 0) + (storedKeysDiffer ? storedKeys!.length : 0);
  const adoptStored = () => {
    if (locked || (!storedIds && !storedKeys)) return;
    setMode("custom");
    setAssignedIds(adoptedIds);
    setRemittanceKeys(adoptedKeys);
  };
  const toggle = (id: number) => {
    if (locked || !ceiling.legacy.includes(id) || requiredOwn.includes(id)) return;
    setMode("custom");
    setAssignedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const selectCategory = (checked: boolean) => {
    if (locked) return;
    setMode("custom");
    const categoryIds = new Set(visible.filter(({ id }) => ceiling.legacy.includes(id)).map(({ id }) => id));
    const keys = visibleRemittances.map(({ key }) => key).filter((key) => ceiling.remittances.includes(key));
    setAssignedIds((current) => checked ? [...new Set([...current, ...categoryIds])] : current.filter((id) => !categoryIds.has(id) || requiredOwn.includes(id)));
    setRemittanceKeys((current) => checked ? [...new Set([...current, ...keys])] : current.filter((key) => !keys.includes(key)));
    if (checked && keys.length) setAssignedIds((current) => [...new Set([...current, 1])]);
  };
  const toggleRemittance = (key: RemittancePermission) => {
    if (locked || !ceiling.remittances.includes(key)) return;
    setMode("custom");
    if (!remittanceKeys.includes(key)) setAssignedIds((current) => [...new Set([...current, 1])]);
    setRemittanceKeys((current) => current.includes(key)
      ? current.filter((value) => value !== key && !REMITTANCE_PERMISSION_DEPENDENCIES[value]?.includes(key))
      : [...new Set([...current, key, ...(REMITTANCE_PERMISSION_DEPENDENCIES[key] ?? [])])]);
  };
  const close = () => {
    if (!request.closable) return;
    request.clear();
    onClose();
  };
  const refresh = () => {
    if (request.locked || loading) return;
    request.clear();
    setSelectedId(null);
    setReload((current) => current + 1);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || !ready || loading || request.busy) return;
    // «Perfil del rol» keeps the saved reference lists as they are; only «Permisos personalizados» replaces them.
    const savedIds = mode === "role" ? storedIds ?? rolePermissionIds(userRole) : assignedIds;
    // The server keeps an empty reference of keys as the role profile, so that is what goes back.
    const savedKeys = mode === "role" ? storedKeys?.length ? storedKeys : roleKeys : remittanceKeys;
    const draft: UserPermissions = { userId, permissionIds: sortedIds(savedIds), mode, remittancePermissions: [...savedKeys].sort(), revision };
    try {
      await request.run<UserPermissions>(`/usuarios/${encodeURIComponent(userId)}/permisos`, { permissionIds: draft.permissionIds, mode, remittancePermissions: draft.remittancePermissions, revision }, draft,
        (result) => isUserPermissions(result, userId) && result.mode === draft.mode && JSON.stringify([...(result.remittancePermissions ?? [])].sort()) === JSON.stringify(draft.remittancePermissions) && JSON.stringify([...result.permissionIds].sort((a, b) => a - b)) === JSON.stringify(draft.permissionIds),
        "POST", isMockToken(getToken()) ? "api" : "strict");
      window.dispatchEvent(new CustomEvent("cyp-user-permissions-updated", { detail: { userId } }));
      onClose();
    } catch {
      // The request lifecycle exposes the error and retains uncertain attempts for a safe retry.
    }
  };

  return <LegacyDialog title="Permisos del Usuario..." onClose={close} className="connected-user-permissions-dialog">
    <form className="connected-user-permissions-content" onSubmit={(event) => void save(event)}>
      <div className="connected-permissions-user"><strong>{userName}</strong><span>{userId}</span></div>
      <label>Aplicar:<select aria-label="Modo de permisos" value={mode} disabled={locked} onChange={(event) => {
        const next = event.target.value as PermissionMode; setMode(next);
        if (next === "role") { setAssignedIds(rolePermissionIds(userRole)); setRemittanceKeys(roleKeys); }
        // Back to the personalized permissions it was loaded with: that selection, not the role profile.
        else if (loadedMode === "custom") { setAssignedIds(storedIds ?? []); setRemittanceKeys(storedKeys ?? []); }
      }}><option value="role">Perfil del rol</option><option value="custom">Permisos personalizados</option></select></label>
      <div className="connected-permissions-controls">
        <label className="connected-permission-category">Categoría:
          <select aria-label="Categoría" value={category} disabled={request.busy} onChange={(event) => { setCategory(event.target.value as DialogCategory); setSelectedId(null); }}>
            {[...PERMISSION_CATEGORIES, REMITTANCE_CATEGORY].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button type="button" disabled={locked || visible.length + visibleRemittances.length === 0} onClick={() => selectCategory(true)}>Seleccionar Todos</button>
        <button type="button" disabled={locked || visible.length + visibleRemittances.length === 0} onClick={() => selectCategory(false)}>Desmarcar Todos</button>
        <button type="button" disabled={loading || request.locked} onClick={refresh}><RefreshCw size={14} /> Refrescar</button>
      </div>
      {loading && <p className="connected-permissions-feedback" role="status">Cargando permisos…</p>}
      {loadError && <p className="connected-permission-error" role="alert">{loadError}</p>}
      {showStored && <div className="connected-permissions-stored" role="group" aria-label="Selección anterior de permisos">
        <p>{mode === "role"
          ? `Esta cuenta conserva una selección anterior de ${storedCount} permisos que no se aplica mientras use «Perfil del rol»; al guardar con el perfil del rol se sigue conservando.`
          : `Selección anterior de esta cuenta (${storedCount} permisos). Al guardar, los permisos marcados la sustituirán.`} Códigos: {sortedIds(storedIds ?? []).join(", ") || "ninguno"}.</p>
        {storedKeysDiffer && <p>{REMITTANCE_CATEGORY}: {storedKeys!.length ? sortedKeys(storedKeys!).map(remittanceName).join(", ") : "ninguno"}.</p>}
        {storedOutOfReach.length + storedKeysOutOfReach.length > 0 && <p>Fuera del alcance del rol, no se aplicarán: {[...sortedIds(storedOutOfReach).map(String), ...sortedKeys(storedKeysOutOfReach).map(remittanceName)].join(", ")}.</p>}
        {!(mode === "custom" && sameIds(assignedIds, adoptedIds) && sameKeys(remittanceKeys, adoptedKeys)) && <button type="button" disabled={locked} onClick={adoptStored}>Aplicar selección anterior</button>}
      </div>}
      <div className="legacy-mdi-table-wrap connected-user-permissions-scroll">
        <table className="legacy-mdi-table connected-user-permissions-table">
          <thead><tr><th>Activo</th><th>Código</th><th>Permiso</th><th>Categoría</th></tr></thead>
          <tbody>
            {visible.map((permission) => <tr key={permission.id} className={selectedId === permission.id ? "is-selected" : ""} aria-selected={selectedId === permission.id} tabIndex={0}
              onClick={() => setSelectedId(permission.id)} onKeyDown={(event) => { if (event.target === event.currentTarget) handleKeyboardActivation(event, () => { setSelectedId(permission.id); toggle(permission.id); }); }}>
              <td><input id={`${controlId}-${permission.id}`} type="checkbox" aria-label={`Permiso ${permission.id}: ${permission.name}`} checked={assigned.has(permission.id)} disabled={locked || !ceiling.legacy.includes(permission.id) || requiredOwn.includes(permission.id)} onChange={() => toggle(permission.id)} /></td>
              <td>{permission.id}</td><td><label htmlFor={`${controlId}-${permission.id}`} className="connected-permissions-name">{permission.name}</label></td><td>{permission.category}</td>
            </tr>)}
            {visibleRemittances.map((permission) => <tr key={permission.key}><td><input id={`${controlId}-${permission.key}`} type="checkbox" aria-label={`${REMITTANCE_CATEGORY}: ${permission.name}`} checked={remittanceKeys.includes(permission.key)} disabled={locked || !ceiling.remittances.includes(permission.key)} onChange={() => toggleRemittance(permission.key)} /></td><td>Envíos</td><td><label htmlFor={`${controlId}-${permission.key}`}>{permission.name}</label></td><td>{REMITTANCE_CATEGORY}</td></tr>)}
            {visible.length + visibleRemittances.length === 0 && <tr><td colSpan={4}>No hay permisos en esta categoría.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="connected-user-permissions-note">{mode === "role" ? "Se aplica el perfil inicial del rol. Al marcar o desmarcar una acción pasarás a permisos personalizados." : "Al guardar se aplicarán estos permisos en las pantallas y en cada operación. El rol no cambia: Supervisor conserva solo consulta, Cobrador conserva su ruta y Cajero atiende solo Remesas y su propia caja, sin catálogos, tasas ni comisiones. Los códigos 410–415 (reportes del sistema anterior) se conservan, pero los reportes se abren con «Visualizar Reportes» (400) y muestran solo los datos que la cuenta puede consultar."}</p>
      {mode === "custom" && !assigned.has(1) && <p role="status" className="connected-permission-error">Sin «Entrar al sistema» esta cuenta no podrá iniciar sesión ni realizar operaciones.</p>}
      {!canEdit && <p className="connected-permissions-feedback">Tu cuenta no tiene permiso para modificar permisos («Modificar permisos de usuario», 106).</p>}
      {request.error && <p className="connected-permission-error" role="alert">{request.error}</p>}
      <div className="connected-permissions-footer">
        <span>{assignedIds.length + remittanceKeys.length} de {PERMISSION_CATALOG.length + REMITTANCE_PERMISSIONS.length} permisos seleccionados</span>
        <div className="legacy-dialog-actions connected-permission-actions">
          <button type="submit" disabled={!canEdit || loading || !ready || request.busy}>{request.busy ? "Guardando…" : request.uncertain ? "Reintentar guardado" : "Guardar"}</button>
          <button type="button" disabled={!request.closable} onClick={close}>Cancelar</button>
        </div>
      </div>
    </form>
  </LegacyDialog>;
}
