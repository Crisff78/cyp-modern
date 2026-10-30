import { effectiveAccess } from "../../shared/access.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { businessDate, type State, type User } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import { cashBalance, createRemittance, getCommissionPolicy, openRemittanceCash, payRemittance, payoutOf, quoteRemittance, remittanceReports,
  saveDeliveryConcept, setCommissionPolicy, setDailyRate, transferView, type AmountMode, type Currency, type ReceiveRounding } from "../src/remittances.js";

// The calculation of Envíos de dinero as explained in the meeting of 29-10-2026 (Downloads/Anotación cálculo cobros y pagos.txt),
// with synthetic numbers: USD bought at 58 and sold at 61, EUR bought at 66 and sold at 70.
const now = new Date("2026-10-29T16:00:00Z");
const day = businessDate(now);
const admin: User = { id: "demo-admin", name: "Synthetic Admin", role: "admin" };
const gestor: User = { id: "demo-collector", name: "Synthetic Gestor", role: "collector", collectorId: "col-1",
  access: { ...effectiveAccess("collector"), roleExceptions: true, remittances: [...effectiveAccess("collector").remittances, "remittances.commissions.view"] } };
const plainGestor: User = { id: "demo-collector", name: "Synthetic Gestor", role: "collector", collectorId: "col-1" };
const receiver: User = { id: "synthetic-receiver", name: "Synthetic Receiver", role: "collector", collectorId: "col-2" };
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code: string }).code, expected); return true; };

function fixture(policy: { transactionCommissionBps: number; managerShareBps?: number; receiveRounding?: ReceiveRounding } = { transactionCommissionBps: 2000, managerShareBps: 5000 }) {
  const state = seed();
  setCommissionPolicy(state, admin, policy, now);
  setDailyRate(state, admin, { currency: "USD", rate: "60", purchaseRate: "58", saleRate: "61", date: day }, now);
  setDailyRate(state, admin, { currency: "EUR", rate: "68", purchaseRate: "66", saleRate: "70", date: day }, now);
  for (const currency of ["DOP", "USD", "EUR"] as const) openRemittanceCash(state, admin, { operatorId: gestor.id, currency, openingAmount: 0 }, [gestor], now);
  for (const currency of ["DOP", "USD", "EUR"] as const) openRemittanceCash(state, admin, { operatorId: receiver.id, currency, openingAmount: 100000000 }, [receiver], now);
  return state;
}
const quote = (state: State, sourceCurrency: Currency, destinationCurrency: Currency, amount: number, amountMode: AmountMode = "source", deliveryConceptId?: string) =>
  quoteRemittance(state, { sourceCurrency, destinationCurrency, amount, amountMode, ...(deliveryConceptId ? { deliveryConceptId } : {}) }, now);
function send(state: State, sourceCurrency: Currency, destinationCurrency: Currency, typed: number, amountMode: AmountMode = "source", deliveryConceptId?: string, user: User = gestor) {
  const quoted = quote(state, sourceCurrency, destinationCurrency, typed, amountMode, deliveryConceptId);
  return createRemittance(state, user, { sourceCurrency, destinationCurrency, amount: quoted.amount, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoted.quote,
    ...(amountMode === "destination" ? { requestedReceiveAmount: typed } : amountMode === "total" ? { requestedTotalAmount: typed } : {}),
    ...(deliveryConceptId ? { deliveryConceptId } : {}) }, [gestor], now);
}

test("1. without currency change: the commission is always charged and added (1,000 + 200 = 1,200)", () => {
  const state = fixture();
  const quoted = quote(state, "DOP", "DOP", 100000);
  assert.equal(quoted.commissionAmount, 20000); assert.equal(quoted.totalAmount, 120000);
  assert.equal(quoted.receiveAmount, 100000); assert.equal(quoted.calculation.payoutAmount, 100000);
  assert.deepEqual(quoted.calculation.exchangeGain, { currency: "DOP", sourceAmount: 0, destinationAmount: 0, totalAmount: 0 }, "pesos to pesos earn nothing on the exchange");
  // Only pesos are one to one (Rardiel, 30-10-2026): dollars to dollars also go through pesos, bought at 58 and sold at 61.
  const dollars = quote(state, "USD", "USD", 10000);
  assert.equal(dollars.commissionAmount, 2000); assert.equal(dollars.receiveAmount, 9508, "100 USD at 58 = 5,800.00 DOP; at 61 = 95.08 USD");
  assert.equal(dollars.calculation.exchangeGain?.totalAmount, 58524, "the company earns on both legs: 300.00 + 285.24 DOP");
});

