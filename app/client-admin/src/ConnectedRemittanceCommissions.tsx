import { useEffect, useState, type FormEvent } from "react";
import { accessRole, hasRoleExceptions, hasRemittancePermission, type AccessActor } from "../../shared/access.mjs";
import { decimalCents } from "../../shared/remittances/output";
import { isDecimalDraft, isTextDraft } from "../../shared/inputRules";
import { confirmedCommissionPolicy } from "../../shared/remittances/commissionPolicyResponse";
import { receiveRoundingLabels, roundingHelp } from "../../shared/remittances/QuoteDetails";
import type { CommissionPolicy, DeliveryConcept, ReceiveRounding, RemittanceSnapshot } from "../../shared/remittances/types";
import { LegacyDialog } from "./LegacyConnectedUi";
import { remittancesApi } from "./remittancesApi";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";

// What Administración configures for the sends (meeting of 29-10-2026): the commission of each send, the manager's share
// of that commission (never of the exchange), how what the person receives is rounded, and the concepts charged at the
// destination. «Comisión del gestor (%)» keeps its usual name; it is now a percentage of the commission.
type PolicyDraft = { transactionCommissionBps: number; managerShareBps: number; receiveRounding: ReceiveRounding };
type ConceptDraft = { id?: string; name: string; commissionBps: number; active: boolean };
const NO_DELIVERY = "sin-comision";
const percent = (bps: number) => String(bps / 100);
export function ConnectedRemittanceCommissions({ actor }: { actor: AccessActor & { id: string } }) {
  const scope = "remittance-commission-policy", conceptScope = "remittance-delivery-concepts";
  const held = pendingMovementDraft<PolicyDraft & { managerCommissionBps?: number }>(actor.id, scope);
  const heldConcept = pendingMovementDraft<ConceptDraft>(actor.id, conceptScope);
  const request = useMovementRequest(actor.id, scope);
  const conceptRequest = useMovementRequest(actor.id, conceptScope);
  const [policy, setPolicy] = useState<CommissionPolicy | null>(null);
  const [concepts, setConcepts] = useState<DeliveryConcept[]>([]);
  const [transaction, setTransaction] = useState(held ? percent(held.transactionCommissionBps) : "");
  const [manager, setManager] = useState(held ? percent(held.managerShareBps ?? 0) : "");
  const [rounding, setRounding] = useState<ReceiveRounding>(held?.receiveRounding ?? "none");
  const [review, setReview] = useState<PolicyDraft | null>(held?.managerShareBps !== undefined ? held : null);
  const [conceptName, setConceptName] = useState(heldConcept?.name ?? "");
  const [conceptPercent, setConceptPercent] = useState(heldConcept ? percent(heldConcept.commissionBps) : "");
  const [conceptActive, setConceptActive] = useState(heldConcept?.active ?? true);
  const [editing, setEditing] = useState<string | undefined>(heldConcept?.id);
  const [conceptReview, setConceptReview] = useState<ConceptDraft | null>(heldConcept ?? null);
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
      setConcepts((result.deliveryConcepts ?? []).filter((concept) => concept.id !== NO_DELIVERY));
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
      const transactionCommissionBps = decimalCents(transaction, true), managerShareBps = decimalCents(manager, true);
      if (transactionCommissionBps > 10000 || managerShareBps > 10000)
        throw new Error("Los porcentajes deben estar entre 0% y 100%.");
      setError(""); setReview({ transactionCommissionBps, managerShareBps, receiveRounding: rounding });
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
  const editConcept = (concept?: DeliveryConcept) => {
    setEditing(concept?.id); setConceptName(concept?.name ?? ""); setConceptPercent(concept ? percent(concept.commissionBps) : ""); setConceptActive(concept?.active ?? true); setError("");
  };
  const prepareConcept = (event: FormEvent) => {
    event.preventDefault(); if (!canManage || conceptRequest.locked) return;
    try {
      const name = conceptName.trim().replace(/\s+/g, " ");
      if (!name || name.length > 80) throw new Error("Escribe el nombre del concepto (hasta 80 caracteres).");
      const commissionBps = decimalCents(conceptPercent, true);
      if (commissionBps >= 10000) throw new Error("La comisión de entrega debe ser de 0% a menos de 100%.");
      setError(""); setConceptReview({ ...(editing ? { id: editing } : {}), name, commissionBps, active: conceptActive });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Revisa el concepto."); }
  };
  const saveConcept = async () => {
    if (!conceptReview || !canManage || conceptRequest.busy) return;
    try {
      await conceptRequest.run<DeliveryConcept>("/envios/conceptos-entrega", conceptReview, conceptReview, (value) =>
        Boolean(value && typeof value.id === "string" && value.name === conceptReview.name && value.commissionBps === conceptReview.commissionBps && value.active === conceptReview.active), "POST", "strict");
      setConceptReview(null); editConcept(); setNotice("Concepto guardado. Se ofrece en los próximos envíos."); setReload((value) => value + 1);
    } catch { /* The mutation lifecycle retains an uncertain intent for the same retry. */ }
  };
  return <section className="legacy-mdi-view remittances" aria-label="Configuración de comisiones de remesas">
    <div className="remittance-heading"><h2>Comisiones de remesas</h2><button type="button" disabled={loading || request.locked || conceptRequest.locked} onClick={() => setReload((value) => value + 1)}>Refrescar</button></div>
    <p className="remittance-help">Administración configura aquí los porcentajes aprobados por Gerencia. El cajero los recibe automáticamente. Los cambios no modifican envíos anteriores.</p>
    {loading && <p role="status">Cargando configuración…</p>}{error && <p role="alert" className="remittance-error">{error}</p>}{notice && <p role="status" className="remittance-notice">{notice}</p>}
    <form className="remittance-panel" onSubmit={prepare}>
      <fieldset className="remittance-form-grid" disabled={loading || !policy || !canManage || request.locked}>
        <label>Comisión total de la transacción (%)<input aria-label="Comisión total de la transacción (%)" required inputMode="decimal" maxLength={6} value={transaction} onChange={(event) => { if (isDecimalDraft(event.target.value, { wholeDigits: 3 })) setTransaction(event.target.value); }} /><small>Se cobra en todo envío, con o sin cambio de moneda, sobre lo que se envía. La paga quien envía.</small></label>
        <label>Comisión del gestor (%)<input aria-label="Comisión del gestor (%)" required inputMode="decimal" maxLength={6} value={manager} onChange={(event) => { if (isDecimalDraft(event.target.value, { wholeDigits: 3 })) setManager(event.target.value); }} /><small>Parte de la comisión del envío que cobra el gestor. Nunca sale de la ganancia por cambio. La empresa conserva el resto.</small></label>
        <label>Redondeo de lo que recibe la persona<select aria-label="Redondeo de lo que recibe la persona" value={rounding} onChange={(event) => setRounding(event.target.value as ReceiveRounding)}>{(Object.keys(receiveRoundingLabels) as ReceiveRounding[]).map((value) => <option key={value} value={value}>{receiveRoundingLabels[value]}</option>)}</select><small>{roundingHelp[rounding]} Va en la moneda en que se recibe (pesos, dólares o euros).</small></label>
      </fieldset>
      {policy?.updatedAt && <p className="remittance-help">Último cambio: {new Intl.DateTimeFormat("es-DO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santo_Domingo" }).format(new Date(policy.updatedAt))}</p>}
      <button className="remittance-primary" disabled={loading || !policy || !canManage || request.locked}>Revisar reparto</button>
    </form>
    <section className="remittance-panel" aria-label="Comisiones de entrega en destino">
      <h2>Comisiones de entrega en destino</h2>
      <p className="remittance-help">Lo que se cobra en el destino (una entrega a domicilio, por ejemplo). Se descuenta de lo que recibe la persona. «Sin comisión» va siempre primero.</p>
      <div className="remittance-table-wrap"><table className="remittance-table"><caption>Conceptos · {concepts.length + 1}</caption><thead><tr><th>Concepto</th><th>Comisión</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
        <tr><td>Sin comisión</td><td>0%</td><td>Activo</td><td>—</td></tr>
        {concepts.map((concept) => <tr key={concept.id}><td>{concept.name}</td><td>{concept.commissionBps / 100}%</td><td>{concept.active ? "Activo" : "Inactivo"}</td><td><button type="button" disabled={!canManage || conceptRequest.locked} onClick={() => editConcept(concept)}>Modificar</button></td></tr>)}
      </tbody></table></div>
      <form onSubmit={prepareConcept}>
        <fieldset className="remittance-form-grid" disabled={loading || !canManage || conceptRequest.locked}>
          <label>Nombre del concepto<input aria-label="Nombre del concepto" required maxLength={80} value={conceptName} onChange={(event) => { if (isTextDraft(event.target.value, 80)) setConceptName(event.target.value); }} /></label>
          <label>Comisión de entrega (%)<input aria-label="Comisión de entrega (%)" required inputMode="decimal" maxLength={6} value={conceptPercent} onChange={(event) => { if (isDecimalDraft(event.target.value, { wholeDigits: 2 })) setConceptPercent(event.target.value); }} /></label>
          <label className="remittance-payment-check"><input type="checkbox" checked={conceptActive} onChange={(event) => setConceptActive(event.target.checked)} />Activo</label>
        </fieldset>
        <div className="remittance-form-actions"><button className="remittance-primary" disabled={loading || !canManage || conceptRequest.locked}>{editing ? "Revisar cambio del concepto" : "Revisar concepto nuevo"}</button>{editing && <button type="button" disabled={conceptRequest.locked} onClick={() => editConcept()}>Agregar otro</button>}</div>
      </form>
    </section>
    {review && <LegacyDialog title="Confirmar configuración de comisiones" onClose={() => { if (request.closable) setReview(null); }}>
      <p>Comisión total: <strong>{review.transactionCommissionBps / 100}%</strong>. Gestor: <strong>{review.managerShareBps / 100}% de la comisión</strong>. Redondeo: <strong>{receiveRoundingLabels[review.receiveRounding]}</strong>.</p><p>Se aplicará únicamente a envíos nuevos.</p>
      {request.error && <p className="remittance-error" role="alert">{request.error}</p>}
      {request.uncertain && <p>Conservamos la misma configuración para reintentar el guardado sin duplicarlo.</p>}
      <div className="legacy-dialog-actions"><button type="button" disabled={!request.closable} onClick={() => setReview(null)}>Cancelar</button><button type="button" disabled={request.busy} onClick={() => void save()}>{request.busy ? "Guardando…" : request.uncertain ? "Reintentar guardado" : "Confirmar"}</button></div>
    </LegacyDialog>}
    {conceptReview && <LegacyDialog title="Confirmar comisión de entrega" onClose={() => { if (conceptRequest.closable) setConceptReview(null); }}>
      <p>{conceptReview.id ? "Cambiar" : "Agregar"} <strong>{conceptReview.name}</strong>: <strong>{conceptReview.commissionBps / 100}%</strong>, {conceptReview.active ? "activo" : "inactivo"}.</p><p>Se aplicará únicamente a envíos nuevos.</p>
      {conceptRequest.error && <p className="remittance-error" role="alert">{conceptRequest.error}</p>}
      {conceptRequest.uncertain && <p>Conservamos el mismo concepto para reintentar el guardado sin duplicarlo.</p>}
      <div className="legacy-dialog-actions"><button type="button" disabled={!conceptRequest.closable} onClick={() => setConceptReview(null)}>Cancelar</button><button type="button" disabled={conceptRequest.busy} onClick={() => void saveConcept()}>{conceptRequest.busy ? "Guardando…" : conceptRequest.uncertain ? "Reintentar guardado" : "Confirmar"}</button></div>
    </LegacyDialog>}
  </section>;
}
