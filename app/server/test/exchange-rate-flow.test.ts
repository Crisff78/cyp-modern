import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { businessDate, type State } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import type { ExchangeRate } from "../src/remittances.js";

async function setup(initial: State = seed()) {
  const store = new MemoryStore(initial);
  const app = await buildApp({
    store, secret: "synthetic-exchange-rate-flow-secret-at-least-32",
    demo: true, origins: [], collectorUrl: "http://127.0.0.1:5174",
  });
  const login = async (email: string) => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { email, password: "Demo-CyP-2026!" } });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().token as string;
  };
  const adminToken = await login("admin@cyp.local");
  const collectorToken = await login("collector@cyp.local");
  const post = (payload: Record<string, unknown>, key = randomUUID(), token = adminToken) =>
    app.inject({ method: "POST", url: "/api/envios/tasas", payload,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  const snapshot = async (token = adminToken) => {
    const response = await app.inject({ url: "/api/envios/snapshot",
      headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  return { app, store, post, snapshot, collectorToken, date: (await snapshot()).businessDate as string };
}

function shiftedDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

test("rate API creates USD, EUR and DOP with server timestamps and explicit history", async () => {
  const { app, store, post, snapshot, date } = await setup();
  try {
    for (const [currency, input, normalized] of [
      ["USD", "00060.1", "60.100000"], ["EUR", "65.123456", "65.123456"], ["DOP", "1", "1.000000"],
    ]) {
      const before = Date.now();
      const response = await post({ currency, rate: input, date });
      const after = Date.now();
      assert.equal(response.statusCode, 200, response.body);
      const saved = response.json<ExchangeRate>();
      assert.equal(saved.currency, currency); assert.equal(saved.rate, normalized); assert.equal(saved.date, date);
      assert.ok(saved.id); assert.ok(saved.changeId); assert.equal(saved.updatedBy, "demo-admin");
      assert.ok(saved.updatedAt);
      assert.ok(Date.parse(saved.updatedAt) >= before && Date.parse(saved.updatedAt) <= after);
      const change = (await store.read()).remittances.rateHistory!.find((row) => row.id === saved.changeId)!;
      assert.equal(change.createdAt, saved.updatedAt); assert.equal(change.actorId, saved.updatedBy);
      assert.equal(change.rate, saved.rate); assert.equal(change.currency, saved.currency); assert.equal(change.date, date);
    }
    const current = await snapshot();
    assert.equal(current.rateHistory.length, 3);
    assert.equal(current.rates.filter((row: ExchangeRate) => row.date === date).length, 3);
  } finally { await app.close(); }
});

test("intraday rate edits preserve the daily id and the previous immutable revision", async () => {
  const { app, store, post, date } = await setup();
  try {
    const firstResponse = await post({ currency: "USD", rate: "60", date });
    assert.equal(firstResponse.statusCode, 200, firstResponse.body);
    const first = firstResponse.json<ExchangeRate>();
    const previous = structuredClone((await store.read()).remittances.rateHistory![0]);
    const editResponse = await post({ currency: "USD", rate: "61.123456", date });
    assert.equal(editResponse.statusCode, 200, editResponse.body);
    const edited = editResponse.json<ExchangeRate>();
    assert.equal(edited.id, first.id); assert.notEqual(edited.changeId, first.changeId);
    assert.equal(edited.rate, "61.123456");
    const state = await store.read();
    assert.equal(state.remittances.rateHistory!.length, 2);
    assert.deepEqual(state.remittances.rateHistory![0], previous);
    assert.equal(state.remittances.rateHistory![1].createdAt, edited.updatedAt);
    assert.equal(state.remittances.rates[0].changeId, edited.changeId);
  } finally { await app.close(); }
});

test("an equivalent-value save is a no-op and preserves its registered timestamp", async () => {
  const { app, store, post, date } = await setup();
  try {
    const firstResponse = await post({ currency: "USD", rate: "60", date });
    assert.equal(firstResponse.statusCode, 200, firstResponse.body);
    const before = structuredClone((await store.read()).remittances);
    const sameResponse = await post({ currency: "USD", rate: "060.000000", date });
    assert.equal(sameResponse.statusCode, 200, sameResponse.body);
    assert.deepEqual(sameResponse.json(), firstResponse.json());
    assert.deepEqual((await store.read()).remittances, before);
  } finally { await app.close(); }
});

test("same-key concurrent/replayed saves do not overwrite a later rate revision", async () => {
  const { app, store, post, date } = await setup();
  try {
    const body = { currency: "USD", rate: "60", date }, key = randomUUID();
    const responses = await Promise.all([post(body, key), post(body, key)]);
    for (const response of responses) assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(responses[0].json(), responses[1].json());
    assert.equal((await store.read()).remittances.rateHistory!.length, 1);
    const edit = await post({ ...body, rate: "61" });
    assert.equal(edit.statusCode, 200, edit.body);
    const beforeReplay = structuredClone((await store.read()).remittances);
    const replay = await post(body, key);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), responses[0].json());
    assert.deepEqual((await store.read()).remittances, beforeReplay);
    const conflict = await post({ ...body, rate: "60.000000" }, key);
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error.code, "IDEMPOTENCY_CONFLICT");
    assert.deepEqual((await store.read()).remittances, beforeReplay);
  } finally { await app.close(); }
});

test("previous/future dates and malformed rates fail without rates or history being saved", async () => {
  const { app, store, post, date } = await setup();
  try {
    const before = structuredClone((await store.read()).remittances);
    for (const invalidDate of [shiftedDate(date, -1), shiftedDate(date, 1)]) {
      const response = await post({ currency: "USD", rate: "60", date: invalidDate });
      assert.equal(response.statusCode, 422, response.body);
      assert.equal(response.json().error.code, "RATE_DATE");
    }
    for (const rate of ["", "0", "0.000000", "-1", "+1", "1e2", "1,25", ".5", "1.", "1.0000001", "1000000000000", "NaN", "Infinity", " 1 "]) {
      const response = await post({ currency: "USD", rate, date });
      assert.equal(response.statusCode, 422, `${rate}: ${response.body}`);
      assert.equal(response.json().error.code, "INVALID_RATE");
    }
    for (const body of [
      { currency: "USD", rate: 60, date }, { currency: "GBP", rate: "60", date },
      { currency: "USD", rate: "60", date: "2026-02-30" },
      { currency: "USD", rate: "60", date, hour: "12:34:56" },
    ]) {
      const response = await post(body);
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().error.code, "VALIDATION");
    }
    assert.deepEqual((await store.read()).remittances, before);
  } finally { await app.close(); }
});

