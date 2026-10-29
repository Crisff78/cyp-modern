import type { CommissionReportGroupBy, CommissionReportStatus, ConsolidatedCommissionReport, Currency, Report } from "./types";
import { formatDate, formatMoney, type OutputSection } from "./output";
import { commissionSections, managerCommissionSections } from "./suggestions";
import { consolidatedCommissionSections } from "./commissionOutput";

export const remittanceReportDefinitions = [
  { type: "amounts", page: "reportRemittanceAmounts", label: "Montos y cantidad de envíos", scope: "Por fecha de envío. Los cancelados cuentan, pero sus importes se excluyen de las sumas." },
  { type: "allocations", page: "reportRemittanceAllocations", label: "Reporte consolidado de comisiones", scope: "Las tres comisiones corresponden a importes vigentes. Desde el 29-10-2026 el gestor cobra su parte de la comisión del envío, en la moneda en que se pagó; antes, un porcentaje del importe de destino. Las canceladas aportan cero al saldo y sus importes anulados se muestran aparte. Los totales del periodo se separan por moneda. La fecha corresponde a emisión; el estado es el actual. Las anotaciones históricas sin reparto no se recalculan." },
  { type: "commissions", page: "reportRemittanceCommissions", label: "Comisión total cobrada en origen", scope: "Por fecha de emisión y estado actual de cada envío. Comisiones del negocio separadas por moneda; las canceladas se muestran aparte y no se suman al total vigente. La información manual del gestor se consulta por separado." },
  { type: "managerCommissions", page: "reportRemittanceManagerCommissions", label: "Información de comisiones de gestores", scope: "Información histórica declarada manualmente, por fecha de emisión y estado actual. Cada gestor y moneda se presenta por separado. Las canceladas se excluyen del vigente; este reporte no calcula ni registra pagos al gestor." },
  { type: "exchangeGain", page: "reportRemittanceExchangeGain", label: "Ganancia por cambio", scope: "Lo que gana la empresa al comprar la moneda del que envía y vender la del que recibe (venta menos compra registradas ese día), en pesos y por fecha de envío. Los cancelados se muestran aparte. Los envíos anteriores al 29-10-2026 no tienen este cálculo." },
  { type: "times", page: "reportRemittanceTimes", label: "Tiempos de entrega", scope: "Por fecha de pago. Muestra el mínimo, máximo y promedio, junto con el detalle de emisión y pago." },
  { type: "delivered", page: "reportRemittanceDelivered", label: "Remesas entregadas", scope: "Por fecha de pago. Cada moneda conserva sus propios importes." },
  { type: "cash", page: "reportRemittanceCash", label: "Caja de remesas", scope: "Por fecha de caja. Aperturas y saldos finales no se suman entre días." },
] as const;
export type RemittanceReportType = (typeof remittanceReportDefinitions)[number]["type"];
export type RemittanceReportPage = (typeof remittanceReportDefinitions)[number]["page"];
export type RemittanceReportFilters = {
  type: RemittanceReportType; from: string; to: string; grouping: "range" | "day";
  groupBy: CommissionReportGroupBy; operationStatus: CommissionReportStatus; managerId: string; currency: Currency | "";
};
export const isRemittanceReportPage = (page: string): page is RemittanceReportPage =>
  remittanceReportDefinitions.some((definition) => definition.page === page);
export const remittanceReportDefinition = (type: RemittanceReportType) =>
  remittanceReportDefinitions.find((definition) => definition.type === type)!;
export const remittanceReportForPage = (page: RemittanceReportPage) =>
  remittanceReportDefinitions.find((definition) => definition.page === page)!;

/** Both entry points use the same strict, read-only API contract. */
export function remittanceReportPath(filters: RemittanceReportFilters): string {
  if (!filters.from || !filters.to || filters.from > filters.to) throw new Error("Revisa las fechas del reporte.");
  const query = new URLSearchParams({ from: filters.from, to: filters.to, grouping: filters.grouping });
  if (filters.type === "allocations") {
    query.set("groupBy", filters.groupBy); query.set("status", filters.operationStatus);
    if (filters.managerId) query.set("managerId", filters.managerId);
    if (filters.currency) query.set("currency", filters.currency);
    return `/envios/reportes/comisiones?${query}`;
  }
  return `/envios/reportes?${query}`;
}

