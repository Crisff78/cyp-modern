import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { businessDate } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import { openRemittanceCash, setCommissionPolicy, setDailyRate } from "../src/remittances.js";

async function fixture(t: TestContext, transactionCommissionBps = 0) {
  const store = new MemoryStore(seed()), now = new Date();
  const actor = { id: "demo-admin", name: "Administración de prueba", role: "admin" as const };
  await store.transaction((state) => {
    setDailyRate(state, actor, { currency: "USD", rate: "59", purchaseRate: "59", saleRate: "61", date: businessDate(now) }, now);
    setCommissionPolicy(state, actor, { transactionCommissionBps, managerCommissionBps: 0 }, now);
    openRemittanceCash(state, actor, { operatorId: actor.id, currency: "USD", openingAmount: 0 }, [], now);
  });
  const app = await buildApp({ store, demo: true, secret: "synthetic-origin-destination-check-secret", origins: [] });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200, login.body);
  const headers = { authorization: `Bearer ${login.json().token}` };
  const quote = async (sourceCurrency: string, destinationCurrency: string, amount: number, amountMode: "source" | "destination") => {
    const params = new URLSearchParams({ sourceCurrency, destinationCurrency, amount: String(amount), amountMode });
    const response = await app.inject({ url: `/api/envios/cotizacion?${params}`, headers });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  return { store, app, headers, quote };
}

test("USD Compra 59 / Venta 61: origin USD 100 yields DOP 5900, destination DOP 2950 requires USD 50", async (t) => {
  const { store, quote } = await fixture(t), before = await store.read();
  const origin = await quote("USD", "DOP", 10000, "source");
  assert.equal(origin.amount, 10000); assert.equal(origin.receiveAmount, 590000);
  assert.equal(origin.amountDop, 590000); assert.equal(origin.totalAmount, 10000);
  assert.equal(origin.quote.sourceRate, "59.000000"); assert.equal(origin.quote.sourceRateKind, "purchase");
  const destination = await quote("USD", "DOP", 295000, "destination");
  assert.equal(destination.amount, 5000); assert.equal(destination.receiveAmount, 295000);
  assert.equal(destination.requestedReceiveAmount, 295000); assert.equal(destination.receiveRoundingDifference, 0);
  assert.equal(destination.totalAmount, 5000); assert.equal(destination.quote.sourceRate, "59.000000");
  assert.equal(destination.quote.sourceRateKind, "purchase", "changing amount mode does not reverse the currency pair");
  const back = await quote("USD", "DOP", 5000, "source");
  assert.equal(back.receiveAmount, destination.receiveAmount);
  assert.deepEqual(await store.read(), before, "quoting never creates a transfer, client or cash movement");
});

test("Venta 61 is used when USD is the destination in either amount-entry mode", async (t) => {
  const { store, quote } = await fixture(t), before = await store.read();
  const origin = await quote("DOP", "USD", 610000, "source");
  const destination = await quote("DOP", "USD", 10000, "destination");
  for (const result of [origin, destination]) {
    assert.equal(result.amount, 610000); assert.equal(result.receiveAmount, 10000);
    assert.equal(result.quote.destinationRate, "61.000000"); assert.equal(result.quote.destinationRateKind, "sale");
  }
  assert.deepEqual(await store.read(), before);
});

test("destination mode keeps USD 50 principal and DOP 2950 delivery when a 5 percent fee is added, including on save", async (t) => {
  const { app, store, headers, quote } = await fixture(t, 500);
  const result = await quote("USD", "DOP", 295000, "destination");
  assert.equal(result.amount, 5000); assert.equal(result.commissionAmount, 250); assert.equal(result.totalAmount, 5250);
  assert.equal(result.receiveAmount, 295000);
  const response = await app.inject({ method: "POST", url: "/api/envios", headers: { ...headers, "idempotency-key": randomUUID() }, payload: {
    senderClientId: "cli-1", recipientClientId: "cli-5", sourceCurrency: "USD", destinationCurrency: "DOP",
    amount: result.amount, requestedReceiveAmount: result.requestedReceiveAmount, quote: result.quote,
    payment: { method: "cash", tenderedAmount: 6000 },
  } });
  assert.equal(response.statusCode, 200, response.body);
  const saved = (await store.read()).remittances.transfers.find(({ id }) => id === response.json().id)!;
  assert.equal(saved.amount, 5000); assert.equal(saved.commissionAmount, 250); assert.equal(saved.totalAmount, 5250);
  assert.equal(saved.receiveAmount, 295000); assert.equal(saved.requestedReceiveAmount, 295000);
  assert.equal(saved.payment?.changeAmount, 750); assert.equal(saved.quote.sourceRate, "59.000000");
});