test("2. USD → DOP → EUR: bought at the purchase rate, sold at the sale rate; the company earns on both legs", () => {
  const state = fixture({ transactionCommissionBps: 500, managerShareBps: 4000 });
  const quoted = quote(state, "USD", "EUR", 10000);
  assert.equal(quoted.quote.sourceRate, "58.000000"); assert.equal(quoted.quote.sourceRateKind, "purchase");
  assert.equal(quoted.quote.destinationRate, "70.000000"); assert.equal(quoted.quote.destinationRateKind, "sale");
  assert.equal(quoted.amountDop, 580000, "100 USD at 58 = 5,800.00 DOP");
  assert.equal(quoted.receiveAmount, 8286, "5,800.00 DOP at 70 = 82.86 EUR");
  assert.equal(quoted.commissionAmount, 500); assert.equal(quoted.totalAmount, 10500);
  assert.deepEqual(quoted.calculation.exchangeGain, { currency: "DOP", sourceAmount: 30000, destinationAmount: 33144, totalAmount: 63144,
    sourcePurchaseRate: "58.000000", sourceSaleRate: "61.000000", destinationPurchaseRate: "66.000000", destinationSaleRate: "70.000000" },
    "100 USD × (61 − 58) = 300.00 DOP; 82.86 EUR × (70 − 66) = 331.44 DOP");
});

test("3. DOP → EUR: pesos are the first step at 1; only the sale of euros earns", () => {
  const state = fixture();
  const quoted = quote(state, "DOP", "EUR", 580000);
  assert.equal(quoted.quote.sourceRate, "1.000000"); assert.equal(quoted.receiveAmount, 8286);
  assert.equal(quoted.calculation.exchangeGain?.sourceAmount, 0); assert.equal(quoted.calculation.exchangeGain?.destinationAmount, 33144);
});

test("4. the three boxes: what is sent, the total paid and what the person receives, forwards and backwards", () => {
  const state = fixture();
  const sent = quote(state, "DOP", "EUR", 100000, "source");
  // The total the sender pays: the commission is taken out and the rest is sent.
  const total = quote(state, "DOP", "EUR", sent.totalAmount, "total");
  assert.equal(total.amount, sent.amount); assert.equal(total.totalAmount, sent.totalAmount); assert.equal(total.receiveAmount, sent.receiveAmount);
  assert.equal(total.calculation.amountMode, "total"); assert.equal(total.calculation.requestedAmount, 120000);
  // A total that cannot be split exactly: the largest send whose commission still fits; never more than the total.
  for (const typed of [1001, 99999, 120001, 333333]) {
    const result = quote(state, "DOP", "DOP", typed, "total");
    assert.ok(result.totalAmount <= typed, `${typed}`);
    const next = quote(state, "DOP", "DOP", result.amount + 1, "source");
    assert.ok(next.totalAmount > typed, `${typed}: the next cent would go over the total`);
  }
  // One cent: its 20% commission rounds to zero, so the whole cent is sent.
  const cent = quote(state, "DOP", "DOP", 1, "total");
  assert.equal(cent.amount, 1); assert.equal(cent.commissionAmount, 0);
  // What the person receives: back through the rates, then the commission is added.
  const received = quote(state, "DOP", "EUR", 8286, "destination");
  assert.equal(received.receiveAmount, 8286); assert.equal(received.calculation.payoutAmount, 8286);
  assert.equal(received.amount, 580020); assert.equal(received.commissionAmount, 116004); assert.equal(received.totalAmount, 696024);
  assert.equal(received.requestedReceiveAmount, 8286); assert.equal(received.receiveRoundingDifference, 0);
});

