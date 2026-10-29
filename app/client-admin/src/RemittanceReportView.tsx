import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import { FiltersToggle } from "../../shared/FiltersToggle";
import { currentOperationalWeek } from "../../shared/operationalWeek";
import { exportSections, printSections } from "../../shared/remittances/output";
import { commissionReportStatusLabels } from "../../shared/remittances/commissionOutput";
import { LatestRequestGate } from "../../shared/remittances/suggestions";
import { remittanceReportForPage, remittanceReportPath, remittanceReportSections, remittanceReportTitle, type RemittanceReportFilters, type RemittanceReportPage } from "../../shared/remittances/reporting";
import type { ConsolidatedCommissionReport, RemittanceSnapshot, Report } from "../../shared/remittances/types";
import { remittanceOperatorName } from "../../shared/remittances/operatorNames";
import type { StrictApi } from "../../shared/remittances/strictApi";
import "./connected-report-layout.css";
import "./remittance-report-view.css";

export function RemittanceReportView({ page, api, actorId }: { page: RemittanceReportPage; api: StrictApi; actorId: string }) {
  const definition = remittanceReportForPage(page);
  const [filters, setFilters] = useState<RemittanceReportFilters>(() => ({ ...currentOperationalWeek(), type: definition.type, grouping: "range", groupBy: "managerCurrency", operationStatus: "all", managerId: "", currency: "" }));
  const [metadata, setMetadata] = useState<RemittanceSnapshot | null>(null);
  const [metadataError, setMetadataError] = useState("");
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [allocationReport, setAllocationReport] = useState<ConsolidatedCommissionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outputError, setOutputError] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [selectedKey, setSelectedKey] = useState("");
  const requests = useRef(new LatestRequestGate());
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    requests.current.invalidate(); setBusy(false); setReport(null); setAllocationReport(null); setMetadata(null); setMetadataError("");
    void api<RemittanceSnapshot>("/envios/snapshot").then((value) => { if (active) setMetadata(value); }).catch((failure: unknown) => { if (active) setMetadataError(failure instanceof Error ? failure.message : "No se pudo cargar el contexto del reporte."); });
    return () => { active = false; requests.current.invalidate(); };
  }, [api, actorId, metadataAttempt]);
  useEffect(() => { grid.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [selectedKey]);

  const updateFilter = (value: Partial<RemittanceReportFilters>) => {
    requests.current.invalidate(); setBusy(false); setFilters((current) => ({ ...current, ...value })); setReport(null); setAllocationReport(null); setSelectedKey(""); setError(""); setOutputError("");
  };
  async function consult(event?: FormEvent) {
    event?.preventDefault(); if (busy || !metadata) return;
    const request = requests.current.begin(); setBusy(true); setError(""); setOutputError(""); setReport(null); setAllocationReport(null); setSelectedKey("");
    try {
      const path = remittanceReportPath(filters);
      if (definition.type === "allocations") {
        const result = await api<ConsolidatedCommissionReport>(path);
        if (requests.current.accepts(request)) setAllocationReport(result);
      } else {
        const result = await api<Report>(path);
        if (requests.current.accepts(request)) setReport(result);
      }
    } catch (failure) { if (requests.current.accepts(request)) setError(failure instanceof Error ? failure.message : "No se pudo consultar el reporte."); }
    finally { if (requests.current.accepts(request)) setBusy(false); }
  }
  const displayed = allocationReport ?? report;
  const sections = remittanceReportSections(definition.type, report, allocationReport, (id) => remittanceOperatorName(metadata, id) ?? id);
  const title = displayed ? remittanceReportTitle(definition.type, displayed) : definition.label;
  const managers = [...new Map((metadata?.transfers ?? []).flatMap((transfer) => transfer.commissionAllocation?.managerId ? [[transfer.commissionAllocation.managerId, { id: transfer.commissionAllocation.managerId, name: transfer.commissionAllocation.managerName ?? transfer.commissionAllocation.managerId }] as const] : [])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const canOutput = Boolean(displayed) && !busy;
  function output(kind: "print" | "csv") {
    if (!displayed || !canOutput) return;
    setOutputError("");
    try {
      if (kind === "print") printSections(title, sections);
      else exportSections(`envios-${definition.type}-${displayed.from}-${displayed.to}`, sections);
    } catch (failure) { setOutputError(failure instanceof Error ? failure.message : "No se pudo preparar la salida del reporte."); }
  }
  const selectionKeys = sections.flatMap((section, sectionIndex) => section.rows.map((_row, rowIndex) => `${sectionIndex}:${rowIndex}`));
  function moveSelection(direction: "first" | "previous" | "next" | "last") {
    if (!selectionKeys.length) return;
    const current = selectionKeys.indexOf(selectedKey);
    const next = direction === "first" ? 0 : direction === "last" ? selectionKeys.length - 1 : current < 0 ? 0 : direction === "previous" ? Math.max(0, current - 1) : Math.min(selectionKeys.length - 1, current + 1);
    setSelectedKey(selectionKeys[next]);
  }
  return <div className="connected-report-mdi remittance-report-view" aria-label={definition.label}>
    <div className="legacy-mdi-toolbar" aria-label="Herramientas del reporte de remesas" onClick={(event) => event.stopPropagation()}>
      <FiltersToggle visible={filtersVisible} onClick={() => setFiltersVisible((value) => !value)} />
      {([["first", "Primer registro", "|<"], ["previous", "Registro anterior", "<"], ["next", "Registro siguiente", ">"], ["last", "Último registro", ">|"]] as const).map(([direction, label, text]) => <button type="button" key={direction} className="nav-tool" title={label} aria-label={label} disabled={!selectionKeys.length} onClick={() => moveSelection(direction)}>{text}</button>)}
      <span className="mdi-toolbar-separator" />
      <button type="button" aria-label="Refrescar" title="Refrescar" disabled={busy || !metadata} onClick={() => void consult()}><RefreshCw size={15} /></button>
      <button type="button" aria-label="Imprimir" title="Imprimir" disabled={!canOutput} onClick={() => output("print")}><Printer size={15} /></button>
      <button type="button" aria-label="Exportar CSV" title="Exportar CSV" disabled={!canOutput} onClick={() => output("csv")}><Download size={15} /></button>
    </div>
    <div className="report-layout connected-report-layout">
      {filtersVisible && <form className="report-filter-panel remittance-report-filters" aria-label="Filtros del reporte" onSubmit={(event) => void consult(event)}>
        <div className="pending-charges-filter-heading">Panel de Filtro</div>
        <fieldset className="report-filter-fields" disabled={busy}>
          <label>Fecha inicial:<input type="date" required value={filters.from} onChange={(event) => updateFilter({ from: event.target.value })} /></label>
          <label>Fecha final:<input type="date" required value={filters.to} onChange={(event) => updateFilter({ to: event.target.value })} /></label>
          <label>Presentación:<select value={filters.grouping} onChange={(event) => updateFilter({ grouping: event.target.value as "range" | "day" })}><option value="range">Resumido del rango</option><option value="day">Diario</option></select></label>
          {definition.type === "allocations" && <>
            <label>Agrupar por:<select aria-label="Agrupar por" value={filters.groupBy} onChange={(event) => updateFilter({ groupBy: event.target.value as RemittanceReportFilters["groupBy"] })}><option value="managerCurrency">Gestor y Moneda</option><option value="currency">Moneda</option></select></label>
            <label>Estado de la operación:<select aria-label="Estado de la operación" value={filters.operationStatus} onChange={(event) => updateFilter({ operationStatus: event.target.value as RemittanceReportFilters["operationStatus"] })}>{Object.entries(commissionReportStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Gestor:<select aria-label="Gestor" value={filters.managerId} onChange={(event) => updateFilter({ managerId: event.target.value })}><option value="">Todos</option>{managers.map((manager) => <option value={manager.id} key={manager.id}>{manager.name} · {manager.id}</option>)}</select></label>
            <label>Moneda de la comisión:<select aria-label="Moneda de la comisión" value={filters.currency} onChange={(event) => updateFilter({ currency: event.target.value as RemittanceReportFilters["currency"] })}><option value="">Todas</option>{metadata?.currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          </>}
        </fieldset>
        <div className="report-filter-actions"><div className="report-separator">---</div><button className="btn full" type="submit" disabled={busy || !metadata}><RefreshCw size={14} />{busy ? "Consultando…" : "Consultar"}</button><div className="report-action-row"><button type="button" disabled={!canOutput} onClick={() => output("print")}><Printer size={14} />Imprimir</button><button type="button" disabled={!canOutput} onClick={() => output("csv")}><Download size={14} />Exportar</button></div></div>
      </form>}
      <section className="report-results-panel" aria-label={`Resultados de ${definition.label}`} aria-busy={busy || (!metadata && !metadataError)}>
        <div className="report-results-header"><strong>{definition.label}</strong><span>{displayed ? `${displayed.from} a ${displayed.to} · ${displayed.grouping === "day" ? "Diario" : "Resumido"}` : "Seleccione los filtros y consulte"}</span></div>
        <details className="connected-report-scope"><summary>Alcance del reporte</summary><p>{definition.scope}</p></details>
        {!metadata && !metadataError && <p role="status" className="connected-report-feedback">Cargando contexto del reporte…</p>}
        {metadataError && <div className="connected-report-feedback" role="alert">{metadataError} <button type="button" onClick={() => setMetadataAttempt((value) => value + 1)}>Reintentar conexión</button></div>}
        {error && <p role="alert" className="connected-report-feedback">{error}</p>}
        {outputError && <p role="alert" className="connected-report-feedback">{outputError}</p>}
        {busy && <p role="status" className="connected-report-feedback">Consultando el reporte…</p>}
        <div className="legacy-mdi-table-wrap connected-report-grid-scroll" ref={grid}>
          {sections.map((section, sectionIndex) => <section className="remittance-report-section" key={section.title}>
            <table className="legacy-mdi-table"><caption className="connected-report-currency-heading">{section.title}</caption><thead><tr>{section.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{section.rows.map((row, rowIndex) => {
              const key = `${sectionIndex}:${rowIndex}`;
              return <tr key={key} tabIndex={0} aria-selected={selectedKey === key} className={selectedKey === key ? "selected-row" : ""} onClick={() => setSelectedKey(key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedKey(key); } }}>{row.map((cell, index) => <td key={index} className={typeof cell === "number" || /^(DOP|USD|EUR) /.test(String(cell)) ? "numeric-cell" : ""}>{cell}</td>)}</tr>;
            })}{!section.rows.length && <tr><td colSpan={section.columns.length}>No hay resultados para esta consulta.</td></tr>}</tbody></table>
          </section>)}
          {!displayed && !busy && metadata && <div className="daily-settlements-empty">Consulte el reporte para ver los resultados.</div>}
        </div>
        <footer className="legacy-footerbar connected-report-footer"><span>Remesas</span><span>Importes separados por moneda</span></footer>
      </section>
    </div>
  </div>;
}
