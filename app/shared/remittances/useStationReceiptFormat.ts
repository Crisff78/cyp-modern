import { useEffect, useMemo, useState } from "react";
import { listLocalStationInstallations } from "./localStationInstallations";
import type { ReceiptFormat } from "./receiptPaper";
import type { StrictApi } from "./strictApi";

type Resolution = { status: "ready"; format: ReceiptFormat } | { status: "loading" } | { status: "error" };

/** Each opening and retry gets its own request, including when a previous print window is still open. */
export function useStationReceiptFormat(api: StrictApi, actorId: string, receiptId: string | null) {
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => ({ api, actorId, receiptId, attempt }), [api, actorId, receiptId, attempt]);
  const [last, setLast] = useState<{ request: typeof request; result: Resolution }>();
  useEffect(() => {
    if (!request.receiptId) return;
    let current = true;
    const resolve = async () => {
      const installations = await listLocalStationInstallations();
      if (!current) return;
      let format: ReceiptFormat = "common";
      if (installations.length) {
        const data = await request.api<{ recipientReceiptFormat: ReceiptFormat }>("/envios/formato-recepcion", {
          method: "POST", readOnly: true, body: JSON.stringify({ installations }),
        });
        if (data?.recipientReceiptFormat !== "common" && data?.recipientReceiptFormat !== "haiti") throw new Error("Formato desconocido");
        format = data.recipientReceiptFormat;
      }
      if (current) setLast({ request, result: { status: "ready", format } });
    };
    void resolve().catch(() => { if (current) setLast({ request, result: { status: "error" } }); });
    return () => { current = false; };
  }, [request]);
  const result: Resolution = !receiptId ? { status: "ready", format: "common" }
    : last?.request === request ? last.result : { status: "loading" };
  return { ...result, retry: () => setAttempt(value => value + 1) };
}

export type StationReceiptFormat = ReturnType<typeof useStationReceiptFormat>;