test("5. the manager takes his share of the commission only, never of the exchange; the company keeps the rest", () => {
  const state = fixture({ transactionCommissionBps: 500, managerShareBps: 4000 });
  const saved = send(state, "USD", "EUR", 10000);
  const split = saved.commissionAllocation!;
  assert.deepEqual({ version: split.version, currency: split.currency, managerCommissionBps: split.managerCommissionBps, base: split.baseAmount,
    transaction: split.transactionAmount, manager: split.managerAmount, company: split.companyAmount, managerId: split.managerId },
    { version: 2, currency: "USD", managerCommissionBps: 4000, base: 500, transaction: 500, manager: 200, company: 300, managerId: gestor.id });
  assert.equal(saved.calculation?.exchangeGain?.totalAmount, 63144, "the exchange gain is the company's, outside the manager's share");
  const report = remittanceReports(state, admin, { from: day, to: day, grouping: "range" });
  assert.equal(report.commissionAllocations.totals[0].managerAmount, 200); assert.equal(report.commissionAllocations.totals[0].companyAmount, 300);
});

test("6. commission at the destination: concepts with «Sin comisión» first; it is taken from what the person receives", () => {
  const state = fixture();
  const delivery = saveDeliveryConcept(state, admin, { name: "Entrega a domicilio", commissionBps: 1000, active: true }, now);
  // 100 with a 10% delivery: the person receives 90 (the meeting's example, in pesos: the only currency one to one).
  const quoted = quote(state, "DOP", "DOP", 10000, "source", delivery.id);
  assert.equal(quoted.receiveAmount, 10000); assert.equal(quoted.calculation.deliveryCommissionAmount, 1000); assert.equal(quoted.calculation.payoutAmount, 9000);
  assert.equal(quoted.totalAmount, 12000, "the sender still pays the send and its commission");
  assert.equal(quoted.requestedReceiveAmount, undefined);
  // Typing what the person receives: the delivery is added back before the rates.
  const back = quote(state, "DOP", "DOP", 9000, "destination", delivery.id);
  assert.equal(back.amount, 10000); assert.equal(back.calculation.payoutAmount, 9000);
  // Without a concept, or with «Sin comisión», nothing is taken.
  assert.equal(quote(state, "DOP", "DOP", 10000).calculation.deliveryConceptId, "sin-comision");
  assert.equal(quote(state, "DOP", "DOP", 10000, "source", "sin-comision").calculation.payoutAmount, 10000);
  // Paying gives the person exactly what remains: the box loses 90, not 100.
  const saved = send(state, "DOP", "DOP", 10000, "source", delivery.id);
  const box = state.remittances.cashSessions.find((cash) => cash.operatorId === receiver.id && cash.currency === "DOP")!;
  const before = cashBalance(state, box).expected;
  payRemittance(state, receiver, saved.id, now);
  assert.equal(before - cashBalance(state, box).expected, 9000);
  assert.equal(state.remittances.events.at(-1)?.amount, 9000);
  const report = remittanceReports(state, admin, { from: day, to: day, grouping: "range" });
  assert.equal(report.delivered[0].amount, 9000);
});

test("7. delivery concepts: Administración only, unique names, «Sin comisión» reserved, an inactive one is not offered", () => {
  const state = fixture();
  assert.throws(() => saveDeliveryConcept(state, gestor, { name: "Otro", commissionBps: 100, active: true }, now), code("FORBIDDEN"));
  assert.throws(() => saveDeliveryConcept(state, admin, { name: "sin comision", commissionBps: 100, active: true }, now), code("CONCEPT_RESERVED"));
  assert.throws(() => saveDeliveryConcept(state, admin, { id: "sin-comision", name: "Cambiado", commissionBps: 100, active: true }, now), code("CONCEPT_RESERVED"));
  for (const commissionBps of [-1, 10000, 0.5]) assert.throws(() => saveDeliveryConcept(state, admin, { name: "Malo", commissionBps, active: true }, now), code("INVALID_CONCEPT"));
  const concept = saveDeliveryConcept(state, admin, { name: "Entrega", commissionBps: 500, active: true }, now);
  assert.throws(() => saveDeliveryConcept(state, admin, { name: "ENTREGA", commissionBps: 500, active: true }, now), code("CONCEPT_EXISTS"));
  const quoted = quote(state, "DOP", "DOP", 100000, "source", concept.id);
  // Changing its percentage after quoting asks to calculate again.
  saveDeliveryConcept(state, admin, { id: concept.id, name: "Entrega", commissionBps: 600, active: true }, now);
  assert.throws(() => createRemittance(state, gestor, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: quoted.amount, senderClientId: "cli-1", recipientClientId: "cli-5",
    quote: quoted.quote, deliveryConceptId: concept.id }, [gestor], now), code("QUOTE_CHANGED"));
  saveDeliveryConcept(state, admin, { id: concept.id, name: "Entrega", commissionBps: 600, active: false }, now);
  assert.throws(() => quote(state, "DOP", "DOP", 100000, "source", concept.id), code("DELIVERY_CONCEPT_UNAVAILABLE"));
  assert.equal(state.remittances.transfers.length, 0);
});

