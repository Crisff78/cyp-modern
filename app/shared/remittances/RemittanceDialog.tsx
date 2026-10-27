import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { closeAfterAsking, dialogKeys, focusFirstUseful, giveFocusBack } from "../keyboard";

export function RemittanceDialog({ title, children, onClose, locked = false }: { title: string; children: ReactNode; onClose: () => void; locked?: boolean }) {
  const element = useRef<HTMLDialogElement>(null);
  const tabsterId = useId();
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<null | { x: number; y: number; left: number; top: number }>(null);
  useEffect(() => {
    const dialog = element.current, opener = document.activeElement;
    dialog?.showModal();
    // React's autoFocus runs before the dialog opens; the field marked data-autofocus takes the focus once it is open.
    // Without one: its first field, else the main button of a question (Enter = Sí); never the × of its title.
    const asked = dialog?.querySelector<HTMLElement>("[data-autofocus]");
    if (asked) asked.focus(); else if (dialog) focusFirstUseful(dialog);
    // Closing gives the focus back to what opened the dialog while it is still on the page.
    return () => {
      dialog?.close();
      giveFocusBack(opener);
    };
  }, []);
  useEffect(() => {
    if (!drag) return;
    const move = (event: MouseEvent) => {
      const box = element.current?.getBoundingClientRect();
      if (!box) return;
      const x = event.clientX - drag.x, y = event.clientY - drag.y;
      setOffset({ x: offset.x + Math.max(8 - box.left, Math.min(x + drag.left - offset.x, window.innerWidth - 8 - box.right)),
        y: offset.y + Math.max(8 - box.top, Math.min(y + drag.top - offset.y, window.innerHeight - 8 - box.bottom)) });
    };
    const stop = () => setDrag(null);
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", stop);
    return () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", stop); };
  }, [drag, offset]);
  return <dialog ref={element} {...dialogKeys(tabsterId)} className="remittances-dialog" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} aria-label={title} onCancel={(event) => { event.preventDefault(); if (!locked) void closeAfterAsking(element.current, onClose); }}>
    <header style={{ cursor: "move" }} onMouseDown={(event) => {
      if (event.button !== 0 || (event.target as Element).closest("button")) return;
      event.preventDefault(); setDrag({ x: event.clientX, y: event.clientY, left: offset.x, top: offset.y });
    }}><h2>{title}</h2><button type="button" disabled={locked} onClick={onClose} aria-label={`Cerrar ${title}`} title={`Cerrar ${title}`}>×</button></header>
    <div className="remittances-dialog-body">{children}</div>
  </dialog>;
}
