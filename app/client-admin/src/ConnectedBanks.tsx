import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { LegacyDialog, LegacyToolbar, handleKeyboardActivation } from "./LegacyConnectedUi";
import { pendingMovementDraft, useMovementRequest } from "./useMovementRequest";
import { remittancesApi } from "./remittancesApi";
import { validateText } from "../../shared/inputRules";
import "./connected-banks.css";

export type Bank = { id: string; name: string; active: boolean };
type BankDraft = { id?: string; name: string; active: boolean };
const scope = "bank-catalog";

export function ConnectedBanks({ actorId, canManage }: { actorId: string; canManage: boolean }) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<BankDraft | null>(() => pendingMovementDraft<BankDraft>(actorId, scope) ?? null);
  const request = useMovementRequest(actorId, scope);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const rows = await remittancesApi<Bank[]>("/bancos");
      if (!Array.isArray(rows) || rows.some((row) => !row.id || typeof row.name !== "string" || typeof row.active !== "boolean")) throw new Error("El servidor no devolvió un catálogo de bancos válido.");
      if (current === generation.current) setBanks(rows);
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : "No se pudieron cargar los bancos."); }
    finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { ++generation.current; }; }, [refresh]);
  const rows = banks.filter((bank) => bank.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = rows.find((bank) => bank.id === selectedId) ?? rows[0];
  const navigate = (direction: "first" | "previous" | "next" | "last") => {
    const index = rows.findIndex((bank) => bank.id === selected?.id);
    const next = direction === "first" ? 0 : direction === "last" ? rows.length - 1 : direction === "previous" ? Math.max(0, index - 1) : Math.min(rows.length - 1, index + 1);
    setSelectedId(rows[next]?.id ?? "");
  };
  const open = (bank?: Bank) => { if (!canManage || request.locked) return; request.clear(); setError(""); setNotice(""); setDraft(bank ? { ...bank } : { name: "", active: true }); };
  const close = () => { if (!request.locked) { request.clear(); setDraft(null); } };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !canManage || request.busy) return;
    try {
      validateText(draft.name, "Banco", 160, { required: true });
      const body = { name: draft.name.trim(), active: draft.active };
      const saved = await request.run<Bank>(draft.id ? `/bancos/${encodeURIComponent(draft.id)}` : "/bancos", body, draft, (result) => Boolean(result?.id) && result.name === body.name && result.active === body.active && (!draft.id || result.id === draft.id));
      setSelectedId(saved.id); setDraft(null); setNotice("Banco guardado. El historial conserva sus referencias."); await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo guardar el banco."); }
  };
  return <section className="legacy-mdi-view connected-banks" aria-label="Bancos">
    <LegacyToolbar onFirst={() => navigate("first")} onPrevious={() => navigate("previous")} onNext={() => navigate("next")} onLast={() => navigate("last")} onNew={() => open()} onEdit={() => selected && open(selected)} onRefresh={() => void refresh()} disableNew={!canManage || request.locked} disableEdit={!selected || !canManage || request.locked} disableDelete deleteTitle="Los bancos se inactivan desde Editar para conservar su historial" extra={<label>Buscar banco:<input type="search" value={query} maxLength={160} onChange={(event) => setQuery(event.target.value)} /></label>} />
    {error && !draft && <p role="alert" className="location-feedback">{error}</p>}{notice && <p role="status" className="location-feedback">{notice}</p>}
    <div className="legacy-mdi-table-wrap"><table className="legacy-mdi-table"><thead><tr><th>Banco</th><th>Activo</th></tr></thead><tbody>{rows.map((bank) => <tr key={bank.id} className={selected?.id === bank.id ? "selected-row" : undefined} aria-selected={selected?.id === bank.id} tabIndex={0} onClick={() => setSelectedId(bank.id)} onDoubleClick={() => open(bank)} onKeyDown={(event) => handleKeyboardActivation(event, () => setSelectedId(bank.id))}><td>{bank.name}</td><td><input type="checkbox" checked={bank.active} readOnly aria-label={bank.active ? "Banco activo" : "Banco inactivo"} /></td></tr>)}{!rows.length && <tr><td colSpan={2}>{loading ? "Cargando bancos…" : "Sin bancos para estos filtros."}</td></tr>}</tbody></table></div>
    <div className="legacy-footerbar"><span>Cantidad: {rows.length}</span></div>
    {draft && <LegacyDialog title="Datos del Banco..." className="bank-form-dialog" onClose={close}><form className="legacy-dialog-form" onSubmit={save}><label>Banco:<input autoFocus required disabled={request.locked} maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label><input type="checkbox" disabled={request.locked} checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />Activo</label>{(error || request.error) && <p role="alert">{error || request.error}</p>}{request.uncertain && <p role="status">No se confirmó el resultado. Reintenta los mismos datos para recuperarlo.</p>}<div className="legacy-dialog-actions centered"><button type="submit" disabled={request.busy}>{request.busy ? "Guardando…" : request.uncertain ? "Reintentar" : "oK"}</button><button type="button" disabled={request.locked} onClick={close}>Cancelar</button></div></form></LegacyDialog>}
  </section>;
}
