import test from "node:test";
import assert from "node:assert/strict";
import { unconfirmedCollectionBalances } from "../src/collectionAlerts";
import type { Movement } from "../src/types";

test("acknowledged cash returns clear collection alerts without accepting a pending deposit or mixing currencies", () => {
  const rows: Movement[] = [
    { id: "cash", type: "collection", collectorId: "a", amount: 1000, currency: "DOP", createdAt: "2026-10-12T12:00:00Z" },
    { id: "pending", type: "deposit", collectorId: "a", amount: 700, currency: "DOP", createdAt: "2026-10-12T13:00:00Z" },
    { id: "dollars", type: "collection", collectorId: "a", amount: 100, currency: "USD", createdAt: "2026-10-12T12:00:00Z" },
  ];
  const before = structuredClone(rows);
  const receipts = [{ collectorId: "a", currency: "DOP" as const, returnedCollection: 300 }];
  assert.deepEqual(unconfirmedCollectionBalances(rows, receipts).map((row) => [row.currency, row.amount]), [["DOP", 700n], ["USD", 100n]]);
  const accepted = rows.map((row) => row.id === "pending" ? { ...row, acceptedAt: "2026-10-15T12:00:00Z" } : row);
  assert.deepEqual(unconfirmedCollectionBalances(accepted, receipts).map((row) => [row.currency, row.amount]), [["USD", 100n]]);
  assert.deepEqual(rows, before);
  assert.deepEqual(unconfirmedCollectionBalances(rows, [{ collectorId: "other", currency: "DOP", returnedCollection: 1000 }]), unconfirmedCollectionBalances(rows));
  assert.throws(() => unconfirmedCollectionBalances(rows, [{ collectorId: "a", currency: "DOP", returnedCollection: Number.MAX_SAFE_INTEGER + 1 }]));
});
