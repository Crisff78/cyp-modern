import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { api, ApiError } from "../src/api";

function transport(t: TestContext) {
  const properties = new Map<string, PropertyDescriptor | undefined>();
  const set = (name: string, value: unknown) => {
    properties.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  t.after(() => {
    for (const [name, descriptor] of properties) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const storage = new Map<string, string>([["cyp-admin-token", "synthetic-fix27-actor"]]);
  set("localStorage", { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key) });
  set("navigator", { onLine: true });
  set("window", { setTimeout: () => 1, clearTimeout: () => undefined });
  const requests: Array<{ method: string; body: string; key: string | null }> = [];
  const effects = new Map<string, unknown>();
  let loseReply = true;
  set("fetch", async (_url: string, options: RequestInit) => {
    const key = new Headers(options.headers).get("Idempotency-Key");
    const request = { method: options.method!, body: String(options.body), key };
    requests.push(request);
    assert.ok(key, "A connected mutation must carry an operation key");
    const result = effects.get(key) ?? { saved: true, id: `synthetic-${effects.size + 1}` };
    effects.set(key, result);
    if (loseReply) { loseReply = false; throw new TypeError("Synthetic reply loss after commit"); }
    return new Response(JSON.stringify(result), { status: 200 });
  });
  return { requests, effects };
}

for (const [id, path, method] of [
  ["018", "/entregas", "POST"],
  ["020", "/cargos", "POST"],
  ["032", "/descargos", "POST"],
  ["036", "/clientes/synthetic-client/tragamonedas/synthetic-machine", "POST"],
  ["020", "/cargos/synthetic-charge", "POST"],
  ["032", "/descargos/synthetic-payout", "POST"],
  ["021", "/clientes/synthetic-client/tragamonedas", "POST"],
] as const) {
  test(`CYP-QA-${id}: adapter preserves one committed effect after lost reply`, async (t) => {
    const { requests, effects } = transport(t);
    const body = JSON.stringify({ synthetic: true, amount: 1975 });
    await assert.rejects(api(path, { method, body }), (error: unknown) =>
      error instanceof ApiError && error.uncertain === true && error.status === 0);
    const recovered = await api<{ id: string }>(path, { method, body });
    assert.equal(recovered.id, "synthetic-1");
    assert.equal(effects.size, 1);
    assert.deepEqual(requests[0], requests[1]);
    await api(path, { method, body });
    assert.equal(effects.size, 2, "An acknowledged subsequent intent receives a new key");
  });
}

test("CYP-QA-036: explicit caller-owned machine key survives the adapter", async (t) => {
  const { requests, effects } = transport(t);
  const options = { method: "POST", body: JSON.stringify({ entry: "123", exit: "456" }),
    headers: new Headers({ "idempotency-key": "fix27-explicit-machine-intent" }) };
  await assert.rejects(api("/clientes/synthetic-client/tragamonedas/synthetic-machine", options));
  await api("/clientes/synthetic-client/tragamonedas/synthetic-machine", options);
  assert.equal(effects.size, 1);
  assert.equal(requests[1].key, "fix27-explicit-machine-intent");
});
