import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, ShieldCheck, Users, Wallet } from "lucide-react";
import { LegacyToolbar, LegacyDialog, LegacyCheck, LegacyDenseTable } from "./LegacyConnectedUi";
import { ConnectedUserPermissionsDialog } from "./ConnectedUserPermissionsDialog";
import { CollectorAssignmentsDialog } from "./CollectorAssignmentsDialog";
import type { CollectorAssignment } from "./collectorAssignmentsState";
import { remittancesApi } from "./remittancesApi";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";
import { decimalCents, formatMoney } from "../../shared/remittances/output";
import { INPUT_LIMITS, assertCentsLimit, isDecimalDraft, isIntegerDraft, parseDay, validateEmail, validatePhone, validateText } from "../../shared/inputRules";
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
type Field = { key: string; label: string; type?: "money" | "number" | "date" | "password" | "boolean" | "email" | "tel"; required?: boolean; multiline?: boolean; maxLength?: number; options?: { value: string; label: string }[] };
const moneyString = (value: unknown) => typeof value === "number" ? `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}` : "0.00";
const active = (row: RecordRow) => row.active !== false && row.status !== "disabled";
// Match the public invitation policy (demo-access.ts), never an invitation value.
const MIN_ACCOUNT_PASSWORD_LENGTH = 10;
const assignmentText = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const areaAssignment = (row: { id: string; name: string; number?: unknown; from?: unknown; to?: unknown }): CollectorAssignment => ({
  id: row.id, name: row.name, number: assignmentText(row.number) || row.id,
  from: assignmentText(row.from), to: assignmentText(row.to),
});

