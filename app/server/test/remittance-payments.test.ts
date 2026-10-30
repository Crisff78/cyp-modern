import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessDate, type User } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { cashBalance, cancelRemittance, createRemittance, openRemittanceCash, quoteRemittance, setCommissionPolicy, setDailyRate } from "../src/remittances.js";
import { paymentAmounts } from "../../shared/remittances/payment.mjs";

const admin: User = { id: "demo-admin", name: "Synthetic office", role: "admin" };
const now = new Date("2026-10-21T16:00:00Z"), older = new Date("2026-10-19T16:00:00Z");
const code = (value: string) => (error: unknown) => { assert.equal((error as { code: string }).code, value); return true; };
function fixture(at = now) {
  const state = seed();
  setCommissionPolicy(state, admin, { transactionCommissionBps: 1000, managerCommissionBps: 500 }, at);
  for (const currency of ["DOP", "USD", "EUR"] as const) openRemittanceCash(state, admin, { operatorId: admin.id, currency, openingAmount: 0 }, [], at);
  return state;
}
function send(state: ReturnType<typeof fixture>, payment?: Parameters<typeof paymentAmounts>[1], at = now) {
  const input = { sourceCurrency: "DOP" as const, destinationCurrency: "DOP" as const, amount: 90000 };
  return createRemittance(state, admin, { ...input, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoteRemittance(state, input, at).quote, payment }, [], at);
}

test("cash records tender and exact change against principal plus fee, without inflating physical cash", () => {
  const state = fixture(), t = send(state, { method: "cash", tenderedAmount: 100000 });
  assert.equal(t.totalAmount, 99000); assert.equal(t.payment?.tenderedAmount, 100000); assert.equal(t.payment?.changeAmount, 1000);
  assert.equal(t.payment?.confirmedBy, admin.id); assert.equal(t.payment?.confirmedAt, now.toISOString());
  assert.equal(cashBalance(state, state.remittances.cashSessions[0]).expected, 99000);
  cancelRemittance(state, admin, t.id, "Synthetic cancellation", now);
  assert.equal(cashBalance(state, state.remittances.cashSessions[0]).expected, 0);
  assert.equal(paymentAmounts(90000, { method: "cash", tenderedAmount: 100000 }).changeAmount, 10000);
  assert.equal(paymentAmounts(90000).changeAmount, 0, "legacy callers default to exact cash");
});

test("invalid payment values are rejected before any transfer or cash event is created", () => {
  for (const payment of [null, {}, { method: null }, { method: "other" }, { method: "cash", tenderedAmount: "100000" },
    { method: "cash", tenderedAmount: 1.5 }, { method: "cash", tenderedAmount: Number.MAX_SAFE_INTEGER + 1 },
    { method: "cash", tenderedAmount: 98999 }, { method: "cash", tenderedAmount: 100000, changeAmount: 0 },
    { method: "card", reference: "QA-123", verified: false }, { method: "card", reference: "", verified: true },
    { method: "transfer", reference: "QA\u2028REF", verified: true }, { method: "transfer", reference: "QA", bank: "Bank\u2029Name", verified: true },
    { method: "transfer", reference: "x\nsecret", verified: true }, { method: "deposit", reference: "QA", verified: true, tenderedAmount: 100000 }]) {
    const state = fixture(), before = structuredClone(state.remittances);
    assert.throws(() => send(state, payment as never));
    assert.deepEqual(state.remittances, before);
  }
});

test("verified card/bank payments and refunds never add or remove physical cash", () => {
  for (const method of ["card", "transfer", "deposit"] as const) {
    const state = fixture(), t = send(state, { method, reference: "QA-REF-123", bank: "Fictional bank", verified: true });
    assert.equal(t.payment?.method, method); assert.equal(t.payment?.changeAmount, 0);
    assert.equal(cashBalance(state, state.remittances.cashSessions[0]).expected, 0);
    assert.equal(state.remittances.events.find((e) => e.type === "sent")?.amount, 0);
    assert.throws(() => cancelRemittance(state, admin, t.id, "Synthetic cancellation", now), code("REFUND_NOT_VERIFIED"));
    for (const reference of ["QA\u2028REF", "QA\u2029REF", "QA\u200bREF"]) assert.throws(() => cancelRemittance(state, admin, t.id, "Synthetic cancellation", now, { reference, verified: true }), code("REFUND_NOT_VERIFIED"));
    assert.equal(t.status, "pending");
    const cancelled = cancelRemittance(state, admin, t.id, "Synthetic cancellation", now, { reference: "QA-REFUND-123", verified: true });
    assert.equal(cancelled.refund?.reference, "QA-REFUND-123"); assert.equal(cancelled.refund?.method, method);
    assert.equal(cashBalance(state, state.remittances.cashSessions[0]).expected, 0);
    assert.equal(state.remittances.events.find((e) => e.type === "cancelled")?.amount, 0);
  }
});

