import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { LegacyDialog, handleKeyboardActivation } from "./LegacyConnectedUi";
import { loadCollectorAssignments, parseLimit, saveCollectorAssignments, type AssignmentKind, type CollectorAssignment } from "./collectorAssignmentsState";
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
      <div className="legacy-dialog-actions centered"><button type="button" disabled={!selected} onClick={submit}>oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
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
      <label>Moneda:<select autoFocus value={currency} onChange={(event) => changeCurrency(event.target.value)}>{currencies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Lím. de Cobro:<input type="text" inputMode="decimal" value={collectionLimit} onChange={(event) => setCollectionLimit(event.target.value)} /></label>
      <label>Lím. de Pago:<input type="text" inputMode="decimal" value={payoutLimit} onChange={(event) => setPayoutLimit(event.target.value)} /></label>
      {rows.some((row) => row.id === currency) && <small>Los valores reemplazarán los límites de esta moneda al aceptar.</small>}
      {error && <p role="alert" className="collector-assignment-error">{error}</p>}
      <div className="legacy-dialog-actions centered"><button type="submit">oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
    </form>
  </LegacyDialog>;
}

export function CollectorAssignmentsDialog({ collectorId, collectorName, kind, initial, loadOptions, onSave, onClose, onModifyOperationalLimits }: Readonly<{
  collectorId: string; collectorName: string; kind: AssignmentKind;
  initial: readonly CollectorAssignment[]; loadOptions: () => Promise<readonly CollectorAssignment[]>;
  onSave: (rows: readonly CollectorAssignment[]) => void; onClose: () => void;
  onModifyOperationalLimits?: () => void;
}>) {
  const [rows, setRows] = useState(() => loadCollectorAssignments(collectorId, kind, initial));
  const [options, setOptions] = useState<readonly CollectorAssignment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [page, setPage] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  const requestNumber = useRef(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const fetchOptions = useCallback(async () => {
    if (kind === "limits") return;
    const request = ++requestNumber.current;
    setLoading(true); setError("");
    try {
      const loaded = await loadOptions();
      if (mounted.current && request === requestNumber.current) {
        setOptions(loaded);
        setRows((current) => current.map((row) => loaded.find((option) => option.id === row.id) ?? row));
      }
    } catch (failure) {
      if (mounted.current && request === requestNumber.current) setError(failure instanceof Error ? failure.message : "No se pudo cargar el catálogo.");
    } finally { if (mounted.current && request === requestNumber.current) setLoading(false); }
  }, [kind, loadOptions]);
  useEffect(() => { mounted.current = true; void fetchOptions(); return () => { mounted.current = false; ++requestNumber.current; }; }, [fetchOptions]);
  const add = (row: CollectorAssignment) => {
    let updated = [...rows, row];
    if (rows.some((item) => item.id === row.id)) updated = rows.map((item) => item.id === row.id ? row : item);
    setRows(updated); setSelectedId(row.id);
    setPage(Math.floor(updated.findIndex((item) => item.id === row.id) / pageSize) + 1);
    setPickerOpen(false);
  };
  const save = () => {
    try { saveCollectorAssignments(collectorId, kind, rows); onSave(rows); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudieron guardar las asignaciones."); }
  };
  const refresh = () => {
    setRows(loadCollectorAssignments(collectorId, kind, initial)); setSelectedId(""); setPage(1);
    void fetchOptions();
  };
  const goToPage = (value: number) => { setPage(Math.min(pageCount, Math.max(1, value))); setSelectedId(""); };
  return <LegacyDialog title={titles[kind]} className="collector-assignments-dialog" onClose={onClose}>
    <div className="collector-assignment-content">
      <div className="legacy-relation-toolbar collector-assignment-toolbar"><button type="button" disabled={loading || (kind !== "limits" && Boolean(error))} onClick={() => setPickerOpen(true)}>Agregar</button><button type="button" disabled={!selectedId} onClick={() => setConfirmOpen(true)}>Eliminar</button>{kind === "limits" && onModifyOperationalLimits && <button type="button" onClick={onModifyOperationalLimits} title="Abrir los límites persistidos. Los cambios de sesión pendientes no se guardan.">Modificar límites operativos DOP</button>}</div>
      <div className="legacy-mdi-table-wrap"><AssignmentGrid kind={kind} rows={visibleRows} selectedId={selectedId} onSelect={setSelectedId} /></div>
      <div className="legacy-mdi-pager collector-assignment-pager">
        <button type="button" aria-label="Primera página" disabled={currentPage === 1} onClick={() => goToPage(1)}>|&lt;</button><button type="button" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)}>&lt;</button>
        <label>Página <input aria-label="Página" type="number" min={1} max={pageCount} value={currentPage} onChange={(event) => goToPage(Number(event.target.value) || 1)} /> de {pageCount}</label>
        <button type="button" aria-label="Página siguiente" disabled={currentPage === pageCount} onClick={() => goToPage(currentPage + 1)}>&gt;</button><button type="button" aria-label="Última página" disabled={currentPage === pageCount} onClick={() => goToPage(pageCount)}>&gt;|</button>
        <button type="button" onClick={refresh} disabled={loading}><RefreshCw size={13} className={loading ? "animate-spin" : ""} />Refrescar</button>
      </div>
      {error && <p className="collector-assignment-error" role="alert">{error}</p>}
      <div className="collector-assignment-scope">{collectorName} · {kind === "limits" ? "Guardado de sesión: límites por moneda. No modifica los límites operativos DOP persistidos." : "Guardado de sesión. Las asignaciones operativas de la API se administran en los catálogos conectados."}</div>
      <div className="legacy-relation-footer"><button type="button" onClick={save}>oK</button><button type="button" onClick={onClose}>Cancelar</button></div>
    </div>
    {pickerOpen && kind !== "limits" && <AreaPicker kind={kind} options={options} assigned={rows} onSelect={add} onClose={() => setPickerOpen(false)} />}
    {pickerOpen && kind === "limits" && <LimitPicker rows={rows} onSelect={add} onClose={() => setPickerOpen(false)} />}
    {confirmOpen && <LegacyDialog title="Confirm" className="legacy-confirm-dialog" onClose={() => setConfirmOpen(false)}><div className="legacy-confirm-content"><span className="legacy-question-icon">?</span><p>{confirmations[kind]}</p></div><div className="legacy-dialog-actions centered"><button type="button" onClick={() => { setRows((current) => current.filter((row) => row.id !== selectedId)); setSelectedId(""); setConfirmOpen(false); }}>Sí</button><button type="button" onClick={() => setConfirmOpen(false)}>No</button></div></LegacyDialog>}
  </LegacyDialog>;
}
