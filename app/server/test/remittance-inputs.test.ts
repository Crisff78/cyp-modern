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
  for (const amount of ["1e3", "0x10", "1.0", "100.50", "+100", "-100", " 100", "100 ", "100\n", "100\r", "100\r\n", "100\t", "NaN", "Infinity", "100;DROP TABLE users", "１２３", "9007199254740992", "1".repeat(200)]) {
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

test("rate fields reject malformed values in direct requests, including trailing line breaks, without writes", async (t) => {
  const { app, store, authorization } = await setup(t), before = await store.read();
  const headers = { authorization, "idempotency-key": randomUUID() };
  // Use the business date from the same clock as the API, not a fixture date.
  const date = (await app.inject({ url: "/api/envios/snapshot", headers: { authorization } })).json().businessDate;
  const rate = { currency: "USD", date, rate: "59", purchaseRate: "59", saleRate: "61" };
  for (const field of ["rate", "purchaseRate", "saleRate"]) {
    for (const invalid of ["60\n", "60\r\n", "60\t", " 60", "60 ", "60abc", "1e3", "-60", "+60", "60,50", "1,234.50", "60.1234567", "1000000000000", "0", "６０", 60, null]) {
      const response = await app.inject({ method: "POST", url: "/api/envios/tasas", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { ...rate, [field]: invalid } });
      assert.ok([400, 422].includes(response.statusCode), `${field}=${JSON.stringify(invalid)}: ${response.body}`);
      assert.deepEqual(await store.read(), before, `invalid ${field} must not create a rate or history entry`);
    }
  }
});

test("payment references, providers and refund references reject hidden separators without financial mutations", async (t) => {
  const { app, store, authorization, post, body } = await setup(t), before = await store.read();
  for (const field of ["reference", "bank"]) {
    for (const invalid of ["QA\u0000REF", "QA\u2028REF", "QA\u2029REF", "QA\u202eREF", "QA\u200bREF", "\ufeffQA", "QA\ufeff", "Q".repeat(161), " ".repeat(160) + "QA"]) {
      const response = await post({ ...body, payment: { method: "transfer", reference: "QA-001/2026", bank: "Banco O'Connor & Hijos", verified: true, [field]: invalid } });
      assert.ok([400, 422].includes(response.statusCode), `${field}: ${response.body}`);
      assert.deepEqual(await store.read(), before);
    }
  }
  const saved = await post({ ...body, payment: { method: "transfer", reference: "0001-REF/2026.10", bank: "Banco O'Connor & Hijos #2", verified: true } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().payment.reference, "0001-REF/2026.10");
  const afterSave = await store.read();
  for (const reference of ["QA\u2028REF", "QA\u2029REF", "QA\u200bREF", "\ufeffQA", "QA\ufeff", "X".repeat(161)]) {
    const response = await app.inject({ method: "POST", url: `/api/envios/${saved.json().id}/cancelar`, headers: { authorization, "idempotency-key": randomUUID() }, payload: { reason: "Prueba de devolución", refund: { reference, verified: true } } });
    assert.ok([400, 422].includes(response.statusCode), response.body);
    assert.deepEqual(await store.read(), afterSave);
  }
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
