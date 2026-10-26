import { MoneyInput } from "../../shared/MoneyInput";
import { remittancesApi } from "./remittancesApi";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { LegacyDialog, handleKeyboardActivation } from "./LegacyConnectedUi";
import { parseLimit, type AssignmentKind, type CollectorAssignment } from "./collectorAssignmentsState";
import { isDecimalDraft } from "../../shared/inputRules";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";
import "./collector-assignments.css";

const titles: Record<AssignmentKind, string> = {
  zones: "Zonas del Cobrador...", limits: "Límites del Cobrador...", routes: "Rutas del Cobrador...",
};
const confirmations: Record<AssignmentKind, string> = {
  zones: "¿Está seguro que desea eliminar la Zona actual del Cobrador?",
  limits: "¿Está seguro que desea borrar los límites actuales?",
  routes: "¿Está seguro que desea eliminar la Rut actual del Cobrador?",
};
const currencies = [
  { id: "", name: "No Definida" }, { id: "DOP", name: "Peso Dominicano" },
  { id: "USD", name: "Dólar Americano" }, { id: "EUR", name: "Euro" },
] as const;
const amountText = (amount: number) => (amount / 100).toFixed(2);
const displayAmount = (amount: number) => new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount / 100);
const pageSize = 10;

function AssignmentGrid({ rows, kind, selectedId, onSelect }: Readonly<{
  rows: readonly CollectorAssignment[]; kind: AssignmentKind; selectedId: string;
  onSelect: (id: string) => void;
}>) {
  const columns = kind === "limits" ? ["Indicador", "Moneda", "Abrev.", "Lím. de Cobro", "Lím. de Pago"] : ["Indicador", "Nro", kind === "zones" ? "Zona" : "Ruta", "Desde", "Hasta"];
  return <table className="legacy-mdi-table collector-assignment-table">
    <thead><tr>{columns.map((column) => <th key={column}>{column === "Indicador" ? <span aria-label="Indicador de fila">▸</span> : column}</th>)}</tr></thead>
    <tbody>{rows.map((row) => {
      let cells: readonly ReactNode[] = [row.number, row.name, row.from, row.to];
      if (kind === "limits") cells = [row.name, row.id, displayAmount(row.collectionLimit ?? 0), displayAmount(row.payoutLimit ?? 0)];
      return <tr key={row.id} tabIndex={0} aria-selected={row.id === selectedId} className={row.id === selectedId ? "selected-row" : ""} onClick={() => onSelect(row.id)} onKeyDown={(event) => handleKeyboardActivation(event, () => onSelect(row.id))}>
        <td className="collector-assignment-indicator">{row.id === selectedId ? "▸" : ""}</td>
        {cells.map((value, index) => <td key={columns[index + 1]}>{value}</td>)}
      </tr>;
    })}{rows.length === 0 && <tr><td colSpan={5}>No hay registros.</td></tr>}</tbody>
  </table>;
}

function AreaPicker({ kind, options, assigned, onSelect, onClose }: Readonly<{
  kind: "zones" | "routes"; options: readonly CollectorAssignment[];
  assigned: readonly CollectorAssignment[]; onSelect: (row: CollectorAssignment) => void; onClose: () => void;
}>) {
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const selected = options.find((row) => row.id === selectedId);
  const submit = () => {
    if (!selected) return;
    if (assigned.some((row) => row.id === selected.id)) { setMessage("Este registro ya está asignado al cobrador."); return; }
    onSelect(selected);
  };
  return <LegacyDialog title="Seleccionar..." className="collector-assignment-picker" onClose={onClose}>
    <div className="collector-assignment-picker-content">
      <span>Seleccione:</span>
      <div className="legacy-mdi-table-wrap"><AssignmentGrid kind={kind} rows={options} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setMessage(""); }} /></div>
      {message && <p role="alert" className="collector-assignment-error">{message}</p>}
      <div className="legacy-dialog-actions centered"><button type="button" disabled={!selected} onClick={submit}>Aceptar</button><button type="button" onClick={onClose}>Cancelar</button></div>
    </div>
  </LegacyDialog>;
}

