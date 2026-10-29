import type { MouseEvent as ReactMouseEvent } from "react";

// «Mostrar/Ocultar filtros» with the funnel (Rardiel, 28-10-2026: the funnel again, in every window that has filters).
// One button for the portal and the collector terminal, so it looks and works the same everywhere. The funnel is the
// lucide «filter» icon drawn inline: the shared code does not depend on lucide-react.
export function FunnelIcon({ size = 15 }: Readonly<{ size?: number }>) {
  return (
    <svg className="lucide lucide-filter cyp-funnel" data-icon="embudo" xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

export function FiltersToggle({ visible, onClick, className = "nav-tool" }: Readonly<{ visible: boolean; onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void; className?: string }>) {
  return (
    <button type="button" className={visible ? `${className} active` : className} title="Mostrar/Ocultar filtros" aria-label="Mostrar/Ocultar filtros" aria-pressed={visible} onClick={onClick}>
      <FunnelIcon />
    </button>
  );
}
