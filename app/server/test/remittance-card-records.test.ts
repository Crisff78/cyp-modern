import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { seed } from "../src/seed.js";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { businessDate, type User } from "../src/domain.js";
import { cashBalance, cancelRemittance, createRemittance, getCommissionPolicy, openRemittanceCash, quoteRemittance, remittanceReports, setCommissionPolicy, setDailyRate } from "../src/remittances.js";
import { cardPaymentCharge, isCardLast4Draft, paymentAmounts, totalPaidForTransfer } from "../../shared/remittances/payment.mjs";
import { remittanceReceipt, receiptHtml } from "../../shared/remittances/receipt.js";
import { confirmedCreatedTransfer } from "../../shared/remittances/createdTransferResponse.js";
import { remittanceReportSections } from "../../shared/remittances/reporting.js";

const admin: User = { id: "demo-admin", name: "Synthetic office", role: "admin" };
const at = new Date("2026-11-04T16:00:00Z");
const pair = { sourceCurrency: "DOP" as const, destinationCurrency: "DOP" as const, amount: 10000 };
const credit = { method: "card" as const, cardType: "credit" as const, cardholderName: "María O'Connor", last4: "0042", reference: "TEST-EXTERNAL-001", verified: true };
function fixture(now = at) {
  const state = seed();
  setCommissionPolicy(state, admin, { transactionCommissionBps: 1000, managerShareBps: 4000, creditCardCommissionBps: 250 }, now);
  openRemittanceCash(state, admin, { operatorId: admin.id, currency: "DOP", openingAmount: 0 }, [], now);
  return state;
}
const bodyFor = (state: ReturnType<typeof seed>, now = at) => ({ ...pair, commissionBps: 1000, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoteRemittance(state, pair, now).quote, payment: credit });

test("credit surcharge uses exact half-up cents on subtotal; defaults, bounds and debit cannot change principal or payout", () => {
  assert.deepEqual(cardPaymentCharge(11000, "credit", 250), { cardSurchargeBps: 250, cardSurchargeAmount: 275, totalAmount: 11275 });
  assert.equal(cardPaymentCharge(1, "credit", 5000).cardSurchargeAmount, 1);
  assert.equal(cardPaymentCharge(1, "credit", 4999).cardSurchargeAmount, 0);
  assert.equal(cardPaymentCharge(11000, "credit").cardSurchargeAmount, 0);
  assert.equal(cardPaymentCharge(11000, "debit", 250).cardSurchargeAmount, 0);
  for (const rate of [-1, 10001, .5, NaN, Infinity]) assert.throws(() => cardPaymentCharge(11000, "credit", rate));
  assert.throws(() => cardPaymentCharge(Number.MAX_SAFE_INTEGER, "credit", 1));
  assert.equal(isCardLast4Draft("0042"), true);
  for (const value of ["4111111111111111", "0042a", "-042", "４１２３", "42\n"]) assert.equal(isCardLast4Draft(value), false);
  const state = fixture(), body = bodyFor(state), q = quoteRemittance(state, pair, at);
  const saved = createRemittance(state, admin, body, [], at);
  assert.equal(saved.totalAmount, 11000); assert.equal(totalPaidForTransfer(saved), 11275);
  assert.equal(saved.payment?.version, 2); assert.equal(saved.payment?.tenderedAmount, 11275);
  assert.equal(saved.payment?.last4, "0042"); assert.equal(saved.payment?.cardSurchargeAmount, 275);
  assert.equal(saved.receiveAmount, 10000); assert.deepEqual(saved.calculation, q.calculation);
  assert.deepEqual(saved.commissionAllocation, { ...q.commissionAllocation, managerId: admin.id, managerName: admin.name });
  assert.equal(cashBalance(state, state.remittances.cashSessions[0]).expected, 0);
  assert.equal(confirmedCreatedTransfer(saved, body, admin.id, q).id, saved.id);
  assert.throws(() => confirmedCreatedTransfer({ ...saved, payment: { ...saved.payment, cardSurchargeAmount: 0 } }, body, admin.id, q));
  const debit = paymentAmounts(11000, { method: "card", cardType: "debit", reference: "DEBIT-TEST", verified: true }, 250);
  assert.equal(debit.tenderedAmount, 11000); assert.equal(debit.cardSurchargeAmount, 0);
});

