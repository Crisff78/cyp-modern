import { useEffect, useState } from "react";
import type { StrictApi } from "./strictApi";
import type { RemittanceContact, RemittanceSnapshot } from "./types";
import type { ClientSide } from "./suggestions";

type ContactState = { path: string; api: StrictApi; snapshot: RemittanceSnapshot | null; contact?: RemittanceContact; error?: string };

export function useClientContact(api: StrictApi, clientId: string, side: ClientSide, senderId: string, snapshot: RemittanceSnapshot | null) {
  const params = new URLSearchParams({ side, ...(side === "recipient" && senderId ? { senderId } : {}) });
  const path = clientId ? `/envios/clientes/${encodeURIComponent(clientId)}/contacto?${params}` : "";
  const [state, setState] = useState<ContactState | null>(null);
  useEffect(() => {
    let retired = false;
    setState(null);
    if (!path) return;
    void api<RemittanceContact>(path).then((contact) => {
      if (!contact || contact.id !== clientId || [contact.code, contact.name, contact.phone, contact.cellular, contact.address].some((field) => typeof field !== "string"))
        throw new Error("No pudimos comprobar los datos de contacto de este cliente.");
      if (!retired) setState({ path, api, snapshot, contact });
    }).catch((failure) => {
      if (!retired) setState({ path, api, snapshot, error: failure instanceof Error ? failure.message : "No pudimos cargar los datos de contacto." });
    });
    return () => { retired = true; };
  }, [api, path, clientId, snapshot]);
  // A new selection or session hides the previous contact before its effect runs.
  const current = state?.path === path && state.api === api && state.snapshot === snapshot ? state : null;
  return { contact: current?.contact, error: current?.error, loading: Boolean(path && !current) };
}
