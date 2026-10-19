import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, Minus, ReceiptText, X } from "lucide-react";

type Area = { width: number; height: number };
let fallbackZ = 200;

/** Modeless receipt viewer. Financial confirmations still use native modal dialogs. */
export function RemittanceWindow({ title, children, onClose, desktopId, nextZIndex }: {
  title: string; children: ReactNode; onClose: () => void;
  desktopId?: string; nextZIndex?: () => number;
}) {
  const host = desktopId ? document.getElementById(desktopId) : null;
  const measure = (): Area => ({ width: host?.clientWidth ?? window.innerWidth, height: host?.clientHeight ?? window.innerHeight });
  const [area, setArea] = useState(measure);
  const [position, setPosition] = useState(() => ({ x: Math.max(8, (measure().width - 820) / 2), y: 24 }));
  const [maximized, setMaximized] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [zIndex, setZIndex] = useState(() => ++fallbackZ);
  const frame = useRef<HTMLElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; left: number; top: number } | null>(null);
  const raise = () => setZIndex(nextZIndex?.() ?? ++fallbackZ);
  useEffect(() => {
    raise();
    frame.current?.focus();
    const update = () => setArea(measure());
    const observer = host ? new ResizeObserver(update) : null;
    if (host) observer?.observe(host);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [host]);
  const width = Math.min(820, area.width - 16), height = Math.min(660, area.height - 32);
  const left = Math.max(8, Math.min(position.x, area.width - width - 8));
  const top = Math.max(8, Math.min(position.y, area.height - height - 8));
  const restore = () => { setMinimized(false); raise(); window.requestAnimationFrame(() => frame.current?.focus()); };
  return createPortal(<>
    <section ref={frame} role="dialog" aria-label={title} aria-modal="false" tabIndex={-1}
      className="remittances-dialog remittance-receipt-window" onPointerDownCapture={raise}
      onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); onClose(); } }}
      style={{ position: host ? "absolute" : "fixed", display: minimized ? "none" : "flex", left: maximized ? 8 : left, top: maximized ? 8 : top, width: maximized ? area.width - 16 : width, height: maximized ? area.height - 16 : height, zIndex }}>
      <header className="remittance-receipt-titlebar" onDoubleClick={(event) => { if (!(event.target as Element).closest("button")) setMaximized((value) => !value); }}
        onPointerDown={(event) => {
          if (event.button !== 0 || maximized || (event.target as Element).closest("button")) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left, top };
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.pointer !== event.pointerId || !event.buttons) return;
          setPosition({ x: Math.max(8, Math.min(active.left + event.clientX - active.x, area.width - width - 8)), y: Math.max(8, Math.min(active.top + event.clientY - active.y, area.height - height - 8)) });
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        <ReceiptText size={16} aria-hidden="true" /><h2>{title}</h2>
        <div className="remittance-window-controls">
          <button type="button" title={`Minimizar ${title}`} aria-label={`Minimizar ${title}`} onClick={() => setMinimized(true)}><Minus size={14} /></button>
          <button type="button" title={`${maximized ? "Restaurar tamaño de" : "Maximizar"} ${title}`} aria-label={`${maximized ? "Restaurar tamaño de" : "Maximizar"} ${title}`} onClick={() => setMaximized((value) => !value)}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
          <button type="button" title={`Cerrar ${title}`} aria-label={`Cerrar ${title}`} onClick={onClose}><X size={15} /></button>
        </div>
      </header>
      <div className="remittances-dialog-body remittance-receipt-body">{children}</div>
    </section>
    {minimized && <button className="remittance-window-restore" type="button" onClick={restore} title={`Restaurar ${title}`} aria-label={`Restaurar ${title}`}><ReceiptText size={16} />{title}</button>}
  </>, host ?? document.body);
}
