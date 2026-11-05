import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, publicEncrypt, randomUUID, constants } from "node:crypto";
import { CardVault, configuredCardVault } from "../src/card-vault.js";
import { encryptCardArchive } from "../../shared/remittances/cardArchive.mjs";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { seed } from "../src/seed.js";
import { openRemittanceCash, quoteRemittance } from "../src/remittances.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";
import type { State } from "../src/domain.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 3072, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const vault = new CardVault(keys.privateKey, 30), pan = "4242424242424242", expiry = "12/99";

test("vault stays disabled without explicit configuration; validates key and retention without exposing them", () => {
  assert.equal(configuredCardVault({}), undefined);
  assert.throws(() => configuredCardVault({ CARD_VAULT_ENABLED: "true" }));
  assert.throws(() => new CardVault("synthetic-invalid-key", 30));
  for (const days of [0, 366, .5, NaN]) assert.throws(() => new CardVault(keys.privateKey, days));
  assert(!JSON.stringify(vault.info()).includes("PRIVATE"));
});

test("transport excludes CVV; at-rest envelope binds record, actor, expiration and key with fresh randomness", async () => {
  const transport = await encryptCardArchive(pan, expiry, vault.info());
  assert(!JSON.stringify(transport).includes(pan)); assert(!JSON.stringify(transport).includes(expiry));
  const one = vault.archive(transport, "synthetic-record", "synthetic-actor", "4242");
  const two = vault.archive(transport, "synthetic-record", "synthetic-actor", "4242");
  assert.notEqual(one.ciphertext, two.ciphertext); assert.notEqual(one.wrappedKey, two.wrappedKey);
  assert(!JSON.stringify(one).includes(pan));assert(!JSON.stringify(one).includes(expiry));
  assert.deepEqual(vault.open(one, "synthetic-record", "synthetic-actor"), { pan, expiry });
  for (const changed of [{...one,tag:two.tag},{...one,transferId:"different"},{...one,actorId:"different"},{...one,expiresAt:new Date(Date.parse(one.expiresAt)+86400000).toISOString()}]) assert.throws(() => vault.open(changed,"synthetic-record","synthetic-actor"));
  assert.throws(() => vault.open(one,"synthetic-record","synthetic-actor",new Date(one.expiresAt)));
  assert.throws(() => vault.archive(transport,"synthetic-record","synthetic-actor","1111"));
  const forbidden = publicEncrypt({key:keys.publicKey,oaepHash:"sha256",padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(JSON.stringify({pan,expiry,cvv:"123"}))).toString("base64");
  assert.throws(() => vault.archive({...transport,ciphertext:forbidden},"synthetic-record","synthetic-actor","4242"));
  await assert.rejects(encryptCardArchive(pan,"13/99",vault.info()));
});

test("API atomically stores only ciphertext, acknowledges storage, redacts responses and replays without duplication", async (t) => {
  const now = new Date(), initial = seed(), admin = {id:"demo-admin",name:"Synthetic Admin",role:"admin" as const};
  openRemittanceCash(initial,admin,{operatorId:admin.id,currency:"DOP",openingAmount:0},[],now);
  const store = new MemoryStore(initial);
  const app = await buildApp({store,demo:true,secret:"synthetic-card-vault-secret-at-least-32",origins:[],cardVault:vault});t.after(()=>app.close());
  const login = await app.inject({method:"POST",url:"/api/auth/login",payload:{email:"admin@cyp.local",password:DEMO_PASSWORD}});
  assert.equal(login.statusCode,200); const authorization = `Bearer ${login.json().token}`;
  const pair = {sourceCurrency:"DOP" as const,destinationCurrency:"DOP" as const,amount:10000};
  const transport = await encryptCardArchive(pan,expiry,vault.info());
  const body = {...pair,senderClientId:"cli-1",recipientClientId:"cli-5",quote:quoteRemittance(await store.read(),pair).quote,
    payment:{method:"card",cardType:"credit",cardholderName:"Persona de prueba",last4:"4242",reference:"QA-VERIFONE",bank:"BHD",verified:true},cardArchive:transport};
  const key = randomUUID(), post = (payload:unknown,id=key)=>app.inject({method:"POST",url:"/api/envios",headers:{authorization,"idempotency-key":id},payload:payload as never});
  const before = JSON.stringify(await store.read());
  const bad = await post({...body,payment:{...body.payment,cvv:"123"}},randomUUID());assert.equal(bad.statusCode,400);assert.equal(JSON.stringify(await store.read()),before);
  const {cardArchive: _archive, ...withoutArchive} = body;
  const missing = await post(withoutArchive,randomUUID());assert.equal(missing.statusCode,400);assert.equal(missing.json().error.code,"CARD_ARCHIVE_REQUIRED");
  const tampered = await post({...body,cardArchive:{...transport,ciphertext:Buffer.alloc(384,1).toString("base64")}},randomUUID());assert.equal(tampered.statusCode,400);assert.equal(tampered.json().error.code,"INVALID_CARD_ARCHIVE");assert.equal(JSON.stringify(await store.read()),before);
  const first = await post(body), retry = await post(body);assert.equal(first.statusCode,200,first.body);assert.deepEqual(first.json(),retry.json());
  assert.equal(first.json().cardStored,true);assert.doesNotMatch(first.body,/ciphertext|wrappedKey|cardArchives|12\/99|4242424242424242|cvv/i);
  const state = await store.read();assert.equal(state.remittances.transfers.length,1);assert.equal(state.remittances.cardArchives?.length,1);
  assert.deepEqual(vault.open(state.remittances.cardArchives![0],first.json().id,admin.id),{pan,expiry});
  assert(!JSON.stringify(state).includes(pan));assert(!JSON.stringify(state).includes(expiry));
  for (const url of ["/api/envios","/api/envios/snapshot"]) { const response=await app.inject({method:"GET",url,headers:{authorization}});assert.equal(response.statusCode,200);assert.doesNotMatch(response.body,/cardArchives|wrappedKey|ciphertext|12\/99|4242424242424242/); }
  await assert.rejects(store.transaction(s=>{s.remittances.cardArchives=[];}));
});

test("database rejection gets a safe support reference and a definitive rollback, without retrying a broken payment forever", async (t) => {
  class RejectedStore extends MemoryStore {
    reject = false;
    override transaction<T>(fn: (state: State) => T | Promise<T>) {
      return super.transaction(async state => {
        const result = await fn(state);
        if (this.reject) { this.reject=false;throw Object.assign(new Error("Synthetic check failure"),{code:"23514",constraint:"remittance_payment_valid"}); }
        return result;
      });
    }
  }
  const now = new Date(), initial = seed(), admin={id:"demo-admin",name:"Synthetic Admin",role:"admin" as const};
  openRemittanceCash(initial,admin,{operatorId:admin.id,currency:"DOP",openingAmount:0},[],now);
  const store = new RejectedStore(initial), app=await buildApp({store,demo:true,secret:"synthetic-check-diagnostic-secret-at-least-32",origins:[]});t.after(()=>app.close());
  const login=await app.inject({method:"POST",url:"/api/auth/login",payload:{email:"admin@cyp.local",password:DEMO_PASSWORD}});
  const pair={sourceCurrency:"DOP" as const,destinationCurrency:"DOP" as const,amount:10000}, before=await store.read();
  const body={...pair,senderClientId:"cli-1",recipientClientId:"cli-5",quote:quoteRemittance(before,pair).quote,payment:{method:"card",cardType:"credit",cardholderName:"Persona de prueba",last4:"4242",reference:"QA-EXTERNAL",verified:true}};
  store.reject=true;
  const failed=await app.inject({method:"POST",url:"/api/envios",headers:{authorization:`Bearer ${login.json().token}`,"idempotency-key":randomUUID()},payload:body});
  assert.equal(failed.statusCode,409);assert.equal(failed.json().error.code,"CARD_PAYMENT_REJECTED");assert(failed.json().error.requestId);
  assert.doesNotMatch(failed.body,/Synthetic check failure|remittance_payment_valid|4242/);
  assert.deepEqual((await store.read()).remittances.transfers,before.remittances.transfers);
  assert.deepEqual((await store.read()).idempotency,before.idempotency);
});