test("8. rounding of what the person receives: as today (cents), normal or always up to the whole unit", () => {
  for (const [receiveRounding, payout, adjustment] of [["none", 100049, 0], ["normal", 100000, -49], ["up", 100100, 51]] as const) {
    const state = fixture({ transactionCommissionBps: 0, managerShareBps: 0, receiveRounding });
    const quoted = quote(state, "DOP", "DOP", 100049);
    assert.equal(quoted.receiveAmount, 100049);
    assert.equal(quoted.calculation.payoutAmount, payout, receiveRounding); assert.equal(quoted.calculation.roundingAdjustment, adjustment, receiveRounding);
    assert.equal(quoted.calculation.receiveRounding, receiveRounding);
  }
  const normal = fixture({ transactionCommissionBps: 0, managerShareBps: 0, receiveRounding: "normal" });
  assert.equal(quote(normal, "DOP", "DOP", 100050).calculation.payoutAmount, 100100, "half goes up");
  assert.equal(getCommissionPolicy(fixture()).receiveRounding, "none", "by default, as today");
});

test("9. each send is written down whole and keeps its numbers when the configuration changes", () => {
  const state = fixture({ transactionCommissionBps: 500, managerShareBps: 4000 });
  const saved = send(state, "USD", "EUR", 10500, "total");
  assert.equal(saved.amount, 10000); assert.equal(saved.totalAmount, 10500);
  const frozen = structuredClone(state.remittances.transfers[0]);
  assert.deepEqual(Object.keys(frozen.calculation!).sort(), ["amountMode", "convertedAmount", "deliveryCommissionAmount", "deliveryCommissionBps", "deliveryConceptId",
    "deliveryConceptName", "exchangeGain", "payoutAmount", "receiveRounding", "requestedAmount", "roundingAdjustment", "version"]);
  assert.equal(frozen.calculation!.requestedAmount, 10500); assert.equal(frozen.registeredBy, gestor.id); assert.ok(frozen.createdAt);
  setCommissionPolicy(state, admin, { transactionCommissionBps: 900, managerShareBps: 1000, receiveRounding: "up" }, now);
  setDailyRate(state, admin, { currency: "EUR", rate: "69", purchaseRate: "60", saleRate: "75", date: day }, now);
  assert.deepEqual(state.remittances.transfers[0], frozen);
  payRemittance(state, receiver, saved.id, new Date("2026-10-29T17:00:00Z"));
  assert.equal(state.remittances.transfers[0].paidBy, receiver.id); assert.equal(state.remittances.transfers[0].paidAt, "2026-10-29T17:00:00.000Z");
  // A send from before has no calculation: what the person receives is its converted amount.
  assert.equal(payoutOf({ receiveAmount: 4321 }), 4321);
});

test("10. the exchange gain report and what each account sees", () => {
  const state = fixture({ transactionCommissionBps: 500, managerShareBps: 4000 });
  send(state, "USD", "EUR", 10000); send(state, "DOP", "EUR", 580000); send(state, "DOP", "DOP", 100000);
  const report = remittanceReports(state, admin, { from: day, to: day, grouping: "range" });
  assert.equal(report.exchangeGains.details.length, 3);
  const totals = Object.fromEntries(report.exchangeGains.totals.map((row) => [`${row.sourceCurrency}-${row.destinationCurrency}`, row.totalAmount]));
  assert.deepEqual(totals, { "USD-EUR": 63144, "DOP-EUR": 33144, "DOP-DOP": 0 });
  // Without the commissions permission: no exchange gain and no manager's share, but the commission at the destination is seen.
  assert.deepEqual(remittanceReports(state, plainGestor, { from: day, to: day, grouping: "range" }).exchangeGains, { details: [], totals: [], legacyCount: 0 });
  const view = transferView(state, plainGestor, state.remittances.transfers[0]);
  assert.equal(view.commissionAllocation, undefined); assert.equal(view.calculation?.exchangeGain, undefined);
  assert.equal(view.calculation?.payoutAmount, 8286); assert.equal(view.quote.managerShareBps, undefined);
});

