import { useEffect, useRef, useState, type ReactNode } from "react";

export function RemittanceDialog({ title, children, onClose, locked = false }: { title: string; children: ReactNode; onClose: () => void; locked?: boolean }) {
  const element = useRef<HTMLDialogElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<null | { x: number; y: number; left: number; top: number }>(null);
  useEffect(() => { element.current?.showModal(); return () => element.current?.close(); }, []);
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
  return <dialog ref={element} className="remittances-dialog" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} aria-label={title} onCancel={(event) => { event.preventDefault(); if (!locked) onClose(); }}>
    <header style={{ cursor: "move" }} onMouseDown={(event) => {
      if (event.button !== 0 || (event.target as Element).closest("button")) return;
      event.preventDefault(); setDrag({ x: event.clientX, y: event.clientY, left: offset.x, top: offset.y });
    }}><h2>{title}</h2><button type="button" disabled={locked} onClick={onClose} aria-label={`Cerrar ${title}`} title={`Cerrar ${title}`}>×</button></header>
    <div className="remittances-dialog-body">{children}</div>
  </dialog>;
}