test("card records reject full numbers, security codes, expiry, incomplete metadata and invented fees without mutations", () => {
  const state = fixture(), body = bodyFor(state), before = structuredClone(state);
  for (const payment of [
    { ...credit, last4: "4111111111111111" }, { ...credit, last4: "123" }, { ...credit, last4: 1234 },
    { ...credit, cardholderName: "" }, { ...credit, cardholderName: "Titular 123" }, { ...credit, cardholderName: "X\u200bY" }, { ...credit, cardholderName: "x".repeat(121) },
    { ...credit, cardNumber: "4111111111111111" }, { ...credit, cvv: "123" }, { ...credit, expiry: "12/29" },
    { ...credit, cardSurchargeBps: 0 }, { ...credit, cardSurchargeAmount: 0 },
    { method: "card", reference: "UNTYPED", verified: true }, { ...credit, cardType: "other" },
    { ...credit, cardType: "debit", cardholderName: undefined }, { ...credit, cardType: "debit", last4: undefined },
    { ...credit, cardType: "debit", last4: "12345" }, { ...credit, cardType: "debit", cardholderName: "Titular 123" },
    { ...credit, method: "transfer" }, { ...credit, verified: false },
  ]) {
    assert.throws(() => createRemittance(state, admin, { ...body, payment } as never, [], at), undefined, JSON.stringify(payment));
    assert.deepEqual(state, before);
  }
});

