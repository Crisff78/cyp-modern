import { isValidElement, useEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ClipboardCheck, KeyRound, Pencil, Plus, Printer, RefreshCw, Trash2, X } from "lucide-react";

// Original MDI presentation shared by the connected screens.
type LegacyToolbarAction = () => void;

const stopToolbarEvent = (event: ReactMouseEvent<HTMLElement>) => {
  event.stopPropagation();
};

const runToolbarAction = (action?: LegacyToolbarAction) => (event: ReactMouseEvent<HTMLButtonElement>) => {
  event.stopPropagation();
  action?.();
};

const reactNodeKey = (value: ReactNode): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean" || value == null) return "empty";
  if (Array.isArray(value)) return value.map(reactNodeKey).join("-");
  if (isValidElement(value)) {
    if (value.key !== null) return String(value.key);
    const props = value.props as { children?: ReactNode; id?: unknown; value?: unknown; className?: unknown };
    if (typeof props.id === "string" || typeof props.id === "number") return String(props.id);
    if (typeof props.value === "string" || typeof props.value === "number") return String(props.value);
    if (props.children !== undefined) return reactNodeKey(props.children);
    if (typeof value.type === "string") return value.type;
  }
  return "node";
};

export const handleKeyboardActivation = (event: ReactKeyboardEvent<HTMLElement>, action: () => void) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
};

export function LegacyToolbar({ onToggleFilters, filtersVisible = true, onFirst, onPrevious, onNext, onLast, onNew, onEdit, onAccept, onDelete, onRefresh, onPrint, disableNew = false, disableEdit = false, disableAccept = false, disableDelete = false, showEdit = true, deleteIcon = "trash", deleteTitle = "Eliminar", newTitle = "Nuevo", newIcon, extra }: Readonly<{ onToggleFilters?: () => void; filtersVisible?: boolean; onFirst?: () => void; onPrevious?: () => void; onNext?: () => void; onLast?: () => void; onNew?: () => void; onEdit?: () => void; onAccept?: () => void; onDelete?: () => void; onRefresh?: () => void; onPrint?: () => void; disableNew?: boolean; disableEdit?: boolean; disableAccept?: boolean; disableDelete?: boolean; showEdit?: boolean; deleteIcon?: "trash" | "x"; deleteTitle?: string; newTitle?: string; newIcon?: ReactNode; extra?: ReactNode }>) {
  return (
    <div className="legacy-mdi-toolbar" aria-label="Barra de herramientas legacy" onMouseDown={stopToolbarEvent} onClick={stopToolbarEvent}>
      {onToggleFilters && <button type="button" className={filtersVisible ? "nav-tool active" : "nav-tool"} title="Mostrar/Ocultar filtros" onClick={runToolbarAction(onToggleFilters)}><KeyRound size={15} /></button>}
      <button type="button" className="nav-tool" title="Primer registro" onClick={runToolbarAction(onFirst)}>|&lt;</button>
      <button type="button" className="nav-tool" title="Registro anterior" onClick={runToolbarAction(onPrevious)}>&lt;</button>
      <button type="button" className="nav-tool" title="Registro siguiente" onClick={runToolbarAction(onNext)}>&gt;</button>
      <button type="button" className="nav-tool" title="Último registro" onClick={runToolbarAction(onLast)}>&gt;|</button>
      <span className="mdi-toolbar-separator" />
      <button type="button" title={newTitle} disabled={disableNew} onClick={runToolbarAction(onNew)}>{newIcon ?? <Plus size={15} />}</button>
      {showEdit && <button type="button" title="Editar" disabled={disableEdit} onClick={runToolbarAction(onEdit)}><Pencil size={15} /></button>}
      {onAccept && <button type="button" title="Aceptar depósito" disabled={disableAccept} onClick={runToolbarAction(onAccept)}><ClipboardCheck size={15} /></button>}
      <button type="button" className="danger-tool" title={deleteTitle} disabled={disableDelete} onClick={runToolbarAction(onDelete)}>{deleteIcon === "x" ? <X size={15} /> : <Trash2 size={15} />}</button>
      <button type="button" title="Refrescar" onClick={runToolbarAction(onRefresh)}><RefreshCw size={15} /></button>
      {onPrint && <button type="button" title="Imprimir" onClick={runToolbarAction(onPrint)}><Printer size={15} /></button>}
      {extra && <span className="mdi-toolbar-extra">{extra}</span>}
    </div>
  );
}

export function LegacyCheck({ checked = true }: Readonly<{ checked?: boolean }>) { return <input type="checkbox" checked={checked} readOnly aria-label={checked ? "Activo" : "Inactivo"} />; }

export function LegacyDenseTable({ columns, rows }: Readonly<{ columns: readonly string[]; rows: readonly ReactNode[][] }>) {
  return (
    <div className="legacy-mdi-table-wrap">
      <table className="legacy-mdi-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowKey = row.map(reactNodeKey).join("|");
            return (
              <tr key={rowKey}>
                {row.map((cell, cellIndex) => (
                  <td key={`${columns[cellIndex] ?? "cell"}-${reactNodeKey(cell)}`}>{cell}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LegacyDialog({ title, onClose, children, className = "", overlayClassName = "" }: Readonly<{ title: string; onClose: () => void; children: ReactNode; className?: string; overlayClassName?: string }>) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<null | { startX: number; startY: number; x: number; y: number }>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const overlay = overlayRef.current;
    const dialog = overlay?.querySelector<HTMLElement>('[role="dialog"]');
    if (!overlay || !dialog) return;
    const isTopmost = () => {
      const overlays = document.querySelectorAll(".legacy-dialog-overlay");
      return overlays[overlays.length - 1] === overlay;
    };
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')).filter((element) => element.getClientRects().length > 0);
    const focusInside = () => {
      const field = dialog.querySelector<HTMLElement>('input:not(:disabled):not([readonly]),select:not(:disabled),textarea:not(:disabled)');
      (field ?? controls()[0] ?? dialog).focus();
    };
    if (!dialog.contains(document.activeElement)) focusInside();
    const containFocus = (event: FocusEvent) => {
      if (isTopmost() && event.target instanceof Node && !dialog.contains(event.target)) focusInside();
    };
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !isTopmost()) return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("focusin", containFocus);
    document.addEventListener("keydown", trapTab, true);
    return () => {
      document.removeEventListener("focusin", containFocus);
      document.removeEventListener("keydown", trapTab, true);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const overlays = document.querySelectorAll(".legacy-dialog-overlay");
      if (event.key === "Escape" && overlays[overlays.length - 1] === overlayRef.current) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  useEffect(() => {
    if (!drag) return;
    const onMouseMove = (event: MouseEvent) => setOffset({ x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY });
    const onMouseUp = () => setDrag(null);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp, { once: true });
    return () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
  }, [drag]);
  const startDialogDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button,input,select,textarea,a")) return;
    event.preventDefault();
    event.stopPropagation();
    setDrag({ startX: event.clientX, startY: event.clientY, x: offset.x, y: offset.y });
  };
  return createPortal(
    <div ref={overlayRef} className={`legacy-dialog-overlay ${overlayClassName}`} role="presentation">
      <section className={`legacy-dialog ${className}`} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="legacy-dialog-titlebar" onMouseDown={startDialogDrag}>
          <span>{title}</span>
          <button type="button" aria-label={`Cerrar ${title}`} onMouseDown={(event) => event.stopPropagation()} onClick={onClose} title={`Cerrar ${title}`}>X</button>
        </div>
        <div className="legacy-dialog-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