function LimitPicker({ rows, onSelect, onClose }: Readonly<{
  rows: readonly CollectorAssignment[]; onSelect: (row: CollectorAssignment) => void; onClose: () => void;
}>) {
  const [currency, setCurrency] = useState("");
  const [collectionLimit, setCollectionLimit] = useState("0.00");
  const [payoutLimit, setPayoutLimit] = useState("0.00");
  const [error, setError] = useState("");
  const changeCurrency = (id: string) => {
    setCurrency(id); setError("");
    const existing = rows.find((row) => row.id === id);
    setCollectionLimit(amountText(existing?.collectionLimit ?? 0));
    setPayoutLimit(amountText(existing?.payoutLimit ?? 0));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const selected = currencies.find((item) => item.id === currency);
    if (!selected?.id) { setError("Seleccione una moneda válida."); return; }
    try {
      onSelect({ id: selected.id, number: selected.id, name: selected.name, from: "", to: "", collectionLimit: parseLimit(collectionLimit), payoutLimit: parseLimit(payoutLimit) });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Revisa los límites."); }
  };
  return <LegacyDialog title="Seleccionar..." className="collector-assignment-limit-picker" onClose={onClose}>
    <form className="collector-assignment-limit-form" onSubmit={submit}>
      <label>Moneda:<select aria-label="Moneda:" autoFocus value={currency} onChange={(event) => changeCurrency(event.target.value)}>{currencies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Lím. de Cobro:<MoneyInput value={collectionLimit} onValueChange={(nextValue) => { const next = nextValue; if (isDecimalDraft(next) || next.length < collectionLimit.length) setCollectionLimit(next); }} /></label>
      <label>Lím. de Pago:<MoneyInput value={payoutLimit} onValueChange={(nextValue) => { const next = nextValue; if (isDecimalDraft(next) || next.length < payoutLimit.length) setPayoutLimit(next); }} /></label>
      {rows.some((row) => row.id === currency) && <small>Los valores reemplazarán los límites de esta moneda al aceptar.</small>}
      {error && <p role="alert" className="collector-assignment-error">{error}</p>}
      <div className="legacy-dialog-actions centered"><button type="submit">Aceptar</button><button type="button" onClick={onClose}>Cancelar</button></div>
    </form>
  </LegacyDialog>;
}

type AssignmentDraft = { rows: CollectorAssignment[]; revision: string; savedRows: string };
type AssignmentResult = { rows: CollectorAssignment[]; revision: string };

export function CollectorAssignmentsDialog({ actorId, collectorId, collectorName, kind, initial, loadOptions, onSave, onClose, canManage = false }: Readonly<{
  actorId: string; collectorId: string; collectorName: string; kind: AssignmentKind;
  initial: readonly CollectorAssignment[]; loadOptions: () => Promise<readonly CollectorAssignment[]>;
  onSave: (rows: readonly CollectorAssignment[]) => void | Promise<void>; onClose: () => void;
  canManage?: boolean;
}>) {
  const scope = `collector-assignments:${collectorId}:${kind}`;
  const request = useMovementRequest(actorId, scope);
  const pending = () => pendingMovementDraft<AssignmentDraft>(actorId, scope);
  const [rows, setRows] = useState(() => pending()?.rows ?? [...initial]);
  const [revision, setRevision] = useState(() => pending()?.revision ?? "");
  const [savedRows, setSavedRows] = useState(() => pending()?.savedRows ?? JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const [saveConfirm, setSaveConfirm] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const path = `/cobradores/${encodeURIComponent(collectorId)}/${({zones:"zonas",routes:"rutas",limits:"limites/monedas"} as const)[kind]}`;
  const dirty = JSON.stringify(rows) !== savedRows;
  const close = () => { if (saving || !request.closable) return; if (request.denied) { onClose(); return; } if (dirty) setDiscardConfirm(true); else { request.clear(); onClose(); } };
  const loadAssigned = useCallback(async () => {
    if (pendingMovementDraft(actorId, scope)) return;
    setLoadingAssigned(true); setError("");
    try {
      const value = await remittancesApi<{ rows: CollectorAssignment[]; revision: string }>(path);
      if (!mounted.current) return;
      setRows(value.rows); setRevision(value.revision); setSavedRows(JSON.stringify(value.rows));
      setSelectedId(""); setPage(1);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "No se pudieron cargar las asignaciones."); }
    finally { if (mounted.current) setLoadingAssigned(false); }
  }, [path, actorId, scope]);
  const [options, setOptions] = useState<readonly CollectorAssignment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [page, setPage] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [loadingAssigned, setLoadingAssigned] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const loading = loadingAssigned || loadingOptions;
  const mounted = useRef(true);
  const requestNumber = useRef(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const fetchOptions = useCallback(async () => {
    if (kind === "limits") return;
    const request = ++requestNumber.current;
    setLoadingOptions(true); setError("");
    try {
      const loaded = await loadOptions();
      if (mounted.current && request === requestNumber.current) {
        setOptions(loaded);
        setRows((current) => current.map((row) => loaded.find((option) => option.id === row.id) ?? row));
      }
    } catch (failure) {
      if (mounted.current && request === requestNumber.current) setError(failure instanceof Error ? failure.message : "No se pudo cargar el catálogo.");
    } finally { if (mounted.current && request === requestNumber.current) setLoadingOptions(false); }
  }, [kind, loadOptions]);
  useEffect(() => { mounted.current = true; void loadAssigned(); void fetchOptions(); return () => { mounted.current = false; ++requestNumber.current; }; }, [fetchOptions, loadAssigned]);
  const add = (row: CollectorAssignment) => {
    let updated = [...rows, row];
    if (rows.some((item) => item.id === row.id)) updated = rows.map((item) => item.id === row.id ? row : item);
    setRows(updated); setSelectedId(row.id);
    setPage(Math.floor(updated.findIndex((item) => item.id === row.id) / pageSize) + 1);
    setPickerOpen(false);
  };
  const save = async () => {
    if (!canManage || !revision || saving || request.busy) return;
    setSaving(true); setError(""); setSaveConfirm(false);
    const submitted = rows.map(({id,collectionLimit,payoutLimit}) => kind === "limits" ? {id,collectionLimit,payoutLimit} : {id});
    try {
      const result = await request.run<AssignmentResult>(path, { rows: submitted, revision, confirmReassignment: true }, { rows, revision, savedRows }, (value) => Array.isArray(value?.rows) && typeof value?.revision === "string");
      setRows(result.rows); setRevision(result.revision); setSavedRows(JSON.stringify(result.rows));
      await onSave(result.rows); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudieron guardar las asignaciones."); }
    finally { setSaving(false); }
  };
  const refresh = () => { if (request.locked || saving) return; if (dirty) { setDiscardConfirm(true); return; } void loadAssigned(); void fetchOptions(); };
  const goToPage = (value: number) => { setPage(Math.min(pageCount, Math.max(1, value))); setSelectedId(""); };
  return <LegacyDialog title={titles[kind]} className="collector-assignments-dialog" onClose={close}>
    <div className="collector-assignment-content">
      <div className="legacy-relation-toolbar collector-assignment-toolbar"><button type="button" disabled={!canManage || !revision || saving || request.locked || loading || (kind !== "limits" && Boolean(error))} onClick={() => setPickerOpen(true)}>Agregar</button><button type="button" disabled={!canManage || saving || request.locked || !selectedId} onClick={() => setConfirmOpen(true)}>Eliminar</button></div>
      <div className="legacy-mdi-table-wrap"><AssignmentGrid kind={kind} rows={visibleRows} selectedId={selectedId} onSelect={setSelectedId} /></div>
      <div className="legacy-mdi-pager collector-assignment-pager">
        <button type="button" aria-label="Primera página" disabled={currentPage === 1} onClick={() => goToPage(1)}>|&lt;</button><button type="button" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)}>&lt;</button>
        <label>Página <input aria-label="Página" type="number" min={1} max={pageCount} value={currentPage} onChange={(event) => goToPage(Number(event.target.value) || 1)} /> de {pageCount}</label>
        <button type="button" aria-label="Página siguiente" disabled={currentPage === pageCount} onClick={() => goToPage(currentPage + 1)}>&gt;</button><button type="button" aria-label="Última página" disabled={currentPage === pageCount} onClick={() => goToPage(pageCount)}>&gt;|</button>
        <button type="button" onClick={refresh} disabled={loading || saving || request.locked}><RefreshCw size={13} className={loading ? "animate-spin" : ""} />Refrescar</button>
      </div>
      {(request.error || error) && <p className="collector-assignment-error" role="alert">{request.error || error}</p>}
      {request.uncertain && <p role="status">El guardado está pendiente de confirmación. Reintenta las mismas asignaciones antes de cambiarlas o cerrar.</p>}
      <div className="collector-assignment-scope">{collectorName} · {kind === "limits" ? "Los límites se guardan y aplican en la moneda indicada, sin conversiones. Quitar una moneda bloquea nuevos importes en esa moneda." : "Asignaciones reales. Una zona incluye todas sus rutas activas. Quitar una asignación deja sus rutas sin cobrador y conserva los clientes y el historial."}</div>
      <div className="legacy-relation-footer"><button type="button" disabled={!canManage || !revision || saving || request.busy || loading} onClick={() => request.uncertain ? void save() : setSaveConfirm(true)}>{saving ? "Guardando…" : request.uncertain ? "Reintentar mismas asignaciones" : "Aceptar"}</button><button type="button" disabled={saving || !request.closable} onClick={close}>Cancelar</button></div>
    </div>
    {saveConfirm && <LegacyDialog title="Confirmar asignaciones" onClose={() => setSaveConfirm(false)}><p>¿Guardar los cambios de {collectorName}? {kind !== "limits" && "Las rutas seleccionadas pasarán a este cobrador, incluso si antes pertenecían a otro. Revisa la lista antes de continuar."}</p><div className="legacy-dialog-actions"><button type="button" onClick={() => void save()}>Sí, guardar</button><button type="button" onClick={() => setSaveConfirm(false)}>No</button></div></LegacyDialog>}
    {discardConfirm && <LegacyDialog title="Descartar cambios" onClose={() => setDiscardConfirm(false)}><p>Hay cambios sin guardar. ¿Deseas descartarlos y cerrar?</p><div className="legacy-dialog-actions"><button type="button" onClick={onClose}>Sí, descartar</button><button type="button" onClick={() => setDiscardConfirm(false)}>Seguir revisando</button></div></LegacyDialog>}
    {pickerOpen && kind !== "limits" && <AreaPicker kind={kind} options={options} assigned={rows} onSelect={add} onClose={() => setPickerOpen(false)} />}
    {pickerOpen && kind === "limits" && <LimitPicker rows={rows} onSelect={add} onClose={() => setPickerOpen(false)} />}
    {confirmOpen && <LegacyDialog title="Confirm" className="legacy-confirm-dialog" onClose={() => setConfirmOpen(false)}><div className="legacy-confirm-content"><span className="legacy-question-icon">?</span><p>{confirmations[kind]}</p></div><div className="legacy-dialog-actions centered"><button type="button" onClick={() => { setRows((current) => current.filter((row) => row.id !== selectedId)); setSelectedId(""); setConfirmOpen(false); }}>Sí</button><button type="button" onClick={() => setConfirmOpen(false)}>No</button></div></LegacyDialog>}
  </LegacyDialog>;
}
