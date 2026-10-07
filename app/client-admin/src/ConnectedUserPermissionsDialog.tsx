import { useEffect, useId, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { LegacyDialog, handleKeyboardActivation } from "./LegacyConnectedUi";
import { api, getToken } from "./api";
import { isMockToken } from "./mock";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";
import { PERMISSION_CATALOG, PERMISSION_CATEGORIES, isUserPermissions, type PermissionCategory, type UserPermissions } from "../../shared/permissionCatalog";
import "./connected-user-permissions.css";

export function ConnectedUserPermissionsDialog({ userId, userName, actorId, canEdit = true, onClose }: Readonly<{
  userId: string;
  userName: string;
  actorId: string;
  canEdit?: boolean;
  onClose: () => void;
}>) {
  const scope = `user-permissions:${userId}`;
  const controlId = useId();
  const pending = pendingMovementDraft<UserPermissions>(actorId, scope);
  const request = useMovementRequest(actorId, scope);
  const [assignedIds, setAssignedIds] = useState<readonly number[]>(pending?.permissionIds ?? []);
  const [revision, setRevision] = useState(pending?.revision ?? 0);
  const [category, setCategory] = useState<PermissionCategory>("No definido");
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
      setAssignedIds(submitted?.permissionIds ?? result.permissionIds);
      setRevision(submitted?.revision ?? result.revision);
      setReady(true);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los permisos.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [userId, actorId, scope, reload]);

  const visible = category === "No definido" ? PERMISSION_CATALOG : PERMISSION_CATALOG.filter((permission) => permission.category === category);
  const assigned = new Set(assignedIds);
  const toggle = (id: number) => {
    if (locked) return;
    setAssignedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const selectCategory = (checked: boolean) => {
    if (locked) return;
    const categoryIds = new Set(visible.map(({ id }) => id));
    setAssignedIds((current) => checked ? [...new Set([...current, ...categoryIds])] : current.filter((id) => !categoryIds.has(id)));
  };
  const close = () => {
    if (request.locked) return;
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
    const draft: UserPermissions = { userId, permissionIds: [...assignedIds].sort((a, b) => a - b), revision };
    try {
      await request.run<UserPermissions>(`/usuarios/${encodeURIComponent(userId)}/permisos`, { permissionIds: draft.permissionIds, revision }, draft,
        (result) => isUserPermissions(result, userId) && JSON.stringify([...result.permissionIds].sort((a, b) => a - b)) === JSON.stringify(draft.permissionIds),
        "POST", isMockToken(getToken()) ? "api" : "strict");
      onClose();
    } catch {
      // The request lifecycle exposes the error and retains uncertain attempts for a safe retry.
    }
  };

  return <LegacyDialog title="Permisos del Usuario..." onClose={close} className="connected-user-permissions-dialog">
    <form className="connected-user-permissions-content" onSubmit={(event) => void save(event)}>
      <div className="connected-permissions-user"><strong>{userName}</strong><span>{userId}</span></div>
      <div className="connected-permissions-controls">
        <label className="connected-permission-category">Categoría:
          <select aria-label="Categoría" value={category} disabled={request.busy} onChange={(event) => { setCategory(event.target.value as PermissionCategory); setSelectedId(null); }}>
            {PERMISSION_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button type="button" disabled={locked || visible.length === 0} onClick={() => selectCategory(true)}>Seleccionar Todos</button>
        <button type="button" disabled={locked || visible.length === 0} onClick={() => selectCategory(false)}>Desmarcar Todos</button>
        <button type="button" disabled={loading || request.locked} onClick={refresh}><RefreshCw size={14} /> Refrescar</button>
      </div>
      {loading && <p className="connected-permissions-feedback" role="status">Cargando permisos…</p>}
      {loadError && <p className="connected-permission-error" role="alert">{loadError}</p>}
      <div className="legacy-mdi-table-wrap connected-user-permissions-scroll">
        <table className="legacy-mdi-table connected-user-permissions-table">
          <thead><tr><th>Activo</th><th>Código</th><th>Permiso</th><th>Categoría</th></tr></thead>
          <tbody>
            {visible.map((permission) => <tr key={permission.id} className={selectedId === permission.id ? "is-selected" : ""} aria-selected={selectedId === permission.id} tabIndex={0}
              onClick={() => setSelectedId(permission.id)} onKeyDown={(event) => { if (event.target === event.currentTarget) handleKeyboardActivation(event, () => { setSelectedId(permission.id); toggle(permission.id); }); }}>
              <td><input id={`${controlId}-${permission.id}`} type="checkbox" aria-label={`Permiso ${permission.id}: ${permission.name}`} checked={assigned.has(permission.id)} disabled={locked} onChange={() => toggle(permission.id)} /></td>
              <td>{permission.id}</td><td><label htmlFor={`${controlId}-${permission.id}`} className="connected-permissions-name">{permission.name}</label></td><td>{permission.category}</td>
            </tr>)}
            {visible.length === 0 && <tr><td colSpan={4}>No hay permisos en esta categoría.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="connected-user-permissions-note">No cambian los permisos efectivos de un rol ni conceden operaciones en el servidor. Estas asignaciones legacy se guardan por usuario en la API; las operaciones siguen sujetas a las restricciones del rol.</p>
      {!canEdit && <p className="connected-permissions-feedback">Acción restringida para Supervisores.</p>}
      {request.error && <p className="connected-permission-error" role="alert">{request.error}</p>}
      <div className="connected-permissions-footer">
        <span>{assignedIds.length} de {PERMISSION_CATALOG.length} permisos seleccionados</span>
        <div className="legacy-dialog-actions connected-permission-actions">
          <button type="submit" disabled={!canEdit || loading || !ready || request.busy}>{request.busy ? "Guardando…" : request.uncertain ? "Reintentar guardado" : "Guardar"}</button>
          <button type="button" disabled={request.locked} onClick={close}>Cancelar</button>
        </div>
      </div>
    </form>
  </LegacyDialog>;
}