test("rate precision supports the full numeric(18,6) boundary and keeps DOP fixed at one", async () => {
  const { app, store, post, date } = await setup();
  try {
    for (const rate of ["0.000001", "999999999999.999999"]) {
      const response = await post({ currency: "EUR", rate, date });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().rate, rate);
    }
    const before = structuredClone((await store.read()).remittances);
    for (const rate of ["2", "1.000001"]) {
      const response = await post({ currency: "DOP", rate, date });
      assert.equal(response.statusCode, 422, response.body);
      assert.equal(response.json().error.code, "DOP_RATE");
    }
    assert.deepEqual((await store.read()).remittances, before);
    const dop = await post({ currency: "DOP", rate: "1.000000", date });
    assert.equal(dop.statusCode, 200, dop.body);
    assert.equal(dop.json().rate, "1.000000");
  } finally { await app.close(); }
});

test("collector permissions reject rate saves and hide the administrative rate history", async () => {
  const { app, store, post, snapshot, collectorToken, date } = await setup();
  try {
    const saved = await post({ currency: "USD", rate: "60", date });
    assert.equal(saved.statusCode, 200, saved.body);
    const before = structuredClone((await store.read()).remittances);
    const rejected = await post({ currency: "USD", rate: "61", date }, randomUUID(), collectorToken);
    assert.equal(rejected.statusCode, 403, rejected.body);
    assert.equal(rejected.json().error.code, "FORBIDDEN");
    assert.deepEqual((await store.read()).remittances, before);
    const visible = await snapshot(collectorToken);
    assert.equal(visible.rateHistory.length, 0);
    const current = visible.rates.find((row: ExchangeRate) => row.currency === "USD" && row.date === date);
    assert.equal(current.updatedAt, saved.json().updatedAt); assert.equal(current.updatedBy, undefined);
  } finally { await app.close(); }
});

test("a legacy rate receives its first known timestamp only after explicit confirmation", async () => {
  const initial = seed(), date = businessDate();
  initial.remittances.rates.push({ id: "synthetic-legacy-usd", currency: "USD", rate: "60", date });
  const { app, store, post, snapshot } = await setup(initial);
  try {
    const before = (await snapshot()).rates.find((row: ExchangeRate) => row.id === "synthetic-legacy-usd");
    assert.equal(before.updatedAt, undefined); assert.equal(before.changeId, undefined);
    assert.equal((await store.read()).remittances.rateHistory?.length ?? 0, 0);
    const response = await post({ currency: "USD", rate: "60", date });
    assert.equal(response.statusCode, 200, response.body);
    const saved = response.json<ExchangeRate>();
    assert.equal(saved.id, before.id); assert.ok(saved.updatedAt); assert.ok(saved.changeId);
    assert.equal((await store.read()).remittances.rateHistory!.length, 1);
  } finally { await app.close(); }
});
