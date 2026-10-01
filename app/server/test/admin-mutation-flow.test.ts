import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { api, ApiError, getToken, setToken } from "../../client-admin/src/api";
import { createStrictApi, StrictApiError } from "../../shared/remittances/strictApi";
import { buildApp } from "../src/app.js";
import { businessDate, type Movement } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";

type CapturedRequest = {
  url: string;
  method: string;
  body: string | undefined;
  headers: Headers;
  status: number;
  response: { error?: { code?: string }; movement?: Movement; movements?: Movement[] };
};

async function setup(t: TestContext) {
  const state = seed();
  state.movements = [];
  state.depositEvents = [];
  state.clients.find((client) => client.id === "cli-1")!.code = "SINTETICO-IMPORTACION-FLUJO";
  const store = new MemoryStore(state);
  const app = await buildApp({
    store, secret: "synthetic-admin-flow-only-secret-2026", demo: true,
    origins: [], collectorUrl: "http://localhost:5174",
  });
  t.after(() => app.close());

  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (name: string, value: unknown) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const storage = new Map<string, string>();
  replace("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  replace("navigator", { onLine: true });
  let timer = 0, key = 0;
  replace("window", { setTimeout: () => ++timer, clearTimeout: () => undefined });
  replace("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(++key) });

  const requests: CapturedRequest[] = [];
  let lostResponsePath: string | undefined;
  replace("fetch", async (url: string, options: RequestInit = {}) => {
    assert.ok(String(url).startsWith("/api/"), "El fetch sintético solo alcanza app.inject().");
    const method = options.method?.toUpperCase() ?? "GET";
    assert.ok(method === "GET" || method === "POST");
    const headers = new Headers(options.headers);
    const body = options.body == null ? undefined : String(options.body);
    const result = await app.inject({
      method: method as "GET" | "POST", url: String(url),
      headers: Object.fromEntries(headers.entries()), payload: body,
    });
    requests.push({ url: String(url), method, body, headers, status: result.statusCode, response: result.json() });
    if (url === lostResponsePath && result.statusCode === 200) {
      lostResponsePath = undefined;
      throw new TypeError("Synthetic response lost after mutation commit");
    }
    return new Response(result.body, { status: result.statusCode, headers: { "Content-Type": "application/json" } });
  });

  const login = await api<{ token: string }>("/auth/login", {
    method: "POST", body: JSON.stringify({ email: "admin@cyp.local", password: "Demo-CyP-2026!" }),
  });
  assert.equal(requests[0].status, 200);
  assert.ok(login.token);
  setToken(login.token);
  const fundCash = async (amount: number) => {
    const result = await app.inject({
      method: "POST", url: "/api/cobros", payload: { chargeId: "chg-1", amount },
      headers: { authorization: `Bearer ${login.token}`, "idempotency-key": randomUUID() },
    });
    assert.equal(result.statusCode, 200, result.body);
  };
  const post = <T>(path: string, payload: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(payload) });
  const fundPayments = async (amount: number) => {
    const result = await app.inject({
      method: "POST", url: "/api/entregas", payload: { collectorId: "col-1", amount },
      headers: { authorization: `Bearer ${login.token}`, "idempotency-key": randomUUID() },
    });
    assert.equal(result.statusCode, 200, result.body);
  };
  return {
    store, requests, post, fundCash, fundPayments,
    loseNextDepositResponse: () => { lostResponsePath = "/api/depositos"; },
    loseNextPaymentResponse: () => { lostResponsePath = "/api/pagos/central"; },
  };
}

function assertAutomaticKeys(requests: CapturedRequest[], expected: number) {
  const mutations = requests.filter((request) => request.method === "POST" && request.url !== "/api/auth/login");
  assert.equal(mutations.length, expected);
  for (const request of mutations) {
    assert.equal(request.status, 200, request.url);
    assert.notEqual(request.response.error?.code, "IDEMPOTENCY_REQUIRED");
    const key = request.headers.get("Idempotency-Key") ?? "";
    assert.ok(key.length >= 8 && key.length <= 100, request.url);
    assert.match(key, /^[0-9a-f]{32}$/);
  }
}

test("admin api automatic keys pass real configuration, deposit lifecycle and import contracts", async (t) => {
  const { store, requests, post, fundCash } = await setup(t);
  const config = { empresa: "Empresa de prueba integrada", synthetic: true };
  assert.deepEqual(await post("/configuracion", { config }), { ok: true });
  assert.deepEqual(await api("/configuracion"), { config });
  assert.equal(requests.at(-1)?.status, 200);
  assert.equal(requests.at(-1)?.headers.has("Idempotency-Key"), false);

  await fundCash(100000);
  const accepted = await post<{ movement: Movement }>("/depositos", { collectorId: "col-1", amount: 20000 });
  const acceptance = await post<Movement>(`/depositos/${accepted.movement.id}/aceptar`, { desglose: [{ denominacion: 10000, cantidad: 2 }] });
  assert.equal(acceptance.id, accepted.movement.id);
  assert.ok(acceptance.acceptedAt);
  const pending = await post<{ movement: Movement }>("/depositos", { collectorId: "col-1", amount: 30000 });
  const cancellation = await post<Movement>(`/depositos/${pending.movement.id}/cancelar`, {});
  assert.equal(cancellation.id, pending.movement.id);
  assert.ok(cancellation.cancelledAt);

  const chargeImport = await post("/cargos/importar", { filas: [{
    identificacion: "SINTETICO-IMPORTACION-FLUJO", servicio: "Servicio de prueba integrada",
    importe: 12500, fecha: businessDate(), requerido: true,
  }] });
  assert.deepEqual(chargeImport, { creados: 1, errores: [] });
  const payoutImport = await post("/descargos/importar", { filas: [{
    identificacion: "SINTETICO-IMPORTACION-FLUJO", concepto: "Descargo de prueba integrada",
    importe: 8000, cobrador: "col-1",
  }] });
  assert.deepEqual(payoutImport, { creados: 1, errores: [] });
  const saved = await store.read();
  assert.deepEqual(saved.systemConfig, config);
  assert.equal(saved.movements.filter((movement) => movement.type === "deposit").length, 2);
  assert.deepEqual(saved.depositEvents.map((event) => [event.movementId, event.action]), [[accepted.movement.id, "accepted"], [pending.movement.id, "cancelled"]]);
  assert.ok(saved.charges.some((charge) => charge.clientId === "cli-1" && charge.service === "Servicio de prueba integrada" && charge.amount === 12500 && charge.required));
  assert.ok(saved.payouts.some((payout) => payout.clientId === "cli-1" && payout.collectorId === "col-1" && payout.concept === "Descargo de prueba integrada" && payout.amount === 8000));
  assertAutomaticKeys(requests, 7);
});

test("admin api retries a committed deposit after losing its response using the same automatic key", async (t) => {
  const { store, requests, post, fundCash, loseNextDepositResponse } = await setup(t);
  await fundCash(50000);
  const body = { collectorId: "col-1", amount: 15000 };
  loseNextDepositResponse();
  await assert.rejects(post("/depositos", body), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.uncertain, true);
    return true;
  });
  const committed = await store.read();
  const deposit = committed.movements.find((movement) => movement.type === "deposit")!;
  assert.ok(deposit);
  assert.equal(deposit.amount, body.amount);
  const replay = await post<{ movement: Movement }>("/depositos", body);
  assert.equal(replay.movement.id, deposit.id);
  assert.deepEqual(await store.read(), committed);
  const attempts = requests.filter((request) => request.url === "/api/depositos");
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1].response, attempts[0].response);
  assert.equal(attempts[1].body, attempts[0].body);
  assert.equal(attempts[1].headers.get("Idempotency-Key"), attempts[0].headers.get("Idempotency-Key"));
  assert.equal((await store.read()).movements.filter((movement) => movement.type === "deposit").length, 1);
  assertAutomaticKeys(requests, 2);
});

