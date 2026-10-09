import test from "node:test";
import assert from "node:assert/strict";
import { confirmedCommissionPolicy } from "./commissionPolicyResponse";
import { StrictApiError } from "./strictApi";

const expected = { transactionCommissionBps: 500, managerCommissionBps: 200 };
const policy = { ...expected, revision: "synthetic-policy" };
test("policy confirmation requires both persisted rates and a valid revision", () => {
  assert.equal(confirmedCommissionPolicy(policy, expected), policy);
  assert.equal(confirmedCommissionPolicy({ revision: "default", transactionCommissionBps: 0, managerCommissionBps: 0 }, { transactionCommissionBps: 0, managerCommissionBps: 0 }).managerCommissionBps, 0);
  for (const value of [null, {}, [], [policy], "saved", { ...policy, revision: "" }, { ...policy, revision: " padded " },
    { ...policy, transactionCommissionBps: undefined }, { ...policy, transactionCommissionBps: "500" },
    { ...policy, transactionCommissionBps: 501 }, { ...policy, managerCommissionBps: 201 }])
    assert.throws(() => confirmedCommissionPolicy(value, expected), (error: unknown) => error instanceof StrictApiError && error.uncertain);
});
