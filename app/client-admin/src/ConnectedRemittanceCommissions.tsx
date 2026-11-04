import { useEffect, useState, type FormEvent } from "react";
import { accessRole, hasRoleExceptions, hasRemittancePermission, type AccessActor } from "../../shared/access.mjs";
import { DELIVERY_COMMISSION_MESSAGE, deliveryCommissionBps, isDeliveryCommissionDraft } from "../../shared/remittances/deliveryCommissionInput";
import { restrictPaste } from "../../shared/remittances/fieldInput";
import { decimalCents } from "../../shared/remittances/output";
import { isDecimalDraft } from "../../shared/inputRules";
import { confirmedCommissionPolicy } from "../../shared/remittances/commissionPolicyResponse";
import { receiveRoundingLabels, roundingHelp } from "../../shared/remittances/QuoteDetails";
import type { CommissionPolicy, ReceiveRounding, RemittanceSnapshot } from "../../shared/remittances/types";
import { LegacyDialog } from "./LegacyConnectedUi";
import { remittancesApi } from "./remittancesApi";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";

// Central percentages for future sends: the sender's commission, the delivery deduction, the manager's share
// of the sender's commission and the recipient's rounding. Saved sends retain their original calculation.
type PolicyDraft = { transactionCommissionBps: number; managerShareBps: number; deliveryCommissionBps?: number; creditCardCommissionBps?: number; receiveRounding: ReceiveRounding };
const percent = (bps: number) => String(bps / 100);
const isCardRateDraft = (value: string) => /^[0-9]{0,3}(?:\.[0-9]{0,2})?$/.test(value) && (!/[0-9]/.test(value) || Number(value) <= 100);
export function ConnectedRemittanceCommissions({ actor }: { actor: AccessActor & { id: string } }) {
  const scope = "remittance-commission-policy";
  const held = pendingMovementDraft<PolicyDraft & { managerCommissionBps?: number }>(actor.id, scope);
  const request = useMovementRequest(actor.id, scope);
  const [policy, setPolicy] = useState<CommissionPolicy | null>(null);
  const [transaction, setTransaction] = useState(held ? percent(held.transactionCommissionBps) : "");
  const [delivery, setDelivery] = useState(held?.deliveryCommissionBps === undefined ? "0" : percent(held.deliveryCommissionBps));
  const [deliveryEntryError, setDeliveryEntryError] = useState(false);
  const [credit, setCredit] = useState(percent(held?.creditCardCommissionBps ?? 0));
  const [creditEntryError, setCreditEntryError] = useState(false);
  const [manager, setManager] = useState(held ? percent(held.managerShareBps ?? 0) : "");
  const [rounding, setRounding] = useState<ReceiveRounding>(held?.receiveRounding ?? "none");
  const [review, setReview] = useState<PolicyDraft | null>(held?.managerShareBps !== undefined ? held : null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const canManage = (accessRole(actor.role) === "admin" || hasRoleExceptions(actor)) && hasRemittancePermission(actor, "remittances.commissions.manage");
  useEffect(() => {
    let retired = false;
    setLoading(true); setError("");
    void remittancesApi<RemittanceSnapshot>("/envios/snapshot").then((result) => {
      if (retired) return;
      if (!result.commissionPolicy || !Number.isInteger(result.commissionPolicy.transactionCommissionBps) || !Number.isInteger(result.commissionPolicy.managerShareBps))
        throw new Error("No se pudo comprobar la configuración de comisiones.");
      setPolicy(result.commissionPolicy);
      setDelivery(percent(held?.deliveryCommissionBps ?? result.commissionPolicy.deliveryCommissionBps ?? 0));
      setCredit(percent(held?.creditCardCommissionBps ?? result.commissionPolicy.creditCardCommissionBps ?? 0));
      if (!pendingMovementDraft<PolicyDraft>(actor.id, scope)) {
        setTransaction(percent(result.commissionPolicy.transactionCommissionBps));
        setManager(percent(result.commissionPolicy.managerShareBps ?? 0));
        setRounding(result.commissionPolicy.receiveRounding ?? "none");
      }
    }).catch((failure) => { if (!retired) setError(failure instanceof Error ? failure.message : "No se pudieron cargar las comisiones."); })
      .finally(() => { if (!retired) setLoading(false); });
    return () => { retired = true; };
  }, [actor.id, reload]);
  const prepare = (event: FormEvent) => {
    event.preventDefault(); if (!canManage || !policy || request.locked) return;
    try {
      if (deliveryEntryError) throw new Error(DELIVERY_COMMISSION_MESSAGE);
      if (creditEntryError || !isCardRateDraft(credit)) throw new Error("El recargo de tarjeta debe estar entre 0 y 100%.");
      const deliveryBps = deliveryCommissionBps(delivery);
      const transactionCommissionBps = decimalCents(transaction, true), managerShareBps = decimalCents(manager, true);
      if (transactionCommissionBps > 10000 || managerShareBps > 10000)
        throw new Error("Los porcentajes deben estar entre 0% y 100%.");
      setError(""); setReview({ transactionCommissionBps, managerShareBps, deliveryCommissionBps: deliveryBps, creditCardCommissionBps: decimalCents(credit, true), receiveRounding: rounding });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Revisa los porcentajes."); }
  };
  const save = async () => {
    if (!review || !canManage || request.busy) return;
    try {
      const saved = await request.run<CommissionPolicy>("/envios/politica-comisiones", review, review, (value) => {
        confirmedCommissionPolicy(value, review); return true;
      }, "POST", "strict");
      setPolicy(saved); setReview(null); setNotice("Configuración guardada. Se aplicará a los próximos envíos.");
      window.dispatchEvent(new Event("cyp-remittance-commissions-updated"));
    } catch { /* The mutation lifecycle retains an uncertain intent for the same retry. */ }
  };
  return <section className="legacy-mdi-view remittances" aria-label="Configuración de comisiones de remesas">
    <div className="remittance-heading"><h2>Comisiones de remesas</h2><button type="button" disabled={loading || request.locked} onClick={() => setReload((value) => value + 1)}>Refrescar</button></div>
    <p className="remittance-help">Administración configura aquí los porcentajes aprobados por Gerencia. El cajero los recibe automáticamente. Los cambios no modifican envíos anteriores.</p>
    {loading && <p role="status">Cargando configuración…</p>}{error && <p role="alert" className="remittance-error">{error}</p>}{notice && <p role="status" className="remittance-notice">{notice}</p>}
    <form className="remittance-panel" onSubmit={prepare}>
      <fieldset className="remittance-form-grid" disabled={loading || !policy || !canManage || request.locked}>
        <label>Comisión total de la transacción (%)<input aria-label="Comisión total de la transacción (%)" required inputMode="decimal" maxLength={6} value={transaction} onChange={(event) => { if (isDecimalDraft(event.target.value, { wholeDigits: 3 })) setTransaction(event.target.value); }} /><small>Se cobra en todo envío, con o sin cambio de moneda, sobre lo que se envía. La paga quien envía.</small></label>
        <label>Comisión de entrega (%)<input aria-label="Comisión de entrega (%)" required inputMode="decimal" maxLength={5} value={delivery} aria-invalid={deliveryEntryError || undefined} onPaste={(event) => restrictPaste(event, isDeliveryCommissionDraft, () => { setDeliveryEntryError(true); setError(DELIVERY_COMMISSION_MESSAGE); })} onChange={(event) => { if (!isDeliveryCommissionDraft(event.target.value)) { setDeliveryEntryError(true); setError(DELIVERY_COMMISSION_MESSAGE); return; } setDelivery(event.target.value); setDeliveryEntryError(false); setError(""); }} /><small>Se descuenta del monto convertido que recibe el destinatario. En 0% no se descuenta nada. Se aplica automáticamente a envíos nuevos.</small></label>
        <label>Recargo por tarjeta de crédito (%)<input aria-label="Recargo por tarjeta de crédito (%)" required inputMode="decimal" maxLength={6} value={credit} aria-invalid={creditEntryError || undefined} onPaste={(event) => restrictPaste(event, isCardRateDraft, () => { setCreditEntryError(true); setError("Usa un porcentaje de 0 a 100."); })} onChange={(event) => { if (!isCardRateDraft(event.target.value)) { setCreditEntryError(true); setError("Usa un porcentaje de 0 a 100."); return; } setCredit(event.target.value); setCreditEntryError(false); setError(""); }} /><small>Se suma solo al pago con crédito, sobre el principal más el cargo del envío. No se descuenta al destinatario ni se reparte con el gestor. Débito no lleva este recargo. En 0% no se cobra.</small></label>
        <label>Comisión del gestor (%)<input aria-label="Comisión del gestor (%)" required inputMode="decimal" maxLength={6} value={manager} onChange={(event) => { if (isDecimalDraft(event.target.value, { wholeDigits: 3 })) setManager(event.target.value); }} /><small>Parte de la comisión del envío que cobra el gestor. Nunca sale de la ganancia por cambio. La empresa conserva el resto.</small></label>
        <label>Redondeo de lo que recibe la persona<select aria-label="Redondeo de lo que recibe la persona" value={rounding} onChange={(event) => setRounding(event.target.value as ReceiveRounding)}>{(Object.keys(receiveRoundingLabels) as ReceiveRounding[]).map((value) => <option key={value} value={value}>{receiveRoundingLabels[value]}</option>)}</select><small>{roundingHelp[rounding]} Va en la moneda en que se recibe (pesos, dólares o euros).</small></label>
      </fieldset>
      {policy?.updatedAt && <p className="remittance-help">Último cambio: {new Intl.DateTimeFormat("es-DO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santo_Domingo" }).format(new Date(policy.updatedAt))}</p>}
      <button className="remittance-primary" disabled={loading || !policy || !canManage || request.locked}>Revisar reparto</button>
    </form>
    {review && <LegacyDialog title="Confirmar configuración de comisiones" onClose={() => { if (request.closable) setReview(null); }}>
      <p>Comisión total: <strong>{review.transactionCommissionBps / 100}%</strong>. Entrega: <strong>{(review.deliveryCommissionBps ?? policy?.deliveryCommissionBps ?? 0) / 100}%</strong>. Gestor: <strong>{review.managerShareBps / 100}% de la comisión</strong>. Redondeo: <strong>{receiveRoundingLabels[review.receiveRounding]}</strong>.</p><p>Recargo por tarjeta de crédito: <strong>{(review.creditCardCommissionBps ?? policy?.creditCardCommissionBps ?? 0) / 100}%</strong>. Débito: sin recargo.</p><p>Se aplicará únicamente a envíos nuevos.</p>
      {request.error && <p className="remittance-error" role="alert">{request.error}</p>}
      {request.uncertain && <p>Conservamos la misma configuración para reintentar el guardado sin duplicarlo.</p>}
      <div className="legacy-dialog-actions"><button type="button" disabled={!request.closable} onClick={() => setReview(null)}>Cancelar</button><button type="button" disabled={request.busy} onClick={() => void save()}>{request.busy ? "Guardando…" : request.uncertain ? "Reintentar guardado" : "Confirmar"}</button></div>
    </LegacyDialog>}
  </section>;
}