test("strict central payment replays a frozen explicit-key request after response loss and snapshot refresh", async (t) => {
  const { store, requests, fundPayments, loseNextPaymentResponse } = await setup(t);
  await fundPayments(100000);
  const strictApi = createStrictApi(getToken, () => false);
  const payload = Object.freeze({
    clientId: "cli-2", collectorId: "col-1",
    lines: Object.freeze([Object.freeze({ payoutId: "pay-1", amount: 25000 })]),
  });
  const key = "synthetic-fixed-payment-retry-key";
  const options = Object.freeze({
    method: "POST", body: JSON.stringify(payload),
    headers: Object.freeze({ "Idempotency-Key": key }),
  });
  type PaymentResult = { movements: Movement[]; receipts: Array<{ movementId: string; token: string; url: string }> };
  type PaymentSnapshot = { payouts: Array<{ id: string; paid: number; status: string }> };
  const before = await api<PaymentSnapshot>("/snapshot");
  assert.equal(before.payouts.find((payout) => payout.id === "pay-1")?.paid, 0);
  loseNextPaymentResponse();
  await assert.rejects(strictApi<PaymentResult>("/pagos/central", options), (error: unknown) => {
    assert.ok(error instanceof StrictApiError);
    assert.equal(error.status, 0);
    assert.equal(error.uncertain, true);
    return true;
  });
  const refreshed = await api<PaymentSnapshot>("/snapshot");
  assert.equal(refreshed.payouts.find((payout) => payout.id === "pay-1")?.paid, 25000);
  assert.equal(refreshed.payouts.find((payout) => payout.id === "pay-1")?.status, "partial");
  const committed = await store.read();
  const replay = await strictApi<PaymentResult>("/pagos/central", options);
  const attempts = requests.filter((request) => request.url === "/api/pagos/central");
  assert.equal(attempts.length, 2);
  attempts.forEach((request) => {
    assert.equal(request.status, 200);
    assert.notEqual(request.response.error?.code, "IDEMPOTENCY_REQUIRED");
    assert.equal(request.headers.get("Idempotency-Key"), key);
    assert.equal(request.body, options.body);
  });
  assert.deepEqual(replay, attempts[0].response);
  assert.deepEqual(attempts[1].response, attempts[0].response);
  assert.equal(replay.movements.length, 1);
  assert.equal(replay.receipts.length, 1);
  assert.equal(replay.receipts[0].movementId, replay.movements[0].id);
  assert.equal(replay.receipts[0].token, replay.movements[0].receiptToken);
  assert.deepEqual(await store.read(), committed);
  assert.equal(committed.movements.filter((movement) => movement.type === "payout").length, 1);
});
