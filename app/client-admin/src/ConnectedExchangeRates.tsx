import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LegacyDialog, LegacyToolbar, handleKeyboardActivation } from "./LegacyConnectedUi";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";
import { remittancesApi } from "./remittancesApi";
import { confirmedRateInput, isRateDraft, rateInputDraft, RATE_INPUT_MAX_LENGTH, RATE_INPUT_MESSAGE } from "../../shared/remittances/rateInput";
import { restrictPaste } from "../../shared/remittances/fieldInput";
import { confirmedRateResponse } from "../../shared/remittances/rateResponse";
import type { Currency, Rate, RemittanceSnapshot } from "../../shared/remittances/types";
import { RateRegistrationTime } from "../../shared/remittances/RateRegistrationTime";
import { rateMoment } from "../../shared/remittances/suggestions";
import "./connected-exchange-rates.css";

type RateDraft = { currency: Currency; rate: string; purchaseRate: string; saleRate: string; date: string };
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
  const [entryErrors, setEntryErrors] = useState<Partial<Record<"purchaseRate" | "saleRate", string>>>({});
  const request = useMovementRequest(actorId, scope);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setSnapshot(await remittancesApi<RemittanceSnapshot>("/envios/snapshot")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudieron cargar las tasas."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const rates = [...(snapshot?.rates ?? [])].sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.currency.localeCompare(b.currency));
  const selected = rates.find((rate) => rate.id === selectedId) ?? rates[0];
  const navigate = (direction: "first" | "previous" | "next" | "last") => {
    const current = Math.max(0, rates.findIndex((rate) => rate.id === selected?.id));
    const index = direction === "first" ? 0 : direction === "last" ? rates.length - 1 : direction === "previous" ? Math.max(0, current - 1) : Math.min(rates.length - 1, current + 1);
    setSelectedId(rates[index]?.id ?? "");
  };
  const open = (rate?: Rate) => {
    if (!snapshot || request.locked || !isAdmin) return;
    request.clear(); setFormError(""); setEntryErrors({}); setNotice(""); setReviewing(false);
    setDraft({ currency: rate?.currency ?? "USD", rate: rate?.currency === "DOP" ? "1.000000" : rate?.rate ?? "", purchaseRate: rate?.currency === "DOP" ? "1.000000" : rate?.purchaseRate ?? "", saleRate: rate?.currency === "DOP" ? "1.000000" : rate?.saleRate ?? "", date: snapshot.businessDate });
  };
  const close = () => { if (request.closable) { request.clear(); setDraft(null); setReviewing(false); } };
  const review = (event: FormEvent) => {
    event.preventDefault();
    if (!draft || request.locked) return;
    if (Object.values(entryErrors).some(Boolean)) { setFormError("Corrige el campo señalado antes de revisar la tasa."); return; }
    try { setDraft({ ...draft, rate: confirmedRateInput(draft.purchaseRate), purchaseRate: confirmedRateInput(draft.purchaseRate), saleRate: confirmedRateInput(draft.saleRate) }); }
    catch (failure) { setFormError(failure instanceof Error ? failure.message : "Revisa la tasa."); return; }
    setFormError(""); setReviewing(true);
  };
  const save = async () => {
    if (!draft || request.busy || !isAdmin) return;
    try { confirmedRateInput(draft.rate); confirmedRateInput(draft.purchaseRate); confirmedRateInput(draft.saleRate); }
    catch (failure) { setFormError(failure instanceof Error ? failure.message : "Revisa la tasa."); return; }
    setFormError("");
    try {
      await request.run<Rate>("/envios/tasas", draft, draft, (result) => { confirmedRateResponse(result, draft); return true; });
      setDraft(null); setReviewing(false); setNotice("Tasa del día guardada. Los envíos anteriores conservan su tasa.");
      window.dispatchEvent(new Event("cyp-exchange-rates-updated"));
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
        <thead><tr><th>Fecha</th><th>Moneda</th><th>Abrev</th><th>Tasa de remesas</th><th>Compra</th><th>Venta</th><th>Último cambio (hora de Santo Domingo)</th></tr></thead>
        <tbody>{rates.map((rate) => <tr key={rate.id} role="button" tabIndex={0} className={selected?.id === rate.id ? "selected-row" : ""}
          onClick={() => setSelectedId(rate.id)} onDoubleClick={() => rate.date === snapshot?.businessDate && open(rate)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedId(rate.id))}>
          <td><span className={`mdi-row-select ${selected?.id === rate.id ? "selected" : ""}`}>{rate.date}</span></td><td>{names[rate.currency]}</td><td>{rate.currency}</td><td>{rate.rate}</td><td>{rate.purchaseRate ?? "Sin configurar"}</td><td>{rate.saleRate ?? "Sin configurar"}</td><td>{rateMoment(rate.updatedAt)}</td>
        </tr>)}{!rates.length && <tr><td colSpan={7}>{loading ? "Cargando tasas…" : "No hay tasas guardadas."}</td></tr>}</tbody>
      </table>
    </div>
    <details className="catalog-scope-note">
      <summary>Historial de cambios de tasa · el más reciente arriba</summary>
      <div className="legacy-mdi-table-wrap"><table className="legacy-mdi-table"><thead><tr><th>Fecha de operación</th><th>Moneda</th><th>Tasa de remesas</th><th>Compra</th><th>Venta</th><th>Fecha y hora (hora de Santo Domingo)</th><th>Registrado por</th></tr></thead><tbody>{[...(snapshot?.rateHistory ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((row) => <tr key={row.id}><td>{row.date}</td><td>{row.currency}</td><td>{row.rate}</td><td>{row.purchaseRate ?? "Sin configurar"}</td><td>{row.saleRate ?? "Sin configurar"}</td><td>{rateMoment(row.createdAt)}</td><td>{snapshot?.operators.find(({ id }) => id === row.actorId)?.name ?? row.actorId}</td></tr>)}{!snapshot?.rateHistory?.length && <tr><td colSpan={7}>No hay cambios registrados.</td></tr>}</tbody></table></div>
    </details>
    <div className="legacy-footerbar"><span>Registros: {rates.length}</span><span>Jornada: {snapshot?.businessDate ?? "—"}</span></div>
    <p className="catalog-scope-note">Escribe cuántos pesos vale una unidad de cada moneda. Compra: recibimos esa moneda del remitente. Venta: la entregamos al destinatario. Se usa la última tasa registrada, aunque sea de días anteriores. Cada envío conserva sus tasas. Si envías y recibes la misma moneda no se realiza otro cambio. DOP siempre vale 1.</p>
    {draft && <LegacyDialog title={reviewing ? "Confirmar Tasa de Cambio..." : "Datos de la Tasa de Cambio..."} className="exchange-rate-dialog" onClose={close}>
      {reviewing ? <div className="legacy-dialog-form">
        <p>Guardar tasas de <strong>{draft.currency}</strong> para {draft.date}.</p>
        <p>Compra: <strong>{draft.purchaseRate} DOP</strong>. Venta: <strong>{draft.saleRate} DOP</strong>.</p>
        <RateRegistrationTime rate={rates.find((row) => row.currency === draft.currency && row.date === draft.date)} className="exchange-rate-row" labelClassName="exchange-rate-label" />
        <p>Los envíos anteriores conservan su tasa. La tasa de DOP es siempre 1.</p>
        {formError && <p role="alert">{formError}</p>}
        {request.error && <p role="alert">{request.error}</p>}
        {request.uncertain && <p>No se confirmó el resultado. Reintenta la misma operación sin cambiar los datos.</p>}
        <div className="legacy-dialog-actions centered"><button type="button" disabled={request.busy} onClick={() => void save()}>{request.busy ? "Guardando…" : request.uncertain ? "Reintentar misma operación" : "Confirmar"}</button><button type="button" disabled={request.locked} onClick={() => setReviewing(false)}>Volver</button></div>
      </div> : <form className="legacy-dialog-form exchange-rate-form" onSubmit={review}>
        <label className="exchange-rate-row"><span className="exchange-rate-label">Moneda:</span><select value={draft.currency} onChange={(event) => { const value = event.target.value === "DOP" ? "1.000000" : ""; setDraft({ ...draft, currency: event.target.value as Currency, rate: value, purchaseRate: value, saleRate: value }); setEntryErrors({}); setFormError(""); }}>{(snapshot?.currencies ?? []).map((code) => <option key={code} value={code}>{names[code]}</option>)}</select></label>
        <label className="exchange-rate-row exchange-date-row"><span className="exchange-rate-label">Fecha:</span><input type="date" value={draft.date} readOnly /></label>
        <RateRegistrationTime rate={rates.find((row) => row.currency === draft.currency && row.date === draft.date)} className="exchange-rate-row" labelClassName="exchange-rate-label" />
        {([['purchaseRate', 'Compra'], ['saleRate', 'Venta']] as const).map(([key, label]) => <label className="exchange-rate-row" key={key}><span className="exchange-rate-label">{label}:</span><input aria-label={label} required inputMode="decimal" autoComplete="off" spellCheck={false} pattern="[0-9]{0,12}([.,][0-9]{0,6})?" title={RATE_INPUT_MESSAGE} maxLength={RATE_INPUT_MAX_LENGTH} value={draft[key] ?? ""} readOnly={draft.currency === "DOP"} aria-invalid={Boolean(entryErrors[key]) || undefined}
          onPaste={(event) => restrictPaste(event, isRateDraft, () => { setEntryErrors((current) => ({ ...current, [key]: RATE_INPUT_MESSAGE })); setFormError(RATE_INPUT_MESSAGE); })}
          onChange={(event) => {
            if (!isRateDraft(event.target.value)) { setEntryErrors((current) => ({ ...current, [key]: RATE_INPUT_MESSAGE })); setFormError(RATE_INPUT_MESSAGE); return; }
            setDraft({ ...draft, [key]: rateInputDraft(event.target.value) }); setEntryErrors((current) => ({ ...current, [key]: undefined })); setFormError("");
          }} /></label>)}
        <p className="exchange-rate-hint" role="note">{draft.currency === "DOP"
          ? "El peso dominicano es la moneda base: siempre vale 1 y por eso aquí no se puede cambiar. Para registrar una tasa, elige Dólar Americano o Euro en «Moneda»."
          : `Escribe cuántos pesos dominicanos (DOP) vale 1 ${draft.currency}. Compra cuando recibimos la moneda; venta cuando la entregamos.`}</p>
        {formError && <p role="alert">{formError}</p>}
        <div className="legacy-dialog-actions centered exchange-rate-actions"><button type="submit">Revisar tasa</button><button type="button" onClick={close}>Cancelar</button></div>
      </form>}
    </LegacyDialog>}
  </section>;
}
