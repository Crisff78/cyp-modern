import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "./components";
import { clearToken } from "./api";
import { remittancesApi } from "./remittancesApi";
import type { Snapshot } from "./types";
import "./connected-admin-tools.css";

export type AdminToolPage = "stations" | "groups" | "pcps" | "sessions" | "traces" | "authorizationRequests";
const definitions: Record<AdminToolPage, { title: string; path: string }> = {
  stations: { title: "Estaciones de PCP", path: "/estaciones" }, groups: { title: "Grupos de PCPs", path: "/grupos-pcp" },
  pcps: { title: "Puntos de cobros y pagos", path: "/pcps" }, sessions: { title: "Sesiones de acceso", path: "/sesiones" },
  traces: { title: "Trazas del sistema", path: "/trazas" }, authorizationRequests: { title: "Solicitudes de autorización", path: "/solicitudes-autorizacion" },
};
export const isConnectedAdminTool = (page: string): page is AdminToolPage => Object.hasOwn(definitions, page);
type Row = { id: string; [key: string]: unknown };
type PageResult = { items: Row[]; total: number; limit: number; offset: number };
type Draft = Record<string, string | boolean>;
type Filter = { q: string; from: string; to: string; status: string };
type Dialog = { type: "edit" | "stations" | "resolve" | "confirm" | "detail"; row?: Row; action?: "deactivate" | "activate" | "delete" | "close" };
type Field = { key: string; label: string; required?: boolean; multiline?: boolean; options?: { value: string; label: string }[]; boolean?: boolean; maxLength?: number };
const value = (row: Row, key: string) => String(row[key] ?? "");
const stationIds = (row: Row) => Array.isArray(row.stationIds) ? row.stationIds.filter((id): id is string => typeof id === "string") : [];
const errorText = (error: unknown) => error instanceof Error ? error.message : "No se pudo completar la operación.";
const dateTime = (date: unknown) => date ? new Date(String(date)).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }) : "—";
const states: Record<string, string> = { active: "Activa", closed: "Cerrada", expired: "Vencida", pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada", cancelled: "Anulada" };
const emptyFilter: Filter = { q: "", from: "", to: "", status: "" };

export function ConnectedAdminTools({ page, snapshot, onRefresh }: { page: AdminToolPage; snapshot: Snapshot; onRefresh: () => void }) {
  const definition = definitions[page], paged = ["sessions", "traces", "authorizationRequests"].includes(page);
  const [records, setRecords] = useState<Row[]>([]), [groups, setGroups] = useState<Row[]>([]), [stations, setStations] = useState<Row[]>([]), [reasons, setReasons] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Filter>(emptyFilter), [applied, setApplied] = useState<Filter>(emptyFilter), [offset, setOffset] = useState(0), [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null), [draft, setDraft] = useState<Draft>({}), [formError, setFormError] = useState(""), [links, setLinks] = useState<string[]>([]);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    const query = new URLSearchParams();
    if (paged) { for (const [key, entry] of Object.entries(applied)) if (entry) query.set(key, entry); query.set("offset", String(offset)); query.set("limit", "50"); }
    try {
      const [result, groupRows, stationRows, reasonRows] = await Promise.all([
        remittancesApi<Row[] | PageResult>(`${definition.path}${paged ? `?${query}` : ""}`),
        page === "pcps" ? remittancesApi<Row[]>("/grupos-pcp") : Promise.resolve([]),
        page === "pcps" ? remittancesApi<Row[]>("/estaciones") : Promise.resolve([]),
        page === "authorizationRequests" ? remittancesApi<Row[]>("/motivos-atraso") : Promise.resolve([]),
      ]);
      const items = Array.isArray(result) ? result : result.items;
      if (!Array.isArray(items)) throw new Error("La API no devolvió un listado válido.");
      setRecords(items); setTotal(Array.isArray(result) ? result.length : result.total); setGroups(groupRows); setStations(stationRows); setReasons(reasonRows);
    } catch (failure) { setError(errorText(failure)); }
    finally { setLoading(false); }
  }, [definition.path, paged, page, applied, offset]);
  useEffect(() => { void refresh(); }, [refresh]);
  const close = () => { if (!busy) { setDialog(null); setDraft({}); setFormError(""); } };
  const open = (next: Dialog) => {
    setDialog(next); setFormError(""); setMessage("");
    const row = next.row;
    const nextDraft: Draft = { name: "", number: "", groupId: groups[0]?.id ?? "", active: true, forCollection: true, note: "", status: "approved" };
    if (row) for (const [key, item] of Object.entries(row)) if (typeof item === "string" || typeof item === "boolean") nextDraft[key] = item;
    if (next.type === "resolve") { nextDraft.status = "approved"; nextDraft.note = ""; }
    if (page === "authorizationRequests" && next.type === "edit") {
      const first = snapshot.clients.find((client) => client.active !== false && snapshot.routes.some((route) => route.id === client.routeId && snapshot.collectors.some((collector) => collector.id === route.collectorId && collector.active !== false)));
      nextDraft.clientId = first?.id ?? ""; nextDraft.collectorId = snapshot.routes.find((route) => route.id === first?.routeId)?.collectorId ?? "";
    }
    setDraft(nextDraft); setLinks(row ? stationIds(row) : []);
  };
  const fields: Field[] = page === "stations" ? [
    { key: "number", label: "Número", required: true, maxLength: 80 }, { key: "name", label: "Estación", required: true }, { key: "deviceId", label: "Identificador del dispositivo (si se conoce)" },
    { key: "description", label: "Descripción", multiline: true, maxLength: 1000 }, { key: "group", label: "Grupo de estación" }, { key: "type", label: "Tipo" },
    { key: "license", label: "Licencia registrada (opcional)" }, { key: "version", label: "Versión registrada (opcional)" }, { key: "active", label: "Activa", boolean: true },
  ] : page === "groups" ? [{ key: "name", label: "Nombre del grupo", required: true }] : page === "pcps" ? [
    { key: "number", label: "Número", required: true, maxLength: 80 }, { key: "name", label: "Nombre del PCP", required: true },
    { key: "groupId", label: "Grupo", required: true, options: groups.map((row) => ({ value: row.id, label: value(row, "name") })) },
    { key: "address", label: "Dirección", maxLength: 500 }, { key: "phone", label: "Teléfono", maxLength: 40 }, { key: "active", label: "Activo", boolean: true },
  ] : [
    { key: "clientId", label: "Cliente", required: true, options: snapshot.clients.filter((client) => client.active !== false).map((client) => ({ value: client.id, label: `${client.code} · ${client.name}` })) },
    { key: "collectorId", label: "Cobrador responsable", required: true, options: snapshot.collectors.filter((collector) => collector.active !== false && snapshot.routes.some((route) => route.collectorId === collector.id && snapshot.clients.some((client) => client.id === draft.clientId && client.routeId === route.id))).map((collector) => ({ value: collector.id, label: collector.name })) },
    { key: "delayReasonId", label: "Motivo de atraso (opcional)", options: reasons.filter((row) => row.active !== false).map((row) => ({ value: row.id, label: value(row, "reason") })) },
    { key: "forCollection", label: "Solicitud para cobro", boolean: true }, { key: "note", label: "Detalle de la solicitud", required: true, multiline: true, maxLength: 2000 },
  ];
  const payload = (source: Draft) => {
    const result: Record<string, string | boolean> = {};
    for (const field of fields) {
      const item = field.boolean ? Boolean(source[field.key]) : String(source[field.key] ?? "").trim();
      if (field.required && !item) throw new Error(`Completa ${field.label.toLocaleLowerCase()}.`);
      if (field.key === "delayReasonId" && !item) continue;
      result[field.key] = item;
    }
    return result;
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!dialog || busy) return;
    setBusy(true); setFormError("");
    try {
      let path = definition.path, body: Record<string, unknown> = {}, text = "Datos guardados correctamente.";
      if (dialog.type === "edit") { if (dialog.row) path += `/${encodeURIComponent(dialog.row.id)}`; body = payload(draft); }
      if (dialog.type === "stations" && dialog.row) { path += `/${encodeURIComponent(dialog.row.id)}/estaciones`; body = { stationIds: links }; text = "Estaciones del PCP guardadas."; }
      if (dialog.type === "resolve" && dialog.row) { path += `/${encodeURIComponent(dialog.row.id)}/resolver`; body = { status: draft.status, note: draft.note }; text = "Decisión registrada."; }
      if (dialog.type === "confirm" && dialog.row) {
        path += `/${encodeURIComponent(dialog.row.id)}`;
        if (dialog.action === "delete") { path += "/eliminar"; text = "Grupo eliminado."; }
        else if (dialog.action === "close") { path += "/cerrar"; text = "Sesión cerrada."; }
        else { body = payload({ ...Object.fromEntries(Object.entries(dialog.row).filter(([, item]) => typeof item === "string" || typeof item === "boolean")), active: dialog.action === "activate" } as Draft); text = "Estado actualizado."; }
      }
      await remittancesApi(path, { method: "POST", body: JSON.stringify(body) });
      if (dialog.action === "close" && dialog.row?.current) { clearToken(); window.location.reload(); return; }
      setDialog(null); setDraft({}); setMessage(text); await refresh(); onRefresh();
    } catch (failure) { setFormError(errorText(failure)); }
    finally { setBusy(false); }
  };
  const updateDraft = (field: string, entry: string | boolean) => {
    setDraft((current) => {
      const next = { ...current, [field]: entry };
      if (field === "clientId") { const client = snapshot.clients.find((row) => row.id === entry); next.collectorId = snapshot.routes.find((route) => route.id === client?.routeId)?.collectorId ?? ""; }
      return next;
    });
  };
  const applyFilter = (event: FormEvent) => { event.preventDefault(); if (filter.from && filter.to && filter.from > filter.to) { setError("La fecha final debe ser igual o posterior a la inicial."); return; } setOffset(0); setApplied({ ...filter }); };
  const visible = paged ? records : records.filter((row) => `${value(row, "name")} ${value(row, "number")} ${value(row, "deviceId")}`.toLocaleLowerCase().includes(applied.q.toLocaleLowerCase()));
  const clientLabel = (row: Row) => snapshot.clients.find((client) => client.id === row.clientId)?.name ?? value(row, "clientId");
  const collectorLabel = (row: Row) => snapshot.collectors.find((collector) => collector.id === row.collectorId)?.name ?? value(row, "collectorId");
  const headers = page === "stations" ? ["Número / estación", "Dispositivo", "Versión registrada", "Estado", "Acciones"]
    : page === "groups" ? ["Grupo", "Acciones"] : page === "pcps" ? ["Número / PCP", "Grupo", "Dirección / teléfono", "Estaciones", "Estado", "Acciones"]
    : page === "sessions" ? ["Usuario", "Inicio", "Vencimiento", "Estado", "Acciones"] : page === "traces" ? ["Fecha", "Acción", "Recurso", "Usuario", "Referencia"]
    : ["Fecha", "Cliente", "Cobrador", "Tipo", "Estado", "Acciones"];
  const catalogActions = (row: Row): ReactNode => <div className="admin-tool-actions"><button type="button" onClick={() => open({ type: "edit", row })}>Modificar</button>{page === "groups"
    ? <button type="button" onClick={() => open({ type: "confirm", row, action: "delete" })}>Eliminar</button>
    : <button type="button" onClick={() => open({ type: "confirm", row, action: row.active === false ? "activate" : "deactivate" })}>{row.active === false ? "Activar" : "Inactivar"}</button>}
    {page === "pcps" && <button type="button" disabled={row.active === false} onClick={() => open({ type: "stations", row })}>Estaciones</button>}</div>;
  const cells = (row: Row): ReactNode => page === "groups" ? <><td>{value(row, "name")}</td><td>{catalogActions(row)}</td></>
    : page === "stations" ? <><td><strong>{value(row, "number")}</strong><br />{value(row, "name")}</td><td>{value(row, "deviceId") || "Sin registrar"}</td><td>{value(row, "version") || "Sin registrar"}</td><td>{row.active ? "Activa" : "Inactiva"}</td><td>{catalogActions(row)}</td></>
    : page === "pcps" ? <><td><strong>{value(row, "number")}</strong><br />{value(row, "name")}</td><td>{groups.find((group) => group.id === row.groupId)?.name as string ?? "—"}</td><td>{value(row, "address")}<br />{value(row, "phone")}</td><td>{stationIds(row).map((id) => stations.find((station) => station.id === id)?.name ?? id).join(", ") || "Sin asignar"}</td><td>{row.active ? "Activo" : "Inactivo"}</td><td>{catalogActions(row)}</td></>
    : page === "sessions" ? <><td>{value(row, "userName")}{row.current ? " (esta sesión)" : ""}<small>{value(row, "role") === "admin" ? "Administración" : "Cobrador"}</small></td><td>{dateTime(row.startedAt)}</td><td>{dateTime(row.expiresAt)}</td><td>{states[value(row, "status")] ?? value(row, "status")}<small>{row.revokedAt ? dateTime(row.revokedAt) : ""}</small></td><td>{row.status === "active" && <button type="button" onClick={() => open({ type: "confirm", row, action: "close" })}>{row.current ? "Cerrar mi sesión" : "Cerrar sesión"}</button>}</td></>
    : page === "traces" ? <><td>{dateTime(row.createdAt)}</td><td>{row.action === "session.started" ? "Inicio de sesión" : row.action === "mutation.completed" ? "Cambio guardado" : value(row, "action")}</td><td>{value(row, "resource")}</td><td>{value(row, "actorId")}</td><td>{value(row, "resourceId") || "—"}</td></>
    : <><td>{dateTime(row.createdAt)}</td><td>{clientLabel(row)}</td><td>{collectorLabel(row)}</td><td>{row.forCollection ? "Para cobro" : "Otra solicitud"}</td><td>{states[value(row, "status")] ?? value(row, "status")}</td><td><div className="admin-tool-actions"><button type="button" onClick={() => open({ type: "detail", row })}>Detalle</button>{row.status === "pending" && <button type="button" onClick={() => open({ type: "resolve", row })}>Resolver</button>}</div></td></>;
  const dialogTitle = dialog?.type === "stations" ? "Estaciones del PCP" : dialog?.type === "resolve" ? "Resolver solicitud" : dialog?.type === "detail" ? "Detalle de la solicitud" : dialog?.type === "confirm" ? "Confirmar acción" : dialog?.row ? "Modificar registro" : "Nuevo registro";
  return <section className="connected-admin-tools" aria-label={definition.title}>
    <div className="admin-tool-toolbar"><h2>{definition.title}</h2>{!["sessions", "traces"].includes(page) && <button type="button" disabled={loading || (page === "pcps" && !groups.length)} onClick={() => open({ type: "edit" })}>Agregar</button>}<button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Cargando…" : "Refrescar"}</button></div>
    {page === "pcps" && !loading && !groups.length && <p>Crea un grupo de PCPs para registrar el primer punto.</p>}
    {page === "authorizationRequests" && <p className="admin-tool-note">La solicitud registra una decisión administrativa. Aprobarla no crea un pago ni modifica límites de efectivo.</p>}
    {page === "sessions" && <p className="admin-tool-note">Sesiones de acceso registradas por esta versión. Se muestran hasta su vencimiento o cierre.</p>}
    <form className="admin-tool-filters" onSubmit={applyFilter}><label>{page === "authorizationRequests" ? "Buscar cliente" : page === "sessions" ? "Buscar usuario" : "Buscar"}<input value={filter.q} maxLength={160} onChange={(event) => setFilter((current) => ({ ...current, q: event.target.value }))} /></label>
      {paged && <><label>Desde<input type="date" value={filter.from} onChange={(event) => setFilter((current) => ({ ...current, from: event.target.value }))} /></label><label>Hasta<input type="date" value={filter.to} onChange={(event) => setFilter((current) => ({ ...current, to: event.target.value }))} /></label></>}
      {(page === "sessions" || page === "authorizationRequests") && <label>Estado<select value={filter.status} onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option>{(page === "sessions" ? ["active", "closed", "expired"] : ["pending", "approved", "rejected", "cancelled"]).map((status) => <option value={status} key={status}>{states[status]}</option>)}</select></label>}<button type="submit" disabled={loading}>Filtrar</button></form>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="admin-tool-table"><table className="legacy-mdi-table"><thead><tr>{headers.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{visible.map((row) => <tr key={row.id}>{cells(row)}</tr>)}</tbody></table>{!loading && !visible.length && <p>No hay registros para estos filtros.</p>}</div>
    {paged && <div className="admin-tool-pagination"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Anterior</button><span>{total === 0 ? "0 registros" : `${offset + 1}–${Math.min(offset + records.length, total)} de ${total}`}</span><button type="button" disabled={loading || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>Siguiente</button></div>}
    {dialog && <Modal open onClose={close} title={dialogTitle} className="admin-tool-dialog" overlayClassName="admin-tool-overlay">
      {dialog.type === "detail" && dialog.row ? <div className="admin-tool-form"><dl><dt>Cliente</dt><dd>{clientLabel(dialog.row)}</dd><dt>Cobrador</dt><dd>{collectorLabel(dialog.row)}</dd><dt>Solicitud</dt><dd>{value(dialog.row, "note")}</dd><dt>Motivo de atraso</dt><dd>{reasons.find((row) => row.id === dialog.row?.delayReasonId)?.reason as string ?? "Sin motivo de atraso"}</dd><dt>Estado</dt><dd>{states[value(dialog.row, "status")]}</dd><dt>Registrada</dt><dd>{dateTime(dialog.row.createdAt)} · {value(dialog.row, "createdBy")}</dd>{dialog.row.resolvedAt ? <><dt>Decisión</dt><dd>{value(dialog.row, "resolutionNote")}</dd><dt>Resuelta</dt><dd>{dateTime(dialog.row.resolvedAt)} · {value(dialog.row, "resolvedBy")}</dd></> : null}</dl><button type="button" onClick={close}>Cerrar</button></div>
      : <form className="admin-tool-form" onSubmit={submit}>
        {dialog.type === "edit" && fields.map((field) => <label key={field.key} className={field.boolean ? "admin-tool-checkbox" : ""}>
          {field.boolean ? <><input type="checkbox" checked={Boolean(draft[field.key])} disabled={busy} onChange={(event) => updateDraft(field.key, event.target.checked)} />{field.label}</>
          : <>{field.label}{field.options ? <select value={String(draft[field.key] ?? "")} required={field.required} disabled={busy} onChange={(event) => updateDraft(field.key, event.target.value)}><option value="">{field.required ? "Selecciona…" : "Sin seleccionar"}</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            : field.multiline ? <textarea value={String(draft[field.key] ?? "")} required={field.required} disabled={busy} maxLength={field.maxLength ?? 2000} onChange={(event) => updateDraft(field.key, event.target.value)} />
            : <input value={String(draft[field.key] ?? "")} required={field.required} disabled={busy} maxLength={field.maxLength ?? 160} onChange={(event) => updateDraft(field.key, event.target.value)} />}</>}
        </label>)}
        {dialog.type === "edit" && page === "stations" && <p className="admin-tool-note">Los datos de dispositivo, licencia y versión se registran manualmente; no activan ni validan una licencia.</p>}
        {dialog.type === "stations" && <fieldset><legend>{dialog.row ? value(dialog.row, "name") : "Estaciones"}</legend>{stations.length ? stations.map((station) => <label key={station.id} className="admin-tool-checkbox"><input type="checkbox" checked={links.includes(station.id)} disabled={busy || (station.active === false && !links.includes(station.id))} onChange={(event) => setLinks((current) => event.target.checked ? [...current, station.id] : current.filter((id) => id !== station.id))} />{value(station, "name")}{station.active === false ? " (inactiva)" : ""}</label>) : <p>No hay estaciones registradas.</p>}</fieldset>}
        {dialog.type === "resolve" && <><label>Decisión<select value={String(draft.status)} disabled={busy} onChange={(event) => updateDraft("status", event.target.value)}><option value="approved">Aprobar</option><option value="rejected">Rechazar</option><option value="cancelled">Anular solicitud</option></select></label><label>Motivo<textarea required maxLength={2000} value={String(draft.note ?? "")} disabled={busy} onChange={(event) => updateDraft("note", event.target.value)} /></label><p>La decisión queda registrada y no se puede editar después.</p></>}
        {dialog.type === "confirm" && <p>{dialog.action === "close" ? dialog.row?.current ? "Tu sesión se cerrará y tendrás que iniciar sesión de nuevo." : `Se cerrará la sesión de ${dialog.row ? value(dialog.row, "userName") : "este usuario"}. Su token dejará de permitir acceso.` : dialog.action === "delete" ? "El grupo se eliminará si no tiene PCPs asociados." : `El registro quedará ${dialog.action === "activate" ? "activo" : "inactivo"}.`}</p>}
        {formError && <p role="alert">{formError}</p>}<div className="admin-tool-actions"><button type="submit" disabled={busy}>{busy ? "Guardando…" : dialog.type === "confirm" ? "Confirmar" : "Guardar"}</button><button type="button" disabled={busy} onClick={close}>Cancelar</button></div>
      </form>}
    </Modal>}
  </section>;
}
