import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ApiError } from "../../client-admin/src/api.js";
import {
  createChargeImportController,
  type ChargeImportResult,
} from "../../client-admin/src/useChargeImportRequest.js";
import { buildApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";

type StorageLike = Parameters<typeof createChargeImportController>[1];
type Transport = NonNullable<Parameters<typeof createChargeImportController>[2]>;
type PendingAttempt = { key: string; body: string; fileName: string };
type Call = { key: string; body: string; status: number };
type ResponseControl = { lose?: boolean; result?: ChargeImportResult; status?: number };
const identification = "QA-IMPORT-CONTROLLER";
const actor = "demo-admin";

class TestStorage implements StorageLike {
  readonly values = new Map<string, string>();
  failSet = false;
  failRemove = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failSet) throw new Error("Synthetic storage quota exceeded");
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemove) throw new Error("Synthetic storage cleanup failed");
    this.values.delete(key);
  }
}

const body = (service: string, amount = 1250) => ({ filas: [{
  identificacion: identification, servicio: service, importe: amount,
}] });
const pending = (storage: TestStorage): PendingAttempt => {
  assert.equal(storage.values.size, 1);
  return JSON.parse([...storage.values.values()][0]) as PendingAttempt;
};
const storageContents = (storage: TestStorage) => [...storage.values.entries()];
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

async function setup(t: TestContext) {
  const fixture = seed();
  fixture.clients.find((client) => client.id === "cli-1")!.code = identification;
  const store = new MemoryStore(fixture);
  const app = await buildApp({ store, secret: "synthetic-import-controller-test-secret", demo: true,
    origins: [], collectorUrl: "http://qa-synthetic.invalid" });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login",
    payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200);
  const token = login.json().token as string;
  const calls: Call[] = [];
  let next: ResponseControl = {};
  const transport: Transport = async <T,>(path: string, options: RequestInit): Promise<T> => {
    assert.equal(path, "/cargos/importar");
    assert.equal(options.method, "POST");
    const key = new Headers(options.headers).get("Idempotency-Key");
    assert.ok(key && key.length >= 8 && key.length <= 100);
    const requestBody = String(options.body);
    const control = next;
    next = {};
    const response = await app.inject({ method: "POST", url: `/api${path}`, payload: requestBody,
      headers: { "content-type": "application/json", authorization: `Bearer ${control.status === 401 ? "synthetic-expired-session" : token}`, "idempotency-key": key } });
    calls.push({ key, body: requestBody, status: response.statusCode });
    if (control.lose) {
      assert.equal(response.statusCode, 200);
      throw new TypeError("Synthetic response lost after actual MemoryStore commit");
    }
    if (control.status) assert.equal(response.statusCode, control.status);
    if (response.statusCode >= 400)
      throw new ApiError(response.json().error.message, response.statusCode, false);
    return (control.result ?? response.json()) as T;
  };
  return { store, calls, transport, control: (value: ResponseControl) => { next = value; } };
}

