import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { seed } from "../src/seed.js";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { businessDate, type User } from "../src/domain.js";
import { cashBalance, cancelRemittance, createRemittance, openRemittanceCash, quoteRemittance, remittanceReports, setCommissionPolicy, setDailyRate } from "../src/remittances.js";
import { cardPaymentCharge, paymentAmounts, totalPaidForTransfer } from "../../shared/remittances/payment.mjs";
import { confirmedCreatedTransfer } from "../../shared/remittances/createdTransferResponse.js";
import { remittanceReceipt, receiptHtml } from "../../shared/remittances/receipt.js";

const admin: User = { id: "demo-admin", name: "Synthetic office", role: "admin" };
const at = new Date("2026-11-10T16:00:00Z");
const card = { method: "card" as const, cardType: "credit" as const, cardholderName: "Persona Ficticia", last4: "0042", reference: "QA-MANUAL-CARD", verified: true, cardChargeAmount: 350 };
function fixture(now = at) {
  const state = seed();
  setCommissionPolicy(state, admin, { transactionCommissionBps: 1000, managerShareBps: 4000, creditCardCommissionBps: 250 }, now);
  for (const currency of ["DOP", "USD", "EUR"] as const) {
    if (currency !== "DOP") setDailyRate(state, admin, {currency, date:businessDate(now), rate:"60", purchaseRate:"59", saleRate:"61"}, now);
    openRemittanceCash(state, admin, {operatorId:admin.id, currency, openingAmount:0}, [], now);
  }
  return state;
}
const bodyFor = (state: ReturnType<typeof seed>, now = at) => ({ sourceCurrency:"DOP" as const, destinationCurrency:"DOP" as const, amount:10000, commissionBps:1000, senderClientId:"cli-1", recipientClientId:"cli-5", quote:quoteRemittance(state, {sourceCurrency:"DOP",destinationCurrency:"DOP",amount:10000}, now).quote, payment:card });

test("manual credit/debit charge adds exact cents once in the sender currency without changing payout, commission or cash", () => {
  const state = fixture();
  for (const sourceCurrency of ["DOP", "USD", "EUR"] as const) for (const cardType of ["credit", "debit"] as const) for (const cardChargeAmount of [0, 1, 350]) {
    const pair = {sourceCurrency,destinationCurrency:"DOP" as const,amount:10000};
    const quote = quoteRemittance(state, pair, at);
    const body = {...bodyFor(state),...pair,quote:quote.quote,payment:{...card,cardType,cardChargeAmount}};
    const saved = createRemittance(state,admin,body,[],at);
    assert.equal(saved.payment?.version,3);
    assert.equal(saved.payment?.cardSurchargeBps,undefined,"an entered amount is not an invented percentage");
    assert.equal(saved.payment?.cardSurchargeAmount,cardChargeAmount);
    assert.equal(saved.totalAmount,quote.totalAmount);
    assert.equal(totalPaidForTransfer(saved),quote.totalAmount+cardChargeAmount);
    assert.equal(saved.payment?.tenderedAmount,quote.totalAmount+cardChargeAmount);
    assert.equal(saved.receiveAmount,quote.receiveAmount);
    assert.deepEqual(saved.calculation,quote.calculation);
    assert.equal(saved.commissionAllocation?.managerAmount,quote.commissionAllocation.managerAmount);
    assert.equal(confirmedCreatedTransfer(saved,body,admin.id,quote).id,saved.id);
    assert.throws(()=>confirmedCreatedTransfer({...saved,payment:{...saved.payment,cardSurchargeAmount:cardChargeAmount+1}},body,admin.id,quote));
    assert.throws(()=>confirmedCreatedTransfer({...saved,payment:{...saved.payment,version:2}},body,admin.id,quote));
  }
  for (const cash of state.remittances.cashSessions) assert.equal(cashBalance(state,cash).expected,0);
});