test("debit records retain holder and last four without a credit surcharge or physical cash", () => {
  const state = fixture(), body = bodyFor(state), saved = createRemittance(state, admin, { ...body, payment: { ...credit, cardType: "debit" } }, [], at);
  assert.equal(saved.payment?.cardholderName, credit.cardholderName); assert.equal(saved.payment?.last4, credit.last4);
  assert.equal(saved.payment?.cardSurchargeBps, 0); assert.equal(saved.payment?.cardSurchargeAmount, 0);
  assert.equal(saved.payment?.tenderedAmount, saved.totalAmount); assert.equal(saved.receiveAmount, 10000);
  assert.equal(cashBalance(state, state.remittances.cashSessions[0]).expected, 0);
  assert.equal(confirmedCreatedTransfer(saved, { ...body, payment: { ...credit, cardType: "debit" } }, admin.id).id, saved.id);
  const html = receiptHtml(remittanceReceipt(saved));
  assert.match(html, /Tarjeta de débito/); assert.match(html, /•••• 0042/);
  assert.doesNotMatch(html, /María O&#39;Connor|cvv|expiry|vencimiento/i);
});

test("USD and EUR credit surcharges stay in the sender's currency without changing any destination conversion", () => {
  const state = fixture();
  for (const currency of ["USD", "EUR"] as const) {
    setDailyRate(state, admin, {currency, date:businessDate(at), rate:currency === "USD" ? "60" : "70", purchaseRate:currency === "USD" ? "59" : "69", saleRate:currency === "USD" ? "61" : "71"}, at);
    openRemittanceCash(state, admin, {operatorId:admin.id, currency, openingAmount:0}, [], at);
  }
  for (const sourceCurrency of ["USD", "EUR"] as const) for (const destinationCurrency of ["DOP", "USD", "EUR"] as const) {
    const input = {...pair, sourceCurrency, destinationCurrency}, q = quoteRemittance(state, input, at);
    const saved = createRemittance(state, admin, {...input, senderClientId:"cli-1", recipientClientId:"cli-5", quote:q.quote, payment:credit}, [], at);
    assert.equal(saved.payment?.cardSurchargeAmount,275); assert.equal(totalPaidForTransfer(saved),11275);
    assert.equal(saved.receiveAmount,q.receiveAmount); assert.deepEqual(saved.calculation,q.calculation);
    assert.equal(saved.commissionAllocation?.managerAmount,q.commissionAllocation.managerAmount);
    const row = remittanceReceipt(saved).sections.find(section=>section.title==="Importes del envío")!.rows.find(([label])=>label==="Recargo tarjeta de crédito");
    assert.deepEqual(row,["Recargo tarjeta de crédito",`${sourceCurrency} 2.75`]);
  }
  for (const cash of state.remittances.cashSessions) assert.equal(cashBalance(state,cash).expected,0);
});

test("frozen card surcharge survives configuration changes, receipts, reports and cancellation without cash or manager inflation", () => {
  const state = fixture(), saved = createRemittance(state, admin, bodyFor(state), [], at);
  setCommissionPolicy(state, admin, { creditCardCommissionBps: 900 }, at);
  assert.equal(saved.quote.creditCardCommissionBps, 250);
  assert.throws(() => createRemittance(state, admin, { ...bodyFor(state), quote: saved.quote }, [], at), (error: unknown) => (error as {code:string}).code === "QUOTE_CHANGED");
  for (const printed of [false, true]) {
    const receipt = remittanceReceipt(saved, undefined, "Synthetic", "Synthetic", printed), html = receiptHtml(receipt);
    assert.match(html, /Tarjeta de crédito/); assert.match(html, /•••• 0042/); assert.match(html, /DOP 112\.75/); assert.match(html, /DOP 2\.75/);
    assert.doesNotMatch(html, /María O&#39;Connor|cardholderName|cardSurchargeBps|cvv|2\.5%/i);
  }
  const filter = { from: businessDate(at), to: businessDate(at), grouping: "range" as const };
  const report = remittanceReports(state, admin, filter);
  assert.equal(report.amounts[0].totalAmount, 11275); assert.equal(report.amounts[0].cardSurchargeAmount, 275);
  assert.equal(report.amounts[0].commissionAmount, 1000);
  assert.equal(report.commissionAllocations.totals[0].managerAmount, 400);
  const section = remittanceReportSections("amounts", report, null, () => "Synthetic")[0];
  assert.equal(section.rows[0][section.columns.indexOf("Recargo tarjeta origen")], "DOP 2.75");
  assert.equal(section.rows[0][section.columns.indexOf("Total origen")], "DOP 112.75");
  cancelRemittance(state, admin, saved.id, "Synthetic full external refund", at, { reference: "TEST-REFUND-11275", verified: true });
  const after = remittanceReports(state, admin, filter);
  assert.equal(after.amounts[0].totalAmount, 0); assert.equal(after.amounts[0].cardSurchargeAmount ?? 0, 0);
  assert.equal(after.commissionAllocations.totals[0].managerAmount, 0);
  assert.equal(state.remittances.events.find((e) => e.type === "cancelled")?.amount, 0);
});

test("API strictly rejects sensitive/forged fields before idempotency storage; authorized configuration and safe card records replay exactly", async (t) => {
  const now = new Date(), store = new MemoryStore(fixture(now));
  const app = await buildApp({ store, demo: true, secret: "synthetic-card-record-secret-at-least-32", origins: [] }); t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200); const authorization = `Bearer ${login.json().token}`;
  const post = (url: string, payload: unknown, key = randomUUID()) => app.inject({ method: "POST", url, payload: payload as never, headers: { authorization, "idempotency-key": key } });
  for (const value of [-1, 10001, .5, "250"]) assert.equal((await post("/api/envios/politica-comisiones", { creditCardCommissionBps: value })).statusCode, 400);
  assert.equal((await post("/api/envios/politica-comisiones", { creditCardCommissionBps: 0 })).statusCode, 200);
  assert.equal((await post("/api/envios/politica-comisiones", { creditCardCommissionBps: 250 })).statusCode, 200);
  const state = await store.read(), body = bodyFor(state, now), before = JSON.stringify(state);
  for (const extra of [{ cardNumber: "4111111111111111" }, { cvv: "123" }, { expiry: "12/29" }, { cardSurchargeAmount: 0 }, { cardChargeAmount: 0 }, {version:2}]) {
    const invalid = await post("/api/envios", { ...body, payment: { ...credit, ...extra } });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.doesNotMatch(invalid.body, /4111111111111111|12\/29/);
    assert.equal(JSON.stringify(await store.read()), before);
  }
  const key = randomUUID(), first = await post("/api/envios", body, key), retry = await post("/api/envios", body, key);
  assert.equal(first.statusCode, 200, first.body); assert.deepEqual(retry.json(), first.json());
  assert.equal(first.json().payment.cardSurchargeAmount, 275); assert.equal((await store.read()).remittances.transfers.length, 1);
  assert.equal(getCommissionPolicy(await store.read()).creditCardCommissionBps, 250);
  const debitBody = { ...body, payment: { ...credit, cardType: "debit" } }, debitKey = randomUUID();
  const debit = await post("/api/envios", debitBody, debitKey), debitReplay = await post("/api/envios", debitBody, debitKey);
  assert.equal(debit.statusCode, 200, debit.body); assert.deepEqual(debitReplay.json(), debit.json());
  assert.equal(debit.json().payment.last4, credit.last4); assert.equal(debit.json().payment.cardholderName, credit.cardholderName);
  assert.equal(debit.json().payment.cardSurchargeAmount, 0); assert.equal((await store.read()).remittances.transfers.length, 2);

  assert.equal((await post("/api/configuracion", { config: { "general.rnc": "SIN-DIGITOS" } })).statusCode, 400);
  const cfgPayload = { "general.empresa": "CREDIAHORA INVERSIONES S.R.L.", "general.eslogan": "Tu aliado en cada envío", "general.direccion": "Av. 27 de Febrero, #2131, Colinas Mall, Santiago", "general.telefono": "809-576-0222", "general.rnc": "1-32-53511-1" };
  assert.equal((await post("/api/configuracion", { config: cfgPayload })).statusCode, 200);
  const snap = (await app.inject({ url: "/api/envios/snapshot", headers: { authorization } })).json();
  assert.equal(snap.receiptIssuer.name, "CREDIAHORA INVERSIONES S.R.L.");
  assert.equal(snap.receiptIssuer.slogan, "Tu aliado en cada envío");
  assert.equal(snap.receiptIssuer.address, "Av. 27 de Febrero, #2131, Colinas Mall, Santiago");
  assert.equal(snap.receiptIssuer.phone, "809-576-0222");
  assert.equal(snap.receiptIssuer.rnc, "1-32-53511-1");
});
