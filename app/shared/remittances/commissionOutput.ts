import type { CommissionAllocation, Report, Transfer } from "./types";
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