test("11. API: three boxes, concepts and the new policy fields, strict and admin-only", async () => {
  const store = new MemoryStore(seed());
  const app = await buildApp({ store, demo: true, secret: "calculation-synthetic-secret-at-least-32", origins: [], collectorUrl: "/collector/" });
  try {
    const login = async (email: string) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } })).json().token;
    const token = await login("admin@cyp.local"), collectorToken = await login("collector@cyp.local");
    const post = (url: string, payload: object, bearer = token, key = randomUUID()) => app.inject({ method: "POST", url: `/api${url}`, payload, headers: { authorization: `Bearer ${bearer}`, "idempotency-key": key } });
    const get = (url: string, bearer = token) => app.inject({ url: `/api${url}`, headers: { authorization: `Bearer ${bearer}` } });
    assert.equal((await post("/envios/politica-comisiones", { managerShareBps: 4000 }, collectorToken)).statusCode, 403);
    for (const payload of [{}, { receiveRounding: "abajo" }, { managerShareBps: 10001 }, { managerShareBps: 4000, extra: 1 }]) assert.equal((await post("/envios/politica-comisiones", payload)).statusCode, 400, JSON.stringify(payload));
    const policy = await post("/envios/politica-comisiones", { transactionCommissionBps: 2000, managerShareBps: 5000, receiveRounding: "none" });
    assert.equal(policy.statusCode, 200, policy.body); assert.equal(policy.json().managerShareBps, 5000);
    assert.equal((await post("/envios/conceptos-entrega", { name: "Entrega", commissionBps: 1000, active: true }, collectorToken)).statusCode, 403);
    for (const payload of [{ name: "", commissionBps: 1000, active: true }, { name: "X", commissionBps: 10000, active: true }, { name: "X", commissionBps: 10, active: "si" }])
      assert.equal((await post("/envios/conceptos-entrega", payload)).statusCode, 400, JSON.stringify(payload));
    const concept = await post("/envios/conceptos-entrega", { name: "Entrega a domicilio", commissionBps: 1000, active: true });
    assert.equal(concept.statusCode, 200, concept.body);
    const snapshot = (await get("/envios/snapshot")).json();
    assert.deepEqual(snapshot.deliveryConcepts.map((row: { name: string }) => row.name), ["Sin comisión", "Entrega a domicilio"]);
    await post("/envios/cajas/abrir", { operatorId: "demo-admin", currency: "DOP", openingAmount: 0 });
    for (const bad of ["amountMode=otro", "deliveryConceptId="]) assert.equal((await get(`/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=120000&${bad}`)).statusCode, 400, bad);
    const quoted = await get(`/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=120000&amountMode=total&deliveryConceptId=${concept.json().id}`);
    assert.equal(quoted.statusCode, 200, quoted.body);
    assert.equal(quoted.json().amount, 100000); assert.equal(quoted.json().calculation.payoutAmount, 90000);
    const body = { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 100000, requestedTotalAmount: 120000, deliveryConceptId: concept.json().id,
      senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoted.json().quote };
    assert.equal((await post("/envios", { ...body, requestedReceiveAmount: 90000 })).statusCode, 422, "two boxes at once are refused");
    const saved = await post("/envios", body);
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().totalAmount, 120000); assert.equal(saved.json().calculation.payoutAmount, 90000);
    assert.equal(saved.json().commissionAllocation.managerAmount, 10000);
  } finally { await app.close(); }
});