export function ConnectedCatalog({ page, snapshot, actorId, onRefresh }: { page: CatalogPage; snapshot: Snapshot; actorId: string; onRefresh: () => void }) {
  const definition = definitions[page];
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [filterMode, setFilterMode] = useState<"all" | "client">("all");
  const [filterClientId, setFilterClientId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [relation, setRelation] = useState<"zones" | "limits" | "routes" | "balances" | "clients" | "permissions" | null>(null);
  const [relationRow, setRelationRow] = useState<RecordRow | null>(null);
  const [clientPicker, setClientPicker] = useState<"form" | "filter" | null>(null);
  const [clientQuery, setClientQuery] = useState("");
  const [pickedClientId, setPickedClientId] = useState("");
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
  const [limitsTarget, setLimitsTarget] = useState<RecordRow | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await remittancesApi<RecordRow[]>(definition.path); if (!Array.isArray(result)) throw new Error("El servidor no devolvió un catálogo válido."); setRecords(result); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo cargar el catálogo."); }
    finally { setLoading(false); }
  }, [definition.path]);
  useEffect(() => { void refresh(); }, [refresh]);
  const loadAssignmentOptions = useCallback(async (): Promise<readonly CollectorAssignment[]> => {
    if (relation !== "zones" && relation !== "routes") return [];
    const result = await remittancesApi<RecordRow[]>(relation === "zones" ? "/zonas" : "/rutas");
    if (!Array.isArray(result)) throw new Error("El servidor no devolvió un catálogo válido.");
    return result.map((row) => areaAssignment({ id: row.id, name: assignmentText(row.name), number: row.number, from: row.from, to: row.to }));
  }, [relation]);

  const collectorOptions = snapshot.collectors.map((row) => ({ value: row.id, label: row.name }));
  const fields: Field[] = page === "collectors" ? [
    { key: "name", label: "Nombre", required: true, maxLength: INPUT_LIMITS.name }, { key: "ident", label: "Código / identificación", maxLength: INPUT_LIMITS.name }, { key: "cellular", label: "Celular", type: "tel", maxLength: INPUT_LIMITS.phone }, { key: "accountId", label: "Cuenta", maxLength: INPUT_LIMITS.name },
    { key: "collectionLimit", label: "Límite de cobro (DOP)", type: "money", required: true, maxLength: 11 }, { key: "payoutLimit", label: "Límite de pago (DOP)", type: "money", required: true, maxLength: 11 },
  ] : page === "routes" ? [
    { key: "number", label: "Número", maxLength: INPUT_LIMITS.name }, { key: "name", label: "Nombre", required: true, maxLength: INPUT_LIMITS.name }, { key: "sector", label: "Sector / zona", required: true, maxLength: INPUT_LIMITS.name }, { key: "collectorId", label: "Cobrador", required: true, maxLength: INPUT_LIMITS.id, options: collectorOptions }, { key: "from", label: "Desde", maxLength: INPUT_LIMITS.name }, { key: "to", label: "Hasta", maxLength: INPUT_LIMITS.name },
  ] : page === "zones" ? [
    { key: "number", label: "Número", maxLength: INPUT_LIMITS.name }, { key: "name", label: "Nombre", required: true, maxLength: INPUT_LIMITS.name }, { key: "sector", label: "Sector", maxLength: INPUT_LIMITS.name }, { key: "from", label: "Desde", maxLength: INPUT_LIMITS.name }, { key: "to", label: "Hasta", maxLength: INPUT_LIMITS.name },
  ] : page === "servicesProducts" ? [
    { key: "service", label: "Servicio", required: true, maxLength: INPUT_LIMITS.name }, { key: "abbr", label: "Abreviatura", maxLength: INPUT_LIMITS.name }, { key: "caption", label: "Descripción", maxLength: INPUT_LIMITS.name }, { key: "fixedAmount", label: "Usa importe fijo", type: "boolean" }, { key: "obligated", label: "Cobro obligatorio", type: "boolean" },
    { key: "referencePriceCents", label: "Precio de referencia", type: "money", maxLength: 11 },
    { key: "referenceCurrency", label: "Moneda del precio de referencia", options: ["DOP", "USD", "EUR"].map((value) => ({ value, label: value })) },
    { key: "taxReference", label: "Impuestos de referencia (indica unidad)", maxLength: 160 },
    { key: "benefitReference", label: "Beneficio de referencia (indica unidad)", maxLength: 160 },
    { key: "referenceQuantity", label: "Cantidad de referencia (indica unidad)", maxLength: INPUT_LIMITS.quantity },
  ] : page === "delayReasons" ? [{ key: "reason", label: "Motivo", required: true, maxLength: INPUT_LIMITS.name }] : page === "users" ? [
    { key: "nickname", label: "Apodo", maxLength: INPUT_LIMITS.userNickname }, { key: "note", label: "Nota", maxLength: INPUT_LIMITS.userNote, multiline: true },
    { key: "name", label: "Nombre", required: true, maxLength: INPUT_LIMITS.name }, { key: "email", label: "Correo", type: "email", required: true, maxLength: INPUT_LIMITS.email }, { key: "role", label: "Rol", required: true, options: [{ value: "admin", label: "Administrador" }, { value: "collector", label: "Cobrador" }] }, { key: "collectorId", label: "Cobrador asociado", options: collectorOptions, required: draft.role === "collector" }, ...(editing === "new" ? [{ key: "password", label: `Contraseña inicial (mínimo ${MIN_ACCOUNT_PASSWORD_LENGTH} caracteres)`, type: "password" as const, required: true, maxLength: INPUT_LIMITS.password }] : []),
  ] : [
    { key: "clientId", label: "Cliente", required: true, options: snapshot.clients.map((row) => ({ value: row.id, label: row.name })) }, { key: "service", label: "Servicio", required: true, maxLength: INPUT_LIMITS.name }, { key: "concept", label: "Concepto", required: true, maxLength: INPUT_LIMITS.name },
    { key: "startDate", label: "Fecha inicial", type: "date", required: true }, { key: "endDate", label: "Fecha final", type: "date" },
    { key: "frequency", label: "Frecuencia", required: true, options: ["No Definida", "Diaria", "Bidiaria", "Semanal", "Quincenal", "Mensual", "Trimestral", "Cuatrimestral", "Semestral", "Anual"].map((value) => ({ value, label: value })) },
    { key: "day1", label: "Primer día", type: "number", maxLength: 2 }, { key: "day2", label: "Segundo día", type: "number", maxLength: 2 }, { key: "amount", label: "Importe (DOP)", type: "money", required: true, maxLength: 11 }, { key: "note", label: "Nota", maxLength: INPUT_LIMITS.note, multiline: true },
  ];
  const open = (record: RecordRow | "new") => {
    if (busy) return;
    const next: Draft = { role: "collector", frequency: "Mensual", startDate: snapshot.businessDate, day1: "1", day2: "15", active: true };
    for (const field of fields) next[field.key] = field.type === "money" ? moneyString(record === "new" ? page === "collectors" ? 1_000_000 : 0 : record[field.key]) : field.type === "boolean" ? Boolean(record !== "new" && record[field.key]) : String(record === "new" ? next[field.key] ?? "" : record[field.key] ?? "");
    if (page === "servicesProducts") next.referencePriceCents = record === "new" || record.referencePriceCents == null ? "" : moneyString(record.referencePriceCents);
    if (next.frequency === "Semestal") next.frequency = "Semestral";
    setDraft(next); setEditing(record); setFormError(""); setMessage("");
  };
  const payloadFor = (value: Draft) => {
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const valueForField = value[field.key] ?? "";
      if (field.required && String(valueForField).trim() === "") throw new Error(`Completa ${field.label.toLowerCase()}.`);
      if (field.type !== "boolean" && field.type !== "password") validateText(String(valueForField), field.label, field.maxLength ?? INPUT_LIMITS.name, { required: field.required, multiline: field.multiline });
      if (field.type === "tel") validatePhone(String(valueForField), field.label, { required: field.required });
      if (field.type === "email") validateEmail(String(valueForField), field.label, { required: field.required });
      if (field.type === "password" && String(valueForField).length > INPUT_LIMITS.password) throw new Error(`La contraseña admite un máximo de ${INPUT_LIMITS.password} caracteres.`);
      if (page === "servicesProducts" && ["referencePriceCents", "referenceCurrency", "taxReference", "benefitReference", "referenceQuantity"].includes(field.key) && String(valueForField).trim() === "") payload[field.key] = null;
      else if (field.key === "referencePriceCents") {
        const cents = decimalCents(String(valueForField), true);
        if (cents > 1_000_000_000) throw new Error("El precio de referencia debe ser de hasta 10,000,000.00 en su moneda.");
        payload[field.key] = cents;
      }
      else if (field.type === "money") payload[field.key] = assertCentsLimit(decimalCents(String(valueForField || "0")), field.label);
      else if (field.type === "number") payload[field.key] = parseDay(String(valueForField), field.label);
      else payload[field.key] = field.type === "boolean" ? Boolean(valueForField) : field.type === "password" ? String(valueForField) : String(valueForField).trim();
    }
    if (page === "servicesProducts" && (payload.referencePriceCents != null) !== (payload.referenceCurrency != null)) throw new Error("El precio de referencia requiere su moneda; borra ambos para dejarlo vacío.");
    if (page === "users") {
      if (payload.role === "admin") delete payload.collectorId;
      if (editing === "new" && String(payload.password).length < MIN_ACCOUNT_PASSWORD_LENGTH) throw new Error(`La contraseña necesita al menos ${MIN_ACCOUNT_PASSWORD_LENGTH} caracteres.`);
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
    if (String(draft.password ?? "").length < MIN_ACCOUNT_PASSWORD_LENGTH) { setFormError(`La contraseña necesita al menos ${MIN_ACCOUNT_PASSWORD_LENGTH} caracteres.`); return; }
    if (String(draft.password ?? "").length > INPUT_LIMITS.password || String(draft.confirmation ?? "").length > INPUT_LIMITS.password) { setFormError(`La contraseña admite un máximo de ${INPUT_LIMITS.password} caracteres.`); return; }
    if (draft.password !== draft.confirmation) { setFormError("La confirmación no coincide con la clave."); return; }
    setBusy(true); setFormError("");
    try { await remittancesApi(`/usuarios/${encodeURIComponent(passwordTarget.id)}/clave`, { method: "POST", body: JSON.stringify({ password: draft.password }) }); setDraft({}); await complete("Contraseña actualizada correctamente."); }
    catch (failure) { setFormError(failure instanceof Error ? failure.message : "No se pudo cambiar la contraseña."); }
    finally { setBusy(false); }
  };
  const text = (row: RecordRow, key: string) => String(row[key] ?? "");
  const clientOf = (row: RecordRow) => snapshot.clients.find((client) => client.id === row.clientId);
  const currencyOf = (row: RecordRow) => !row.currency || row.currency === "Peso Dominicano" ? "DOP" : String(row.currency);
  const dateOf = (input: unknown) => {
    if (!input) return "";
    const value = String(input);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date) : "";
  };
  const invalidRange = Boolean(from && to && from > to);
  const visible = records.filter((row) => {
    const client = clientOf(row);
    const matchesQuery = [text(row, definition.label), text(row, "number"), text(row, "email"), text(row, "nickname"), text(row, "note"), client?.code, client?.name].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase());
    return matchesQuery && (page !== "recurringCharges" || (!invalidRange &&
      (filterMode === "all" || !filterClientId || row.clientId === filterClientId) &&
      (!from || text(row, "startDate") >= from) && (!to || text(row, "startDate") <= to) &&
      (statusFilter === "all" || active(row) === (statusFilter === "active"))));
  });
  const selected = visible.find((row) => row.id === selectedId) ?? visible[0];
  const moveSelected = (direction: "first" | "up" | "down" | "last") => {
    if (!selected || busy) return;
    const index = visible.findIndex((row) => row.id === selected.id);
    const next = direction === "first" ? 0 : direction === "last" ? visible.length - 1 : direction === "up" ? Math.max(0, index - 1) : Math.min(visible.length - 1, index + 1);
    setSelectedId(visible[next].id);
  };
  const openRelation = (kind: NonNullable<typeof relation>) => {
    if (!selected || loading || busy) return;
    setRelationRow(selected); setRelation(kind);
  };
  const openPicker = (target: "form" | "filter") => {
    if (busy) return;
    setClientPicker(target); setClientQuery("");
    setPickedClientId(target === "form" ? String(draft.clientId ?? "") : filterClientId);
  };
  const pickClient = () => {
    if (!pickedClientId) return;
    if (clientPicker === "form") setDraft((current) => ({ ...current, clientId: pickedClientId }));
    else setFilterClientId(pickedClientId);
    setClientPicker(null);
  };
  const headers: Record<CatalogPage, string[]> = {
    collectors: ["Cod.", "Cobrador", "Celular", "Cuenta", "Act."],
    routes: ["Nro.", "Ruta", "Desde", "Hasta", "Activo"],
    zones: ["Nro", "Zona", "Desde", "Hasta", "Act."],
    servicesProducts: ["Nro.", "Servicio", "Abrev", "Caption", "Ob. Cob.", "Importe fijo", "Activo"],
    delayReasons: ["Nro.", "Motivo", "Activo"],
    users: ["Usuario", "Cuenta", "Rol", "Act."],
    recurringCharges: ["Nro.", "Fecha", "Frecuencia", "Identif.", "Cliente", "Servicio", "Importe", "Activo", "Fecha de Registro"],
  };
  const gridClasses: Record<CatalogPage, string> = {
    collectors: "collectors-grid", routes: "routes-grid", zones: "zones-grid", servicesProducts: "services-products-grid",
    delayReasons: "delay-reasons-grid", users: "users-grid", recurringCharges: "recurring-charges-table",
  };
  const rowCells = (row: RecordRow, index: number): ReactNode[] => {
    const marker = (label: ReactNode) => <span className={"mdi-row-select " + (selected?.id === row.id ? "selected" : "")}>{label}</span>;
    const check = <LegacyCheck checked={active(row)} />;
    switch (page) {
      case "collectors": return [marker(text(row, "ident") || "—"), text(row, "name"), text(row, "cellular"), text(row, "accountId"), check];
      case "routes": case "zones": return [marker(text(row, "number") || index + 1), text(row, "name"), text(row, "from"), text(row, "to"), check];
      case "servicesProducts": return [marker(index + 1), text(row, "service"), text(row, "abbr"), text(row, "caption"), <LegacyCheck checked={Boolean(row.obligated)} />, <input type="checkbox" readOnly aria-label="Usa importe fijo" checked={Boolean(row.fixedAmount)} />, check];
      case "delayReasons": return [marker(index + 1), text(row, "reason"), check];
      case "users": return [marker(text(row, "name")), text(row, "email"), row.role === "admin" ? "Administrador" : "Cobrador", check];
      case "recurringCharges": {
        const client = clientOf(row);
        return [marker(index + 1), dateOf(row.startDate), text(row, "frequency"), client?.identification ?? "", client?.name ?? "Sin cliente asignado", text(row, "service"), formatMoney(Number(row.amount ?? 0), currencyOf(row)), check, dateOf(row.registeredAt)];
      }
    }
  };
  const totals = new Map<string, number>();
  if (page === "recurringCharges") for (const row of visible) totals.set(currencyOf(row), (totals.get(currencyOf(row)) ?? 0) + Number(row.amount ?? 0));

  const control = (key: string, label?: string, className?: string): ReactNode => {
    const field = fields.find((item) => item.key === key);
    if (!field) return null;
    const common = { "aria-label": label ?? field.label, disabled: busy, required: field.required, maxLength: field.maxLength, className };
    if (field.type === "boolean") return <input {...common} type="checkbox" checked={Boolean(draft[key])} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))} />;
    if (field.options) return <select {...common} value={String(draft[key] ?? "")} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}><option value="">Selecciona…</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
    return <input {...common} type={field.type === "date" || field.type === "password" || field.type === "email" || field.type === "tel" ? field.type : "text"} inputMode={field.type === "money" ? "decimal" : field.type === "number" ? "numeric" : field.type === "tel" ? "tel" : undefined} autoComplete={field.type === "password" ? "new-password" : "off"} value={String(draft[key] ?? "")} onChange={(event) => {
      const next = event.target.value;
      setDraft((current) => {
        const shrinking = next.length < String(current[key] ?? "").length;
        if (!shrinking && ((field.type === "money" && !isDecimalDraft(next, { wholeDigits: 8 })) || (field.type === "number" && !isIntegerDraft(next)))) return current;
        return { ...current, [key]: next };
      });
    }} />;
  };
  const formTitles: Record<CatalogPage, string> = {
    collectors: "Datos de Cobrador...", routes: "Datos de Ruta...", zones: "Datos de la Zona...",
    servicesProducts: "Datos del Servicio o Producto (Bien)...", delayReasons: "Motivo de atraso...",
    users: "Datos de Usuario...", recurringCharges: "Datos del Cargo Recurrente...",
  };
  const dialogClasses: Record<CatalogPage, string> = {
    collectors: "collector-form-dialog", routes: "route-data-dialog", zones: "zone-form-dialog",
    servicesProducts: "service-product-dialog", delayReasons: "legacy-select-dialog",
    users: "legacy-user-dialog", recurringCharges: "recurring-charge-dialog",
  };
  const formClasses: Record<CatalogPage, string> = {
    collectors: "legacy-dialog-form", routes: "legacy-dialog-form legacy-route-form", zones: "zone-form",
    servicesProducts: "legacy-dialog-form service-product-form", delayReasons: "legacy-dialog-form",
    users: "legacy-user-form", recurringCharges: "recurring-charge-form",
  };
  const formContent = (): ReactNode => {
    if (page === "collectors") return <>
      <label>Cobrador:{control("name")}</label>
      <div className="legacy-dialog-row two-cols"><label>Ident.:{control("ident")}</label><label>Celular:{control("cellular")}</label></div>
      <label>Cuenta:{control("accountId")}</label>
      <fieldset className="legacy-config-fieldset"><legend>Límites en DOP</legend><div className="legacy-dialog-row two-cols"><label>Cobro:{control("collectionLimit")}</label><label>Pago:{control("payoutLimit")}</label></div></fieldset>
    </>;
    if (page === "routes") return <>
      <div className="route-form-row route-code-row"><span className="route-form-label">Ruta:</span>{control("number", "Número de ruta", "route-code-input")}{control("name", "Nombre de ruta", "route-name-input")}</div>
      <label className="route-form-row"><span className="route-form-label">Desde:</span>{control("from")}</label>
      <label className="route-form-row"><span className="route-form-label">Hasta:</span>{control("to")}</label>
      <label className="route-form-row"><span className="route-form-label">Sector:</span>{control("sector")}</label>
      <label className="route-form-row"><span className="route-form-label">Cobrador:</span>{control("collectorId")}</label>
    </>;
    if (page === "zones") return <>
      <div className="zone-form-row zone-code-row"><span>Zona:</span>{control("number", "Número de zona")}{control("name", "Nombre de zona")}</div>
      <label className="zone-form-row"><span>Desde:</span>{control("from")}</label>
      <label className="zone-form-row"><span>Hasta:</span>{control("to")}</label>
      <label className="zone-form-row"><span>Sector:</span>{control("sector")}</label>
    </>;
    if (page === "servicesProducts") return <>
      <label className="service-form-row"><span className="service-form-label">Bien:</span>{control("service")}</label>
      <div className="service-form-row service-two-cols"><label><span>Caption:</span>{control("caption")}</label><label><span>Abrev:</span>{control("abbr")}</label></div>
      <label className="legacy-check-line service-obligated-line">{control("obligated")}<span>Obligado cobrar</span></label>
      <label className="legacy-check-line service-obligated-line">{control("fixedAmount")}<span>Usa importe fijo</span></label>
      <fieldset className="legacy-config-fieldset"><legend>Referencias opcionales</legend>
        <div className="service-form-row service-two-cols"><label><span>Precio:</span>{control("referencePriceCents")}</label><label><span>Moneda:</span>{control("referenceCurrency")}</label></div>
        <label className="service-form-row"><span>Impuestos:</span>{control("taxReference")}</label>
        <label className="service-form-row"><span>Beneficio:</span>{control("benefitReference")}</label>
        <label className="service-form-row"><span>Cantidad:</span>{control("referenceQuantity")}</label>
        <p className="catalog-scope-note">Datos manuales informativos. Indica la unidad en impuestos, beneficio y cantidad. No calculan impuestos o beneficios ni modifican cargos, existencias o totales. Déjalos vacíos si no aplican; el precio requiere una moneda explícita.</p>
      </fieldset>
    </>;
    if (page === "delayReasons") return <label>Motivo:{control("reason")}</label>;
    if (page === "users") return <>
      <label className="legacy-form-row"><span>Nombre:</span>{control("name")}</label>
      <label className="legacy-form-row"><span>Apodo:</span>{control("nickname")}</label>
      <label className="legacy-form-row"><span>Nota:</span>{control("note")}</label>
      <div className="legacy-form-row user-role-row"><label><span>Usuario / correo:</span>{control("email")}</label><label><span>Rol:</span>{control("role")}</label></div>
      {draft.role === "collector" && <label className="legacy-form-row"><span>Cobrador:</span>{control("collectorId")}</label>}
      {editing === "new" && <label className="legacy-form-row"><span>Clave inicial:</span>{control("password")}</label>}
      {editing === "new" && <small>Mínimo {MIN_ACCOUNT_PASSWORD_LENGTH} caracteres.</small>}
    </>;
    const client = snapshot.clients.find((item) => item.id === draft.clientId);
    return <>
      <div className="recurring-charge-row recurring-charge-client-row"><span>Cliente:</span><input aria-label="Código del cliente" value={client?.code ?? ""} readOnly /><input aria-label="Nombre del cliente" value={client?.name ?? ""} readOnly placeholder="Seleccione un cliente" /><button type="button" disabled={busy} onClick={() => openPicker("form")} aria-label="Buscar cliente" title="Buscar cliente">[...]</button></div>
      <div className="recurring-charge-row recurring-charge-date-row"><span>F. Inicial:</span>{control("startDate")}<span>F. final:</span>{control("endDate")}</div>
      <div className="recurring-charge-row recurring-charge-frequency-row"><span>Frecuencia:</span>{control("frequency")}<span>Día1:</span>{control("day1", undefined, "recurring-charge-day")}<span>Día2:</span>{control("day2", undefined, "recurring-charge-day")}</div>
      <label className="recurring-charge-row recurring-charge-labeled-row"><span>Moneda:</span><input value="Peso Dominicano (DOP)" readOnly /></label>
      <label className="recurring-charge-row recurring-charge-labeled-row"><span>Servicio:</span>{control("service")}</label>
      <label className="recurring-charge-row recurring-charge-labeled-row"><span>Concepto:</span>{control("concept")}</label>
      <label className="recurring-charge-checkbox" title="La marca guardada se conserva; el catálogo no calcula un importe de concepto."><input type="checkbox" checked={Boolean(editing && editing !== "new" && editing.useConceptAmount)} disabled />Usar Importe de Concepto</label>
      <label className="recurring-charge-row recurring-charge-labeled-row"><span>Importe:</span>{control("amount")}</label>
      <label className="recurring-charge-row recurring-charge-labeled-row"><span>Nota:</span>{control("note")}</label>
    </>;
  };
  const relatedRoutes = snapshot.routes.filter((row) => row.collectorId === relationRow?.id || row.id === relationRow?.routeId);
  const relatedZones = (snapshot.zones ?? []).filter((zone) => relatedRoutes.some((route) => route.zoneId === zone.id || (!route.zoneId && route.sector === zone.sector)));
  let assignmentInitial: readonly CollectorAssignment[] = [];
  if (relation === "zones") assignmentInitial = relatedZones.map(areaAssignment);
  if (relation === "routes") assignmentInitial = relatedRoutes.map(areaAssignment);
  if (relation === "limits" && relationRow) assignmentInitial = [{ id: "DOP", number: "DOP", name: "Peso Dominicano", from: "", to: "", collectionLimit: Number(relationRow.collectionLimit ?? 0), payoutLimit: Number(relationRow.payoutLimit ?? 0) }];
  const saveAssignments = (rows: readonly CollectorAssignment[]) => {
    if (!relationRow || !relation) return;
    const collectorId = relationRow.id;
    const kind = relation;
    // Session-only metadata never enters catalog API payloads or financial risk checks.
    setRecords((current) => current.map((row) => row.id === collectorId ? {
      ...row, sessionAssignments: { ...(row.sessionAssignments as Record<string, unknown> | undefined), [kind]: rows },
    } : row));
    setMessage("Asignaciones guardadas para esta sesión.");
  };
  const relatedClients = snapshot.clients.filter((row) => row.routeId === relationRow?.id);
  const collector = snapshot.collectors.find((row) => row.id === relationRow?.id);
  const relationTitles = { zones: "Zonas del Cobrador...", limits: "Límites del Cobrador...", routes: "Rutas del Cobrador...", balances: "Balances de Efectivo del Cobrador", clients: "Clientes de la Ruta...", permissions: "Permisos del Usuario..." };
  const relationContent = (): ReactNode => {
    if (!relationRow) return null;
    if (relation === "clients") return <><LegacyDenseTable columns={["Nro.", "Código", "Cliente", "Teléfono"]} rows={relatedClients.map((row, index) => [index + 1, row.code, row.name, row.phone ?? ""])} /><p className="catalog-scope-note">La asignación de cada cliente se modifica desde Clientes.</p></>;
    if (relation === "balances") return <><LegacyDenseTable columns={["Jornada", "Moneda", "Efectivo actual"]} rows={collector ? [[snapshot.businessDate, "DOP", formatMoney(collector.cashInHand, "DOP")]] : []} /><p className="catalog-scope-note">Saldo actual registrado. El detalle de cada jornada se consulta en Cuadres Diarios.</p></>;
    return null;
  };
  const clientOptions = snapshot.clients.filter((row) => [row.code, row.identification, row.name].join(" ").toLocaleLowerCase().includes(clientQuery.toLocaleLowerCase()));
  return <section className={"catalog-legacy legacy-mdi-view " + (page === "recurringCharges" ? "charges-view recurring-charges-view" : "")} aria-label={definition.title} aria-busy={loading}>
    <LegacyToolbar
      onToggleFilters={page === "recurringCharges" ? () => setFiltersVisible((current) => !current) : undefined}
      filtersVisible={filtersVisible}
      onFirst={() => moveSelected("first")} onPrevious={() => moveSelected("up")} onNext={() => moveSelected("down")} onLast={() => moveSelected("last")}
      onNew={() => open("new")} onEdit={() => selected && open(selected)}
      onDelete={() => { if (selected && !busy) { setToggleTarget(selected); setFormError(""); } }}
      deleteIcon="x" deleteTitle={selected && !active(selected) ? "Reactivar" : "Inactivar"}
      disableNew={loading || busy} disableEdit={!selected || loading || busy} disableDelete={!selected || loading || busy}
      onRefresh={() => { if (!loading && !busy) void refresh(); }}
      extra={<>
        {page === "collectors" && <><button type="button" title="Zonas del Cobrador" aria-label="Zonas del Cobrador" disabled={!selected || busy} onClick={() => openRelation("zones")}>Z</button><button type="button" title="Límites del Cobrador" aria-label="Límites del Cobrador" disabled={!selected || busy} onClick={() => openRelation("limits")}>L</button><button type="button" title="Rutas del Cobrador" aria-label="Rutas del Cobrador" disabled={!selected || busy} onClick={() => openRelation("routes")}>R</button><button type="button" title="Balances de Efectivo" aria-label="Balances de Efectivo" disabled={!selected || busy} onClick={() => openRelation("balances")}><Wallet size={15} /></button></>}
        {page === "routes" && <button type="button" title="Clientes de la Ruta" aria-label="Clientes de la Ruta" disabled={!selected || busy} onClick={() => openRelation("clients")}><Users size={15} /></button>}
        {page === "users" && <><button type="button" title="Cambiar Clave" aria-label="Cambiar Clave" disabled={!selected || busy} onClick={() => { if (selected) { setPasswordTarget(selected); setDraft({ password: "", confirmation: "" }); setFormError(""); } }}><KeyRound size={15} /></button><button type="button" title="Permisos" aria-label="Permisos" disabled={!selected || busy} onClick={() => openRelation("permissions")}><ShieldCheck size={15} /></button></>}
        {page !== "recurringCharges" && <label className="catalog-toolbar-search">Buscar:<input aria-label={"Buscar en " + definition.title} value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
      </>}
    />
    {error && <p className="catalog-feedback" role="alert">{error}</p>}{message && <p className="catalog-feedback" role="status">{message}</p>}
    {loading && <p className="catalog-feedback" role="status">Cargando…</p>}
    <div className={page === "recurringCharges" ? "charges-layout recurring-charges-legacy-layout" : "catalog-grid-workspace"}>
      {page === "recurringCharges" && filtersVisible && <aside className="legacy-filter-panel charges-filter-panel recurring-charge-filter-panel" aria-label="Panel de filtro de cargos recurrentes">
        <div className="pending-charges-filter-heading">Panel de Filtro</div>
        <label className="charges-radio-row"><input type="radio" name="connected-recurring-filter" checked={filterMode === "all"} onChange={() => setFilterMode("all")} />Todos</label>
        <div className="charges-filter-group"><label className="charges-radio-row"><input type="radio" name="connected-recurring-filter" checked={filterMode === "client"} onChange={() => setFilterMode("client")} />por Cliente:</label><div className="legacy-lookup-field charges-filter-control"><input aria-label="Cliente del filtro" value={snapshot.clients.find((client) => client.id === filterClientId)?.name ?? ""} disabled={filterMode !== "client"} readOnly /><button type="button" disabled={filterMode !== "client"} onClick={() => openPicker("filter")} aria-label="Seleccionar cliente" title="Seleccionar cliente">...</button></div></div>
        <label className="field compact-field">Fecha Inicial:<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field compact-field">Fecha final:<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="field compact-field">Estado:<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
        <label className="field compact-field">Buscar:<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {invalidRange && <p role="alert">La fecha inicial debe ser anterior o igual a la final.</p>}
      </aside>}
      <div className={page === "recurringCharges" ? "charges-grid-panel" : "catalog-grid-panel"}>
        <div className="legacy-mdi-table-wrap"><table className={"legacy-mdi-table " + gridClasses[page]}><thead><tr>{headers[page].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>
          {visible.map((row, index) => <tr key={row.id} className={selected?.id === row.id ? "selected-row" : ""} aria-selected={selected?.id === row.id} tabIndex={0} onClick={() => setSelectedId(row.id)} onDoubleClick={() => open(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(row.id); } }}>{rowCells(row, index).map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}
          {!loading && !visible.length && <tr><td colSpan={headers[page].length}>No hay registros para estos filtros.</td></tr>}
        </tbody></table></div>
        {page === "recurringCharges" && <div className="legacy-footerbar"><span>Cantidad: <strong>{visible.length}</strong></span>{Array.from(totals, ([currency, amount]) => <span key={currency}>Total {currency}: <strong>{formatMoney(amount, currency)}</strong></span>)}<span title="La API no vincula cobros a estas plantillas">Recib.: <strong>—</strong></span><span title="La API no calcula saldos de plantillas">Pend.: <strong>—</strong></span></div>}
      </div>
    </div>
    {page === "recurringCharges" && <p className="catalog-scope-note">Plantillas guardadas. La generación por calendario todavía no está disponible; recibido y pendiente no se calculan para plantillas.</p>}
    {page === "users" && <p className="catalog-scope-note">Usuarios → Permisos muestra las asignaciones de pantallas de este navegador. El rol de la cuenta y la API determinan las operaciones autorizadas; este panel no modifica los permisos efectivos de un rol.</p>}
    {limitsTarget && <CollectorLimitsDialog key={`${actorId}-${limitsTarget.id}`} actorId={actorId} collector={limitsTarget} onClose={() => setLimitsTarget(null)} onSaved={async (saved) => { setLimitsTarget(null); setRelationRow(saved); await refresh(); setMessage("Límites del cobrador guardados. Sus demás datos se conservan."); onRefresh(); }} />}
    {editing && <LegacyDialog title={formTitles[page]} className={dialogClasses[page] + " catalog-legacy-dialog"} onClose={() => { if (!busy) setEditing(null); }}>
      <form className={formClasses[page]} onSubmit={submit}>{formContent()}{formError && <p role="alert">{formError}</p>}<div className="legacy-dialog-actions centered"><button type="submit" disabled={busy}>{busy ? "Guardando…" : "oK"}</button><button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancelar</button></div></form>
    </LegacyDialog>}
    {toggleTarget && <LegacyDialog title="Confirmar" className="legacy-confirm-dialog catalog-legacy-dialog" onClose={() => { if (!busy) setToggleTarget(null); }}><div className="legacy-confirm-content"><span className="legacy-question-icon">?</span><p>¿{active(toggleTarget) ? "Inactivar" : "Reactivar"} {text(toggleTarget, definition.label)}?</p></div><p className="catalog-scope-note">El historial se conserva.</p>{formError && <p role="alert">{formError}</p>}<div className="legacy-dialog-actions centered"><button type="button" disabled={busy} onClick={() => void toggle()}>{busy ? "Guardando…" : "Sí"}</button><button type="button" disabled={busy} onClick={() => setToggleTarget(null)}>No</button></div></LegacyDialog>}
    {passwordTarget && <LegacyDialog title="Cambiar clave de usuario..." className="legacy-password-dialog catalog-legacy-dialog" onClose={() => { if (!busy) setPasswordTarget(null); }}><form className="legacy-user-form" onSubmit={changePassword}><label className="legacy-form-row"><span>Clave:</span><input autoFocus type="password" disabled={busy} required minLength={MIN_ACCOUNT_PASSWORD_LENGTH} maxLength={INPUT_LIMITS.password} autoComplete="new-password" value={String(draft.password ?? "")} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} /></label><label className="legacy-form-row"><span>Confirmación:</span><input type="password" disabled={busy} required maxLength={INPUT_LIMITS.password} autoComplete="new-password" value={String(draft.confirmation ?? "")} onChange={(event) => setDraft((current) => ({ ...current, confirmation: event.target.value }))} /></label><small>Mínimo {MIN_ACCOUNT_PASSWORD_LENGTH} caracteres.</small>{formError && <p role="alert">{formError}</p>}<div className="legacy-dialog-actions centered"><button type="submit" disabled={busy}>{busy ? "Guardando…" : "oK"}</button><button type="button" disabled={busy} onClick={() => setPasswordTarget(null)}>Cancelar</button></div></form></LegacyDialog>}
    {relation === "permissions" && relationRow && <ConnectedUserPermissionsDialog key={relationRow.id} userId={relationRow.id} userName={text(relationRow, "name") || text(relationRow, "email") || relationRow.id} role={text(relationRow, "role")} onClose={() => setRelation(null)} />}
    {(relation === "zones" || relation === "limits" || relation === "routes") && relationRow && <CollectorAssignmentsDialog key={`${relationRow.id}:${relation}`} collectorId={relationRow.id} collectorName={text(relationRow, "name")} kind={relation} initial={assignmentInitial} loadOptions={loadAssignmentOptions} onSave={saveAssignments} onClose={() => setRelation(null)} onModifyOperationalLimits={relation === "limits" ? () => { if (!busy && !loading) { setMessage(""); setLimitsTarget(relationRow); setRelation(null); } } : undefined} />}
    {(relation === "clients" || relation === "balances") && relationRow && <LegacyDialog title={relationTitles[relation]} className="catalog-relation-dialog" onClose={() => setRelation(null)}><div className="legacy-relation-manager">{relationContent()}<div className="legacy-relation-footer"><span>{text(relationRow, "name")}</span><button type="button" onClick={() => setRelation(null)}>Cerrar</button></div></div></LegacyDialog>}
    {clientPicker && <LegacyDialog title="Buscar Cliente..." className="catalog-client-picker" onClose={() => setClientPicker(null)}><div className="legacy-dialog-form"><label>Buscar:<input autoFocus value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} /></label><div className="legacy-mdi-table-wrap"><table className="legacy-mdi-table"><thead><tr><th>Código</th><th>Cliente</th><th>Identificación</th></tr></thead><tbody>{clientOptions.map((client) => <tr key={client.id} className={pickedClientId === client.id ? "selected-row" : ""} tabIndex={0} aria-selected={pickedClientId === client.id} onClick={() => setPickedClientId(client.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPickedClientId(client.id); } }}><td>{client.code}</td><td>{client.name}</td><td>{client.identification}</td></tr>)}</tbody></table></div><div className="legacy-dialog-actions centered"><button type="button" disabled={!pickedClientId} onClick={pickClient}>oK</button><button type="button" onClick={() => setClientPicker(null)}>Cancelar</button></div></div></LegacyDialog>}
  </section>;
}

