import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresStore } from "../src/store.js";
import { buildApp } from "../src/app.js";
import { businessDate } from "../src/domain.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";
import { openRemittanceCash, quoteRemittance, setCommissionPolicy, setDailyRate } from "../src/remittances.js";

test("PostgreSQL persists USD-to-USD and EUR-to-EUR through DOP for cash and credit, retaining immutable exchange gains", {skip:!process.env.CYP_CARD_RECORDS_TEST_DATABASE_URL}, async () => {
  const target = new URL(process.env.CYP_CARD_RECORDS_TEST_DATABASE_URL!);
  assert.equal(target.hostname,"127.0.0.1");assert.equal(target.port,"55437");assert.equal(target.pathname,"/cyp_card_vault_qa_20261105_v2");
  const store = new PostgresStore(target.href), now = new Date(), actor = {id:"demo-admin",name:"Synthetic Admin",role:"admin" as const};
  const date = businessDate(now);
  await store.transaction(state => {
    setCommissionPolicy(state,actor,{transactionCommissionBps:1000,deliveryCommissionBps:0,creditCardCommissionBps:250},now);
    for (const currency of ["USD","EUR"] as const) {
      setDailyRate(state,actor,{currency,date,rate:currency==="USD"?"63":"70",purchaseRate:currency==="USD"?"63":"70",saleRate:currency==="USD"?"64":"72"},now);
      if (!state.remittances.cashSessions.some(row=>row.operatorId===actor.id&&row.currency===currency&&row.date===date&&row.status==="open")) openRemittanceCash(state,actor,{operatorId:actor.id,currency,openingAmount:0},[],now);
    }
  });
  const app = await buildApp({store,demo:true,secret:"synthetic-same-currency-postgres-at-least-32",origins:[]});
  const sql = new pg.Client({connectionString:target.href});await sql.connect();
  try {
    assert.equal(await store.sameCurrencySchemaReady(),true,"the read-only health probe verifies both foreign-currency pairs");
    assert.equal((await app.inject({method:"GET",url:"/api/health"})).json().sameCurrencyRecordsReady,true);
    const historical = (await store.read()).remittances.transfers;
    const login = await app.inject({method:"POST",url:"/api/auth/login",payload:{email:"admin@cyp.local",password:DEMO_PASSWORD}});assert.equal(login.statusCode,200);
    const authorization = `Bearer ${login.json().token}`;
    for (const currency of ["USD","EUR"] as const) for (const method of ["cash","credit"] as const) {
      const pair = {sourceCurrency:currency,destinationCurrency:currency,amount:10000}, quotation = quoteRemittance(await store.read(),pair);
      assert.equal(quotation.receiveAmount,currency==="USD"?9844:9722);
      const response = await app.inject({method:"POST",url:"/api/envios",headers:{authorization,"idempotency-key":randomUUID()},payload:{...pair,senderClientId:"cli-1",recipientClientId:"cli-5",quote:quotation.quote,
        payment:method==="cash"?{method:"cash",tenderedAmount:11000}:{method:"card",cardType:"credit",cardholderName:"Persona de Prueba",last4:"4242",reference:"QA-SAME-CURRENCY",verified:true}}});
      assert.equal(response.statusCode,200,`${currency}/${method}: ${response.body}`);
      const saved = (await store.read()).remittances.transfers.find(row=>row.id===response.json().id)!;
      assert.equal(saved.receiveAmount,quotation.receiveAmount);assert(saved.calculation?.exchangeGain?.sourcePurchaseRate);assert(saved.calculation?.exchangeGain?.destinationSaleRate);
      assert.equal(saved.payment?.method,method==="credit"?"card":"cash");
      assert.equal(saved.totalAmount,11000);assert.equal(saved.payment?.tenderedAmount,method==="credit"?11275:11000);
      assert.equal((await store.read()).remittances.events.find(row=>row.transferId===saved.id&&row.type==="sent")?.amount,method==="cash"?11000:0);
      const valid = async (calculation:unknown) => (await sql.query("SELECT valid_remittance_calculation($1::jsonb,$2::bigint,$3::bigint,$4::bigint,$5::text,$6::text) AS ok",[JSON.stringify(calculation),saved.amount,saved.receiveAmount,saved.calculation!.payoutAmount,currency,currency])).rows[0].ok;
      assert.equal(await valid(saved.calculation),true);
      assert.equal(await valid({...saved.calculation,exchangeGain:{...saved.calculation!.exchangeGain,sourceAmount:saved.calculation!.exchangeGain!.sourceAmount+1}}),false,"forged gain arithmetic is still rejected");
      assert.equal(await valid({...saved.calculation,payoutAmount:saved.calculation!.payoutAmount+1}),false,"payout binding is still enforced");
    }
    const after = (await store.read()).remittances.transfers;
    for (const old of historical) assert.deepEqual(after.find(row=>row.id===old.id),old,"historical transfers stay frozen");
  } finally {await app.close();await sql.end();}
});
