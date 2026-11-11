import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultCashRange,
  filterCashSessions,
  historicalUnlinkedCarry,
  previousOpenCash,
  previousOpenCashDate,
  remittanceCashNotice,
} from "./cashNotice";
import type { Cash } from "./types";

const box = (values: Partial<Cash>): Pick<Cash, "operatorId" | "currency" | "date" | "status"> => ({ operatorId: "op-1", currency: "DOP", date: "2026-10-18", status: "open", ...values });

test("the cash notice compares the operator's open boxes with the business date", () => {
  const at = (...cashSessions: ReturnType<typeof box>[]) => ({ businessDate: "2026-10-18", cashSessions });
  assert.equal(remittanceCashNotice(at(box({})), "op-1", "DOP"), "ok");
  assert.equal(remittanceCashNotice(at(), "op-1", "DOP"), "missing");
  // One box per operator, currency and day: a box of today already closed is not opened again (CASH_EXISTS).
  assert.equal(remittanceCashNotice(at(box({ status: "closed" })), "op-1", "DOP"), "closedToday", "a closed box of today is not a missing one");
  assert.equal(remittanceCashNotice(at(box({ status: "closed", currency: "USD" })), "op-1", "DOP"), "missing", "a box closed today in another currency does not count");
  assert.equal(remittanceCashNotice(at(box({ currency: "USD" })), "op-1", "DOP"), "missing", "another currency does not count");
  assert.equal(remittanceCashNotice(at(box({ operatorId: "op-2" })), "op-1", "DOP"), "missing", "another operator does not count");
  assert.equal(remittanceCashNotice(at(box({ date: "2026-10-17" })), "op-1", "DOP"), "previousOpen");
  assert.equal(remittanceCashNotice(at(box({ date: "2026-10-17", status: "closed" })), "op-1", "DOP"), "missing");
  assert.equal(remittanceCashNotice(at(box({ date: "2026-10-17" }), box({})), "op-1", "DOP"), "ok", "the box of today wins");
  assert.equal(previousOpenCashDate(at(box({ date: "2026-10-16" }), box({ date: "2026-10-15" }), box({ date: "2026-10-14", currency: "USD" })), "op-1", "DOP"), "2026-10-15");
  assert.equal(previousOpenCash(at(box({ date: "2026-10-16" }), box({ date: "2026-10-15" })), "op-1", "DOP")?.date, "2026-10-15");
  assert.equal(previousOpenCashDate(at(box({})), "op-1", "DOP"), undefined);
});

test("defaultCashRange brings at least the last two comparative dates and filterCashSessions sorts newest first", () => {
  const businessDate = "2026-11-04";
  assert.deepEqual(defaultCashRange({ businessDate, cashSessions: [] }), { from: "2026-11-03", to: "2026-11-04" });
  assert.deepEqual(
    defaultCashRange({ businessDate, cashSessions: [box({ date: "2026-11-04" }), box({ date: "2026-11-03", status: "closed" })] }),
    { from: "2026-11-03", to: "2026-11-04" },
  );
  // Multi-day or weekend gap: reaches back to the second latest date for the selected operator and currency.
  const sessions = [
    box({ operatorId: "demo-admin", currency: "EUR", date: "2026-10-10", status: "closed" }),
    box({ operatorId: "demo-admin", currency: "EUR", date: "2026-11-04", status: "open" }),
    box({ operatorId: "op-2", currency: "DOP", date: "2026-11-03", status: "closed" }),
  ];
  assert.deepEqual(defaultCashRange({ businessDate, cashSessions: sessions }, "demo-admin", "EUR"), { from: "2026-10-10", to: "2026-11-04" });
  // When more than two dates exist, only the last two comparative dates anchor the default range.
  const many = ["2026-10-28", "2026-10-30", "2026-11-01", "2026-11-04"].map((date) => box({ date, status: "closed" }));
  assert.deepEqual(defaultCashRange({ businessDate, cashSessions: many }), { from: "2026-11-01", to: "2026-11-04" });

  const filtered = filterCashSessions(
    [
      box({ date: "2026-10-10", status: "open", currency: "EUR" }),
      box({ date: "2026-11-01", status: "closed", currency: "EUR" }),
      box({ date: "2026-11-03", status: "closed", currency: "EUR" }),
      box({ date: "2026-11-04", status: "open", currency: "EUR" }),
    ],
    { from: "2026-11-03", to: "2026-11-04", operatorId: "op-1", currency: "EUR" },
    businessDate,
  );
  // Includes 2026-11-04, 2026-11-03, plus the still-open 2026-10-10 box because `to` covers businessDate; excludes closed 2026-11-01.
  assert.deepEqual(filtered.map((row) => row.date), ["2026-11-04", "2026-11-03", "2026-10-10"]);
});

test("historicalUnlinkedCarry flags pre-rule zero openings without a recorded discharge and ignores linked carries", () => {
  const auditBox = (values: Partial<Cash>) => ({
    id: "cash-1",
    operatorId: "demo-admin",
    currency: "EUR" as const,
    date: "2026-10-10",
    status: "closed" as const,
    openedAt: "2026-10-10T12:00:00.000Z",
    openingAmount: 50000,
    countedAmount: 50000,
    discharged: 0,
    carry: 50000,
    ...values,
  });
  const oct10 = auditBox({ id: "oct-10", date: "2026-10-10", openingAmount: 50000, countedAmount: 50000, carry: 50000 });
  const oct11Zero = auditBox({ id: "oct-11", date: "2026-10-11", openedAt: "2026-10-11T12:00:00.000Z", openingAmount: 0, countedAmount: 0, carry: 0 });
  assert.deepEqual(historicalUnlinkedCarry([oct10, oct11Zero], oct11Zero), { date: "2026-10-10", carry: 50000, discharged: 0 });

  const oct11Linked = auditBox({ ...oct11Zero, openingAmount: 50000, carriedFrom: "oct-10" });
  assert.equal(historicalUnlinkedCarry([oct10, oct11Linked], oct11Linked), undefined);
});