type CollectorLimitsDraft = { collectionLimit: string; payoutLimit: string; previousCollectionLimit: number; previousPayoutLimit: number };
function CollectorLimitsDialog({ actorId, collector, onClose, onSaved }: { actorId: string; collector: RecordRow; onClose: () => void; onSaved: (collector: RecordRow) => Promise<void> }) {
  const scope = `collector-limits:${collector.id}`;
  const request = useMovementRequest(actorId, scope);
  const [draft, setDraft] = useState<CollectorLimitsDraft>(() => pendingMovementDraft<CollectorLimitsDraft>(actorId, scope) ?? { collectionLimit: moneyString(collector.collectionLimit), payoutLimit: moneyString(collector.payoutLimit), previousCollectionLimit: Number(collector.collectionLimit ?? 0), previousPayoutLimit: Number(collector.payoutLimit ?? 0) });
  const [reviewing, setReviewing] = useState(() => Boolean(pendingMovementDraft(actorId, scope)));
  const [formError, setFormError] = useState("");
  const close = () => { if (!request.locked) { request.clear(); onClose(); } };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (request.busy) return;
    setFormError("");
    try {
      const submitted = pendingMovementDraft<CollectorLimitsDraft>(actorId, scope) ?? draft;
      validateText(submitted.collectionLimit, "Límite de cobro", 11, { required: true });
      validateText(submitted.payoutLimit, "Límite de pago", 11, { required: true });
      const payload = { collectionLimit: decimalCents(submitted.collectionLimit), payoutLimit: decimalCents(submitted.payoutLimit) };
      if (payload.collectionLimit > 1_000_000_000 || payload.payoutLimit > 1_000_000_000) throw new Error("Cada límite debe ser positivo y no superar DOP 10,000,000.00.");
      if (!reviewing) { setReviewing(true); return; }
      const saved = await request.run<RecordRow>(`/cobradores/${encodeURIComponent(collector.id)}/limites`, payload, submitted, (result) => result?.id === collector.id && result.collectionLimit === payload.collectionLimit && result.payoutLimit === payload.payoutLimit);
      await onSaved(saved);
    } catch (failure) { setFormError(failure instanceof Error ? failure.message : "No se pudieron guardar los límites."); }
  };
  const previewLimit = (value: string) => { try { return formatMoney(decimalCents(value), "DOP"); } catch { return "Importe no válido"; } };
  return <LegacyDialog title={reviewing ? "Confirmar límites del cobrador..." : "Modificar límites del cobrador..."} className="collector-form-dialog catalog-legacy-dialog" onClose={close}>
    <form className="legacy-dialog-form" onSubmit={submit}>
      <p>Cobrador: <strong>{String(collector.name ?? "")}</strong> · Código: {String(collector.ident ?? collector.id)}</p>
      <p className="catalog-scope-note">Este formulario solo modifica los límites. Nombre, contacto, cuenta, actividad y ruta se conservan.</p>
      {reviewing ? <><LegacyDenseTable columns={["Límite", "Antes", "Después"]} rows={[["Cobro", formatMoney(draft.previousCollectionLimit, "DOP"), previewLimit(draft.collectionLimit)], ["Pago", formatMoney(draft.previousPayoutLimit, "DOP"), previewLimit(draft.payoutLimit)]]} /><p>Confirma estos cambios para el cobrador indicado.</p></> : <fieldset disabled={request.locked} className="legacy-config-fieldset"><legend>Límites en DOP</legend>
        <label>Cobro:<input autoFocus required aria-label="Límite de cobro (DOP)" inputMode="decimal" maxLength={11} value={draft.collectionLimit} onChange={(event) => { const next = event.target.value; if (isDecimalDraft(next, { wholeDigits: 8 }) || next.length < draft.collectionLimit.length) setDraft((current) => ({ ...current, collectionLimit: next })); }} /></label>
        <label>Pago:<input required aria-label="Límite de pago (DOP)" inputMode="decimal" maxLength={11} value={draft.payoutLimit} onChange={(event) => { const next = event.target.value; if (isDecimalDraft(next, { wholeDigits: 8 }) || next.length < draft.payoutLimit.length) setDraft((current) => ({ ...current, payoutLimit: next })); }} /></label>
      </fieldset>}
      {(request.error || formError) && <p role="alert">{request.error || formError}</p>}
      {request.uncertain && <p role="status">El resultado está pendiente de confirmación. Reintenta los mismos límites antes de cambiar los datos o cerrar.</p>}
      <div className="legacy-dialog-actions centered"><button type="submit" disabled={request.busy}>{request.busy ? "Guardando…" : request.uncertain ? "Reintentar mismos límites" : reviewing ? "Confirmar límites" : "Revisar límites"}</button>{reviewing && <button type="button" disabled={request.locked} onClick={() => setReviewing(false)}>Volver</button>}<button type="button" disabled={request.locked} onClick={close}>Cancelar</button></div>
    </form>
  </LegacyDialog>;
}
