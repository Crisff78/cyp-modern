import assert from "node:assert/strict";
import test from "node:test";
import { remittanceOperatorName } from "./operatorNames";

test("an operator is named from the operators list, then from the names of the visible operations", () => {
  const snapshot = { operators: [{ id: "op-self", name: "Cajero Beto", role: "cashier" as const }], operatorNames: { "op-self": "Cajero Beto", "op-other": "Cajera Ana" } };
  assert.equal(remittanceOperatorName(snapshot, "op-self"), "Cajero Beto");
  assert.equal(remittanceOperatorName(snapshot, "op-other"), "Cajera Ana", "another operator of a visible operation keeps its name");
  assert.equal(remittanceOperatorName(snapshot, "op-unknown"), undefined, "an unknown id is never turned into a name");
  assert.equal(remittanceOperatorName(snapshot, "constructor"), undefined, "only the names sent by the server count");
  assert.equal(remittanceOperatorName({ operators: [] }, "op-other"), undefined, "an older answer without names still works");
  assert.equal(remittanceOperatorName(null, "op-self"), undefined);
  assert.equal(remittanceOperatorName(snapshot, undefined), undefined);
});
