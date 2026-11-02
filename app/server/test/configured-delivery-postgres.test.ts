import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { seed } from "../src/seed.js";
import { PostgresStore } from "../src/store.js";
import { businessDate, type User } from "../src/domain.js";
import { createRemittance, getCommissionPolicy, openRemittanceCash, payRemittance, quoteRemittance, setCommissionPolicy } from "../src/remittances.js";

test("PostgreSQL 046: central delivery starts at zero, persists, freezes the send and rejects invalid percentages", {skip: !process.env.CYP_DELIVERY_POLICY_TEST_DATABASE_URL}, async () => {
  const url = new URL(process.env.CYP_DELIVERY_POLICY_TEST_DATABASE_URL!);
  assert.equal(url.hostname,"127.0.0.1"); assert.equal(url.port,"55437");
  assert.equal(url.pathname,"/cyp_delivery_policy_qa"); assert.equal(url.username,"delivery_policy_qa");
  const store = new PostgresStore(url.href), reader = new PostgresStore(url.href);
  const sql = new pg.Client({connectionString:url.href}); await sql.connect();
  const now = new Date(), admin: User = {id:"demo-admin",name:"Synthetic Admin",role:"admin"};
  try {
    assert.equal(getCommissionPolicy(await reader.read()).deliveryCommissionBps,0);
    const saved = await store.transaction(state => {
      Object.assign(state, {...seed(), remittances:state.remittances});
      setCommissionPolicy(state,admin,{transactionCommissionBps:500,deliveryCommissionBps:1000},now);
      openRemittanceCash(state,admin,{operatorId:admin.id,currency:"DOP",openingAmount:1000000},[],now);
      const q = quoteRemittance(state,{sourceCurrency:"DOP",destinationCurrency:"DOP",amount:10000},now);
      return createRemittance(state,admin,{sourceCurrency:"DOP",destinationCurrency:"DOP",amount:q.amount,senderClientId:"cli-1",recipientClientId:"cli-5",quote:q.quote},[],now);
    });
    assert.equal(getCommissionPolicy(await reader.read()).deliveryCommissionBps,1000);
    const frozen = (await reader.read()).remittances.transfers[0];
    assert.deepEqual(frozen.calculation,saved.calculation); assert.equal(frozen.calculation?.payoutAmount,9000);
    await store.transaction(state => setCommissionPolicy(state,admin,{deliveryCommissionBps:2000},now));
    assert.deepEqual((await reader.read()).remittances.transfers[0].calculation,frozen.calculation);
    await assert.rejects(store.transaction(state => createRemittance(state,admin,{sourceCurrency:"DOP",destinationCurrency:"DOP",amount:saved.amount,senderClientId:"cli-1",recipientClientId:"cli-5",quote:saved.quote},[],now)), error => (error as {code:string}).code==="QUOTE_CHANGED");
    await store.transaction(state => payRemittance(state,admin,saved.id,now));
    assert.equal((await sql.query("SELECT amount FROM remittance_events WHERE transfer_id=$1 AND type='paid'",[saved.id])).rows[0].amount,9000);
    for (const value of [-1,10000]) await assert.rejects(sql.query("UPDATE remittance_commission_policy SET delivery_commission_bps=$1 WHERE id=1",[value]));
    assert.equal((await reader.read()).remittances.transfers.length,1);
    assert.equal(saved.quote.date,businessDate(now));
  } finally {await sql.end();await store.close();await reader.close();}
});
