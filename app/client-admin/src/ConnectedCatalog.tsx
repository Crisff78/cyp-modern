import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Modal } from "./components";
import { remittancesApi } from "./remittancesApi";
import { decimalCents, formatMoney } from "../../shared/remittances/output";
import type { Snapshot } from "./types";
import "./connected-catalog.css";

export type CatalogPage = "collectors" | "routes" | "zones" | "servicesProducts" | "delayReasons" | "users" | "recurringCharges";
const definitions: Record<CatalogPage, { title: string; path: string; label: string }> = {
  collectors: { title: "Cobradores", path: "/cobradores", label: "name" },
  routes: { title: "Rutas", path: "/rutas", label: "name" },
  zones: { title: "Zonas", path: "/zonas", label: "name" },
  servicesProducts: { title: "Servicios y productos", path: "/servicios", label: "service" },
  delayReasons: { title: "Motivos de atraso", path: "/motivos-atraso", label: "reason" },
  users: { title: "Usuarios", path: "/usuarios", label: "name" },
  recurringCharges: { title: "Cargos recurrentes", path: "/cargos-recurrentes", label: "concept" },
};
export const isConnectedCatalog = (page: string): page is CatalogPage => Object.hasOwn(definitions, page);
type RecordRow = { id: string; [key: string]: unknown };
type Draft = Record<string, string | boolean>;
type Field = { key: string; label: string; type?: "money" | "number" | "date" | "password" | "boolean"; required?: boolean; options?: { value: string; label: string }[] };
const moneyString = (value: unknown) => typeof value === "number" ? `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}` : "0.00";
const active = (row: RecordRow) => row.active !== false && row.status !== "disabled";

