import type { CommissionAllocation, ConsolidatedCommissionReport, Report, Transfer } from "./types";
import { formatDate, formatMoney, type OutputSection } from "./output";

export function allocationRows(allocation?: CommissionAllocation, status?: Transfer["status"]): (string | number)[][] {
  if (!allocation) return [["Reparto de comisión", "Sin reparto calculado (operación histórica)"]];
  const money = (value: number) => formatMoney(value, allocation.currency);
  return [
    ["Gestor del envío", allocation.managerName ?? "Operador del envío seleccionado"],
    ["Comisión de transacción convertida", money(allocation.transactionAmount)],
    ["Comisión de la empresa", money(allocation.companyAmount)],
    [`Comisión del gestor (${allocation.managerCommissionBps / 100}%)`, money(allocation.managerAmount)],
    ["Base del gestor (importe final de destino)", money(allocation.baseAmount)],
    ["Devengo", status === "cancelled" ? "Anulado por cancelación; excluido del acumulado vigente" : "Al crear la remesa; no representa un pago al gestor"],
  ];
}

export function allocationSections(report: NonNullable<Report["commissionAllocations"]>): OutputSection[] {
  return [
    { title: "Reparto de comisiones por gestor y moneda de destino", columns: ["Fecha de emisión", "Gestor", "Moneda", "Vigentes", "Comisión transacción", "Empresa", "Gestor", "Canceladas", "Transacción anulada", "Empresa anulada", "Gestor anulado"],
      rows: report.totals.map((row) => [row.date, row.managerName, row.currency, row.count,
        formatMoney(row.transactionAmount, row.currency), formatMoney(row.companyAmount, row.currency), formatMoney(row.managerAmount, row.currency), row.cancelledCount,
        formatMoney(row.cancelledTransactionAmount, row.currency), formatMoney(row.cancelledCompanyAmount, row.currency), formatMoney(row.cancelledManagerAmount, row.currency)]) },
    { title: "Detalle de devengos y anulaciones", columns: ["Envío", "Emitido", "Gestor", "Moneda", "Base destino", "% gestor", "Transacción", "Empresa", "Gestor", "Estado"],
      rows: report.details.map((row) => [row.envioReference, formatDate(row.createdAt), row.managerName ?? row.managerId ?? "—", row.currency,
        formatMoney(row.baseAmount, row.currency), row.managerCommissionBps / 100, formatMoney(row.transactionAmount, row.currency), formatMoney(row.companyAmount, row.currency), formatMoney(row.managerAmount, row.currency),
        row.status === "cancelled" ? "Anulado (excluido del acumulado)" : "Devengado"]) },
  ];
}

export const consolidatedCommissionColumns = ["Comisión Total de la Transacción", "Comisión de la Empresa", "Comisión del Gestor"];
export const commissionReportStatusLabels = { all: "Todas", active: "Vigentes (pendientes y pagadas)", pending: "Pendiente de entrega", paid: "Pagado", cancelled: "Cancelado" };
export function consolidatedCommissionSections(report: ConsolidatedCommissionReport): OutputSection[] {
  const amounts = (row: { transactionAmount: number; companyAmount: number; managerAmount: number; currency: string }) =>
    [formatMoney(row.transactionAmount, row.currency), formatMoney(row.companyAmount, row.currency), formatMoney(row.managerAmount, row.currency)];
  const annulled = (row: { cancelledTransactionAmount: number; cancelledCompanyAmount: number; cancelledManagerAmount: number; currency: string }) =>
    [formatMoney(row.cancelledTransactionAmount, row.currency), formatMoney(row.cancelledCompanyAmount, row.currency), formatMoney(row.cancelledManagerAmount, row.currency)];
  const cancelledColumns = ["Comisión Transacción Anulada", "Comisión Empresa Anulada", "Comisión Gestor Anulada"];
  return [
    { title: "Filtros del reporte consolidado", columns: ["Filtro", "Valor"], rows: [
      ["Periodo de emisión", `${report.from} a ${report.to}`], ["Estado", commissionReportStatusLabels[report.status]],
      ["Gestor (ID)", report.managerId ?? "Todos"], ["Moneda de destino", report.currency ?? "Todas (totales separados)"],
      ["Agrupar por", report.groupBy === "currency" ? "Moneda" : "Gestor y Moneda"], ["Presentación", report.grouping === "day" ? "Diario" : "Resumido del periodo"],
      ["Operaciones históricas sin reparto (excluidas)", report.excludedLegacyCount],
    ] },
    { title: report.groupBy === "currency" ? "Comisiones agrupadas por Moneda" : "Comisiones agrupadas por Gestor y Moneda",
      columns: ["Periodo", ...(report.groupBy === "managerCurrency" ? ["Gestor", "ID Gestor"] : []), "Moneda", "Operaciones Vigentes", "Canceladas", ...consolidatedCommissionColumns, ...cancelledColumns],
      rows: report.groups.map((row) => [row.date, ...(report.groupBy === "managerCurrency" ? [row.managerName ?? "—", row.managerId ?? "—"] : []), row.currency, row.count, row.cancelledCount, ...amounts(row), ...annulled(row)]) },
    { title: "Totales del periodo por Moneda", columns: ["Total", "Moneda", "Operaciones Vigentes", "Canceladas", ...consolidatedCommissionColumns, ...cancelledColumns],
      rows: report.currencyTotals.map((row) => ["Total", row.currency, row.count, row.cancelledCount, ...amounts(row), ...annulled(row)]) },
    { title: "Detalle de operaciones y anulaciones", columns: ["Envío", "Fecha de Emisión", "Gestor", "ID Gestor", "Moneda", "Estado", ...consolidatedCommissionColumns, ...cancelledColumns],
      rows: report.details.map((row) => [row.envioReference, formatDate(row.createdAt), row.managerName ?? "—", row.managerId ?? "—", row.currency,
        commissionReportStatusLabels[row.status], ...amounts(row.status === "cancelled" ? { ...row, transactionAmount: 0, companyAmount: 0, managerAmount: 0 } : row),
        ...annulled({ currency: row.currency, cancelledTransactionAmount: row.status === "cancelled" ? row.transactionAmount : 0,
          cancelledCompanyAmount: row.status === "cancelled" ? row.companyAmount : 0, cancelledManagerAmount: row.status === "cancelled" ? row.managerAmount : 0 })]) },
  ];
}
