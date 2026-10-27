import { useId } from "react";

// Dionel's icons for the panels of a listing window (sent 26-10-2026): a window with its blue title bar and a
// yellow panel on the left (filters) or on the right (details). Drawn here as SVG so they stay sharp at any size;
// the originals are 32×32 bitmaps on the magenta that the old program used as transparent.
type PanelSide = "left" | "right";

function ListingPanelIcon({ side, size = 16, name }: Readonly<{ side: PanelSide; size?: number; name: string }>) {
  const id = useId().replace(/:/g, "");
  const panelX = side === "left" ? 3 : 22;
  const dividerX = side === "left" ? 10.5 : 21.5;
  return (
    <svg className={`cyp-panel-icon cyp-panel-icon-${name}`} data-icon={name} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f7fb" />
          <stop offset="1" stopColor="#c6d6e3" />
        </linearGradient>
        <linearGradient id={`${id}-panel`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6d77c" />
          <stop offset="1" stopColor="#e8ac2e" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="4.5" width="27" height="23" rx="2" fill={`url(#${id}-body)`} stroke="#4c4f7d" strokeWidth="1" />
      <rect x="3" y="5" width="26" height="4" rx="1" fill="#5f86d1" />
      <rect x="3" y="5" width="26" height="1.2" fill="#9db6ec" />
      <rect x={panelX} y="9" width="7" height="18" fill={`url(#${id}-panel)`} />
      {[11, 15, 19].map((y) => <rect key={y} x={panelX + 0.8} y={y} width="5.4" height="2" rx="0.5" fill="#fcecb8" stroke="#d9a73c" strokeWidth="0.5" />)}
      <line x1={dividerX} y1="9" x2={dividerX} y2="27" stroke="#9aa6b5" strokeWidth="1" />
    </svg>
  );
}

/** «Mostrar/Ocultar filtros» of a listing window. */
export function FiltersPanelIcon({ size }: Readonly<{ size?: number }>) {
  return <ListingPanelIcon side="left" size={size} name="panel-filtros" />;
}

/** «Mostrar/Ocultar detalles» of a listing window. */
export function DetailsPanelIcon({ size }: Readonly<{ size?: number }>) {
  return <ListingPanelIcon side="right" size={size} name="panel-detalles" />;
}