export function ConnectedCatalog({ page, snapshot, onRefresh }: { page: CatalogPage; snapshot: Snapshot; onRefresh: () => void }) {
  const definition = definitions[page];
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<RecordRow | "new" | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<RecordRow | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [toggleTarget, setToggleTarget] = useState<RecordRow | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await remittancesApi<RecordRow[]>(definition.path); if (!Array.isArray(result)) throw new Error("El servidor no devolvió un catálogo válido."); setRecords(result); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo cargar el catálogo."); }
    finally { setLoading(false); }
  }, [definition.path]);
  useEffect(() => { void refresh(); }, [refresh]);

  const collectorOptions = snapshot.collectors.map((row) => ({ value: row.id, label: row.name }));
  const fields: Field[] = page === "collectors" ? [
    { key: "name", label: "Nombre", required: true }, { key: "ident", label: "Código / identificación" }, { key: "cellular", label: "Celular" }, { key: "accountId", label: "Cuenta" },
    { key: "collectionLimit", label: "Límite de cobro (DOP)", type: "money", required: true }, { key: "payoutLimit", label: "Límite de pago (DOP)", type: "money", required: true },
  ] : page === "routes" ? [
    { key: "number", label: "Número" }, { key: "name", label: "Nombre", required: true }, { key: "sector", label: "Sector / zona", required: true }, { key: "collectorId", label: "Cobrador", required: true, options: collectorOptions }, { key: "from", label: "Desde" }, { key: "to", label: "Hasta" },
  ] : page === "zones" ? [
    { key: "number", label: "Número" }, { key: "name", label: "Nombre", required: true }, { key: "sector", label: "Sector" }, { key: "from", label: "Desde" }, { key: "to", label: "Hasta" },
  ] : page === "servicesProducts" ? [
    { key: "service", label: "Servicio", required: true }, { key: "abbr", label: "Abreviatura" }, { key: "caption", label: "Descripción" }, { key: "fixedAmount", label: "Usa importe fijo", type: "boolean" }, { key: "obligated", label: "Cobro obligatorio", type: "boolean" },
  ] : page === "delayReasons" ? [{ key: "reason", label: "Motivo", required: true }] : page === "users" ? [
    { key: "name", label: "Nombre", required: true }, { key: "email", label: "Correo", required: true }, { key: "role", label: "Rol", required: true, options: [{ value: "admin", label: "Administrador" }, { value: "collector", label: "Cobrador" }] }, { key: "collectorId", label: "Cobrador asociado", options: collectorOptions, required: draft.role === "collector" }, ...(editing === "new" ? [{ key: "password", label: "Contraseña inicial (mínimo 12 caracteres)", type: "password" as const, required: true }] : []),
  ] : [
    { key: "clientId", label: "Cliente", required: true, options: snapshot.clients.map((row) => ({ value: row.id, label: row.name })) }, { key: "service", label: "Servicio", required: true }, { key: "concept", label: "Concepto", required: true },
    { key: "startDate", label: "Fecha inicial", type: "date", required: true }, { key: "endDate", label: "Fecha final", type: "date" },
    { key: "frequency", label: "Frecuencia", required: true, options: ["No Definida", "Diaria", "Bidiaria", "Semanal", "Quincenal", "Mensual", "Trimestral", "Cuatrimestral", "Semestral", "Anual"].map((value) => ({ value, label: value })) },
    { key: "day1", label: "Primer día", type: "number" }, { key: "day2", label: "Segundo día", type: "number" }, { key: "amount", label: "Importe (DOP)", type: "money", required: true }, { key: "note", label: "Nota" },
  ];
  const open = (record: RecordRow | "new") => {
    const next: Draft = { role: "collector", frequency: "Mensual", startDate: snapshot.businessDate, day1: "1", day2: "15", active: true };
    for (const field of fields) next[field.key] = field.type === "money" ? moneyString(record === "new" ? page === "collectors" ? 1_000_000 : 0 : record[field.key]) : field.type === "boolean" ? Boolean(record !== "new" && record[field.key]) : String(record === "new" ? next[field.key] ?? "" : record[field.key] ?? "");
    if (next.frequency === "Semestal") next.frequency = "Semestral";
    setDraft(next); setEditing(record); setFormError(""); setMessage("");
  };
  const payloadFor = (value: Draft) => {
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const valueForField = value[field.key] ?? "";
      if (field.required && String(valueForField).trim() === "") throw new Error(`Completa ${field.label.toLowerCase()}.`);
      if (field.type === "money") payload[field.key] = decimalCents(String(valueForField || "0"));
      else if (field.type === "number") { const n = Number(valueForField || "0"); if (!Number.isSafeInteger(n)) throw new Error(`Revisa ${field.label.toLowerCase()}.`); payload[field.key] = n; }
      else payload[field.key] = field.type === "boolean" ? Boolean(valueForField) : String(valueForField).trim();
    }
    if (page === "users") {
      if (payload.role === "admin") delete payload.collectorId;
      if (editing === "new" && String(payload.password).length < 12) throw new Error("La contraseña necesita al menos 12 caracteres.");
    } else payload.active = editing === "new" || !editing ? true : active(editing);
    if (page === "recurringCharges") { payload.currency = "DOP"; payload.useConceptAmount = editing && editing !== "new" ? Boolean(editing.useConceptAmount) : false; }
    return payload;
  };
  const complete = async (text: string) => { setMessage(text); setEditing(null); setPasswordTarget(null); setToggleTarget(null); await refresh(); onRefresh(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !editing) return;
    setBusy(true); setFormError("");
    try { const payload = payloadFor(draft); await remittancesApi(`${definition.path}${editing === "new" ? "" : `/${encodeURIComponent(editing.id)}`}`, { method: "POST", body: JSON.stringify(payload) }); await complete("Datos guardados correctamente."); }
    catch (failure) { setFormError(failure instanceof Error ? failure.message : "No se pudieron guardar los datos."); }
    finally { setBusy(false); }
  };
  const toggle = async () => {
    if (!toggleTarget || busy) return;
    setBusy(true); setFormError("");
    try {
      let path = `${definition.path}/${encodeURIComponent(toggleTarget.id)}`;
      let payload: Record<string, unknown>;
      if (page === "collectors") { path += "/actividad"; payload = { active: !active(toggleTarget) }; }
      else if (page === "users") { path += "/estado"; payload = { status: active(toggleTarget) ? "disabled" : "active" }; }
      else { payload = {}; for (const field of fields) if (toggleTarget[field.key] !== undefined) payload[field.key] = toggleTarget[field.key]; payload.active = !active(toggleTarget); if (page === "recurringCharges") { payload.currency = "DOP"; payload.useConceptAmount = Boolean(toggleTarget.useConceptAmount); } }
      await remittancesApi(path, { method: "POST", body: JSON.stringify(payload) }); await complete("Estado actualizado correctamente.");
    } catch (failure) { setFormError(failure instanceof Error ? failure.message : "No se pudo cambiar el estado."); }
    finally { setBusy(false); }
  };
  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); if (!passwordTarget || busy) return;
    if (String(draft.password ?? "").length < 12) { setFormError("La contraseña necesita al menos 12 caracteres."); return; }
    setBusy(true); setFormError("");
    try { await remittancesApi(`/usuarios/${encodeURIComponent(passwordTarget.id)}/clave`, { method: "POST", body: JSON.stringify({ password: draft.password }) }); setDraft({}); await complete("Contraseña actualizada correctamente."); }
    catch (failure) { setFormError(failure instanceof Error ? failure.message : "No se pudo cambiar la contraseña."); }
    finally { setBusy(false); }
  };
  const visible = records.filter((row) => String(row[definition.label] ?? "").toLowerCase().includes(query.toLowerCase()));
  return <section className="connected-catalog" aria-label={definition.title}>
    <div className="connected-catalog-toolbar"><button type="button" onClick={() => open("new")}>Agregar</button><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Cargando…" : "Refrescar"}</button><label>Buscar<input value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {page === "recurringCharges" && <p className="location-feedback">Catálogo de plantillas guardadas. La generación automática por calendario todavía no está disponible.</p>}
    <div className="connected-catalog-scroll"><table className="legacy-mdi-table"><thead><tr><th>{definition.title}</th><th>Detalle</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td>{String(row[definition.label] || row.service || row.id)}</td><td>{page === "users" ? `${row.email} · ${row.role === "admin" ? "Administrador" : "Cobrador"}` : page === "recurringCharges" ? `${snapshot.clients.find((client) => client.id === row.clientId)?.name ?? "Cliente no asignado"} · ${formatMoney(Number(row.amount ?? 0), "DOP")}` : String(row.sector ?? row.cellular ?? row.caption ?? "")}</td><td>{active(row) ? "Activo" : "Inactivo"}</td><td><div className="connected-row-actions"><button type="button" onClick={() => open(row)}>Modificar</button><button type="button" onClick={() => { setToggleTarget(row); setFormError(""); }}>{active(row) ? "Inactivar" : "Activar"}</button>{page === "users" && <button type="button" onClick={() => { setPasswordTarget(row); setDraft({ password: "" }); setFormError(""); }}>Cambiar clave</button>}</div></td></tr>)}</tbody></table>{!loading && !visible.length && <p>No hay registros para mostrar.</p>}</div>
    <Modal className="connected-catalog-dialog" overlayClassName="connected-catalog-overlay" open={Boolean(editing)} title={`${editing === "new" ? "Agregar" : "Modificar"} · ${definition.title}`} onClose={() => { if (!busy) setEditing(null); }}><form className="connected-catalog-form" onSubmit={submit}>{fields.map((field) => <label key={field.key}>{field.label}{field.type === "boolean" ? <input type="checkbox" checked={Boolean(draft[field.key])} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.checked })} /> : field.options ? <select required={field.required} value={String(draft[field.key] ?? "")} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}><option value="">Selecciona…</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input required={field.required} type={field.type === "date" || field.type === "password" ? field.type : "text"} inputMode={field.type === "money" ? "decimal" : field.type === "number" ? "numeric" : undefined} autoComplete={field.type === "password" ? "new-password" : "off"} value={String(draft[field.key] ?? "")} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />}</label>)}{formError && <p role="alert">{formError}</p>}<div className="connected-row-actions"><button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancelar</button><button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button></div></form></Modal>
    <Modal className="connected-catalog-dialog" overlayClassName="connected-catalog-overlay" open={Boolean(toggleTarget)} title="Confirmar cambio de estado" onClose={() => { if (!busy) setToggleTarget(null); }}><p>{toggleTarget && `${active(toggleTarget) ? "Inactivar" : "Activar"} ${String(toggleTarget[definition.label] ?? "este registro")}?`}</p><p>El historial se conserva.</p>{formError && <p role="alert">{formError}</p>}<div className="connected-row-actions"><button type="button" disabled={busy} onClick={() => setToggleTarget(null)}>Cancelar</button><button type="button" disabled={busy} onClick={() => void toggle()}>{busy ? "Guardando…" : "Confirmar"}</button></div></Modal>
    <Modal className="connected-catalog-dialog" overlayClassName="connected-catalog-overlay" open={Boolean(passwordTarget)} title="Cambiar contraseña" onClose={() => { if (!busy) setPasswordTarget(null); }}><form className="connected-catalog-form" onSubmit={changePassword}><label>Nueva contraseña (mínimo 12 caracteres)<input type="password" autoComplete="new-password" value={String(draft.password ?? "")} onChange={(event) => setDraft({ password: event.target.value })} /></label>{formError && <p role="alert">{formError}</p>}<button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar contraseña"}</button></form></Modal>
  </section>;
}
