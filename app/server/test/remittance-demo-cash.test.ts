import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { MemoryStore, PostgresStore, type Store } from "../src/store.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";
import { addRemittanceCash, closeRemittanceCash, openRemittanceCash, withdrawRemittanceCash } from "../src/remittances.js";
import { reopenDemoRemittanceCash } from "../src/remittance-demo-cash.js";
import type { User } from "../src/domain.js";
import pg from "pg";

const admin: User = { id: "demo-admin", name: "Administración", role: "admin" };
const now = new Date("2026-11-11T16:00:00Z");
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

for (const currency of ["DOP", "USD", "EUR"] as const) test(`demo reopening preserves the ${currency} ledger across repeated closes`, () => {
  const state = seed();
  const cash = openRemittanceCash(state, admin, { operatorId: admin.id, currency, openingAmount: 10000 }, [admin], now);
  addRemittanceCash(state, admin, cash.id, { amount: 5000, note: "Entrega de prueba" }, now);
  withdrawRemittanceCash(state, admin, cash.id, { amount: 2000, note: "Retiro de prueba" }, now);
  closeRemittanceCash(state, admin, cash.id, 13000, now);
  const events = structuredClone(state.remittances.events), movements = structuredClone(state.remittances.cashMovements);
  const reopened = reopenDemoRemittanceCash(state, admin, cash.id, true, now);
  assert.equal(reopened.status, "open"); assert.equal(reopened.expected, 13000); assert.equal(reopened.openingAmount, 10000);
  assert.equal(reopened.countedAmount, undefined); assert.equal(reopened.closedAt, undefined);
  assert.deepEqual(state.remittances.events.slice(0, events.length), events);
  assert.deepEqual(state.remittances.cashMovements, movements);
  assert.equal(state.remittances.cashSessions.length, 1);
  assert.throws(() => reopenDemoRemittanceCash(state, admin, cash.id, true, now), code("CASH_REOPEN_BLOCKED"));
  addRemittanceCash(state, admin, cash.id, { amount: 1000 }, now);
  closeRemittanceCash(state, admin, cash.id, 14000, now);
  reopenDemoRemittanceCash(state, admin, cash.id, true, now);
  closeRemittanceCash(state, admin, cash.id, 14000, now);
  const lifecycle = state.remittances.events.filter(event => event.cashSessionId === cash.id);
  assert.deepEqual(lifecycle.map(event => event.type), ["opened", "closed", "reopened", "closed", "reopened", "closed"]);
  assert.deepEqual([...lifecycle].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)), lifecycle,
    "PostgreSQL replay order stays deterministic even with the same clock tick");
});

test("reopening rejects production, non-admins, old dates, a later dependent box and discharged cash without changing anything", () => {
  const state = seed();
  const box = openRemittanceCash(state, admin, { operatorId: admin.id, currency: "EUR", openingAmount: 10000 }, [admin], now);
  closeRemittanceCash(state, admin, box.id, 10000, now);
  const original = structuredClone(state);
  assert.throws(() => reopenDemoRemittanceCash(state, admin, box.id, false, now), code("NOT_FOUND"));
  assert.throws(() => reopenDemoRemittanceCash(state, { ...admin, role: "cashier" }, box.id, true, now), code("FORBIDDEN"));
  assert.throws(() => reopenDemoRemittanceCash(state, admin, box.id, true, new Date("2026-11-12T16:00:00Z")), code("CASH_REOPEN_BLOCKED"));
  assert.deepEqual(state, original);
  state.remittances.cashSessions.push({ ...state.remittances.cashSessions[0], id: "later", date: "2026-11-12", carriedFrom: box.id });
  assert.throws(() => reopenDemoRemittanceCash(state, admin, box.id, true, now), code("CASH_REOPEN_BLOCKED"));
  state.remittances.cashSessions.pop();
  state.remittances.cashMovements = [{ id: "discharge", cashSessionId: box.id, currency: "EUR", operatorId: admin.id,
    actorId: admin.id, type: "discharge", amount: 1000, createdAt: now.toISOString() }];
  assert.throws(() => reopenDemoRemittanceCash(state, admin, box.id, true, now), code("CASH_REOPEN_BLOCKED"));
});

