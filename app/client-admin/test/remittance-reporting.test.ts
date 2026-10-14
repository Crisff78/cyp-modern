import assert from "node:assert/strict";
import test from "node:test";
import { remittanceReportDefinitions, remittanceReportPath, remittanceReportSections, type RemittanceReportFilters } from "../../shared/remittances/reporting";
import type { ConsolidatedCommissionReport, Report } from "../../shared/remittances/types";

const filters: RemittanceReportFilters = { type: "amounts", from: "2026-10-12", to: "2026-10-18", grouping: "range", groupBy: "managerCurrency", operationStatus: "cancelled", managerId: "gestor+1/ejemplo", currency: "USD" };

test("standalone report links keep the strict API query contract and encode only applicable filters", () => {
  for (const definition of remittanceReportDefinitions.filter((row) => row.type !== "allocations")) {
    const url = new URL(remittanceReportPath({ ...filters, type: definition.type }), "http://example.invalid");
    assert.equal(url.pathname, "/envios/reportes");
    assert.deepEqual([...url.searchParams.keys()].sort(), ["from", "grouping", "to"]);
  }
  const allocated = new URL(remittanceReportPath({ ...filters, type: "allocations" }), "http://example.invalid");
  assert.equal(allocated.pathname, "/envios/reportes/comisiones");
  assert.equal(allocated.searchParams.get("managerId"), filters.managerId);
  assert.equal(allocated.searchParams.get("currency"), "USD");
  assert.equal(allocated.searchParams.get("status"), "cancelled");
  assert.equal(allocated.searchParams.get("groupBy"), "managerCurrency");
  const all = new URL(remittanceReportPath({ ...filters, type: "allocations", managerId: "", currency: "" }), "http://example.invalid");
  assert.equal(all.searchParams.has("managerId"), false);
  assert.equal(all.searchParams.has("currency"), false);
  for (const range of [{ from: "", to: "2026-10-18" }, { from: "2026-10-18", to: "2026-10-12" }]) assert.throws(() => remittanceReportPath({ ...filters, ...range }), /fechas/);
});

const report: Report = {
  from: filters.from, to: filters.to, grouping: "range", deliveryTimes: [], deliveryTimeSummary: [], cash: [],
  amounts: [
    { date: "2026-10-12/2026-10-18", sourceCurrency: "USD", destinationCurrency: "DOP", count: 2, pendingCount: 1, paidCount: 0, cancelledCount: 1, amount: 10000, commissionAmount: 500, totalAmount: 10500, receiveAmount: 600000 },
    { date: "2026-10-12/2026-10-18", sourceCurrency: "EUR", destinationCurrency: "USD", count: 1, pendingCount: 0, paidCount: 1, cancelledCount: 0, amount: 2500, commissionAmount: 100, totalAmount: 2600, receiveAmount: 2750 },
  ],
  delivered: [{ date: "2026-10-12/2026-10-18", currency: "USD", count: 1, amount: 2750 }],
  cashSummary: [{ date: "2026-10-12/2026-10-18", operatorId: "qa-operator", currency: "USD", sessionCount: 2, firstOpening: 1000, lastExpected: 5000, sentTotal: 10000, cancelRefund: 500, paid: 5500 }],
};
test("report presentation preserves currency pairs, cancelled counts and server amounts without modifying the response", () => {
  const before = structuredClone(report);
  const amounts = remittanceReportSections("amounts", report, null, (id) => id)[0];
  assert.equal(amounts.rows.length, 2);
  assert.deepEqual(amounts.rows[0].slice(1), ["USD", "DOP", 2, 1, 0, 1, "USD 100.00", "USD 5.00", "USD 105.00", "DOP 6,000.00"]);
  assert.deepEqual(amounts.rows[1].slice(1, 3), ["EUR", "USD"]);
  assert.deepEqual(remittanceReportSections("delivered", report, null, (id) => id)[0].rows[0].slice(1), ["USD", 1, "USD 27.50"]);
  const cash = remittanceReportSections("cash", report, null, () => "Operador sintético")[0];
  assert.deepEqual(cash.rows[0].slice(1), ["Operador sintético", "USD", 2, "USD 10.00", "USD 100.00", "USD 5.00", "USD 55.00", "USD 50.00"]);
  assert.deepEqual(report, before);
});

test("commission reports retain separate annulled totals and never present a cancelled accrual as an active balance", () => {
  const totals = { count: 0, cancelledCount: 1, transactionAmount: 0, companyAmount: 0, managerAmount: 0, cancelledTransactionAmount: 500, cancelledCompanyAmount: 300, cancelledManagerAmount: 200 };
  const allocated: ConsolidatedCommissionReport = {
    from: filters.from, to: filters.to, grouping: "range", groupBy: "managerCurrency", status: "all", excludedLegacyCount: 0,
    groups: [{ ...totals, date: filters.from, currency: "USD", managerId: "qa-operator", managerName: "Gestor sintético" }],
    currencyTotals: [{ ...totals, currency: "USD" }],
    details: [{ version: 1, id: "qa-cancelled", envioReference: "ENV-QA-1", createdAt: "2026-10-13T16:00:00Z", status: "cancelled", managerId: "qa-operator", managerName: "Gestor sintético", currency: "USD", policyRevision: "qa-policy", managerCommissionBps: 200, baseAmount: 10000, transactionAmount: 500, companyAmount: 300, managerAmount: 200 }],
  };
  const before = structuredClone(allocated);
  const sections = remittanceReportSections("allocations", null, allocated, (id) => id);
  const summary = sections.find((section) => section.title === "Totales del periodo por Moneda")!;
  assert.deepEqual(summary.rows[0], ["Total", "USD", 0, 1, "USD 0.00", "USD 0.00", "USD 0.00", "USD 5.00", "USD 3.00", "USD 2.00"]);
  const detail = sections.find((section) => section.title === "Detalle de operaciones y anulaciones")!;
  assert.deepEqual(detail.rows[0].slice(-6), ["USD 0.00", "USD 0.00", "USD 0.00", "USD 5.00", "USD 3.00", "USD 2.00"]);
  assert.deepEqual(allocated, before);
});
