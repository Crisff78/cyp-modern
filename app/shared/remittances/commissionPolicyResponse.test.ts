import test from "node:test";
import assert from "node:assert/strict";
import { confirmedCommissionPolicy } from "./commissionPolicyResponse";
import { StrictApiError } from "./strictApi";

const expected = { transactionCommissionBps: 500, managerShareBps: 4000, receiveRounding: "none" as const };
const policy = { ...expected, managerCommissionBps: 200, revision: "synthetic-policy" };
test("policy confirmation requires the commission, the manager's share of it, the rounding and a valid revision", () => {
  assert.equal(confirmedCommissionPolicy(policy, expected), policy);
  assert.equal(confirmedCommissionPolicy({ revision: "default", transactionCommissionBps: 0, managerShareBps: 0, receiveRounding: "none" }, { transactionCommissionBps: 0, managerShareBps: 0, receiveRounding: "none" }).managerShareBps, 0);
  // The manager's share is a part of the commission: 100% of it is allowed even with a small total.
  assert.equal(confirmedCommissionPolicy({ ...policy, transactionCommissionBps: 100, managerShareBps: 10000 }, { ...expected, transactionCommissionBps: 100, managerShareBps: 10000 }).managerShareBps, 10000);
  for (const value of [null, {}, [], [policy], "saved", { ...policy, revision: "" }, { ...policy, revision: " padded " },
    { ...policy, transactionCommissionBps: undefined }, { ...policy, transactionCommissionBps: "500" },
    { ...policy, transactionCommissionBps: 501 }, { ...policy, managerShareBps: 4001 }, { ...policy, managerShareBps: 10001 },
    { ...policy, receiveRounding: "up" }, { ...policy, receiveRounding: "abajo" }, { ...policy, receiveRounding: undefined }])
    assert.throws(() => confirmedCommissionPolicy(value, expected), (error: unknown) => error instanceof StrictApiError && error.uncertain);
});
