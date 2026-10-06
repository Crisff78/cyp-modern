import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LegacyDialog, LegacyToolbar, handleKeyboardActivation } from "./LegacyConnectedUi";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";
import { remittancesApi } from "./remittancesApi";
import { INPUT_LIMITS, isDecimalDraft, isPositiveRate } from "../../shared/inputRules";
import type { Currency, Rate, RemittanceSnapshot } from "../../shared/remittances/types";
import { RateRegistrationTime } from "../../shared/remittances/RateRegistrationTime";
import { rateMoment } from "../../shared/remittances/suggestions";
import "./connected-exchange-rates.css";

type RateDraft = { currency: Currency; rate: string; date: string };
const names: Record<Currency, string> = { DOP: "Peso Dominicano", USD: "Dólar Americano", EUR: "Euro" };
const scope = "daily-exchange-rate";

export function ConnectedExchangeRates({ actorId, isAdmin }: { actorId: string; isAdmin: boolean }) {
  const [snapshot, setSnapshot] = useState<RemittanceSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<RateDraft | null>(() => pendingMovementDraft<RateDraft>(actorId, scope) ?? null);
  const [reviewing, setReviewing] = useState(() => Boolean(pendingMovementDraft(actorId, scope)));
  const [formError, setFormError] = useState("");
  const request = useMovementRequest(actorId, scope);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setSnapshot(await remittancesApi<RemittanceSnapshot>("/envios/snapshot")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudieron cargar las tasas."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const rates = snapshot?.rates ?? [];
  const selected = rates.find((rate) => rate.id === selectedId) ?? rates[0];
  const navigate = (direction: "first" | "previous" | "next" | "last") => {
    const current = Math.max(0, rates.findIndex((rate) => rate.id === selected?.id));
    const index = direction === "first" ? 0 : direction === "last" ? rates.length - 1 : direction === "previous" ? Math.max(0, current - 1) : Math.min(rates.length - 1, current + 1);
    setSelectedId(rates[index]?.id ?? "");
  };
  const open = (rate?: Rate) => {
    if (!snapshot || request.locked || !isAdmin) return;
    request.clear(); setFormError(""); setNotice(""); setReviewing(false);
    setDraft({ currency: rate?.currency ?? "USD", rate: rate?.rate ?? "", date: snapshot.businessDate });
  };
  const close = () => { if (!request.locked) { request.clear(); setDraft(null); setReviewing(false); } };
  const review = (event: FormEvent) => {
    event.preventDefault();
    if (!draft || request.locked) return;
    if (!isPositiveRate(draft.rate)) {
      setFormError("Escribe una tasa positiva con hasta doce enteros y seis decimales."); return;
    }
    setFormError(""); setReviewing(true);
  };
  const save = async () => {
    if (!draft || request.busy || !isAdmin) return;
    if (!isPositiveRate(draft.rate)) { setFormError("Escribe una tasa positiva con hasta doce enteros y seis decimales."); return; }
    setFormError("");
    try {
      await request.run<Rate>("/envios/tasas", draft, draft, (result) => Boolean(result?.id && result.currency === draft.currency && result.date === draft.date && result.rate));
      setDraft(null); setReviewing(false); setNotice("Tasa del día guardada. Los envíos anteriores conservan su tasa.");
      await refresh();
    } catch { /* The request retains its submitted draft and a reusable key when the outcome is uncertain. */ }
  };
  return <section className="legacy-mdi-view" aria-label="Tasas de Cambio">
    <LegacyToolbar onFirst={() => navigate("first")} onPrevious={() => navigate("previous")} onNext={() => navigate("next")} onLast={() => navigate("last")}
      onNew={() => open()} onEdit={() => selected && open(selected)} onRefresh={() => void refresh()}
      disableNew={!snapshot || !isAdmin || request.locked} disableEdit={!selected || selected.date !== snapshot?.businessDate || !isAdmin || request.locked}
      disableDelete deleteTitle="Las tasas utilizadas se conservan en el historial" />
    {error && <p className="location-feedback" role="alert">{error}</p>}
    {notice && <p className="location-feedback" role="status">{notice}</p>}
    <div className="legacy-mdi-table-wrap">
      <table className="legacy-mdi-table exchange-rates-grid">
        <thead><tr><th>Fecha</th><th>Moneda</th><th>Abrev</th><th>Tasa</th><th>Último cambio (America/Santo_Domingo)</th></tr></thead>
        <tbody>{rates.map((rate) => <tr key={rate.id} role="button" tabIndex={0} className={selected?.id === rate.id ? "selected-row" : ""}
          onClick={() => setSelectedId(rate.id)} onDoubleClick={() => rate.date === snapshot?.businessDate && open(rate)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedId(rate.id))}>
          <td><span className={`mdi-row-select ${selected?.id === rate.id ? "selected" : ""}`}>{rate.date}</span></td><td>{names[rate.currency]}</td><td>{rate.currency}</td><td>{rate.rate}</td><td>{rateMoment(rate.updatedAt)}</td>
        </tr>)}{!rates.length && <tr><td colSpan={5}>{loading ? "Cargando tasas…" : "No hay tasas guardadas."}</td></tr>}</tbody>
      </table>
    </div>
    <div className="legacy-footerbar"><span>Registros: {rates.length}</span><span>Jornada: {snapshot?.businessDate ?? "—"}</span></div>
    <p className="catalog-scope-note">Tasa: cantidad de DOP equivalente a una unidad de la moneda seleccionada. Admite valores positivos menores que 1 y hasta seis decimales. DOP siempre vale 1.</p>
    {draft && <LegacyDialog title={reviewing ? "Confirmar Tasa de Cambio..." : "Datos de la Tasa de Cambio..."} className="exchange-rate-dialog" onClose={close}>
      {reviewing ? <div className="legacy-dialog-form">
        <p>Guardar <strong>1 {draft.currency} = {draft.rate} DOP</strong> para {draft.date}.</p>
        <RateRegistrationTime rate={rates.find((row) => row.currency === draft.currency && row.date === draft.date)} className="exchange-rate-row" labelClassName="exchange-rate-label" />
        <p>Los envíos anteriores conservan su tasa. La tasa de DOP es siempre 1.</p>
        {formError && <p role="alert">{formError}</p>}
        {request.error && <p role="alert">{request.error}</p>}
        {request.uncertain && <p>No se confirmó el resultado. Reintenta la misma operación sin cambiar los datos.</p>}
        <div className="legacy-dialog-actions centered"><button type="button" disabled={request.busy} onClick={() => void save()}>{request.busy ? "Guardando…" : request.uncertain ? "Reintentar misma operación" : "Confirmar"}</button><button type="button" disabled={request.locked} onClick={() => setReviewing(false)}>Volver</button></div>
      </div> : <form className="legacy-dialog-form exchange-rate-form" onSubmit={review}>
        <label className="exchange-rate-row"><span className="exchange-rate-label">Moneda:</span><select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as Currency, rate: event.target.value === "DOP" ? "1.000000" : "" })}>{(snapshot?.currencies ?? []).map((code) => <option key={code} value={code}>{names[code]}</option>)}</select></label>
        <label className="exchange-rate-row exchange-date-row"><span className="exchange-rate-label">Fecha:</span><input type="date" value={draft.date} readOnly /></label>
        <RateRegistrationTime rate={rates.find((row) => row.currency === draft.currency && row.date === draft.date)} className="exchange-rate-row" labelClassName="exchange-rate-label" />
        <label className="exchange-rate-row"><span className="exchange-rate-label">Tasa:</span><input aria-label="Tasa" required inputMode="decimal" maxLength={INPUT_LIMITS.rate} value={draft.rate} readOnly={draft.currency === "DOP"} onChange={(event) => { const next = event.target.value; if (isDecimalDraft(next, { wholeDigits: 12, decimalDigits: 6 }) || next.length < draft.rate.length) setDraft({ ...draft, rate: next }); }} /></label>
        {formError && <p role="alert">{formError}</p>}
        <div className="legacy-dialog-actions centered exchange-rate-actions"><button type="submit">Revisar tasa</button><button type="button" onClick={close}>Cancelar</button></div>
      </form>}
    </LegacyDialog>}
  </section>;
}
