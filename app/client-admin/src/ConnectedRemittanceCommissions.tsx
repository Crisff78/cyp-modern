import { useEffect, useState, type FormEvent } from "react";
import { accessRole, hasRoleExceptions, hasRemittancePermission, type AccessActor } from "../../shared/access.mjs";
import { decimalCents } from "../../shared/remittances/output";
import { isDecimalDraft } from "../../shared/inputRules";
import { confirmedCommissionPolicy } from "../../shared/remittances/commissionPolicyResponse";
import type { CommissionPolicy, RemittanceSnapshot } from "../../shared/remittances/types";
import { LegacyDialog } from "./LegacyConnectedUi";
import { remittancesApi } from "./remittancesApi";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";

type PolicyDraft = { transactionCommissionBps: number; managerCommissionBps: number };
export function ConnectedRemittanceCommissions({ actor }: { actor: AccessActor & { id: string } }) {
  const scope = "remittance-commission-policy";
  const held = pendingMovementDraft<PolicyDraft>(actor.id, scope);
  const request = useMovementRequest(actor.id, scope);
  const [policy, setPolicy] = useState<CommissionPolicy | null>(null);
  const [transaction, setTransaction] = useState(held ? String(held.transactionCommissionBps / 100) : "");
  const [manager, setManager] = useState(held ? String(held.managerCommissionBps / 100) : "");
  const [review, setReview] = useState<PolicyDraft | null>(held ?? null);
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
      if (!result.commissionPolicy || !Number.isInteger(result.commissionPolicy.transactionCommissionBps) || !Number.isInteger(result.commissionPolicy.managerCommissionBps))
        throw new Error("No se pudo comprobar la configuración de comisiones.");
      setPolicy(result.commissionPolicy);
      if (!pendingMovementDraft<PolicyDraft>(actor.id, scope)) {
        setTransaction(String(result.commissionPolicy.transactionCommissionBps / 100));
        setManager(String(result.commissionPolicy.managerCommissionBps / 100));
      }
    }).catch((failure) => { if (!retired) setError(failure instanceof Error ? failure.message : "No se pudieron cargar las comisiones."); })
      .finally(() => { if (!retired) setLoading(false); });
    return () => { retired = true; };
  }, [actor.id, reload]);
  const prepare = (event: FormEvent) => {
    event.preventDefault(); if (!canManage || !policy || request.locked) return;
    try {
      const transactionCommissionBps = decimalCents(transaction, true), managerCommissionBps = decimalCents(manager, true);
      if (transactionCommissionBps > 10000 || managerCommissionBps > 10000 || managerCommissionBps > transactionCommissionBps)
        throw new Error("Los porcentajes deben estar entre 0% y 100%, y la comisión total debe cubrir el porcentaje del gestor.");
      setError(""); setReview({ transactionCommissionBps, managerCommissionBps });
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
        <label>Comisión total de la transacción (%)<input aria-label="Comisión total de la transacción (%)" required inputMode="decimal" maxLength={6} value={transaction} onChange={(event) => { if (isDecimalDraft(event.target.value, { wholeDigits: 3 })) setTransaction(event.target.value); }} /><small>Se cobra sobre el monto a enviar en moneda de origen.</small></label>
        <label>Comisión del gestor (%)<input aria-label="Comisión del gestor (%)" required inputMode="decimal" maxLength={6} value={manager} onChange={(event) => { if (isDecimalDraft(event.target.value, { wholeDigits: 3 })) setManager(event.target.value); }} /><small>Se calcula sobre el importe final de destino. La empresa conserva el resto.</small></label>
      </fieldset>
      {policy?.updatedAt && <p className="remittance-help">Último cambio: {new Intl.DateTimeFormat("es-DO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santo_Domingo" }).format(new Date(policy.updatedAt))}</p>}
      <button className="remittance-primary" disabled={loading || !policy || !canManage || request.locked}>Revisar reparto</button>
    </form>
    {review && <LegacyDialog title="Confirmar configuración de comisiones" onClose={() => { if (request.closable) setReview(null); }}>
      <p>Comisión total: <strong>{review.transactionCommissionBps / 100}%</strong>. Gestor: <strong>{review.managerCommissionBps / 100}%</strong>.</p><p>Se aplicará únicamente a envíos nuevos.</p>
      {request.error && <p className="remittance-error" role="alert">{request.error}</p>}
      {request.uncertain && <p>Conservamos la misma configuración para reintentar el guardado sin duplicarlo.</p>}
      <div className="legacy-dialog-actions"><button type="button" disabled={!request.closable} onClick={() => setReview(null)}>Cancelar</button><button type="button" disabled={request.busy} onClick={() => void save()}>{request.busy ? "Guardando…" : request.uncertain ? "Reintentar guardado" : "Confirmar"}</button></div>
    </LegacyDialog>}
  </section>;
}
