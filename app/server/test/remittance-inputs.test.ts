import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { seed } from "../src/seed.js";
import { openRemittanceCash, quoteRemittance } from "../src/remittances.js";
import { saveRemittances } from "../src/remittance-store.js";

async function setup(t: TestContext) {
  const store = new MemoryStore(seed()), actor = { id: "demo-admin", name: "Admin", role: "admin" as const };
  await store.transaction((state) => openRemittanceCash(state, actor, { operatorId: actor.id, currency: "DOP", openingAmount: 0 }));
  const app = await buildApp({ store, demo: true, secret: "remittance-inputs-synthetic-secret", origins: [] });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200, login.body);
  const authorization = `Bearer ${login.json().token}`;
  const post = (payload: unknown) => app.inject({ method: "POST", url: "/api/envios", headers: { authorization, "idempotency-key": randomUUID() }, payload });
  const state = await store.read(), quote = quoteRemittance(state, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 100 });
  const body = { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 100, quote: quote.quote,
    senderClientId: "cli-1", recipientClientId: "cli-5" };
  return { app, store, authorization, post, body, routeId: state.routes[0].id };
}

test("quote cents accept only safe decimal integers, including when the UI is bypassed", async (t) => {
  const { app, store, authorization } = await setup(t), before = await store.read();
  for (const amount of ["1e3", "0x10", "1.0", "100.50", "+100", "-100", " 100", "100 ", "NaN", "Infinity", "100;DROP TABLE users", "１２３", "9007199254740992", "1".repeat(200)]) {
    const query = new URLSearchParams({ sourceCurrency: "DOP", destinationCurrency: "DOP", amount });
    const response = await app.inject({ method: "GET", url: `/api/envios/cotizacion?${query}`, headers: { authorization } });
    assert.equal(response.statusCode, 400, `${amount}: ${response.body}`);
  }
  for (const amount of ["100", "000100"]) {
    const response = await app.inject({ method: "GET", url: `/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=${amount}`, headers: { authorization } });
    assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().amount, 100);
  }
  assert.deepEqual(await store.read(), before);
});

test("new remittance clients and monetary bodies reject malformed values without partial writes", async (t) => {
  const { store, post, body, routeId } = await setup(t), before = await store.read();
  const client = { name: "José O'Connor & Hijos #2", identification: "001-0001234-5", phone: "+1 (809) 555-0101", address: "Av. Núñez #12 / local (B)", routeId };
  const { senderClientId: _sender, ...newClientBody } = body;
  for (const change of [{ name: "12345" }, { name: "Ana\u0000María" }, { identification: "ID;DROP TABLE users" }, { identification: "-- / ." },
    { phone: "abc" }, { phone: "1234567890123456" }, { phone: "1234567" }, { phone: "12345678 ext 2" }]) {
    const response = await post({ ...newClientBody, newSenderClient: { ...client, ...change } });
    assert.equal(response.statusCode, 400, response.body);
  }
  for (const amount of ["100", "1e2", 1.5, -1, 9007199254740992]) assert.equal((await post({ ...body, amount })).statusCode, 400);
  for (const change of [{ recipientPhone: "abc" }, { recipientPhone: "12+345678" }, { note: "Nota\u0000oculta" }]) assert.equal((await post({ ...body, ...change })).statusCode, 400);
  assert.deepEqual(await store.read(), before);
});

test("valid client text is preserved and remittance SQL sends it only as bound data", async (t) => {
  const { store, post, body, routeId } = await setup(t), before = await store.read();
  const { senderClientId: _sender, ...newClientBody } = body;
  const note = "O'Connor; x'); DROP TABLE remittance_transfers; --\nPago en local #2";
  const client = { name: "José O'Connor & Hijos #2", identification: "PAS/001.23", phone: "+1 (809) 555-0101", address: "Av. Núñez #12 / local (B)", routeId };
  const response = await post({ ...newClientBody, newSenderClient: client, note });
  assert.equal(response.statusCode, 200, response.body);
  const state = await store.read(), saved = state.remittances.transfers.find(({ id }) => id === response.json().id)!;
  assert.equal(saved.note, note); assert.equal(saved.senderContact?.name, client.name); assert.equal(saved.senderContact?.identification, client.identification);
  assert.equal(state.clients.length, before.clients.length + 1); assert.equal(state.remittances.transfers.length, before.remittances.transfers.length + 1);
  const queries: { sql: string; values: unknown[] }[] = [];
  const connection = { query: async (sql: string, values: unknown[]) => { queries.push({ sql, values }); return { rows: [] }; } } as unknown as pg.PoolClient;
  await saveRemittances(connection, state.remittances, before.remittances);
  const insert = queries.find(({ sql }) => sql.startsWith("INSERT INTO remittance_transfers")); assert(insert);
  assert.ok(insert.values.includes(note)); assert.ok(insert.sql.includes("$21")); assert.equal(insert.sql.includes(note), false);
  assert.equal(queries.some(({ sql }) => sql.includes("DROP TABLE")), false);
});
