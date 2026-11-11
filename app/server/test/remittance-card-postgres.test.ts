import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { seed } from "../src/seed.js";
import { PostgresStore } from "../src/store.js";
import { type User } from "../src/domain.js";
import { cancelRemittance, createRemittance, getCommissionPolicy, openRemittanceCash, quoteRemittance, setCommissionPolicy } from "../src/remittances.js";

test("PostgreSQL 047: fresh migrations, frozen credit/debit records, exact fee, strict SQL allowlist and quote binding", {skip: !process.env.CYP_CARD_RECORDS_TEST_DATABASE_URL}, async () => {
  const url = new URL(process.env.CYP_CARD_RECORDS_TEST_DATABASE_URL!);
  assert.equal(url.hostname,"127.0.0.1"); assert.equal(url.port,"55437");
  assert(["/cyp_card_records_qa","/cyp_card_records_qa_final","/cyp_card_records_qa_verified","/cyp_card_vault_qa_20261105","/cyp_card_vault_qa_20261105_v2","/cyp_card_details_qa_20261106","/cyp_card_manual_qa_20261110"].includes(url.pathname)); assert.equal(url.username,"card_records_qa");
  const store = new PostgresStore(url.href), reader = new PostgresStore(url.href);
  const sql = new pg.Client({connectionString:url.href}); await sql.connect();
  const now = new Date(), admin: User = {id:"demo-admin",name:"Synthetic Admin",role:"admin"};
  try {
    assert.equal(getCommissionPolicy(await reader.read()).creditCardCommissionBps,0);
    const saved = await store.transaction(state => {
      Object.assign(state, {...seed(), remittances:state.remittances});
      setCommissionPolicy(state,admin,{transactionCommissionBps:1000,creditCardCommissionBps:250},now);
      if (!state.remittances.cashSessions.some(row=>row.operatorId===admin.id&&row.currency==="DOP"&&row.status==="open")) openRemittanceCash(state,admin,{operatorId:admin.id,currency:"DOP",openingAmount:0},[],now);
      const pair = {sourceCurrency:"DOP" as const,destinationCurrency:"DOP" as const,amount:10000};
      return createRemittance(state,admin,{...pair,senderClientId:"cli-1",recipientClientId:"cli-5",quote:quoteRemittance(state,pair,now).quote,
        payment:{method:"card",cardType:"credit",cardholderName:"Synthetic Holder",last4:"0042",reference:"QA-EXTERNAL",verified:true}},[],now);
    });
    assert.equal(getCommissionPolicy(await reader.read()).creditCardCommissionBps,250);
    const frozen = (await reader.read()).remittances.transfers.find(row=>row.id===saved.id)!;
    assert.deepEqual(frozen.payment,saved.payment); assert.deepEqual(frozen.quote,saved.quote);
    assert.equal(frozen.payment?.tenderedAmount,11275); assert.equal(frozen.payment?.cardSurchargeAmount,275);
    await store.transaction(state => setCommissionPolicy(state,admin,{creditCardCommissionBps:500},now));
    assert.deepEqual((await reader.read()).remittances.transfers.find(row=>row.id===saved.id)!.payment,frozen.payment);
    const valid = async (payment: unknown) => (await sql.query("SELECT valid_remittance_payment($1::jsonb,$2,$3,$4) AS valid",[JSON.stringify(payment),saved.totalAmount,saved.registeredBy,saved.createdAt])).rows[0].valid;
    assert.equal(await valid(saved.payment),true);
    const legacy = {version:1,method:"card",reference:"QA-LEGACY",tenderedAmount:saved.totalAmount,changeAmount:0,confirmedBy:saved.registeredBy,confirmedAt:saved.createdAt};
    assert.equal(await valid(legacy),true,"legacy card records remain readable without invented metadata");
    assert.equal(await valid({...legacy,method:"cash",tenderedAmount:12000,changeAmount:1000,reference:undefined}),true);
    for (const payment of [
      {...saved.payment,cvv:"123"}, {...saved.payment,cardNumber:"4111111111111111"}, {...saved.payment,expiry:"12/29"},
      {...saved.payment,last4:"12345"}, {...saved.payment,last4:1234}, {...saved.payment,cardholderName:null},
      {...saved.payment,cardType:"other"}, {...saved.payment,cardType:"debit"}, {...saved.payment,cardSurchargeAmount:0},
      {...saved.payment,tenderedAmount:11000}, {...saved.payment,version:1},
    ]) assert.equal(await valid(payment),false);
    // A mathematically consistent forged lower fee must still fail the frozen quote binding.
    const id = randomUUID(), forged = {...saved.payment,cardSurchargeBps:0,cardSurchargeAmount:0,tenderedAmount:11000};
    assert.equal(await valid(forged),true);
    await assert.rejects(sql.query(`INSERT INTO remittance_transfers SELECT (jsonb_populate_record(NULL::remittance_transfers,
      to_jsonb(t) || $2::jsonb)).* FROM remittance_transfers t WHERE id=$1`,[saved.id,JSON.stringify({id,sequence:99999998,envio_reference:"ENV99999998",recibo_reference:"REC99999998",operating_code:id,payment:forged})]), /remittance_card_rate_matches_quote/);
    await assert.rejects(sql.query(`INSERT INTO remittance_transfers SELECT (jsonb_populate_record(NULL::remittance_transfers,
      to_jsonb(t) || $2::jsonb)).* FROM remittance_transfers t WHERE id=$1`,[saved.id,JSON.stringify({id,sequence:99999998,envio_reference:"ENV99999998",recibo_reference:"REC99999998",operating_code:id,payment:legacy})]), /remittance_card_rate_matches_quote/);
    // PostgreSQL preserves 2.0 as numeric text. Its value is still version 2: never bypass the quote binding.
    await assert.rejects(sql.query(`INSERT INTO remittance_transfers SELECT (jsonb_populate_record(NULL::remittance_transfers,
      to_jsonb(t) || jsonb_set($2::jsonb,'{payment,version}','2.0'::jsonb))).* FROM remittance_transfers t WHERE id=$1`,
      [saved.id,JSON.stringify({id,sequence:99999998,envio_reference:"ENV99999998",recibo_reference:"REC99999998",operating_code:id,payment:saved.payment,quote_credit_card_commission_bps:0})]), /remittance_card_rate_matches_quote/);
    for (const rate of [-1,10001]) await assert.rejects(sql.query("UPDATE remittance_commission_policy SET credit_card_commission_bps=$1 WHERE id=1",[rate]));
    await store.transaction(state => {
      const pair = {sourceCurrency:"DOP" as const,destinationCurrency:"DOP" as const,amount:10000};
      return createRemittance(state,admin,{...pair,senderClientId:"cli-1",recipientClientId:"cli-5",quote:quoteRemittance(state,pair,now).quote,
        payment:{method:"card",cardType:"debit",reference:"QA-DEBIT",verified:true}},[],now);
    });
    assert.equal((await reader.read()).remittances.transfers.find(row=>row.payment?.cardType==="debit")!.payment?.cardSurchargeAmount,0);
    const debitWithDetails = await store.transaction(state => {
      const pair = {sourceCurrency:"DOP" as const,destinationCurrency:"DOP" as const,amount:10000};
      return createRemittance(state,admin,{...pair,senderClientId:"cli-1",recipientClientId:"cli-5",quote:quoteRemittance(state,pair,now).quote,
        payment:{method:"card",cardType:"debit",cardholderName:"Persona de Débito",last4:"0042",reference:"QA-DEBIT-DETAILS",verified:true}},[],now);
    });
    assert.deepEqual((await reader.read()).remittances.transfers.find(row=>row.id===debitWithDetails.id)!.payment,debitWithDetails.payment);
    assert.equal(await valid(debitWithDetails.payment),true);
    for (const invalid of [{...debitWithDetails.payment,last4:undefined},{...debitWithDetails.payment,cardholderName:undefined},{...debitWithDetails.payment,cvv:"123"},{...debitWithDetails.payment,expiry:"12/99"}]) assert.equal(await valid(invalid),false);
    assert.equal(await reader.cardPaymentSchemaReady(),true);
    await store.transaction(state => cancelRemittance(state,admin,saved.id,"Synthetic external refund",now,{reference:"QA-REFUND-11275",verified:true}));
    const after = await reader.read();
    assert.equal(after.remittances.transfers.find(row=>row.id===saved.id)!.status,"cancelled");
    assert.equal(after.remittances.events.find(e=>e.type==="cancelled")?.amount,0);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM cyp_schema_migrations WHERE name = '051_remittance_debit_card_details.sql'")).rows[0].n,1);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM cyp_schema_migrations WHERE name = '052_manual_card_charge.sql'")).rows[0].n,1);
  } finally {await sql.end();await store.close();await reader.close();}
});
