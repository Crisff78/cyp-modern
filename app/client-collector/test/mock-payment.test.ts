import assert from "node:assert/strict";
import { test } from "node:test";
import { mockApi, mockLedgerId } from "../src/mock.ts";
import type { Snapshot } from "../src/types.ts";

test("offline example retries original actor/key/body once and rejects a different payload", async () => {
  const values = new Map<string, string>();
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    assert.match(mockLedgerId, /^mock-ledger-/);
    await mockApi("/auth/login", { method: "POST", body: JSON.stringify({ email: "collector.demo", password: "Demo-CyP-2026!" }) });
    const before = await mockApi<Snapshot>("/snapshot");
    const charge = before.charges.find((item) => item.collected < item.amount)!;
    const request = { method: "POST", headers: { "Idempotency-Key": "synthetic-mock-key" }, body: JSON.stringify({ chargeId: charge.id, amount: 10000 }) };
    const first = await mockApi<{ receipt: { token: string } }>("/cobros", request);
    const retry = await mockApi<{ receipt: { token: string } }>("/cobros", request);
    assert.deepEqual(retry, first);
    const after = await mockApi<Snapshot>("/snapshot");
    assert.equal(after.movements.filter((item) => item.chargeId === charge.id).length, before.movements.filter((item) => item.chargeId === charge.id).length + 1);
    assert.equal(after.charges.find((item) => item.id === charge.id)!.collected, charge.collected + 10000);
    await assert.rejects(mockApi("/cobros", { ...request, body: JSON.stringify({ chargeId: charge.id, amount: 20000 }) }), /otra operación/);
    assert.equal((await mockApi<Snapshot>("/snapshot")).movements.length, after.movements.length);
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, "sessionStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
