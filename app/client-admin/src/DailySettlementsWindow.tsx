import { useEffect, useState } from "react";
import RemittancesWorkspace, { type RemittanceCashOpening } from "../../shared/remittances/RemittancesWorkspace";
import { ConnectedSettlements } from "./ConnectedSettlements";
import { remittancesApi } from "./remittancesApi";
import type { Snapshot, User } from "./types";
import "./connected-report-layout.css";

export type DailySettlementSection = "collectors" | "remittanceCash";
// Last request to show a section that was already applied: reopening the window later keeps its own choice.
let appliedSectionRequest = 0;

// Cuadres Diarios: the settlements of collectors (401) and the box of Envíos de Dinero (its own
// permission) share the window. A section is mounted only while it is shown, so its dialogs stay visible.
export function DailySettlementsWindow({ snapshot, user, isAdmin, showCollectors, showRemittanceCash, canManage, onRefresh, sectionRequest }: Readonly<{
  snapshot: Snapshot; user: User; isAdmin: boolean; showCollectors: boolean; showRemittanceCash: boolean; canManage: boolean;
  onRefresh: () => void | boolean | Promise<void | boolean>;
  // opening: the box named by the notice that asked for Caja de remesas (operator and currency).
  sectionRequest?: { id: number; section: DailySettlementSection; opening?: RemittanceCashOpening };
}>) {
  const available: DailySettlementSection[] = [...(showCollectors ? ["collectors" as const] : []), ...(showRemittanceCash ? ["remittanceCash" as const] : [])];
  const requested = sectionRequest && sectionRequest.id > appliedSectionRequest && available.includes(sectionRequest.section) ? sectionRequest : undefined;
  const [section, setSection] = useState<DailySettlementSection | undefined>(requested?.section ?? available[0]);
  useEffect(() => {
    if (!requested) return;
    appliedSectionRequest = requested.id;
    setSection(requested.section);
  }, [requested?.id, requested?.section]);
  const shown = section && available.includes(section) ? section : available[0];
  return <div className="daily-settlements-window">
    {available.length > 1 && <div className="legacy-mdi-toolbar settlement-sections" role="group" aria-label="Secciones de Cuadres Diarios">
      <button type="button" aria-pressed={shown === "collectors"} onClick={() => setSection("collectors")}>Cuadres de cobradores</button>
      <button type="button" aria-pressed={shown === "remittanceCash"} onClick={() => setSection("remittanceCash")}>Caja de remesas</button>
    </div>}
    {shown === "collectors" && <ConnectedSettlements snapshot={snapshot} actorId={user.id} canManage={canManage} onRefresh={onRefresh} />}
    {shown === "remittanceCash" && <div className="settlement-remittance-cash">
      <RemittancesWorkspace api={remittancesApi} user={user} isAdmin={isAdmin} sections={["caja"]} heading="Caja de remesas"
        cashRequest={sectionRequest?.section === "remittanceCash" && sectionRequest.opening ? { id: sectionRequest.id, ...sectionRequest.opening } : undefined} />
    </div>}
    {!shown && <p className="connected-report-feedback" role="status">Tu cuenta no tiene permisos para Cuadres Diarios.</p>}
  </div>;
}
