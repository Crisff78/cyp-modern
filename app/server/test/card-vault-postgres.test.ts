import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import pg from "pg";
import { CardVault } from "../src/card-vault.js";
import { encryptCardArchive } from "../../shared/remittances/cardArchive.mjs";
import { PostgresStore } from "../src/store.js";
import { buildApp } from "../src/app.js";
import { openRemittanceCash, quoteRemittance } from "../src/remittances.js";
import { seed } from "../src/seed.js";
import { businessDate } from "../src/domain.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";

test("048 PostgreSQL stores authenticated ciphertext, reads it after restart, and rejects modification and CVV columns", {skip:!process.env.CYP_CARD_RECORDS_TEST_DATABASE_URL}, async () => {
  const target = new URL(process.env.CYP_CARD_RECORDS_TEST_DATABASE_URL!);
  assert.equal(target.hostname,"127.0.0.1");assert.equal(target.port,"55437");assert(["/cyp_card_vault_qa_20261105","/cyp_card_vault_qa_20261105_v2","/cyp_card_details_qa_20261106"].includes(target.pathname));
  const {privateKey} = generateKeyPairSync("rsa",{modulusLength:3072,privateKeyEncoding:{type:"pkcs8",format:"pem"},publicKeyEncoding:{type:"spki",format:"pem"}});
  const vault = new CardVault(privateKey,30), store = new PostgresStore(target.href), reader = new PostgresStore(target.href);
  const sql = new pg.Client({connectionString:target.href});await sql.connect();
  assert.equal(await store.cardPaymentSchemaReady(), true, "read-only probe accepts credit snapshots and safe debit metadata");
  await store.transaction(state => {
    if (!state.clients.length) Object.assign(state, {...seed(),remittances:state.remittances});
    if (!state.remittances.cashSessions.some(row=>row.operatorId==="demo-admin"&&row.currency==="DOP"&&row.date===businessDate()&&row.status==="open"))
      openRemittanceCash(state,{id:"demo-admin",name:"Synthetic Admin",role:"admin"},{operatorId:"demo-admin",currency:"DOP",openingAmount:0});
  });
  const app = await buildApp({store,demo:true,secret:"synthetic-archive-postgres-secret-at-least-32",origins:[],cardVault:vault});
  try {
    const login = await app.inject({method:"POST",url:"/api/auth/login",payload:{email:"admin@cyp.local",password:DEMO_PASSWORD}});assert.equal(login.statusCode,200);
    const authorization = `Bearer ${login.json().token}`, pair={sourceCurrency:"DOP" as const,destinationCurrency:"DOP" as const,amount:10000};
    const pan="4242424242424242", expiry="12/99", cardArchive=await encryptCardArchive(pan,expiry,vault.info());
    const response = await app.inject({method:"POST",url:"/api/envios",headers:{authorization,"idempotency-key":randomUUID()},payload:{...pair,senderClientId:"cli-1",recipientClientId:"cli-5",quote:quoteRemittance(await store.read(),pair).quote,
      payment:{method:"card",cardType:"credit",cardholderName:"Persona de Prueba",last4:"4242",reference:"QA-VERIFONE-ARCHIVE",verified:true},cardArchive}});
    assert.equal(response.statusCode,200,response.body);assert.equal(response.json().cardStored,true);
    const persisted = (await reader.read()).remittances.cardArchives!.find(row=>row.transferId===response.json().id)!;
    assert.deepEqual(vault.open(persisted,response.json().id,"demo-admin"),{pan,expiry});
    const raw = (await sql.query("SELECT row_to_json(v)::text AS raw FROM remittance_card_vault v WHERE transfer_id=$1",[response.json().id])).rows[0].raw;
    assert(!raw.includes(pan));assert(!raw.includes(expiry));assert(!raw.includes('"cvv"'));
    await assert.rejects(sql.query("UPDATE remittance_card_vault SET key_id=key_id WHERE transfer_id=$1",[response.json().id]));
    await assert.rejects(sql.query("DELETE FROM remittance_card_vault WHERE transfer_id=$1",[response.json().id]));
    for (const cardType of ["credit","debit"] as const) {
      const cardArchive = await encryptCardArchive(pan,undefined,vault.info());
      const response = await app.inject({method:"POST",url:"/api/envios",headers:{authorization,"idempotency-key":randomUUID()},payload:{...pair,senderClientId:"cli-1",recipientClientId:"cli-5",quote:quoteRemittance(await store.read(),pair).quote,
        payment:{method:"card",cardType,cardholderName:"Persona de Prueba",last4:"4242",reference:`QA-PAN-ONLY-${cardType}`,verified:true},cardArchive}});
      assert.equal(response.statusCode,200,response.body); assert.equal(response.json().cardStored,true);
      const reloaded = (await reader.read()).remittances.transfers.find(row=>row.id===response.json().id)!;
      assert.equal(reloaded.payment?.cardType,cardType); assert.equal(reloaded.payment?.last4,"4242"); assert.equal(reloaded.payment?.cardholderName,"Persona de Prueba");
      const encrypted = (await reader.read()).remittances.cardArchives!.find(row=>row.transferId===reloaded.id)!;
      assert.deepEqual(vault.open(encrypted,reloaded.id,"demo-admin"),{pan});
      const raw = (await sql.query("SELECT row_to_json(v)::text AS raw FROM remittance_card_vault v WHERE transfer_id=$1",[reloaded.id])).rows[0].raw;
      assert(!raw.includes(pan)); assert.doesNotMatch(raw,/"expiry"|"cvv"/);
    }
  } finally {await app.close();await reader.close();await sql.end();}
});