test("manual charges reject invalid cents, overflow, non-card fields and incomplete details before recording", () => {
  const state=fixture(), body=bodyFor(state), before=structuredClone(state);
  for (const payment of [
    ...[-1, .1, NaN, Infinity, Number.MAX_SAFE_INTEGER, "350", null].map(cardChargeAmount=>({...card,cardChargeAmount})),
    {...card,method:"cash"}, {...card,method:"transfer"}, {...card,method:"deposit"}, {...card,cardType:undefined},
    {...card,cardType:"debit",last4:undefined}, {...card,cardType:"debit",cardholderName:undefined}, {...card,verified:false},
  ]) {
    assert.throws(()=>createRemittance(state,admin,{...body,payment} as never,[],at));
    assert.deepEqual(state,before);
  }
  assert.deepEqual(cardPaymentCharge(11000,"credit",250,350),{cardSurchargeAmount:350,totalAmount:11350});
  assert.deepEqual(cardPaymentCharge(11000,"debit",250,0),{cardSurchargeAmount:0,totalAmount:11000});
  assert.equal(paymentAmounts(11000,{...card,cardChargeAmount:0},250).tenderedAmount,11000);
  assert.throws(()=>cardPaymentCharge(Number.MAX_SAFE_INTEGER,"debit",0,1));
});

test("the manual charge is frozen in full and telephone receipts, reports and external refunds", () => {
  const state=fixture(), saved=createRemittance(state,admin,bodyFor(state),[],at);
  setCommissionPolicy(state,admin,{creditCardCommissionBps:900},at);
  for (const printed of [false,true]) for (const compact of [false,true]) {
    const html=receiptHtml(remittanceReceipt(saved,undefined,"Synthetic","Synthetic",printed),{paper:"76",compact});
    assert.match(html,/Cargo adicional por tarjeta/);
    assert.match(html,/DOP 3\.50/); assert.match(html,/DOP 113\.50/);
    assert.doesNotMatch(html,/Persona Ficticia|9%|2\.5%/);
  }
  const filter={from:businessDate(at),to:businessDate(at),grouping:"range" as const};
  const report=remittanceReports(state,admin,filter);
  assert.equal(report.amounts[0].totalAmount,11350); assert.equal(report.amounts[0].cardSurchargeAmount,350);
  assert.equal(report.amounts[0].commissionAmount,1000); assert.equal(report.commissionAllocations.totals[0].managerAmount,400);
  cancelRemittance(state,admin,saved.id,"Synthetic external refund",at,{reference:"QA-REFUND-11350",verified:true});
  assert.equal(remittanceReports(state,admin,filter).amounts[0].totalAmount,0);
  assert.equal(state.remittances.events.find(row=>row.type==="cancelled")?.amount,0);
});

test("API persists manual charges and replays the same result after a lost reply without accepting a changed amount", async t => {
  const now=new Date(), store=new MemoryStore(fixture(now));
  const app=await buildApp({store,demo:true,secret:"synthetic-manual-charge-secret-at-least-32",origins:[]});
  t.after(()=>app.close());
  const login=await app.inject({method:"POST",url:"/api/auth/login",payload:{email:"admin@cyp.local",password:"Demo-CyP-2026!"}});
  assert.equal(login.statusCode,200);
  const post=(body:unknown,key=randomUUID())=>app.inject({method:"POST",url:"/api/envios",payload:body as never,headers:{authorization:`Bearer ${login.json().token}`,"idempotency-key":key}});
  const body=bodyFor(await store.read(),now), before=JSON.stringify(await store.read());
  for (const cardChargeAmount of [-1, .5, "350", null, Number.MAX_SAFE_INTEGER]) {
    assert.equal((await post({...body,payment:{...card,cardChargeAmount}})).statusCode,cardChargeAmount === Number.MAX_SAFE_INTEGER ? 422 : 400);
    assert.equal(JSON.stringify(await store.read()),before);
  }
  for (const cardType of ["credit","debit"] as const) {
    const payload={...body,payment:{...card,cardType}}, key=randomUUID();
    const first=await post(payload,key), retry=await post(payload,key);
    assert.equal(first.statusCode,200,first.body); assert.deepEqual(retry.json(),first.json());
    assert.equal(first.json().payment.version,3); assert.equal(first.json().payment.cardSurchargeAmount,350);
    assert.equal(first.json().payment.tenderedAmount,11350);
    const changed=await post({...payload,payment:{...payload.payment,cardChargeAmount:351}},key);
    assert.equal(changed.statusCode,409,changed.body);
  }
  assert.equal((await store.read()).remittances.transfers.length,2);
});