async function exerciseApi(store: Store) {
  const app = await buildApp({ store, demo: true, secret: "synthetic-demo-cash-reopen-secret-32", origins: [] });
  try {
    const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin", password: DEMO_PASSWORD } })).json().token;
    const post = (url: string, payload: unknown, key = randomUUID(), auth = token) => app.inject({ method: "POST", url, payload,
      headers: { authorization: `Bearer ${auth}`, "idempotency-key": key } });
    const account = await post("/api/usuarios", { role: "cashier", name: "Caja de prueba", email: `cash-${randomUUID()}@example.invalid`, password: "Prueba-Caja-2026!" });
    assert.equal(account.statusCode, 200, account.body);
    const opened = await post("/api/envios/cajas/abrir", { operatorId: account.json().id, currency: "EUR", openingAmount: 10000 });
    assert.equal(opened.statusCode, 200, opened.body);
    const id = opened.json().id, path = `/api/envios/cajas/${id}/reabrir-prueba`;
    assert.equal((await post(`/api/envios/cajas/${id}/cerrar`, { countedAmount: 10000 })).statusCode, 200);
    const snap = () => app.inject({ url: "/api/envios/snapshot", headers: { authorization: `Bearer ${token}` } });
    assert.equal((await snap()).json().cashSessions.find((row: { id: string }) => row.id === id).canReopen, true);
    const cashierToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: account.json().email, password: "Prueba-Caja-2026!" } })).json().token;
    assert.equal((await post(path, {}, randomUUID(), cashierToken)).statusCode, 403);
    assert.equal((await post(path, { openingAmount: 999999 })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: path, payload: {}, headers: { authorization: `Bearer ${token}` } })).statusCode, 400);
    const key = randomUUID();
    for (let retry = 0; retry < 2; retry++) {
      const response = await post(path, {}, key); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().expected, 10000);
    }
    assert.equal((await store.read()).remittances.events.filter(event => event.cashSessionId === id && event.type === "reopened").length, 1);
    let read = await store.read(), cash = read.remittances.cashSessions.find(row => row.id === id)!;
    assert.equal(cash.status, "open"); assert.equal(cash.countedAmount, undefined);
    assert.equal((await post(`/api/envios/cajas/${id}/entregas`, { amount: 5000 })).statusCode, 200);
    assert.equal((await post(`/api/envios/cajas/${id}/cerrar`, { countedAmount: 15000 })).statusCode, 200);
    const concurrent = await Promise.all([post(path, {}), post(path, {})]);
    assert.deepEqual(concurrent.map(response => response.statusCode).sort(), [200, 409]);
    assert.equal((await post(`/api/envios/cajas/${id}/cerrar`, { countedAmount: 15000 })).statusCode, 200);
    read = await store.read(); cash = read.remittances.cashSessions.find(row => row.id === id)!;
    assert.equal(cash.status, "closed"); assert.equal(cash.countedAmount, 15000);
    assert.equal(read.remittances.events.filter(event => event.cashSessionId === id && event.type === "closed").length, 3);
    return id;
  } finally { await app.close(); }
}

test("demo API requires admin, strict payload and idempotency; permits only one concurrent reopening", async () => {
  await exerciseApi(new MemoryStore(seed()));
});

test("the reopening route and capability do not exist in configured mode", async () => {
  const app = await buildApp({ store: new MemoryStore(seed()), demo: false, secret: "synthetic-configured-cash-reopen-32", origins: [],
    adminEmail: "cash-reopen@example.invalid", adminPassword: "Synthetic-Reopen-2026!" });
  try {
    const api = (await app.inject({ url: "/api/openapi.json" })).json();
    assert.equal(Object.keys(api.paths).some(path => path.includes("reabrir-prueba")), false);
    const response = await app.inject({ method: "POST", url: "/api/envios/cajas/test/reabrir-prueba", payload: {} });
    assert.notEqual(response.statusCode, 200);
  } finally { await app.close(); }
});

test("PostgreSQL keeps old closures immutable and replays reopenings and repeated closes", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const store = new PostgresStore(process.env.TEST_DATABASE_URL!);
  const id = await exerciseApi(store); // app.close() cierra también su almacén.
  const reopened = new PostgresStore(process.env.TEST_DATABASE_URL!);
  try { assert.equal((await reopened.read()).remittances.cashSessions.find(cash => cash.id === id)?.countedAmount, 15000); }
  finally { await reopened.close(); }
  const sql = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL! });
  try {
    await sql.connect();
    const closed = (await sql.query("SELECT * FROM remittance_events WHERE cash_session_id=$1 AND type='closed' ORDER BY created_at DESC LIMIT 1", [id])).rows[0];
    await assert.rejects(sql.query("UPDATE remittance_events SET amount=0 WHERE id=$1", [closed.id]), /append-only/);
    await assert.rejects(sql.query("DELETE FROM remittance_events WHERE id=$1", [closed.id]), /append-only/);
    await assert.rejects(sql.query(`INSERT INTO remittance_events(id,type,cash_session_id,operator_id,currency,amount,actor_id,created_at)
      VALUES($1,'closed',$2,$3,$4,$5,$6,$7)`, [randomUUID(), id, closed.operator_id, closed.currency, closed.amount, closed.actor_id,
      new Date(new Date(closed.created_at).getTime() + 1)]), /Invalid remittance cash lifecycle/);
  } finally { await sql.end(); }
});
