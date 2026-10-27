import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { closeAfterAsking } from "../keyboard";
// Shared code cannot import the icon package of each app (it is not resolvable from app/shared): small inline icons.
const Icon = ({ size = 16, children }: { size?: number; children: ReactNode }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
const Minus = ({ size }: { size?: number }) => <Icon size={size}><path d="M5 12h14" /></Icon>;
const X = ({ size }: { size?: number }) => <Icon size={size}><path d="M18 6 6 18M6 6l12 12" /></Icon>;
const Maximize2 = ({ size }: { size?: number }) => <Icon size={size}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></Icon>;
const Minimize2 = ({ size }: { size?: number }) => <Icon size={size}><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></Icon>;
const ReceiptText = ({ size }: { size?: number }) => <Icon size={size}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M14 8H8M16 12H8M13 16H8" /></Icon>;

type Area = { width: number; height: number };
let fallbackZ = 200;
// The minimized receipts of every window of the desktop wait stacked in one tray, so none covers another.
const trayOf = (parent: HTMLElement) => parent.querySelector<HTMLElement>(":scope > .remittance-window-tray") ??
  parent.appendChild(Object.assign(document.createElement("div"), { className: "remittance-window-tray" }));

// returnFocus: cleared by the window that closes the receipt to go to another window, which takes the keyboard.
// revealVersion: raised when the reference of this receipt is chosen again; a minimized or covered receipt comes back on top.
/** Modeless receipt viewer. Financial confirmations still use native modal dialogs. */
export function RemittanceWindow({ title, children, onClose, desktopId, nextZIndex, returnFocus, revealVersion = 0 }: {
  title: string; children: ReactNode; onClose: () => void;
  desktopId?: string; nextZIndex?: () => number;
  returnFocus?: { readonly current: boolean }; revealVersion?: number;
}) {
  const host = desktopId ? document.getElementById(desktopId) : null;
  const measure = (): Area => ({ width: host?.clientWidth ?? window.innerWidth, height: host?.clientHeight ?? window.innerHeight });
  const [area, setArea] = useState(measure);
  const [position, setPosition] = useState(() => ({ x: Math.max(8, (measure().width - 820) / 2), y: 24 }));
  const [maximized, setMaximized] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [zIndex, setZIndex] = useState(() => ++fallbackZ);
  const [tray, setTray] = useState<HTMLElement | null>(null);
  const frame = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const focusBack = useRef(returnFocus);
  focusBack.current = returnFocus;
  const revealed = useRef(revealVersion);
  const drag = useRef<{ pointer: number; x: number; y: number; left: number; top: number } | null>(null);
  const raise = () => setZIndex(nextZIndex?.() ?? ++fallbackZ);
  useEffect(() => {
    const node = frame.current;
    opener.current = document.activeElement;
    raise();
    node?.focus();
    // Closing with ×, Escape or «Cerrar» gives the keyboard back to what opened the receipt while it is still on the
    // page, as the modal detail did. A focus already taken elsewhere stays there, and going to another window leaves it there.
    return () => {
      const target = opener.current, active = document.activeElement;
      if (focusBack.current?.current === false || !(target instanceof HTMLElement) || !target.isConnected) return;
      if (!active || active === document.body || node?.contains(active)) target.focus();
    };
  }, []);
  useEffect(() => {
    setTray(trayOf(host ?? document.body));
    const update = () => setArea(measure());
    const observer = host ? new ResizeObserver(update) : null;
    if (host) observer?.observe(host);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [host]);
  const width = Math.min(820, area.width - 16), height = Math.min(660, area.height - 32);
  const left = Math.max(8, Math.min(position.x, area.width - width - 8));
  const top = Math.max(8, Math.min(position.y, area.height - height - 8));
  // The receipt takes the keyboard once it is drawn again (a hidden window cannot be focused).
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => { if (focusRequest) frame.current?.focus(); }, [focusRequest]);
  const restore = () => { setMinimized(false); raise(); setFocusRequest((value) => value + 1); };
  useEffect(() => {
    if (revealVersion === revealed.current) return;
    revealed.current = revealVersion;
    // The reference chosen again is what the keyboard goes back to when the receipt closes.
    const active = document.activeElement;
    if (active && active !== document.body && !frame.current?.contains(active)) opener.current = active;
    restore();
  }, [revealVersion]);
  return createPortal(<>
    <section ref={frame} role="dialog" aria-label={title} aria-modal="false" tabIndex={-1}
      className="remittances-dialog remittance-receipt-window" onPointerDownCapture={raise}
      onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); void closeAfterAsking(frame.current, onClose); } }}
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
        <ReceiptText size={16} /><h2>{title}</h2>
        <div className="remittance-window-controls">
          <button type="button" title={`Minimizar ${title}`} aria-label={`Minimizar ${title}`} onClick={() => setMinimized(true)}><Minus size={14} /></button>
          <button type="button" title={`${maximized ? "Restaurar tamaño de" : "Maximizar"} ${title}`} aria-label={`${maximized ? "Restaurar tamaño de" : "Maximizar"} ${title}`} onClick={() => setMaximized((value) => !value)}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
          <button type="button" title={`Cerrar ${title}`} aria-label={`Cerrar ${title}`} onClick={onClose}><X size={15} /></button>
        </div>
      </header>
      <div className="remittances-dialog-body remittance-receipt-body">{children}</div>
    </section>
    {minimized && tray && createPortal(<button className="remittance-window-restore" type="button" onClick={restore} title={`Restaurar ${title}`} aria-label={`Restaurar ${title}`}><ReceiptText size={16} />{title}</button>, tray)}
  </>, host ?? document.body);
}
