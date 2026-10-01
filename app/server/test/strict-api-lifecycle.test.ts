import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { api, ApiError } from "../../client-admin/src/api.js";
import { createStrictApi, StrictApiError } from "../../shared/remittances/strictApi.js";
import { buildApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";

type Capture = { path: string; key: string | null; body?: string; status?: number };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
type Hold = { committed: ReturnType<typeof deferred<Capture>>; released: ReturnType<typeof deferred<void>> };
type ResponseControl = { loss?: boolean; invalidJson?: boolean; status?: number; hold?: Hold };
const config = (value: string): RequestInit => ({ method: "POST", body: JSON.stringify({ config: { "qa.lifecycle": value } }) });
const reason = (value: string): RequestInit => ({ method: "POST", body: JSON.stringify({ reason: value, active: true }) });

async function setup(t: TestContext) {
  const fixture = seed();
  fixture.delayReasons = [];
  fixture.idempotency = [];
  const store = new MemoryStore(fixture);
  const app = await buildApp({ store, secret: `synthetic-strict-lifecycle-${randomUUID()}`, demo: true, origins: [], collectorUrl: "http://qa-synthetic.invalid" });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200);
  const token = login.json().token as string;
  const created = await app.inject({ method: "POST", url: "/api/motivos-atraso", headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() }, payload: { reason: "Synthetic initial reason", active: true } });
  assert.equal(created.statusCode, 200);
  const catalogPath = `/motivos-atraso/${created.json().id}`;

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
  const storage = new Map<string, string>([["cyp-admin-token", token]]);
  replace("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  replace("navigator", { onLine: true });
  replace("window", { setTimeout, clearTimeout });
  const calls: Capture[] = [];
  const controls: ResponseControl[] = [];
  replace("fetch", async (input: string | URL | Request, options: RequestInit = {}) => {
    const path = String(input);
    assert.ok(path.startsWith("/api/"), "All requests must stay inside app.inject");
    const headers = new Headers(options.headers);
    const call: Capture = { path, key: headers.get("Idempotency-Key"), body: options.body === undefined ? undefined : String(options.body) };
    calls.push(call);
    const control = controls.shift() ?? {};
    if (control.status) {
      call.status = control.status;
      return Response.json({ error: { code: "SYNTHETIC_UNAVAILABLE", message: "Synthetic unavailable response" } }, { status: control.status });
    }
    const method = (options.method ?? "GET").toUpperCase();
    assert.ok(method === "GET" || method === "POST", "This isolated adapter supports only the exercised HTTP methods");
    const response = await app.inject({ method, url: path, headers: Object.fromEntries(headers), ...(call.body ? { payload: call.body } : {}) });
    call.status = response.statusCode;
    if (control.hold) { control.hold.committed.resolve(call); await control.hold.released.promise; }
    if (control.loss) throw new TypeError("Synthetic response lost after actual MemoryStore commit");
    return new Response(control.invalidJson ? "invalid-json" : response.body, { status: response.statusCode, headers: { "Content-Type": "application/json" } });
  });
  const holdNext = () => {
    const hold: Hold = { committed: deferred<Capture>(), released: deferred<void>() };
    controls.push({ hold });
    t.after(() => hold.released.resolve());
    return hold;
  };
  return { store, app, calls, controls, holdNext, catalogPath, strict: createStrictApi(() => token, () => false) };
}

test("admin configuration A response lost, B saved, then A is a new persisted operation", async (t) => {
  const f = await setup(t);
  f.controls.push({ loss: true });
  await assert.rejects(api("/configuracion", config("A")), (error: unknown) => error instanceof ApiError && error.uncertain === true);
  assert.equal((await f.store.read()).systemConfig?.["qa.lifecycle"], "A");
  await api("/configuracion", config("B"));
  await api("/configuracion", config("A"));
  assert.equal((await f.store.read()).systemConfig?.["qa.lifecycle"], "A");
  assert.equal(new Set(f.calls.map((call) => call.key)).size, 3);
});

test("catalog A response lost, B saved, then A persists with a fresh key", async (t) => {
  const f = await setup(t);
  f.controls.push({ loss: true });
  await assert.rejects(f.strict(f.catalogPath, reason("Synthetic A")), StrictApiError);
  await f.strict(f.catalogPath, reason("Synthetic B"));
  await f.strict(f.catalogPath, reason("Synthetic A"));
  assert.equal((await f.store.read()).delayReasons[0].reason, "Synthetic A");
  assert.equal(new Set(f.calls.map((call) => call.key)).size, 3);
});