test("company identity/footer are frozen without leaking system configuration secrets", () => {
  const state = fixture();
  state.systemConfig = { "general.empresa": "Synthetic company", "general.direccion": "Fictional address", "general.telefono": "8095550100", "general.correo": "office@example.test", receiptFooterNote: "Present your reference for inquiries.", "general.licencia": "PRIVATE-NOT-ON-RECEIPT" };
  const t = send(state);
  state.systemConfig["general.empresa"] = "Changed later";
  assert.equal(t.receiptIssuer?.name, "Synthetic company"); assert.equal(t.receiptIssuer?.phone, "8095550100");
  assert.equal(JSON.stringify(t.receiptIssuer).includes("PRIVATE-NOT-ON-RECEIPT"), false);
});

test("buy source/sell destination through DOP, carry forward rates, reverse quote; only pesos are one to one", () => {
  const state = fixture();
  setDailyRate(state, admin, { currency: "USD", rate: "60", purchaseRate: "59", saleRate: "61", date: businessDate(older) }, older);
  setDailyRate(state, admin, { currency: "EUR", rate: "70", purchaseRate: "69", saleRate: "75", date: businessDate(older) }, older);
  const quote = (sourceCurrency: "DOP" | "USD" | "EUR", destinationCurrency: "DOP" | "USD" | "EUR", amount: number, amountMode: "source" | "destination" = "source") => quoteRemittance(state, { sourceCurrency, destinationCurrency, amount, amountMode }, now);
  assert.equal(quote("USD", "DOP", 10000).receiveAmount, 590000);
  assert.equal(quote("DOP", "USD", 610000).receiveAmount, 10000);
  const cross = quote("USD", "EUR", 100000);
  assert.equal(cross.amountDop, 5900000); assert.equal(cross.receiveAmount, 78667);
  assert.equal(cross.quote.sourceRateKind, "purchase"); assert.equal(cross.quote.destinationRateKind, "sale");
  assert.equal(cross.quote.sourceRateDate, businessDate(older));
  const reverse = quote("USD", "EUR", 78667, "destination");
  assert.equal(reverse.amount, 100000); assert.equal(reverse.receiveAmount, 78667);
  // Rardiel, 30-10-2026: dollars to dollars also go through pesos (1,000 USD at 59 = 59,000 DOP; at 61 = 967.21 USD).
  assert.equal(quote("USD", "USD", 100000).receiveAmount, 96721);
  assert.equal(quote("DOP", "DOP", 100000).receiveAmount, 100000);
});

test("API validates payment and derived change, retains idempotency and refuses invented bank confirmation", async (t) => {
  const at = new Date(), state = fixture(at), store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret: "synthetic-payment-secret-at-least-32", origins: [] }); t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200, login.body); const authorization = `Bearer ${login.json().token}`;
  const input = { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 90000 };
  const q = await app.inject({ url: "/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=90000", headers: { authorization } });
  assert.equal(q.statusCode, 200, q.body);
  const body = { ...input, senderClientId: "cli-1", recipientClientId: "cli-5", quote: q.json().quote };
  const post = (payment: unknown, key = randomUUID()) => app.inject({ method: "POST", url: "/api/envios", payload: { ...body, payment }, headers: { authorization, "idempotency-key": key } });
  for (const payment of [{ method: "cash", tenderedAmount: "100000" }, { method: "cash", tenderedAmount: 100000, changeAmount: 10000 }]) {
    const invalid = await post(payment); assert.equal(invalid.statusCode, 400, invalid.body);
  }
  const unverified = await post({ method: "card", reference: "QA-BANK" }); assert.equal(unverified.statusCode, 422, unverified.body);
  assert.equal((await store.read()).remittances.transfers.length, 0);
  const key = randomUUID(), payment = { method: "cash", tenderedAmount: 100000 };
  const first = await post(payment, key), retry = await post(payment, key);
  assert.equal(first.statusCode, 200, first.body); assert.deepEqual(retry.json(), first.json());
  assert.equal(first.json().payment.changeAmount, 1000); assert.equal((await store.read()).remittances.transfers.length, 1);
});
