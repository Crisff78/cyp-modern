import assert from "node:assert/strict";
import test from "node:test";
import { loadCollectorAssignments, parseLimit, saveCollectorAssignments, type CollectorAssignment } from "../src/collectorAssignmentsState";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
} });
const zone: CollectorAssignment = { id: "zone-1", number: "1", name: "Zona ficticia", from: "Inicio", to: "Fin" };

test("an unsaved draft cannot mutate the collector's saved assignments", () => {
  saveCollectorAssignments("draft-test", "zones", [zone]);
  const draft = loadCollectorAssignments("draft-test", "zones", []);
  draft.splice(0, 1);
  assert.deepEqual(loadCollectorAssignments("draft-test", "zones", []), [zone]);
});
test("assignments stay isolated by collector and relation", () => {
  saveCollectorAssignments("isolation-a", "zones", [zone]);
  assert.deepEqual(loadCollectorAssignments("isolation-b", "zones", []), []);
  assert.deepEqual(loadCollectorAssignments("isolation-a", "routes", []), []);
});
test("saving an empty list preserves intentional removals instead of reseeding", () => {
  saveCollectorAssignments("empty-test", "zones", []);
  assert.deepEqual(loadCollectorAssignments("empty-test", "zones", [zone]), []);
});
test("valid persisted records hydrate and corrupt storage falls back safely", () => {
  store.set("cyp-collector-assignments-v1:hydrate-test:zones", JSON.stringify([zone]));
  assert.deepEqual(loadCollectorAssignments("hydrate-test", "zones", []), [zone]);
  store.set("cyp-collector-assignments-v1:corrupt-test:zones", '{"bad":');
  assert.deepEqual(loadCollectorAssignments("corrupt-test", "zones", [zone]), [zone]);
});
test("currency limits preserve cents and reject unsafe or undefined values", () => {
  assert.equal(parseLimit("1250.25"), 125025);
  assert.equal(parseLimit("0"), 0);
  for (const value of ["", "-1", "NaN", "1.001", "9007199254740991"]) assert.throws(() => parseLimit(value));
  assert.throws(() => saveCollectorAssignments("bad-limit", "limits", [zone]));
});
test("replacing currency limits does not duplicate a currency", () => {
  const limit = { ...zone, id: "USD", collectionLimit: 100, payoutLimit: 50 };
  saveCollectorAssignments("limits-test", "limits", [limit, { ...limit, collectionLimit: 200 }]);
  const saved = loadCollectorAssignments("limits-test", "limits", []);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].collectionLimit, 200);
});
