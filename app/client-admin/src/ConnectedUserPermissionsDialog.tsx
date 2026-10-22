import { useEffect, useId, useState, type FormEvent, type MouseEvent } from "react";
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
type PermissionEntry = { key: string; code: string; name: string; category: string; selected: boolean; saved: boolean; allowed: boolean; protected: boolean; add: () => void };
type PermissionPrompt =
  | { kind: "warning"; message: string }
  | { kind: "remove"; key: string; message: string }
  | { kind: "save"; message: string }
  | { kind: "discard"; action: "close" | "refresh"; message: string };

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PermissionPrompt | null>(null);
  const [saveNotice, setSaveNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const locked = loading || !ready || !canEdit || request.locked || prompt !== null;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setReady(false);
    setLoadError("");
    setSaveNotice("");
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
    setSaveNotice("");
    setSelectedKey(null);
    setMode("custom");
    setAssignedIds(adoptedIds);
    setRemittanceKeys(adoptedKeys);
  };
  const addLegacy = (id: number) => {
    if (locked || !ceiling.legacy.includes(id) || requiredOwn.includes(id)) return;
    setSaveNotice("");
    setMode("custom");
    setAssignedIds((current) => [...new Set([...current, id])]);
  };
  const addRemittance = (key: RemittancePermission) => {
    if (locked || !ceiling.remittances.includes(key)) return;
    setSaveNotice("");
    setMode("custom");
    setAssignedIds((current) => [...new Set([...current, 1])]);
    setRemittanceKeys((current) => [...new Set([...current, key, ...(REMITTANCE_PERMISSION_DEPENDENCIES[key] ?? [])])]);
  };
  // Compare with the last confirmed save, not with an earlier selection kept only as a reference.
  const savedIds = new Set(loadedMode === "role" ? rolePermissionIds(userRole) : storedIds ?? []);
  const savedKeys = new Set(loadedMode === "role" ? roleKeys : storedKeys ?? []);
  const entries: PermissionEntry[] = [
    ...PERMISSION_CATALOG.map((permission) => ({ key: `legacy:${permission.id}`, code: String(permission.id), name: permission.name, category: permission.category,
      selected: assigned.has(permission.id), saved: savedIds.has(permission.id), allowed: ceiling.legacy.includes(permission.id), protected: requiredOwn.includes(permission.id), add: () => addLegacy(permission.id) })),
    ...REMITTANCE_PERMISSIONS.map((permission) => ({ key: permission.key, code: "Remesas", name: permission.name, category: REMITTANCE_CATEGORY,
      selected: remittanceKeys.includes(permission.key), saved: savedKeys.has(permission.key), allowed: ceiling.remittances.includes(permission.key), protected: false, add: () => addRemittance(permission.key) })),
  ];
  const entryFor = new Map(entries.map((entry) => [entry.key, entry]));
  const reviewEntries = ready ? entries.filter((entry) => entry.selected || entry.saved) : [];
  const hasChanges = ready && (mode !== loadedMode || entries.some((entry) => entry.selected !== entry.saved));
  const entryStatus = (entry: PermissionEntry, catalog = false) => !entry.allowed ? "No disponible para el rol"
    : !entry.selected && entry.saved ? "Por quitar" : entry.selected && !entry.saved ? "Por agregar"
    : !entry.selected ? "Sin asignar" : catalog ? "Ya asignado" : mode === "role" && loadedMode === "role" ? "Del perfil del rol" : "Guardado";
  const entryHint = (entry: PermissionEntry) => !entry.allowed ? "El rol de esta cuenta no permite activar este permiso."
    : entry.protected ? "No puedes retirar tu propio acceso ni la administración de permisos."
    : entry.selected ? "Este permiso ya está en la lista de asignados. Puedes quitarlo desde esa lista." : "Selecciona este permiso y pulsa Agregar para pasarlo a la lista de asignados.";
  const selectEntry = (entry: PermissionEntry) => {
    if (locked || !entry.allowed || entry.protected || entry.selected) return;
    setSelectedKey(entry.key);
    setSaveNotice("");
  };
  const add = () => {
    if (locked) return;
    const entry = entryFor.get(selectedKey ?? "");
    if (!entry) { setPrompt({ kind: "warning", message: "Selecciona un permiso del catálogo antes de pulsar Agregar." }); return; }
    if (entry.selected) { setPrompt({ kind: "warning", message: "Este permiso ya está en la lista de asignados." }); return; }
    entry.add();
    setSelectedKey(null);
  };
  const remove = (entry: PermissionEntry) => {
    if (locked || !entry.allowed || entry.protected) return;
    if (!entry.selected) { entry.add(); setSelectedKey(null); return; }
    const dependents = REMITTANCE_PERMISSION_KEYS.includes(entry.key as RemittancePermission)
      ? remittanceKeys.filter((key) => REMITTANCE_PERMISSION_DEPENDENCIES[key]?.includes(entry.key as RemittancePermission)) : [];
    setPrompt({ kind: "remove", key: entry.key, message: `¿Quitar el permiso «${entry.name}» de ${userName}?${dependents.length ? ` También se quitarán los permisos que lo necesitan: ${dependents.map(remittanceName).join(", ")}.` : ""} El cambio se aplicará al confirmar Guardar.` });
  };
  const clickRow = (event: MouseEvent<HTMLTableRowElement>, entry: PermissionEntry) => {
    // A row only selects one candidate; Agregar is the only catalog action that changes the draft.
    if (event.target instanceof Element && event.target.closest("input,label,button,a,select,textarea")) return;
    selectEntry(entry);
  };
  const finishClose = () => {
    request.clear();
    onClose();
  };
  const close = () => {
    if (!request.closable || prompt) return;
    // A submitted, unresolved attempt is retained by useMovementRequest even when access was withdrawn.
    if (hasChanges && !request.uncertain) {
      setPrompt({ kind: "discard", action: "close", message: "Hay cambios de permisos sin guardar. ¿Cerrar la ventana y descartar esos cambios? Los permisos guardados se conservarán." });
    } else finishClose();
  };
  const finishRefresh = () => {
    request.clear();
    setSelectedKey(null);
    setReload((current) => current + 1);
  };
  const refresh = () => {
    if (request.locked || loading || prompt) return;
    if (hasChanges) setPrompt({ kind: "discard", action: "refresh", message: "Hay cambios de permisos sin guardar. ¿Descartarlos y recargar los permisos guardados?" });
    else finishRefresh();
  };
  const save = async () => {
    if (!canEdit || !ready || loading || request.busy) return;
    // «Perfil del rol» keeps the saved reference lists as they are; only «Permisos personalizados» replaces them.
    const savedIds = mode === "role" ? storedIds ?? rolePermissionIds(userRole) : assignedIds;
    // The server keeps an empty reference of keys as the role profile, so that is what goes back.
    const savedKeys = mode === "role" ? storedKeys?.length ? storedKeys : roleKeys : remittanceKeys;
    const draft: UserPermissions = { userId, permissionIds: sortedIds(savedIds), mode, remittancePermissions: [...savedKeys].sort(), revision };
    try {
      const result = await request.run<UserPermissions>(`/usuarios/${encodeURIComponent(userId)}/permisos`, { permissionIds: draft.permissionIds, mode, remittancePermissions: draft.remittancePermissions, revision }, draft,
        (result) => isUserPermissions(result, userId) && result.mode === draft.mode && JSON.stringify([...(result.remittancePermissions ?? [])].sort()) === JSON.stringify(draft.remittancePermissions) && JSON.stringify([...result.permissionIds].sort((a, b) => a - b)) === JSON.stringify(draft.permissionIds),
        "POST", isMockToken(getToken()) ? "api" : "strict");
      // A second save in this window must use the server's new revision and a fresh operation key.
      const confirmedMode = result.mode ?? "role";
      setRevision(result.revision);
      setLoadedMode(confirmedMode);
      setStoredIds(result.permissionIds);
      setStoredKeys(result.remittancePermissions ?? []);
      setMode(confirmedMode);
      setAssignedIds(confirmedMode === "role" ? rolePermissionIds(userRole) : result.permissionIds);
      setRemittanceKeys(confirmedMode === "role" ? roleKeys : result.remittancePermissions ?? []);
      setSelectedKey(null);
      setSaveNotice("Permisos guardados. Puedes seguir agregando o quitando permisos en esta ventana.");
      window.dispatchEvent(new CustomEvent("cyp-user-permissions-updated", { detail: { userId } }));
    } catch {
      // The request lifecycle exposes the error and retains uncertain attempts for a safe retry.
    }
  };
  const requestSave = (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || !ready || loading || request.busy || prompt) return;
    // A retry confirms the same immutable attempt and operation key, never a new draft.
    if (request.uncertain) { void save(); return; }
    const count = assignedIds.length + remittanceKeys.length;
    if (!count && !entries.some((entry) => entry.saved && !entry.selected)) {
      setPrompt({ kind: "warning", message: "Agrega al menos un permiso a la lista de asignados antes de guardar." });
      return;
    }
    setPrompt({ kind: "save", message: `¿Guardar los permisos de ${userName}?${count === 0 ? " Esta cuenta quedará sin permisos y no podrá iniciar sesión." : ` Quedarán ${count} permisos en la lista de asignados.`} Los cambios se aplicarán a esta cuenta al confirmar.` });
  };
  const confirmPrompt = () => {
    if (!prompt || request.busy) return;
    const confirmed = prompt;
    setPrompt(null);
    if (confirmed.kind === "save") { void save(); return; }
    if (confirmed.kind === "discard") { if (confirmed.action === "close") finishClose(); else finishRefresh(); return; }
    if (confirmed.kind === "remove") {
      // Recheck every access boundary before applying the confirmed removal to the draft.
      const entry = entryFor.get(confirmed.key);
      if (!entry?.selected || !entry.allowed || entry.protected || loading || !ready || !canEdit || request.locked) return;
      setSaveNotice("");
      setMode("custom");
      setSelectedKey(null);
      if (confirmed.key.startsWith("legacy:")) setAssignedIds((current) => current.filter((id) => `legacy:${id}` !== confirmed.key));
      else setRemittanceKeys((current) => current.filter((key) => key !== confirmed.key && !REMITTANCE_PERMISSION_DEPENDENCIES[key]?.includes(confirmed.key as RemittancePermission)));
    }
  };

  return <><LegacyDialog title="Permisos del Usuario..." onClose={close} className="connected-user-permissions-dialog">
    <form className="connected-user-permissions-content" inert={prompt !== null} onSubmit={requestSave}>
      <div className="connected-permissions-user"><strong>{userName}</strong><span>{userId}</span></div>
      <label className="connected-permissions-mode">Aplicar:<select aria-label="Modo de permisos" value={mode} disabled={locked} onChange={(event) => {
        setSaveNotice("");
        setSelectedKey(null);
        const next = event.target.value as PermissionMode; setMode(next);
        if (next === "role") { setAssignedIds(rolePermissionIds(userRole)); setRemittanceKeys(roleKeys); }
        // Back to the personalized permissions it was loaded with: that selection, not the role profile.
        else if (loadedMode === "custom") { setAssignedIds(storedIds ?? []); setRemittanceKeys(storedKeys ?? []); }
      }}><option value="role">Perfil del rol</option><option value="custom">Permisos personalizados</option></select></label>
      <div className="connected-permissions-controls">
        <label className="connected-permission-category">Categoría:
          <select aria-label="Categoría" value={category} disabled={request.busy || prompt !== null} onChange={(event) => { setCategory(event.target.value as DialogCategory); setSelectedKey(null); }}>
            {[...PERMISSION_CATEGORIES, REMITTANCE_CATEGORY].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button type="button" disabled={locked} onClick={add}>Agregar</button>
        <button type="button" disabled={loading || request.locked || prompt !== null} title="Recargar los permisos guardados" onClick={refresh}><RefreshCw size={14} /> Refrescar</button>
      </div>
      <p className="connected-permissions-feedback">Selecciona un permiso y pulsa Agregar. Repite para agregar otros, revisa la lista de asignados y pulsa Guardar. Los permisos necesarios para cada acción se agregan automáticamente.</p>
      {saveNotice && <p className="connected-permissions-saved" role="status">{saveNotice}</p>}
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
      <div className="connected-permissions-workspace">
      <div className="legacy-mdi-table-wrap connected-user-permissions-scroll">
        <table aria-label="Catálogo de permisos" className="legacy-mdi-table connected-user-permissions-table">
          <thead><tr><th>Seleccionar</th><th>Código</th><th>Permiso</th><th>Categoría</th><th>Estado</th></tr></thead>
          <tbody>
            {visible.map((permission) => { const entry = entryFor.get(`legacy:${permission.id}`)!; return <tr key={permission.id} className={selectedKey === entry.key ? "is-selected" : ""} aria-selected={selectedKey === entry.key} aria-disabled={locked || !entry.allowed || entry.protected || entry.selected} tabIndex={0} title={entryHint(entry)}
              onClick={(event) => clickRow(event, entry)} onKeyDown={(event) => { if (event.target === event.currentTarget) handleKeyboardActivation(event, () => selectEntry(entry)); }}>
              <td><input id={`${controlId}-${permission.id}`} type="radio" name={`${controlId}-permission`} aria-label={`Permiso ${permission.id}: ${permission.name}`} checked={selectedKey === entry.key} disabled={locked || !entry.allowed || entry.protected || entry.selected} onChange={() => selectEntry(entry)} /></td>
              <td>{permission.id}</td><td><label htmlFor={`${controlId}-${permission.id}`} className="connected-permissions-name">{permission.name}</label></td><td>{permission.category}</td>
              <td className="connected-permission-state">{ready ? entryStatus(entry, true) : "Cargando…"}</td>
            </tr>; })}
            {visibleRemittances.map((permission) => { const entry = entryFor.get(permission.key)!; return <tr key={permission.key} className={selectedKey === entry.key ? "is-selected" : ""} aria-selected={selectedKey === entry.key} aria-disabled={locked || !entry.allowed || entry.selected} tabIndex={0} title={entryHint(entry)} onClick={(event) => clickRow(event, entry)} onKeyDown={(event) => { if (event.target === event.currentTarget) handleKeyboardActivation(event, () => selectEntry(entry)); }}><td><input id={`${controlId}-${permission.key}`} type="radio" name={`${controlId}-permission`} aria-label={`${REMITTANCE_CATEGORY}: ${permission.name}`} checked={selectedKey === entry.key} disabled={locked || !entry.allowed || entry.selected} onChange={() => selectEntry(entry)} /></td><td>Envíos</td><td><label htmlFor={`${controlId}-${permission.key}`}>{permission.name}</label></td><td>{REMITTANCE_CATEGORY}</td><td className="connected-permission-state">{ready ? entryStatus(entry, true) : "Cargando…"}</td></tr>; })}
            {visible.length + visibleRemittances.length === 0 && <tr><td colSpan={5}>No hay permisos en esta categoría.</td></tr>}
          </tbody>
        </table>
      </div>
      <section className="connected-permissions-assigned" aria-label="Permisos asignados">
        <div className="connected-permissions-assigned-heading"><h3>Permisos asignados</h3><p>{assignedIds.length + remittanceKeys.length} permisos en todas las categorías</p><p role="status">{hasChanges ? "Hay cambios sin guardar." : ready ? "Sin cambios pendientes." : "Cargando permisos…"}</p></div>
        <ul className="connected-permissions-assigned-list">
          {reviewEntries.map((entry) => <li key={entry.key} className={!entry.selected ? "is-removing" : undefined}>
            <div><strong>{entry.name}</strong><small>{entry.category} · {entry.code}</small><span className="connected-permission-state">{entryStatus(entry)}</span></div>
            <button type="button" aria-label={`${entry.selected ? "Quitar" : "Restaurar"} permiso: ${entry.name}`} title={entryHint(entry)} disabled={locked || !entry.allowed || entry.protected} onClick={() => remove(entry)}>{entry.selected ? "Quitar" : "Restaurar"}</button>
          </li>)}
          {ready && reviewEntries.length === 0 && <li className="connected-permissions-empty">No hay permisos asignados. Selecciona uno en el catálogo y pulsa Agregar.</li>}
        </ul>
      </section>
      </div>
      <p className="connected-user-permissions-note">{mode === "role" ? "Se aplica el perfil inicial del rol. Al agregar o quitar un permiso pasarás a permisos personalizados." : "Al guardar se aplicarán estos permisos en las pantallas y en cada operación. El rol no cambia: Supervisor conserva solo consulta, Cobrador conserva su ruta y Cajero atiende solo Remesas y su propia caja, sin catálogos, tasas ni comisiones. Los códigos 410–415 (reportes del sistema anterior) se conservan, pero los reportes se abren con «Visualizar Reportes» (400) y muestran solo los datos que la cuenta puede consultar."}</p>
      {mode === "custom" && !assigned.has(1) && <p role="status" className="connected-permission-error">Sin «Entrar al sistema» esta cuenta no podrá iniciar sesión ni realizar operaciones.</p>}
      {!canEdit && <p className="connected-permissions-feedback">Tu cuenta no tiene permiso para modificar permisos («Modificar permisos de usuario», 106).</p>}
      {request.error && <p className="connected-permission-error" role="alert">{request.error}</p>}
      <div className="connected-permissions-footer">
        <span>{assignedIds.length + remittanceKeys.length} de {PERMISSION_CATALOG.length + REMITTANCE_PERMISSIONS.length} permisos en la lista de asignados</span>
        <div className="legacy-dialog-actions connected-permission-actions">
          <button type="submit" disabled={!canEdit || loading || !ready || request.busy}>{request.busy ? "Guardando…" : request.uncertain ? "Reintentar guardado" : "Guardar"}</button>
          <button type="button" disabled={!request.closable} onClick={close}>Cancelar</button>
        </div>
      </div>
    </form>
  </LegacyDialog>
  {prompt && <LegacyDialog title={prompt.kind === "warning" ? "Aviso" : prompt.kind === "remove" ? "Quitar permiso" : prompt.kind === "save" ? "Guardar permisos" : "Cambios sin guardar"} className="legacy-confirm-dialog connected-permission-confirm" overlayClassName="connected-permission-prompt-overlay" onClose={() => setPrompt(null)}>
    <div className="legacy-confirm-content"><span className="legacy-question-icon" aria-hidden="true">{prompt.kind === "warning" ? "!" : "?"}</span><p role={prompt.kind === "warning" ? "alert" : undefined}>{prompt.message}</p></div>
    <div className="legacy-dialog-actions centered">
      {prompt.kind === "warning" ? <button type="button" autoFocus onClick={() => setPrompt(null)}>Aceptar</button> : <>
        <button type="button" onClick={confirmPrompt}>Sí</button>
        <button type="button" autoFocus onClick={() => setPrompt(null)}>No</button>
      </>}
    </div>
  </LegacyDialog>}
  </>;
}