/** Only presentation: keep server amounts, annulments and currency totals intact. */
export function remittanceReportSections(type: RemittanceReportType, report: Report | null, allocationReport: ConsolidatedCommissionReport | null, operatorName: (id: string) => string): OutputSection[] {
  if (allocationReport) return consolidatedCommissionSections(allocationReport);
  if (!report) return [];
  const money = formatMoney;
  switch (type) {
    case "amounts": return [{ title: "Montos de envíos por moneda de origen y destino", columns: ["Fecha", "Origen", "Destino", "Envíos", "Pendientes", "Pagados", "Cancelados", "Principal origen", "Comisión origen", "Total origen", "A entregar destino"], rows: report.amounts.map((row) => [row.date, row.sourceCurrency, row.destinationCurrency, row.count, row.pendingCount, row.paidCount, row.cancelledCount, money(row.amount, row.sourceCurrency), money(row.commissionAmount, row.sourceCurrency), money(row.totalAmount, row.sourceCurrency), money(row.receiveAmount, row.destinationCurrency)]) }];
    case "times": return [{ title: "Tiempo desde el envío hasta el pago", columns: ["Fecha", "Pagados", "Mínimo (min)", "Máximo (min)", "Promedio (min)"], rows: (report.deliveryTimeSummary ?? []).map((row) => [row.date, row.count, (row.minSeconds / 60).toFixed(1), (row.maxSeconds / 60).toFixed(1), (row.averageSeconds / 60).toFixed(1)]) }, { title: "Detalle de emisión y pago", columns: ["Envío", "Emitido", "Pagado", "Tiempo (min)"], rows: report.deliveryTimes.map((row) => [row.envioReference, formatDate(row.createdAt), formatDate(row.paidAt), (row.elapsedSeconds / 60).toFixed(1)]) }];
    case "delivered": return [{ title: "Entregados por fecha de pago y moneda", columns: ["Fecha", "Moneda", "Pagados", "Importe entregado"], rows: report.delivered.map((row) => [row.date, row.currency, row.count, money(row.amount, row.currency)]) }];
    case "commissions": return commissionSections(report.commissions ?? { details: [], totals: [] }, operatorName);
    case "managerCommissions": return managerCommissionSections(report.managerCommissions ?? { details: [], totals: [] });
    case "exchangeGain": {
      const gains = report.exchangeGains ?? { details: [], totals: [], legacyCount: 0 };
      const dop = (cents: number) => money(cents, "DOP");
      return [
        { title: "Ganancia por cambio por fecha y monedas (DOP)", columns: ["Fecha", "Origen", "Destino", "Envíos vigentes", "Al comprar", "Al vender", "Ganancia", "Cancelados", "Ganancia anulada"],
          rows: gains.totals.map((row) => [row.date, row.sourceCurrency, row.destinationCurrency, row.count, dop(row.sourceAmount), dop(row.destinationAmount), dop(row.totalAmount), row.cancelledCount, dop(row.cancelledTotalAmount)]) },
        { title: "Detalle por envío", columns: ["Envío", "Fecha", "Monedas", "Enviado", "Monto en destino", "Al comprar", "Al vender", "Ganancia", "Estado"],
          rows: gains.details.map((row) => [row.envioReference, formatDate(row.createdAt), `${row.sourceCurrency} → ${row.destinationCurrency}`, money(row.amount, row.sourceCurrency), money(row.receiveAmount, row.destinationCurrency),
            dop(row.sourceAmount), dop(row.destinationAmount), dop(row.totalAmount), row.status === "cancelled" ? "Cancelado (excluido)" : row.status === "paid" ? "Pagado" : "Pendiente"]) },
        ...(gains.legacyCount ? [{ title: "Envíos sin este cálculo", columns: ["Dato", "Valor"], rows: [["Envíos anteriores al 29-10-2026 (sin ganancia calculada)", gains.legacyCount]] }] : []),
      ];
    }
    case "cash": return [{ title: "Caja de remesas por operador y moneda", columns: ["Fecha", "Operador", "Moneda", "Cajas", "Primera apertura", "Ingresos envíos", "Devoluciones", "Pagos", "Último esperado"], rows: (report.cashSummary ?? []).map((row) => [row.date, operatorName(row.operatorId), row.currency, row.sessionCount, money(row.firstOpening, row.currency), money(row.sentTotal, row.currency), money(row.cancelRefund, row.currency), money(row.paid, row.currency), money(row.lastExpected, row.currency)]) }];
    case "allocations": return [];
  }
}

export const remittanceReportTitle = (type: RemittanceReportType, report: Pick<Report, "from" | "to" | "grouping">) =>
  `${remittanceReportDefinition(type).label} · ${report.from} a ${report.to} · ${report.grouping === "day" ? "Diario" : "Resumido"}`;
