import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Building2, FileCheck2, KeyRound, RefreshCw } from "lucide-react";
import { LegacyCheck, LegacyDenseTable, LegacyDialog, LegacyToolbar, handleKeyboardActivation } from "./LegacyConnectedUi";
import { clearToken } from "./api";
import { remittancesApi } from "./remittancesApi";
import { StrictApiError } from "../../shared/remittances/strictApi";
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
  const [selectedId, setSelectedId] = useState(""), [filtersVisible, setFiltersVisible] = useState(true), [groupFilter, setGroupFilter] = useState(""), [userFilter, setUserFilter] = useState(false);
  const [selectedLink, setSelectedLink] = useState(""), [addingStation, setAddingStation] = useState(false), [stationChoice, setStationChoice] = useState(""), [uncertain, setUncertain] = useState(false);
  const requestVersion = useRef(0), pendingRequest = useRef<{ path: string; body: string } | null>(null), instanceId = useId();
  const locked = busy || uncertain;
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
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
      if (version !== requestVersion.current) return;
      const items = Array.isArray(result) ? result : result.items;
      if (!Array.isArray(items)) throw new Error("La API no devolvió un listado válido.");
      const count = Array.isArray(result) ? result.length : result.total;
      setRecords(items); setTotal(count); setGroups(groupRows); setStations(stationRows); setReasons(reasonRows);
      if (paged && offset > 0 && offset >= count) setOffset(Math.max(0, Math.ceil(count / 50) - 1) * 50);
    } catch (failure) { if (version === requestVersion.current) setError(errorText(failure)); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [definition.path, paged, page, applied, offset]);
  useEffect(() => { void refresh(); return () => { requestVersion.current += 1; }; }, [refresh]);
  const close = () => { if (!locked) { setDialog(null); setDraft({}); setFormError(""); setAddingStation(false); } };
  const open = (next: Dialog) => {
    if (locked || loading) return;
    pendingRequest.current = null; setUncertain(false);
    setDialog(next); setFormError(""); setMessage("");
    const row = next.row;
    const nextDraft: Draft = { name: "", number: "", groupId: groups[0]?.id ?? "", active: true, forCollection: true, note: "", status: "approved" };
    if (row) for (const [key, item] of Object.entries(row)) if (typeof item === "string" || typeof item === "boolean") nextDraft[key] = item;
    if (next.type === "resolve") { nextDraft.status = "approved"; nextDraft.note = ""; }
    if (page === "authorizationRequests" && next.type === "edit") {
      const first = snapshot.clients.find((client) => client.active !== false && snapshot.routes.some((route) => route.id === client.routeId && snapshot.collectors.some((collector) => collector.id === route.collectorId && collector.active !== false)));
      nextDraft.clientId = first?.id ?? ""; nextDraft.collectorId = snapshot.routes.find((route) => route.id === first?.routeId)?.collectorId ?? "";
    }
    setDraft(nextDraft); setLinks(row ? stationIds(row) : []); setSelectedLink(row ? stationIds(row)[0] ?? "" : ""); setAddingStation(false);
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
      const request = pendingRequest.current ?? { path, body: JSON.stringify(body) };
      pendingRequest.current = request;
      await remittancesApi(request.path, { method: "POST", body: request.body });
      pendingRequest.current = null; setUncertain(false);
      if (dialog.action === "close" && dialog.row?.current) { clearToken(); window.location.reload(); return; }
      setDialog(null); setDraft({}); setMessage(text); await refresh(); onRefresh();
    } catch (failure) {
      const resultUncertain = failure instanceof StrictApiError && failure.uncertain;
      setUncertain(resultUncertain); if (!resultUncertain) pendingRequest.current = null;
      setFormError(errorText(failure));
    }
    finally { setBusy(false); }
  };
  const updateDraft = (field: string, entry: string | boolean) => {
    if (locked) return;
    setDraft((current) => {
      const next = { ...current, [field]: entry };
      if (field === "clientId") { const client = snapshot.clients.find((row) => row.id === entry); next.collectorId = snapshot.routes.find((route) => route.id === client?.routeId)?.collectorId ?? ""; }
      return next;
    });
  };
  const layout = ({ stations: "stations", groups: "groups", pcps: "pcp", sessions: "sessions", traces: "traces", authorizationRequests: "authorization" } as const)[page];
  const visible = useMemo(() => paged ? records : records.filter((row) =>
    (page !== "pcps" || !groupFilter || row.groupId === groupFilter) &&
    (value(row, "name") + " " + value(row, "number") + " " + value(row, "deviceId")).toLocaleLowerCase().includes(filter.q.toLocaleLowerCase())
  ), [records, paged, page, groupFilter, filter.q]);
  useEffect(() => { setSelectedId((current) => visible.some((row) => row.id === current) ? current : visible[0]?.id ?? ""); }, [visible]);
  const selected = visible.find((row) => row.id === selectedId);
  const moveSelection = (direction: "first" | "previous" | "next" | "last") => {
    if (loading || !visible.length) return;
    const index = Math.max(0, visible.findIndex((row) => row.id === selectedId));
    const target = { first: 0, previous: Math.max(0, index - 1), next: Math.min(visible.length - 1, index + 1), last: visible.length - 1 }[direction];
    setSelectedId(visible[target].id);
  };
  const applyFilter = (event: FormEvent) => {
    event.preventDefault();
    if (filter.from && filter.to && filter.from > filter.to) { setError("La fecha final debe ser igual o posterior a la inicial."); return; }
    const next = { ...filter, q: page === "sessions" && !userFilter ? "" : filter.q.trim() };
    if (offset === 0 && JSON.stringify(next) === JSON.stringify(applied)) void refresh();
    else { setOffset(0); setApplied(next); }
  };
  const updateFilter = (key: keyof Filter, entry: string) => setFilter((current) => ({ ...current, [key]: entry }));
  const clientFor = (row: Row) => snapshot.clients.find((client) => client.id === row.clientId);
  const clientLabel = (row: Row) => clientFor(row)?.name ?? value(row, "clientId");
  const collectorLabel = (row: Row) => snapshot.collectors.find((collector) => collector.id === row.collectorId)?.name ?? value(row, "collectorId");
  const draftClient = snapshot.clients.find((client) => client.id === draft.clientId);
  const availableStations = stations.filter((station) => station.active !== false && !links.includes(station.id));
  const assignedStations = links.map((id) => stations.find((station) => station.id === id) ?? { id, name: id, active: false });
  const beginResolution = (cancel = false) => {
    if (!selected || selected.status !== "pending") return;
    open({ type: "resolve", row: selected });
    if (cancel) setDraft((current) => ({ ...current, status: "cancelled" }));
  };
  const headers = page === "stations" ? ["Nro", "Estacion", "idDispositivo", "Licencia", "Version", "VersionRec", "Activa"]
    : page === "groups" ? ["Nro.", "Grupo"] : page === "pcps" ? ["Nro.", "PCP", "Cliente", "Grupo", "Ruta", "Activo"]
    : page === "sessions" ? ["Nro.", "Usuario", "Estacion", "Inicio", "Estado", "Vencimiento"]
    : page === "traces" ? ["Nro.", "Fecha", "Traza"] : ["Nro.", "Fecha", "Cobrador", "Código", "Cliente", "Telefono", "Celular", "Estado"];
  const unavailable = (description: string) => <span title={description}>—</span>;
  const cells = (row: Row): ReactNode => page === "groups" ? <td>{value(row, "name")}</td>
    : page === "stations" ? <><td title={value(row, "description")}>{value(row, "name")}</td><td>{value(row, "deviceId") || "—"}</td><td title="Licencia registrada manualmente">{value(row, "license") || "—"}</td><td>{value(row, "version") || "—"}</td><td>{unavailable("La versión recibida no está disponible.")}</td><td><LegacyCheck checked={row.active !== false} /></td></>
    : page === "pcps" ? <><td title={[value(row, "address"), value(row, "phone"), "Estaciones: " + (stationIds(row).map((id) => stations.find((station) => station.id === id)?.name ?? id).join(", ") || "Sin asignar")].filter(Boolean).join(" · ")}>{value(row, "name")}</td><td>{unavailable("El PCP es independiente de los clientes.")}</td><td>{groups.find((group) => group.id === row.groupId)?.name as string ?? "—"}</td><td>{unavailable("El PCP no tiene una ruta de cobro asignada.")}</td><td><LegacyCheck checked={row.active !== false} /></td></>
    : page === "sessions" ? <><td title={value(row, "role") === "admin" ? "Administración" : "Cobrador"}>{value(row, "userName")}{row.current ? " (esta sesión)" : ""}</td><td>{unavailable("Las sesiones no registran una estación de PCP.")}</td><td>{dateTime(row.startedAt)}</td><td title={row.revokedAt ? "Cerrada: " + dateTime(row.revokedAt) : undefined}>{states[value(row, "status")] ?? value(row, "status")}</td><td>{dateTime(row.expiresAt)}</td></>
    : page === "traces" ? <><td>{dateTime(row.createdAt)}</td><td className="legacy-admin-trace-cell">{row.action === "session.started" ? "Inicio de sesión" : row.action === "mutation.completed" ? "Cambio guardado" : value(row, "action")} · {value(row, "resource")} · Usuario: {value(row, "actorId")}{row.resourceId ? " · Referencia: " + value(row, "resourceId") : ""}</td></>
    : <><td>{dateTime(row.createdAt)}</td><td>{collectorLabel(row)}</td><td>{clientFor(row)?.code ?? "—"}</td><td title={row.forCollection ? "Solicitud para cobro" : "Otra solicitud"}>{clientLabel(row)}</td><td>{clientFor(row)?.phone || "—"}</td><td>{clientFor(row)?.cellular || "—"}</td><td>{states[value(row, "status")] ?? value(row, "status")}</td></>;
  const fieldFor = (key: string) => fields.find((field) => field.key === key);
  const input = (key: string, className?: string, autoFocus = false) => <input aria-label={fieldFor(key)?.label ?? key} className={className} autoFocus={autoFocus} value={String(draft[key] ?? "")} required={fieldFor(key)?.required} maxLength={fieldFor(key)?.maxLength ?? 160} disabled={locked} onChange={(event) => updateDraft(key, event.target.value)} />;
  const selectInput = (key: string) => <select aria-label={fieldFor(key)?.label ?? key} value={String(draft[key] ?? "")} required={fieldFor(key)?.required} disabled={locked} onChange={(event) => updateDraft(key, event.target.value)}><option value="">{fieldFor(key)?.required ? "Seleccione..." : "Sin seleccionar"}</option>{fieldFor(key)?.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  const check = (key: string, label: string) => <label className="legacy-admin-checkbox"><input type="checkbox" checked={Boolean(draft[key])} disabled={locked} onChange={(event) => updateDraft(key, event.target.checked)} />{label}</label>;
  const formMessages = <>{formError && <p className="legacy-admin-feedback error" role="alert">{formError}</p>}{uncertain && <p className="legacy-admin-note">El resultado está pendiente de confirmación. Reintenta con estos mismos datos antes de cerrar.</p>}</>;
  const actions = (label = "oK") => <div className="legacy-dialog-actions centered"><button type="submit" disabled={busy}>{busy ? "Guardando…" : uncertain ? "Reintentar" : label}</button><button type="button" disabled={locked} onClick={close}>Cancelar</button></div>;
  const search = <label className="legacy-admin-search">Buscar:<input aria-label="Buscar" value={filter.q} maxLength={160} onChange={(event) => updateFilter("q", event.target.value)} /></label>;
  const deleteTitle = page === "groups" ? "Eliminar grupo" : page === "authorizationRequests" ? "Anular solicitud" : selected?.active === false ? "Activar" : "Inactivar";
  const deleteSelected = () => {
    if (!selected) return;
    if (page === "authorizationRequests") beginResolution(true);
    else open({ type: "confirm", row: selected, action: page === "groups" ? "delete" : selected.active === false ? "activate" : "deactivate" });
  };
  const toolbar = page === "sessions" || page === "traces"
    ? <div className={"legacy-mdi-toolbar " + (page === "sessions" ? "session-toolbar" : "traces-toolbar")} aria-label="Barra de herramientas" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <button type="button" className={filtersVisible ? "nav-tool active" : "nav-tool"} title="Mostrar/Ocultar filtros" onClick={() => setFiltersVisible((current) => !current)}><KeyRound size={15} /></button>
      <button type="button" className="nav-tool" title="Primer registro" disabled={loading || !selected} onClick={() => moveSelection("first")}>|&lt;</button><button type="button" className="nav-tool" title="Registro anterior" disabled={loading || !selected} onClick={() => moveSelection("previous")}>&lt;</button><button type="button" className="nav-tool" title="Registro siguiente" disabled={loading || !selected} onClick={() => moveSelection("next")}>&gt;</button><button type="button" className="nav-tool" title="Último registro" disabled={loading || !selected} onClick={() => moveSelection("last")}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      {page === "sessions" && <button type="button" title={selected?.current ? "Cerrar mi sesión" : "Cerrar sesión"} disabled={loading || selected?.status !== "active"} onClick={() => selected && open({ type: "confirm", row: selected, action: "close" })}><FileCheck2 size={15} /><span>×</span></button>}
      <button type="button" title="Refrescar" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} /></button>
    </div>
    : <LegacyToolbar onToggleFilters={page === "pcps" || page === "authorizationRequests" ? () => setFiltersVisible((current) => !current) : undefined} filtersVisible={filtersVisible}
      onFirst={() => moveSelection("first")} onPrevious={() => moveSelection("previous")} onNext={() => moveSelection("next")} onLast={() => moveSelection("last")}
      onNew={() => open({ type: "edit" })} disableNew={loading || (page === "pcps" && !groups.length)} newTitle={page === "authorizationRequests" ? "Nueva solicitud" : "Nuevo"}
      showEdit={page !== "authorizationRequests"} onEdit={() => selected && open({ type: "edit", row: selected })} disableEdit={loading || !selected}
      onDelete={deleteSelected} deleteTitle={deleteTitle} deleteIcon={page === "groups" ? "trash" : "x"} disableDelete={loading || !selected || (page === "authorizationRequests" && selected.status !== "pending")}
      onRefresh={() => { if (!loading) void refresh(); }} extra={page === "pcps" ? <button type="button" className="pcp-stations-button" title="Estaciones del PCP" disabled={loading || !selected || selected.active === false} onClick={() => selected && open({ type: "stations", row: selected })}><Building2 size={15} /><span>Estaciones</span></button>
        : page === "authorizationRequests" ? <><button type="button" disabled={loading || !selected} onClick={() => selected && open({ type: "detail", row: selected })}>Detalle</button><button type="button" disabled={loading || selected?.status !== "pending"} onClick={() => beginResolution()}>Resolver</button></> : search} />;
  const filterPanel = page === "pcps"
    ? <aside className="pcp-filter-panel legacy-admin-filters" aria-label="Filtros de PCP">
      <label className="pcp-radio-line"><input type="radio" name={instanceId + "-group"} checked={!groupFilter} onChange={() => setGroupFilter("")} /><span>Todos</span></label>
      <label className="pcp-radio-line"><input type="radio" name={instanceId + "-group"} checked={Boolean(groupFilter)} disabled={!groups.length} onChange={() => setGroupFilter(groups[0]?.id ?? "")} /><span>del Grupo:</span></label>
      <select aria-label="Grupo de PCP" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="">Todos</option>{groups.map((group) => <option key={group.id} value={group.id}>{value(group, "name")}</option>)}</select>{search}
    </aside>
    : <form className={layout + "-filter-panel legacy-admin-filters"} aria-label="Filtros" onSubmit={applyFilter}>
      {page === "sessions" && <><label className="session-radio-line"><input type="radio" name={instanceId + "-user"} checked={!userFilter} onChange={() => setUserFilter(false)} /><span>Todas</span></label><label className="session-radio-line"><input type="radio" name={instanceId + "-user"} checked={userFilter} onChange={() => setUserFilter(true)} /><span>del Usuario:</span></label><input aria-label="Buscar usuario" value={filter.q} disabled={!userFilter} maxLength={160} onChange={(event) => updateFilter("q", event.target.value)} /></>}
      <label>Fecha Inicial:<input type="date" value={filter.from} onChange={(event) => updateFilter("from", event.target.value)} /></label>
      <label>Fecha Final:<input type="date" value={filter.to} onChange={(event) => updateFilter("to", event.target.value)} /></label>
      {(page === "sessions" || page === "authorizationRequests") && <label>Estado:<select value={filter.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="">Todos</option>{(page === "sessions" ? ["active", "closed", "expired"] : ["pending", "approved", "rejected", "cancelled"]).map((status) => <option value={status} key={status}>{states[status]}</option>)}</select></label>}
      {page !== "sessions" && <label>{page === "authorizationRequests" ? "Cliente:" : "Buscar:"}<input value={filter.q} maxLength={160} onChange={(event) => updateFilter("q", event.target.value)} /></label>}
      <button type="submit" disabled={loading}>Filtrar</button>
    </form>;
  const grid = <div className={layout + "-grid-panel legacy-admin-grid-panel"}><div className="legacy-mdi-table-wrap"><table className={"legacy-mdi-table " + layout + "-grid"}>
    <thead><tr>{headers.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
    <tbody>{visible.map((row, index) => <tr key={row.id} className={selectedId === row.id ? "selected-row" : ""} tabIndex={0} aria-selected={selectedId === row.id} onClick={() => setSelectedId(row.id)} onDoubleClick={page === "authorizationRequests" ? () => open({ type: "detail", row }) : !paged ? () => open({ type: "edit", row }) : undefined} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedId(row.id))}>
      <td><span className={"mdi-row-select " + (selectedId === row.id ? "selected" : "")}>{page === "stations" || page === "pcps" ? value(row, "number") : offset + index + 1}</span></td>{cells(row)}
    </tr>)}{!visible.length && <tr><td className="legacy-admin-empty" colSpan={headers.length}>{loading ? "Cargando…" : error ? "No se pudo cargar el listado." : "No hay registros para estos filtros."}</td></tr>}</tbody>
  </table></div></div>;
  const totalPages = Math.max(1, Math.ceil(total / 50));
  const dialogTitle = dialog?.type === "stations" ? "Estaciones del PCP..." : dialog?.type === "resolve" ? "Resolver solicitud" : dialog?.type === "detail" ? "Detalle de la solicitud" : dialog?.type === "confirm" ? "Confirmación" : page === "stations" ? "Datos de la Estación de PCP" : page === "groups" ? "Nombre del Grupo..." : page === "pcps" ? "Datos del PCP..." : "Solicitud de autorización";
  const dialogClass = dialog?.type === "stations" ? "pcp-stations-dialog" : dialog?.type === "confirm" ? "legacy-confirm-dialog" : page === "stations" ? "pcp-station-dialog" : page === "groups" ? "legacy-select-dialog" : page === "pcps" ? "pcp-data-dialog" : "authorization-form-dialog";
  const formClass = dialog?.type === "stations" ? "legacy-relation-manager legacy-admin-relations" : page === "stations" && dialog?.type === "edit" ? "legacy-dialog-form pcp-station-form" : page === "pcps" && dialog?.type === "edit" ? "legacy-dialog-form pcp-data-form legacy-pcp-form" : page === "authorizationRequests" ? "authorization-form" : "legacy-dialog-form";
  return <section className={"connected-admin-tools legacy-mdi-view " + layout + "-mdi-view"} aria-label={definition.title} aria-busy={loading}>
    {toolbar}
    {error && <p className="legacy-admin-feedback error" role="alert">{error}</p>}{message && <p className="legacy-admin-feedback success" role="status">{message}</p>}
    {page === "pcps" && !loading && !groups.length && <p className="legacy-admin-note">Crea un grupo de PCPs para registrar el primer punto.</p>}
    {paged || page === "pcps" ? <div className={layout + "-workspace"}>{filtersVisible && filterPanel}{grid}</div> : grid}
    {paged && <div className={"legacy-mdi-pager " + (page === "traces" ? "traces-pager" : "")}>
      <button type="button" title="Primera página" disabled={loading || !offset} onClick={() => setOffset(0)}>|&lt;</button><button type="button" title="Página anterior" disabled={loading || !offset} onClick={() => setOffset(Math.max(0, offset - 50))}>&lt;</button>
      <span>Página {Math.floor(offset / 50) + 1} de {totalPages}</span>
      <button type="button" title="Página siguiente" disabled={loading || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>&gt;</button><button type="button" title="Última página" disabled={loading || offset + 50 >= total} onClick={() => setOffset((totalPages - 1) * 50)}>&gt;|</button><span>{total} registros</span>
    </div>}
    {dialog && <LegacyDialog title={dialogTitle} onClose={close} className={dialogClass + " legacy-admin-dialog"}>
      {dialog.type === "detail" && dialog.row ? <div className="authorization-form">
        <div className="legacy-dialog-row two-cols"><label>Fecha:<input readOnly value={dateTime(dialog.row.createdAt)} /></label><label>Estado:<input readOnly value={states[value(dialog.row, "status")] ?? value(dialog.row, "status")} /></label></div>
        <label>Cobrador:<input readOnly value={collectorLabel(dialog.row)} /></label><label>Cliente:<input readOnly value={clientLabel(dialog.row)} /></label>
        <label>Solicitud:<textarea readOnly rows={3} value={value(dialog.row, "note")} /></label><label>Motivo de atraso:<input readOnly value={String(reasons.find((row) => row.id === dialog.row?.delayReasonId)?.reason ?? "Sin motivo de atraso")} /></label>
        <p className="legacy-admin-note">{dialog.row.forCollection ? "Solicitud para cobro" : "Otra solicitud"} · Registrada por {value(dialog.row, "createdBy")}</p>
        {dialog.row.resolvedAt ? <><label>Decisión:<textarea readOnly rows={3} value={value(dialog.row, "resolutionNote")} /></label><p className="legacy-admin-note">Resuelta: {dateTime(dialog.row.resolvedAt)} · {value(dialog.row, "resolvedBy")}</p></> : null}
        <p className="legacy-admin-note">La decisión administrativa no crea pagos ni modifica límites de efectivo.</p>
        <div className="legacy-dialog-actions centered">{dialog.row.status === "pending" && <button type="button" onClick={() => open({ type: "resolve", row: dialog.row })}>Resolver</button>}<button type="button" onClick={close}>Cerrar</button></div>
      </div> : <form className={formClass} onSubmit={submit}>
        {dialog.type === "edit" && page === "stations" && <>
          <div className="legacy-tabs compact"><button type="button" className="active">General</button></div>
          <fieldset className="legacy-config-fieldset station-general-fieldset"><legend>General</legend>
            <span className="station-internal-id" title={dialog.row?.id}>ID: {dialog.row?.id ?? "Nuevo"}</span>
            <label>Estación:{input("name", undefined, true)}</label>
            <div className="legacy-dialog-row two-cols"><label>Nro.:{input("number")}</label><label>ID:{input("deviceId")}</label></div>
            <div className="license-row"><label>Lic.:{input("license")}</label><button type="button" disabled title="Los datos del dispositivo se registran manualmente.">Obtener Datos</button><button type="button" disabled title="No hay un servicio de emisión de licencias conectado.">Obtener Licencia</button></div>
            <label>Descrip.:<textarea rows={2} maxLength={1000} value={String(draft.description ?? "")} disabled={locked} onChange={(event) => updateDraft("description", event.target.value)} /></label>
            <div className="legacy-dialog-row two-cols"><label>Grupo:{input("group")}</label><label>Tipo:{input("type")}</label></div>
            <div className="legacy-dialog-row two-cols"><label>Versión registrada:{input("version")}</label>{check("active", "Activa")}</div>
          </fieldset><p className="legacy-admin-note">Dispositivo, licencia y versión se registran manualmente; no activan ni validan una licencia.</p>
        </>}
        {dialog.type === "edit" && page === "groups" && <label>Nombre:{input("name", undefined, true)}</label>}
        {dialog.type === "edit" && page === "pcps" && <>
          <div className="pcp-form-row pcp-code-row"><span className="pcp-form-label">PCP:</span>{input("number", "pcp-code-input", true)}{input("name", "pcp-name-input")}</div>
          <label className="pcp-form-row"><span className="pcp-form-label">Grupo:</span>{selectInput("groupId")}</label>
          <label className="pcp-form-row"><span className="pcp-form-label">Dir.:</span>{input("address")}</label>
          <label className="pcp-form-row pcp-phone-row"><span className="pcp-form-label">Telef.:</span>{input("phone")}</label>{check("active", "Activo")}
        </>}
        {dialog.type === "edit" && page === "authorizationRequests" && <>
          <div className="legacy-dialog-row two-cols"><label>Fecha:<input readOnly value="Al guardar" /></label><label>Estado:<input readOnly value="Pendiente" /></label></div>
          <label>Cobrador:{selectInput("collectorId")}</label>
          <div className="legacy-dialog-row two-cols"><label>Código:<input readOnly value={draftClient?.code ?? ""} /></label><label>Cliente:{selectInput("clientId")}</label></div>
          <div className="legacy-dialog-row two-cols"><label>Telefono:<input readOnly value={draftClient?.phone ?? ""} /></label><label>Celular:<input readOnly value={draftClient?.cellular ?? ""} /></label></div>
          <label>Motivo de atraso:{selectInput("delayReasonId")}</label>{check("forCollection", "Solicitud para cobro")}
          <label>Detalle de la solicitud:<textarea autoFocus rows={3} required maxLength={2000} value={String(draft.note ?? "")} disabled={locked} onChange={(event) => updateDraft("note", event.target.value)} /></label>
          <p className="legacy-admin-note">La decisión administrativa no crea pagos ni modifica límites de efectivo.</p>
        </>}
        {dialog.type === "stations" && <>
          <div className="legacy-relation-toolbar"><button type="button" disabled={locked || !availableStations.length} onClick={() => { setStationChoice(availableStations[0]?.id ?? ""); setAddingStation(true); }}>Agregar</button><button type="button" disabled={locked || !selectedLink} onClick={() => { setLinks((current) => current.filter((id) => id !== selectedLink)); setSelectedLink(""); }}>Eliminar</button></div>
          <LegacyDenseTable columns={["Nro", "Estación", "idDispositivo", "Activa"]} rows={assignedStations.map((station, index) => [<button type="button" key={station.id} className={"mdi-row-select " + (selectedLink === station.id ? "selected" : "")} disabled={locked} onClick={() => setSelectedLink(station.id)}>{value(station, "number") || index + 1}</button>, value(station, "name"), value(station, "deviceId") || "—", <LegacyCheck key={station.id + "-active"} checked={station.active !== false} />])} />
          {!links.length && <p className="legacy-admin-note">No hay estaciones asignadas.</p>}
          {formMessages}<p className="legacy-admin-note">Pulsa Guardar para aplicar los cambios de estaciones.</p>
          <div className="legacy-relation-footer"><span className="pcp-stations-owner">{dialog.row ? value(dialog.row, "name") : "PCP"}</span><button type="submit" disabled={busy}>{busy ? "Guardando…" : uncertain ? "Reintentar" : "Guardar"}</button><button type="button" disabled={locked} onClick={close}>Cancelar</button></div>
        </>}
        {dialog.type === "resolve" && <>
          <label>Solicitud:<textarea readOnly rows={2} value={dialog.row ? value(dialog.row, "note") : ""} /></label>
          <label>Decisión:<select value={String(draft.status)} disabled={locked} onChange={(event) => updateDraft("status", event.target.value)}><option value="approved">Aprobar</option><option value="rejected">Rechazar</option><option value="cancelled">Anular solicitud</option></select></label>
          <label>Motivo:<textarea autoFocus required rows={3} maxLength={2000} value={String(draft.note ?? "")} disabled={locked} onChange={(event) => updateDraft("note", event.target.value)} /></label>
          <p className="legacy-admin-note">La decisión quedará registrada y no podrá editarse después. No crea pagos ni modifica límites de efectivo.</p>
        </>}
        {dialog.type === "confirm" && <div className="legacy-confirm-content"><span className="legacy-question-icon">?</span><p>{dialog.action === "close" ? dialog.row?.current ? "Tu sesión se cerrará y tendrás que iniciar sesión de nuevo." : "Se cerrará la sesión de " + (dialog.row ? value(dialog.row, "userName") : "este usuario") + ". Su token dejará de permitir acceso." : dialog.action === "delete" ? "El grupo se eliminará si no tiene PCPs asociados." : "El registro quedará " + (dialog.action === "activate" ? "activo" : "inactivo") + "."}</p></div>}
        {dialog.type !== "stations" && <>{formMessages}{actions(dialog.type === "confirm" ? "Confirmar" : "oK")}</>}
      </form>}
    </LegacyDialog>}
    {dialog?.type === "stations" && addingStation && <LegacyDialog title="Seleccionar..." onClose={() => { if (!locked) setAddingStation(false); }} className="legacy-select-dialog legacy-admin-dialog">
      <div className="legacy-dialog-form"><label>Seleccione:<select autoFocus value={stationChoice} disabled={locked} onChange={(event) => setStationChoice(event.target.value)}>{availableStations.map((station) => <option key={station.id} value={station.id}>{value(station, "number")} · {value(station, "name")}</option>)}</select></label>
        <div className="legacy-dialog-actions centered"><button type="button" disabled={locked || !availableStations.some((station) => station.id === stationChoice)} onClick={() => { setLinks((current) => [...current, stationChoice]); setSelectedLink(stationChoice); setAddingStation(false); }}>oK</button><button type="button" disabled={locked} onClick={() => setAddingStation(false)}>Cancelar</button></div>
      </div>
    </LegacyDialog>}
  </section>;
}
