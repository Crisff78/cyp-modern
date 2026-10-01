import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { api, ApiError } from "../../client-admin/src/api";

type CapturedRequest = { url: string; body: BodyInit | null | undefined; headers: Headers };

function browserMocks(t: TestContext, token = "synthetic-api-session") {
  const original = new Map<string, PropertyDescriptor | undefined>();
  const replace = (name: string, value: unknown) => {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  t.after(() => {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const storage = new Map<string, string>(token ? [["cyp-admin-token", token]] : []);
  replace("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  replace("navigator", { onLine: true });
  let timer = 0;
  replace("window", { setTimeout: () => ++timer, clearTimeout: () => undefined });
  let key = 0;
  replace("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(++key) });
  const requests: CapturedRequest[] = [];
  const responses: (Response | Error)[] = [];
  replace("fetch", async (url: string, options: RequestInit = {}) => {
    requests.push({ url: String(url), body: options.body, headers: new Headers(options.headers) });
    const response = responses.shift();
    assert.ok(response, "Cada petición necesita una respuesta sintética preparada.");
    if (response instanceof Error) throw response;
    return response;
  });
  return { requests, responses, storage };
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

for (const path of [
  "/configuracion",
  "/depositos",
  "/depositos/synthetic-deposit/aceptar",
  "/depositos/synthetic-deposit/cancelar",
  "/cargos/importar",
  "/descargos/importar",
]) {
  test(`api ${path}: POST sends an automatic idempotency key`, async (t) => {
    const { requests, responses } = browserMocks(t);
    responses.push(jsonResponse({ saved: true }));
    const body = JSON.stringify({ synthetic: true });
    assert.deepEqual(await api(path, { method: "POST", body }), { saved: true });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `/api${path}`);
    assert.equal(requests[0].body, body);
    assert.equal(requests[0].headers.get("Authorization"), "Bearer synthetic-api-session");
    assert.equal(requests[0].headers.get("Content-Type"), "application/json");
    assert.match(requests[0].headers.get("Idempotency-Key") ?? "", /^[0-9a-f]{32}$/);
  });
}

test("api deposit replay: lost response retains the body and key; success releases the key", async (t) => {
  const { requests, responses } = browserMocks(t);
  const body = JSON.stringify({ collectorId: "synthetic-collector", amount: 100 });
  responses.push(new TypeError("Synthetic response loss"), jsonResponse({ movement: { id: "synthetic-deposit" } }), jsonResponse({ movement: { id: "synthetic-second-deposit" } }));
  await assert.rejects(api("/depositos", { method: "POST", body }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.uncertain, true);
    return true;
  });
  assert.deepEqual(await api("/depositos", { method: "POST", body }), { movement: { id: "synthetic-deposit" } });
  await api("/depositos", { method: "POST", body });
  assert.deepEqual(requests.map((request) => request.body), [body, body, body]);
  const keys = requests.map((request) => request.headers.get("Idempotency-Key"));
  assert.ok(keys[0]);
  assert.equal(keys[1], keys[0]);
  assert.notEqual(keys[2], keys[0]);
});

test("api strict mutations preserve explicit keys provided using Headers", async (t) => {
  const { requests, responses } = browserMocks(t);
  responses.push(jsonResponse({ accepted: true }));
  await api("/depositos/synthetic-deposit/aceptar", {
    method: "post",
    headers: new Headers({ "idempotency-key": "synthetic-explicit-key" }),
    body: JSON.stringify({ denominations: [] }),
  });
  assert.equal(requests[0].headers.get("Idempotency-Key"), "synthetic-explicit-key");
});

test("api invalid JSON response is uncertain and replay uses the same key", async (t) => {
  const { requests, responses } = browserMocks(t);
  const body = JSON.stringify({ syntheticImport: [] });
  responses.push(new Response("invalid synthetic JSON", { status: 200 }), jsonResponse({ creados: 1 }));
  await assert.rejects(api("/cargos/importar", { method: "POST", body }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 200);
    assert.equal(error.uncertain, true);
    return true;
  });
  await api("/cargos/importar", { method: "POST", body });
  assert.equal(requests[1].headers.get("Idempotency-Key"), requests[0].headers.get("Idempotency-Key"));
  assert.equal(requests[1].body, requests[0].body);
});

test("api server error preserves status, code and the pending key", async (t) => {
  const { requests, responses } = browserMocks(t);
  const body = JSON.stringify({ syntheticSetting: true });
  responses.push(jsonResponse({ error: { message: "Synthetic server failure", code: "SYNTHETIC_FAILURE" } }, 503), jsonResponse({ saved: true }));
  await assert.rejects(api("/configuracion", { method: "POST", body }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, "Synthetic server failure");
    assert.equal(error.status, 503);
    assert.equal(error.uncertain, true);
    assert.equal(error.code, "SYNTHETIC_FAILURE");
    return true;
  });
  await api("/configuracion", { method: "POST", body });
  assert.equal(requests[1].headers.get("Idempotency-Key"), requests[0].headers.get("Idempotency-Key"));
});

test("api prevalidation rejection is definitive and releases the automatic key", async (t) => {
  const { requests, responses } = browserMocks(t);
  const body = JSON.stringify({ syntheticImport: [] });
  responses.push(jsonResponse({ error: { message: "Synthetic validation", code: "VALIDATION" } }, 400), jsonResponse({ creados: 0 }));
  await assert.rejects(api("/descargos/importar", { method: "POST", body }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.uncertain, false);
    assert.equal(error.code, "VALIDATION");
    return true;
  });
  await api("/descargos/importar", { method: "POST", body });
  assert.notEqual(requests[1].headers.get("Idempotency-Key"), requests[0].headers.get("Idempotency-Key"));
});

test("api login remains available without a token and without an automatic key", async (t) => {
  const { requests, responses } = browserMocks(t, "");
  responses.push(jsonResponse({ token: "synthetic-login-result" }));
  assert.deepEqual(await api("/auth/login", { method: "POST", body: JSON.stringify({ email: "synthetic@example.invalid" }) }), { token: "synthetic-login-result" });
  assert.equal(requests[0].headers.has("Authorization"), false);
  assert.equal(requests[0].headers.has("Idempotency-Key"), false);
});

test("api GET configuration and unrelated mutations preserve their existing routing", async (t) => {
  const { requests, responses } = browserMocks(t);
  responses.push(jsonResponse({ config: {} }), jsonResponse({ saved: true }));
  await api("/configuracion");
  await api("/clientes", { method: "POST", body: JSON.stringify({ name: "Synthetic client" }), headers: { "Idempotency-Key": "synthetic-client-key" } });
  assert.equal(requests[0].headers.has("Idempotency-Key"), false);
  assert.equal(requests[1].headers.get("Idempotency-Key"), "synthetic-client-key");
});

test("api targeted mutation requires a connected session before sending", async (t) => {
  const { requests } = browserMocks(t, "");
  await assert.rejects(api("/depositos", { method: "POST", body: "{}" }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.equal(error.uncertain, false);
    return true;
  });
  assert.equal(requests.length, 0);
});

test("api mock mode continues to use mock configuration without network", async (t) => {
  const { requests } = browserMocks(t, "mock-token:synthetic-session");
  const result = await api<{ config: Record<string, unknown> }>("/configuracion");
  assert.ok(result.config);
  assert.equal(requests.length, 0);
});