// Rardiel, 30-10-2026: «En el único caso que no se cobra la tasa es cuando es de peso dominicano a peso dominicano porque ahí
// es siempre de 1 a 1». Whatever box is typed (what is sent, the total or what the person receives), the sender's currency
// is bought at the purchase rate and the recipient's sold at the sale rate, also dollars to dollars and euros to euros.
test("12. only pesos are one to one: every other pair buys at the purchase rate and sells at the sale rate, in the three boxes", () => {
  const state = fixture({ transactionCommissionBps: 1000, managerShareBps: 0 });
  const kinds = { DOP: ["1.000000", "base", "1.000000", "base"], USD: ["58.000000", "purchase", "61.000000", "sale"], EUR: ["66.000000", "purchase", "70.000000", "sale"] } as const;
  for (const sourceCurrency of ["DOP", "USD", "EUR"] as const) for (const destinationCurrency of ["DOP", "USD", "EUR"] as const) for (const mode of ["source", "total", "destination"] as const) {
    const quoted = quote(state, sourceCurrency, destinationCurrency, 10000, mode);
    const label = `${sourceCurrency} → ${destinationCurrency}, ${mode}`;
    assert.deepEqual([quoted.quote.sourceRate, quoted.quote.sourceRateKind], [kinds[sourceCurrency][0], kinds[sourceCurrency][1]], label);
    assert.deepEqual([quoted.quote.destinationRate, quoted.quote.destinationRateKind], [kinds[destinationCurrency][2], kinds[destinationCurrency][3]], label);
  }
  // The capture of Rardiel: USD to USD typing the total 100.00 with a 10% commission sends 90.91, sold back at 61.
  const total = quote(state, "USD", "USD", 10000, "total");
  assert.equal(total.amount, 9091); assert.equal(total.commissionAmount, 909); assert.equal(total.totalAmount, 10000);
  assert.equal(total.amountDop, 527278, "90.91 USD at 58 = 5,272.78 DOP");
  assert.equal(total.receiveAmount, 8644, "5,272.78 DOP at 61 = 86.44 USD");
  assert.equal(total.calculation.exchangeGain?.totalAmount, 27273 + 25932);
  // Pesos to pesos: one to one, no exchange gain.
  const pesos = quote(state, "DOP", "DOP", 10000, "total");
  assert.equal(pesos.amount, 9091); assert.equal(pesos.receiveAmount, 9091); assert.equal(pesos.calculation.exchangeGain?.totalAmount, 0);
  // Euros to euros too: 100 EUR at 66 = 6,600.00 DOP; at 70 = 94.29 EUR.
  assert.equal(quote(state, "EUR", "EUR", 10000).receiveAmount, 9429);
});

// The rates of the demo in the cloud on 30-10-2026, as Rardiel gave them: DOP 1/1, USD 60.50/62.90, EUR 69.00/75.00.
// Before, euros to euros showed 69 on both sides; the sale is 75.
test("13. the rates of the cloud: USD 60.50/62.90 and EUR 69.00/75.00, sold at the sale rate in every pair and box", () => {
  const state = fixture({ transactionCommissionBps: 1000, managerShareBps: 0 });
  setDailyRate(state, admin, { currency: "USD", rate: "61.7", purchaseRate: "60.50", saleRate: "62.90", date: day }, new Date(now.getTime() + 1000));
  setDailyRate(state, admin, { currency: "EUR", rate: "72", purchaseRate: "69.00", saleRate: "75.00", date: day }, new Date(now.getTime() + 1000));
  const sale = { DOP: "1.000000", USD: "62.900000", EUR: "75.000000" } as const, purchase = { DOP: "1.000000", USD: "60.500000", EUR: "69.000000" } as const;
  for (const sourceCurrency of ["DOP", "USD", "EUR"] as const) for (const destinationCurrency of ["DOP", "USD", "EUR"] as const) for (const mode of ["source", "total", "destination"] as const) {
    const quoted = quoteRemittance(state, { sourceCurrency, destinationCurrency, amount: 10000, amountMode: mode }, new Date(now.getTime() + 2000));
    assert.equal(quoted.quote.sourceRate, purchase[sourceCurrency], `${sourceCurrency} → ${destinationCurrency}, ${mode}`);
    assert.equal(quoted.quote.destinationRate, sale[destinationCurrency], `${sourceCurrency} → ${destinationCurrency}, ${mode}`);
  }
  // The capture: USD → USD typing the total 100.00 with 10%: sends 90.91 (DOP 5,500.06) and the person receives 87.44 USD.
  const dollars = quoteRemittance(state, { sourceCurrency: "USD", destinationCurrency: "USD", amount: 10000, amountMode: "total" }, new Date(now.getTime() + 2000));
  assert.equal(dollars.amount, 9091); assert.equal(dollars.amountDop, 550006); assert.equal(dollars.receiveAmount, 8744);
  // Euros to euros: 100 EUR at 69 = DOP 6,900.00; at 75 = 92.00 EUR.
  const euros = quoteRemittance(state, { sourceCurrency: "EUR", destinationCurrency: "EUR", amount: 10000, amountMode: "source" }, new Date(now.getTime() + 2000));
  assert.equal(euros.quote.destinationRate, "75.000000"); assert.equal(euros.amountDop, 690000); assert.equal(euros.receiveAmount, 9200);
});