test("charge import restores a lost committed reply after controller reload with the same key and body", async (t) => {
  const { store, calls, transport, control } = await setup(t);
  const storage = new TestStorage();
  const first = createChargeImportController(actor, storage, transport);
  const before = await store.read();
  const payload = body("QA controller lost reply");
  control({ lose: true });
  await assert.rejects(first.run(payload, "lost.csv"), /lost after actual/);
  const committed = await store.read();
  assert.equal(committed.charges.length, before.charges.length + 1);
  assert.deepEqual(committed.movements, before.movements);
  const saved = pending(storage);
  assert.equal(saved.body, JSON.stringify(payload));
  assert.equal(saved.fileName, "lost.csv");
  assert.equal(first.getSnapshot().uncertain, true);

  // A new controller models closing/reopening the tab or renewing the UI session.
  const restored = createChargeImportController(actor, storage, transport);
  assert.deepEqual(restored.getSnapshot().attempt, saved);
  assert.equal(restored.getSnapshot().uncertain, true);
  assert.deepEqual(await restored.run(), { creados: 1, errores: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, calls[1].key);
  assert.equal(calls[0].body, calls[1].body);
  assert.deepEqual(await store.read(), committed, "Replaying the saved import must not append another charge or audit event.");
  assert.equal(storage.values.size, 0);
  assert.equal(restored.getSnapshot().attempt, undefined);
  assert.equal(restored.getSnapshot().uncertain, false);
});

test("concurrent charge-import clicks share one in-flight API request", async (t) => {
  const { store, calls, transport } = await setup(t);
  const storage = new TestStorage();
  const release = deferred<void>();
  const delayed: Transport = async <T,>(path: string, options: RequestInit) => {
    await release.promise;
    return transport<T>(path, options);
  };
  const controller = createChargeImportController(actor, storage, delayed);
  const before = await store.read();
  const payload = body("QA controller double click");
  const first = controller.run(payload, "double.csv");
  const second = controller.run(payload, "double.csv");
  assert.strictEqual(first, second);
  assert.equal(controller.getSnapshot().busy, true);
  release.resolve();
  assert.deepEqual(await Promise.all([first, second]), [{ creados: 1, errores: [] }, { creados: 1, errores: [] }]);
  assert.equal(calls.length, 1);
  assert.equal((await store.read()).charges.length, before.charges.length + 1);
  assert.equal(storage.values.size, 0);
});

test("pending imports are isolated by actor while using the same browser storage", async () => {
  const storage = new TestStorage();
  const calls: { actor: string; key: string; body: string }[] = [];
  const transportFor = (actorId: string): Transport => {
    let lose = true;
    return async <T,>(_path: string, options: RequestInit) => {
      calls.push({ actor: actorId, key: new Headers(options.headers).get("Idempotency-Key")!, body: String(options.body) });
      if (lose) { lose = false; throw new TypeError("Synthetic actor reply lost"); }
      return { creados: 1, errores: [] } as T;
    };
  };
  const first = createChargeImportController("synthetic-actor-a", storage, transportFor("a"));
  await assert.rejects(first.run(body("Actor A"), "actor-a.csv"));
  const firstAttempt = first.getSnapshot().attempt;
  const second = createChargeImportController("synthetic-actor-b", storage, transportFor("b"));
  assert.equal(second.getSnapshot().attempt, undefined);
  assert.equal(second.getSnapshot().uncertain, false);
  await assert.rejects(second.run(body("Actor B"), "actor-b.csv"));
  assert.equal(storage.values.size, 2);
  assert.notEqual(firstAttempt?.key, second.getSnapshot().attempt?.key);
  await first.run();
  assert.equal(storage.values.size, 1);
  assert.deepEqual(pending(storage), second.getSnapshot().attempt);
  await second.run();
  assert.equal(storage.values.size, 0);
  assert.equal(calls[0].key, calls[2].key);
  assert.equal(calls[1].key, calls[3].key);
});

test("a first definitive HTTP 400 clears the attempt and corrected data uses a new key", async (t) => {
  const { store, calls, transport } = await setup(t);
  const storage = new TestStorage();
  const controller = createChargeImportController(actor, storage, transport);
  const before = await store.read();
  await assert.rejects(controller.run(body(""), "invalid.csv"), (error: unknown) => error instanceof ApiError && error.status === 400);
  assert.equal(storage.values.size, 0);
  assert.equal(controller.getSnapshot().attempt, undefined);
  assert.equal(controller.getSnapshot().uncertain, false);
  assert.deepEqual(await store.read(), before);
  await controller.run(body("QA corrected after 400"), "corrected.csv");
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].key, calls[1].key);
  assert.equal((await store.read()).charges.length, before.charges.length + 1);
});

test("an inconsistent HTTP 200 count preserves the committed import for a keyed replay", async (t) => {
  const { store, calls, transport, control } = await setup(t);
  const storage = new TestStorage();
  const controller = createChargeImportController(actor, storage, transport);
  control({ result: { creados: 0, errores: [] } });
  await assert.rejects(controller.run(body("QA inconsistent count"), "count.csv"),
    (error: unknown) => error instanceof ApiError && error.status === 200 && error.uncertain === true);
  const committed = await store.read();
  const saved = pending(storage);
  assert.equal(controller.getSnapshot().uncertain, true);
  const restored = createChargeImportController(actor, storage, transport);
  assert.deepEqual(await restored.run(), { creados: 1, errores: [] });
  assert.equal(calls[1].key, saved.key);
  assert.equal(calls[1].body, saved.body);
  assert.deepEqual(await store.read(), committed);
});

test("storage quota failure stops an import before any API request", async (t) => {
  const { store, calls, transport } = await setup(t);
  const storage = new TestStorage();
  storage.failSet = true;
  const controller = createChargeImportController(actor, storage, transport);
  const before = await store.read();
  await assert.rejects(controller.run(body("QA quota blocked"), "quota.csv"), /No se envi/);
  assert.equal(calls.length, 0);
  assert.equal(storage.values.size, 0);
  assert.equal(controller.getSnapshot().busy, false);
  assert.deepEqual(await store.read(), before);
  storage.failSet = false;
  await controller.run(body("QA quota recovered"), "quota.csv");
  assert.equal(calls.length, 1);
  assert.equal((await store.read()).charges.length, before.charges.length + 1);
});

