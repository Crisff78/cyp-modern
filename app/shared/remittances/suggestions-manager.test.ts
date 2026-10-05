import assert from "node:assert/strict";
import test from "node:test";
import { managerCommissionMatches, managerCommissionRows, managerCommissionSections, parseManagerCommission } from "./suggestions";

test("unchecked manager information stays absent and does not manufacture zero or a currency", () => {
  assert.equal(parseManagerCommission(false, "", "", ""), undefined);
  assert.deepEqual(managerCommissionRows(), [["Comisión informativa del gestor", "No registrada en esta operación"]]);
  assert.equal(managerCommissionMatches(undefined, undefined), true);
  assert.equal(managerCommissionMatches(undefined, { managerName: "Default", amount: 0, currency: "DOP" }), false);
});

test("manual manager information requires an explicit name, amount and supported currency", () => {
  assert.throws(() => parseManagerCommission(true, " ", "1.23", "EUR"), /nombre del gestor/);
  assert.throws(() => parseManagerCommission(true, "Gestor", "1.23", ""), /moneda/);
  assert.throws(() => parseManagerCommission(true, "Gestor", "", "EUR"), /importe/);
  assert.throws(() => parseManagerCommission(true, "Gestor", "1.23", "HTG"), /moneda/);
  assert.deepEqual(parseManagerCommission(true, " Gestor declarado ", "1.23", "EUR"), { managerName: "Gestor declarado", amount: 123, currency: "EUR" });
  assert.deepEqual(parseManagerCommission(true, "Gestor", "0", "USD"), { managerName: "Gestor", amount: 0, currency: "USD" });
});

test("manual money remains exact at the safe-cent boundary and rejects unsafe, fractional or negative amounts", () => {
  assert.equal(parseManagerCommission(true, "Gestor", "90071992547409.91", "USD")?.amount, Number.MAX_SAFE_INTEGER);
  for (const value of ["90071992547409.92", "0.001", "-1", "NaN"]) assert.throws(() => parseManagerCommission(true, "Gestor", value, "USD"));
});

test("confirmation requires the exact manual snapshot after retry, irrespective of JSON property order", () => {
  const expected = { managerName: "Gestor", amount: 123, currency: "EUR" as const };
  assert.equal(managerCommissionMatches(expected, { currency: "EUR", amount: 123, managerName: "Gestor" }), true);
  for (const actual of [undefined, null, { ...expected, amount: 124 }, { ...expected, currency: "DOP" }, { ...expected, managerName: "Operador inferido" }, { ...expected, extra: 0 }]) assert.equal(managerCommissionMatches(expected, actual), false);
});

test("manager output separates declared names/currencies and cancelled information from current totals", () => {
  const [totals, details] = managerCommissionSections({ totals: [{ date: "2026-10-05", managerName: "A", currency: "EUR", count: 1, amount: 123, cancelledCount: 1, cancelledAmount: 500 }, { date: "2026-10-05", managerName: "A", currency: "USD", count: 1, amount: 0, cancelledCount: 0, cancelledAmount: 0 }], details: [{ id: "x", envioReference: "E1", createdAt: "2026-10-05T06:00:00Z", status: "cancelled", managerName: "A", amount: 500, currency: "EUR" }] });
  assert.deepEqual(totals.rows.map(row => [row[1], row[2], row[4], row[6]]), [["A", "EUR", "EUR 1.23", "EUR 5.00"], ["A", "USD", "USD 0.00", "USD 0.00"]]);
  assert.equal(details.rows[0][5], "Cancelado (excluido del total vigente)");
  assert.match(totals.title, /manual/);
  assert.match(managerCommissionRows({ managerName: "A", amount: 123, currency: "EUR" })[2][1] as string, /no se suma al cobro/);
});
