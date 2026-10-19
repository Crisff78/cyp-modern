import assert from "node:assert/strict";
import test from "node:test";
import { previousOpenCashDate, remittanceCashNotice } from "./cashNotice";
import type { Cash } from "./types";

const box = (values: Partial<Cash>): Pick<Cash, "operatorId" | "currency" | "date" | "status"> => ({ operatorId: "op-1", currency: "DOP", date: "2026-10-18", status: "open", ...values });

test("the cash notice compares the operator's open boxes with the business date", () => {
  const at = (...cashSessions: ReturnType<typeof box>[]) => ({ businessDate: "2026-10-18", cashSessions });
  assert.equal(remittanceCashNotice(at(box({})), "op-1", "DOP"), "ok");
  assert.equal(remittanceCashNotice(at(), "op-1", "DOP"), "missing");
  assert.equal(remittanceCashNotice(at(box({ status: "closed" })), "op-1", "DOP"), "missing", "a closed box of today does not count");
  assert.equal(remittanceCashNotice(at(box({ currency: "USD" })), "op-1", "DOP"), "missing", "another currency does not count");
  assert.equal(remittanceCashNotice(at(box({ operatorId: "op-2" })), "op-1", "DOP"), "missing", "another operator does not count");
  assert.equal(remittanceCashNotice(at(box({ date: "2026-10-17" })), "op-1", "DOP"), "previousOpen");
  assert.equal(remittanceCashNotice(at(box({ date: "2026-10-17", status: "closed" })), "op-1", "DOP"), "missing");
  assert.equal(remittanceCashNotice(at(box({ date: "2026-10-17" }), box({})), "op-1", "DOP"), "ok", "the box of today wins");
  assert.equal(previousOpenCashDate(at(box({ date: "2026-10-16" }), box({ date: "2026-10-15" }), box({ date: "2026-10-14", currency: "USD" })), "op-1", "DOP"), "2026-10-15");
  assert.equal(previousOpenCashDate(at(box({})), "op-1", "DOP"), undefined);
});