test("failed local cleanup after HTTP 200 retains the same key until a replay clears it", async (t) => {
  const { store, calls, transport } = await setup(t);
  const storage = new TestStorage();
  storage.failRemove = true;
  const controller = createChargeImportController(actor, storage, transport);
  await assert.rejects(controller.run(body("QA cleanup failure"), "cleanup.csv"),
    (error: unknown) => error instanceof ApiError && error.status === 200 && error.uncertain === true);
  const committed = await store.read();
  const saved = pending(storage);
  assert.equal(controller.getSnapshot().uncertain, true);
  assert.equal(controller.getSnapshot().attempt?.key, saved.key);
  storage.failRemove = false;
  assert.deepEqual(await controller.run(), { creados: 1, errores: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].key, calls[0].key);
  assert.equal(calls[1].body, calls[0].body);
  assert.deepEqual(await store.read(), committed);
  assert.equal(storage.values.size, 0);
  assert.equal(controller.getSnapshot().attempt, undefined);
});

test("a previously idle controller cannot overwrite another controller's pending import", async (t) => {
  const { store, calls, transport, control } = await setup(t);
  const storage = new TestStorage();
  const first = createChargeImportController(actor, storage, transport);
  const idleSibling = createChargeImportController(actor, storage, transport);
  control({ lose: true });
  await assert.rejects(first.run(body("QA existing pending"), "existing.csv"));
  const saved = storageContents(storage);
  const committed = await store.read();
  await assert.rejects(idleSibling.run(body("QA must not replace"), "other.csv"), /pendiente/);
  assert.equal(calls.length, 1);
  assert.deepEqual(storageContents(storage), saved);
  assert.deepEqual(await store.read(), committed);
  assert.deepEqual(idleSibling.getSnapshot().attempt, first.getSnapshot().attempt);
});

test("a restored pending controller rejects a different file and then explicitly replays its saved import", async (t) => {
  const { store, calls, transport, control } = await setup(t);
  const storage = new TestStorage();
  const first = createChargeImportController(actor, storage, transport);
  control({ lose: true });
  await assert.rejects(first.run(body("QA reload pending"), "reload.csv"));
  const committed = await store.read();
  const saved = storageContents(storage);
  const restored = createChargeImportController(actor, storage, transport);
  await assert.rejects(restored.run(body("QA replacement denied"), "replacement.csv"), /pendiente/);
  assert.equal(calls.length, 1);
  assert.deepEqual(storageContents(storage), saved);
  await restored.run();
  assert.equal(calls[1].key, calls[0].key);
  assert.deepEqual(await store.read(), committed);
});

test("a stale in-memory attempt cannot replace a newer pending attempt in shared storage", async (t) => {
  const { store, calls, transport, control } = await setup(t);
  const storage = new TestStorage();
  const first = createChargeImportController(actor, storage, transport);
  control({ lose: true });
  await assert.rejects(first.run(body("QA old attempt X"), "x.csv"));
  const stale = createChargeImportController(actor, storage, transport);
  const oldKey = stale.getSnapshot().attempt?.key;
  await first.run();
  control({ lose: true });
  await assert.rejects(first.run(body("QA current attempt Y"), "y.csv"));
  assert.notEqual(first.getSnapshot().attempt?.key, oldKey);
  const savedY = storageContents(storage);
  const committed = await store.read();
  const count = calls.length;
  await assert.rejects(stale.run(), /pendiente|sustituid|otro/i);
  assert.equal(calls.length, count, "The stale controller must not issue its older POST.");
  assert.deepEqual(storageContents(storage), savedY, "The current pending reference must remain recoverable.");
  assert.deepEqual(await store.read(), committed);
});

test("HTTP 401 after an uncertain commit retains the original reference for session recovery", async (t) => {
  const { store, calls, transport, control } = await setup(t);
  const storage = new TestStorage();
  const controller = createChargeImportController(actor, storage, transport);
  control({ lose: true });
  await assert.rejects(controller.run(body("QA session recovery"), "session.csv"));
  const committed = await store.read();
  const saved = pending(storage);
  control({ status: 401 });
  await assert.rejects(controller.run(), (error: unknown) => error instanceof ApiError && error.status === 401);
  assert.deepEqual(pending(storage), saved);
  assert.equal(controller.getSnapshot().uncertain, true);
  await controller.run();
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.key === saved.key && call.body === saved.body));
  assert.deepEqual(await store.read(), committed);
  assert.equal(storage.values.size, 0);
});

test("HTTP 200 with duplicate error-row numbers remains uncertain even when its count adds up", async (t) => {
  const { store, calls, transport, control } = await setup(t);
  const storage = new TestStorage();
  const controller = createChargeImportController(actor, storage, transport);
  const payload = { filas: [...body("QA duplicate row A").filas, ...body("QA duplicate row B").filas] };
  control({ result: { creados: 0, errores: [{ fila: 1, mensaje: "Error A" }, { fila: 1, mensaje: "Error B" }] } });
  await assert.rejects(controller.run(payload, "duplicate-rows.csv"),
    (error: unknown) => error instanceof ApiError && error.uncertain === true);
  const committed = await store.read();
  const saved = pending(storage);
  assert.deepEqual(await controller.run(), { creados: 2, errores: [] });
  assert.equal(calls[1].key, saved.key);
  assert.deepEqual(await store.read(), committed);
});
