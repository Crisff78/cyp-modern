import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api } from "./api";
import { LegacyDialog } from "./LegacyConnectedUi";
import { centsInput, nativeMoney, businessTimestamp } from "./adminFinance";
import { decimalCents } from "../../shared/remittances/output";
import type { CashReconciliationAmounts, CashReconciliationRecord, PreviousCashInput, PreviousCashPreview } from "../../shared/cashReconciliation";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";

const currencies = ["DOP", "USD", "EUR"] as const;
const cashMoney = (amount: number, currency: string) => Number.isSafeInteger(amount) ? nativeMoney(amount, currency) : "Requiere revisión";
type ReceiptDraft = { preview: PreviousCashPreview; received: Record<typeof currencies[number], string>; note: string; confirmed: boolean };

export function PreviousCashDialog({ actorId, collectorId, onClose, onRefresh }: Readonly<{
  actorId: string; collectorId: string; onClose: () => void; onRefresh: () => void | boolean | Promise<void | boolean>;
}>) {
  const scope = `previous-cash:${collectorId}`;
  const request = useMovementRequest(actorId, scope);
  const pending = pendingMovementDraft<ReceiptDraft>(actorId, scope);
  const [preview, setPreview] = useState<PreviousCashPreview | null>(pending?.preview ?? null);
  const [received, setReceived] = useState(pending?.received ?? { DOP: "0.00", USD: "0.00", EUR: "0.00" });
  const [note, setNote] = useState(pending?.note ?? "");
  const [confirmed, setConfirmed] = useState(pending?.confirmed ?? false);
  const [loading, setLoading] = useState(!pending);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const path = `/cuadres/pendientes?collectorId=${encodeURIComponent(collectorId)}`;

  useEffect(() => {
    if (pending) return;
    let active = true;
    void api<PreviousCashPreview>(path).then((value) => { if (active) setPreview(value); })
      .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "No se pudo revisar el saldo anterior."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [collectorId]);

  const reload = async () => {
    if (request.locked || loading) return;
    setLoading(true); setError("");
    try {
      setPreview(await api<PreviousCashPreview>(path));
      setReceived({ DOP: "0.00", USD: "0.00", EUR: "0.00" }); setConfirmed(false); request.clear();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo revisar el saldo anterior."); }
    finally { setLoading(false); }
  };
  const finish = async () => {
    setRefreshing(true);
    try {
      if (await onRefresh() === false) throw new Error("Snapshot refresh was not confirmed.");
      onClose();
    }
    catch { setError("La devolución ya se guardó. Actualiza la vista para continuar; no hace falta volver a registrarla."); }
    finally { setRefreshing(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (request.busy || saved || loading || !preview) return;
    setError("");
    const draft = pending ?? { preview, received, note, confirmed };
    if (!draft.preview.canReconcile) return;
    if (!draft.confirmed) { setError("Confirma la recepción del efectivo antes de conciliar."); return; }
    if (!draft.note.trim()) { setError("Escribe el motivo de la devolución del efectivo anterior."); return; }
    let amounts: CashReconciliationAmounts;
    try {
      amounts = Object.fromEntries(currencies.map((currency) => [currency, decimalCents(draft.received[currency], true)])) as CashReconciliationAmounts;
      for (const currency of currencies) if (amounts[currency] !== draft.preview.amounts[currency]) throw new Error(`El efectivo recibido en ${currency} debe coincidir exactamente con el pendiente.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Revisa los importes recibidos."); return; }
    const input: PreviousCashInput = { collectorId, revision: draft.preview.revision, amounts, note: draft.note.trim(), confirmReceived: true };
    try {
      await request.run<{ collectorId: string; records: CashReconciliationRecord[]; amounts: CashReconciliationAmounts }>("/cuadres/regularizar", input, draft,
        (result) => result?.collectorId === collectorId && Array.isArray(result.records) && result.records.length === draft.preview.rows.length
          && result.records.every((row) => typeof row.id === "string" && row.collectorId === collectorId)
          && currencies.every((currency) => result.amounts?.[currency] === amounts[currency]), "POST", "api");
      setSaved(true); toast.success("Devolución de efectivo anterior registrada. Puedes continuar con las entregas de hoy.");
      await finish();
    } catch { /* The request retains its immutable intent if confirmation was lost. */ }
  };
  const close = () => { if (!request.busy && !refreshing) onClose(); };
  const clearError = () => { setError(""); request.clear(); };
  const locked = request.locked || loading || saved;
  return <LegacyDialog title="Resolver efectivo de jornadas anteriores..." onClose={close} className="previous-cash-dialog" overlayClassName="collection-receipt-suboverlay">
    <form className="previous-cash-content" onSubmit={(event) => void submit(event)}>
      <p><strong>{preview?.collectorName ?? "Cobrador seleccionado"}</strong> · Recepción administrativa del efectivo anterior.</p>
      <p className="catalog-scope-note">Registra esta devolución cuando el efectivo haya sido recibido en oficina. Los movimientos originales conservan sus fechas e importes. No afecta la caja de Envíos de Dinero.</p>
      {preview?.demo && <p className="previous-cash-demo">Demo: todos los importes de esta prueba son ficticios. Puedes simular la devolución con el botón de importes de prueba.</p>}
      {loading && <p role="status">Revisando jornadas anteriores…</p>}
      {preview && <>
        <div className="legacy-mdi-table-wrap previous-cash-table"><table className="legacy-mdi-table"><thead><tr><th>Fecha</th><th>Moneda</th><th>Cobros por devolver</th><th>Entregas sin usar</th><th>Total pendiente</th></tr></thead><tbody>
          {preview.rows.map((row) => <tr key={`${row.date}:${row.currency}`}><td>{row.date}</td><td>{row.currency}</td><td>{cashMoney(row.returnedCollection, row.currency)}</td><td>{cashMoney(row.returnedPayout, row.currency)}</td><td>{cashMoney(row.amount, row.currency)}</td></tr>)}
          {!preview.rows.length && <tr><td colSpan={5}>Sin efectivo pendiente de jornadas anteriores. Puedes continuar con las entregas de hoy.</td></tr>}
        </tbody></table></div>
        {preview.issues.map((issue) => <p role="alert" key={issue}>{issue}</p>)}
        {preview.rows.length > 0 && <fieldset disabled={locked || !preview.canReconcile} className="previous-cash-fields">
          {currencies.map((currency) => <label key={currency}>{currency} recibido:<input aria-label={`Efectivo recibido ${currency}`} inputMode="decimal" maxLength={22} value={received[currency]} readOnly={preview.amounts[currency] === 0} onChange={(event) => { setReceived((current) => ({ ...current, [currency]: event.target.value })); clearError(); }} /><small>Pendiente: {cashMoney(preview.amounts[currency], currency)}</small></label>)}
          {preview.demo && <button type="button" onClick={() => { setReceived(Object.fromEntries(currencies.map((currency) => [currency, centsInput(preview.amounts[currency])])) as ReceiptDraft["received"]); clearError(); }}>Usar importes ficticios de prueba</button>}
          <label className="previous-cash-note">Motivo:<textarea aria-label="Motivo de devolución" maxLength={2000} rows={2} value={note} onChange={(event) => { setNote(event.target.value); clearError(); }} /></label>
          <label className="previous-cash-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); clearError(); }} />{preview.demo ? "Confirmo la recepción ficticia para esta prueba" : "Confirmo que recibí en oficina el efectivo indicado"}</label>
        </fieldset>}
        {preview.history.length > 0 && <details><summary>Devoluciones anteriores registradas ({preview.history.length})</summary><div className="legacy-mdi-table-wrap"><table className="legacy-mdi-table"><thead><tr><th>Jornada</th><th>Moneda</th><th>Devuelto</th><th>Registro</th><th>Responsable</th><th>Motivo</th></tr></thead><tbody>{preview.history.map((row) => <tr key={row.id}><td>{row.date}</td><td>{row.currency}</td><td>{cashMoney(row.returnedCollection + row.returnedPayout, row.currency)}</td><td>{businessTimestamp(row.createdAt)}</td><td>{row.actorId}</td><td>{row.note}</td></tr>)}</tbody></table></div></details>}
      </>}
      {(error || request.error) && <p role="alert">{error || request.error}</p>}
      {request.uncertain && <p role="status">La confirmación no llegó. Reintenta esta misma devolución; el servidor no la duplicará. No cambies de cobrador hasta recuperar el resultado.</p>}
      <div className="legacy-dialog-actions centered">
        {saved ? <button type="button" disabled={refreshing} onClick={() => void finish()}>Actualizar vista</button> : <>
          <button type="button" disabled={request.locked || loading} onClick={() => void reload()}>Refrescar</button>
          {preview?.canReconcile && <button type="submit" disabled={request.busy || loading}>{request.busy ? "Registrando…" : request.uncertain ? "Reintentar devolución" : "Registrar devolución"}</button>}
        </>}
        <button type="button" disabled={request.busy || refreshing} onClick={close}>{saved || !preview?.rows.length ? "Cerrar" : "Cancelar"}</button>
      </div>
    </form>
  </LegacyDialog>;
}