test("unchanged uncertain retry retains the key and confirms the original commit", async (t) => {
  const f = await setup(t);
  f.controls.push({ loss: true });
  await assert.rejects(f.strict("/configuracion", config("same")), (error: unknown) => error instanceof StrictApiError && error.uncertain);
  const committed = await f.store.read();
  await f.strict("/configuracion", config("same"));
  assert.equal(f.calls[0].key, f.calls[1].key);
  assert.equal(f.calls[0].body, f.calls[1].body);
  assert.deepEqual(await f.store.read(), committed);
  await f.strict("/configuracion", config("same"));
  assert.notEqual(f.calls[2].key, f.calls[0].key, "Confirmed success must retire the operation");
});

test("simultaneous unchanged submissions share one request and one commit", async (t) => {
  const f = await setup(t);
  const before = await f.store.read();
  const hold = f.holdNext();
  const first = f.strict("/configuracion", config("double click"));
  await hold.committed.promise;
  const second = f.strict("/configuracion", config("double click"));
  assert.equal(f.calls.length, 1);
  hold.released.resolve();
  assert.deepEqual(await first, await second);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.store.read()).idempotency.length, before.idempotency.length + 1);
});

test("superseded response cannot report success or erase the current uncertain key", async (t) => {
  const f = await setup(t);
  const hold = f.holdNext();
  const old = f.strict("/configuracion", config("old A"));
  const superseded = assert.rejects(old, (error: unknown) => error instanceof StrictApiError && error.code === "REQUEST_SUPERSEDED" && !error.uncertain);
  await hold.committed.promise;
  f.controls.push({ loss: true });
  await assert.rejects(f.strict("/configuracion", config("current B")), StrictApiError);
  hold.released.resolve();
  await superseded;
  await f.strict("/configuracion", config("current B"));
  assert.equal(f.calls[1].key, f.calls[2].key, "Old cleanup must not retire B's retry key");
  assert.notEqual(f.calls[0].key, f.calls[1].key);
  assert.equal((await f.store.read()).systemConfig?.["qa.lifecycle"], "current B");
});

test("mutations on different paths do not retire an unrelated uncertain attempt", async (t) => {
  const f = await setup(t);
  f.controls.push({ loss: true });
  await assert.rejects(f.strict("/configuracion", config("pending configuration")), StrictApiError);
  await f.strict(f.catalogPath, reason("Independent catalog operation"));
  await f.strict("/configuracion", config("pending configuration"));
  assert.equal(f.calls[0].key, f.calls[2].key);
  assert.notEqual(f.calls[0].key, f.calls[1].key);
  assert.equal((await f.store.read()).delayReasons[0].reason, "Independent catalog operation");
});

test("caller-owned explicit keys remain unchanged for uncertain replay and a later operation", async (t) => {
  const f = await setup(t);
  const explicit = { ...config("explicit"), headers: new Headers({ "idempotency-key": "synthetic-caller-owned-first" }) };
  f.controls.push({ loss: true });
  await assert.rejects(f.strict("/configuracion", explicit), StrictApiError);
  const committed = await f.store.read();
  await f.strict("/configuracion", explicit);
  assert.deepEqual(await f.store.read(), committed);
  await f.strict("/configuracion", { ...config("explicit"), headers: { "Idempotency-Key": "synthetic-caller-owned-next" } });
  assert.deepEqual(f.calls.map((call) => call.key), ["synthetic-caller-owned-first", "synthetic-caller-owned-first", "synthetic-caller-owned-next"]);
});

test("503 and invalid JSON keep the same automatic key until a valid response confirms the commit", async (t) => {
  const f = await setup(t);
  f.controls.push({ status: 503 }, { invalidJson: true });
  await assert.rejects(f.strict("/configuracion", config("recover")), (error: unknown) => error instanceof StrictApiError && error.status === 503 && error.uncertain);
  await assert.rejects(f.strict("/configuracion", config("recover")), (error: unknown) => error instanceof StrictApiError && error.status === 200 && error.uncertain);
  const committed = await f.store.read();
  await f.strict("/configuracion", config("recover"));
  assert.equal(new Set(f.calls.map((call) => call.key)).size, 1);
  assert.deepEqual(await f.store.read(), committed);
});

test("definitive validation failures preserve strict error fields and retire their automatic key", async (t) => {
  const f = await setup(t);
  const before = await f.store.read();
  const options = { method: "POST", body: JSON.stringify({}) };
  for (let i = 0; i < 2; i++) {
    await assert.rejects(f.strict("/configuracion", options), (error: unknown) => error instanceof StrictApiError && error.status === 400 && error.code === "VALIDATION" && !error.uncertain);
  }
  assert.notEqual(f.calls[0].key, f.calls[1].key);
  assert.deepEqual(await f.store.read(), before);
});
