import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { seed } from "../src/seed.js";
import { type User } from "../src/domain.js";
import { effectiveAccess } from "../../shared/access.mjs";
import { remittanceCashActivity } from "../src/remittance-cash-activity.js";
import { addRemittanceCash, cancelRemittance, cashBalance, closeRemittanceCash, createRemittance, openRemittanceCash,
  payRemittance, quoteRemittance, setCommissionPolicy, withdrawRemittanceCash } from "../src/remittances.js";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";

const admin: User = {id:"demo-admin",name:"Encargado",role:"admin"};
const operator: User = {id:"cash-activity-operator",name:"Operadora de prueba",role:"cashier"};
const actors = [admin,operator];
function fixture() {
  const state = seed(); let tick = 0;
  const next = () => new Date(Date.parse("2026-11-06T14:00:00.000Z") + tick++ * 1000);
  setCommissionPolicy(state,admin,{transactionCommissionBps:1000,creditCardCommissionBps:0},next());
  const box = openRemittanceCash(state,admin,{operatorId:operator.id,currency:"DOP",openingAmount:100000},actors,next());
  addRemittanceCash(state,admin,box.id,{amount:20000,note:"Primera entrega"},next());
  addRemittanceCash(state,operator,box.id,{amount:30000,note:"Segunda entrega"},next());
  withdrawRemittanceCash(state,operator,box.id,{amount:10000,note:"Primer retiro al encargado"},next());
  withdrawRemittanceCash(state,admin,box.id,{amount:5000,note:"Segundo retiro al encargado"},next());
  const send = (amount: number, bank = false) => {
    const now = next(), pair = {sourceCurrency:"DOP" as const,destinationCurrency:"DOP" as const,amount};
    return createRemittance(state,operator,{...pair,senderClientId:"cli-1",recipientClientId:"cli-5",quote:quoteRemittance(state,pair,now).quote,
      ...(bank ? {payment:{method:"card" as const,cardType:"debit" as const,cardholderName:"Persona de Prueba",last4:"4242",reference:"QA-EXTERNAL",verified:true}} : {})},actors,now);
  };
  const refunded = send(10000), paid = send(15000), external = send(8000,true);
  cancelRemittance(state,operator,refunded.id,"Devolución al remitente",next());
  payRemittance(state,operator,paid.id,next());
  return {state,box,refunded,paid,external,next};
}

test("cash detail lists each addition, withdrawal, send, refund and payout and reconciles exact cents without rewriting history", () => {
  const {state,box,refunded,paid,external} = fixture(), before = structuredClone(state);
  const detail = remittanceCashActivity(state,admin,box.id,actors);
  assert.equal(detail.entries.length,9);
  assert.deepEqual(detail.groups,{addition:{count:2,amount:50000},withdrawal:{count:2,amount:15000},sent:{count:3,amount:27500},refund:{count:1,amount:11000},paid:{count:1,amount:15000},discharge:{count:0,amount:0}});
  assert.equal(detail.totals.expected,136500); assert.deepEqual(detail.totals,cashBalance(state,state.remittances.cashSessions[0]));
  assert.equal(detail.entries.find(row=>row.kind==="refund")!.reference,refunded.envioReference);
  assert.equal(detail.entries.find(row=>row.kind==="paid")!.receiptReference,paid.reciboReference);
  assert.equal(detail.entries.find(row=>row.reference===external.envioReference)!.amount,0);
  assert.equal(detail.entries.find(row=>row.reference===external.envioReference)!.operationAmount,8800);
  assert.equal(detail.entries.find(row=>row.reference===external.envioReference)!.payment,"Tarjeta de débito");
  assert.equal(detail.entries.filter(row=>row.kind==="addition")[0].recordedBy,admin.name);
  assert.equal(detail.entries.filter(row=>row.kind==="addition")[1].recordedBy,operator.name);
  assert.deepEqual(detail.entries.map(row=>row.createdAt),detail.entries.map(row=>row.createdAt).toSorted());
  assert.doesNotMatch(JSON.stringify(detail),/cardholderName|last4|cardArchives|commissionAllocation|exchangeGain|senderContact|recipientContact/);
  assert.deepEqual(state,before);
});

test("historical closed cash keeps its original count and separates the final discharge from daytime withdrawals", () => {
  const {state,box,next} = fixture();
  closeRemittanceCash(state,operator,box.id,136500,next(),36500);
  const detail = remittanceCashActivity(state,operator,box.id,actors);
  assert.equal(detail.cash.status,"closed"); assert.equal(detail.cash.countedAmount,136500);
  assert.equal(detail.totals.expected,136500); assert.equal(detail.totals.carry,100000);
  assert.deepEqual(detail.groups.discharge,{count:1,amount:36500}); assert.equal(detail.groups.withdrawal.amount,15000);
  assert.equal(detail.entries.length,10,"opening and closing observations are not counted twice as cash entries");
});

test("cash detail enforces permission, operator and currency scope even without permission to view transfers", () => {
  const {state,box,next} = fixture();
  const other = openRemittanceCash(state,admin,{operatorId:admin.id,currency:"EUR",openingAmount:25000},actors,next());
  const readOnly:User = {...operator,access:effectiveAccess("cashier",{permissionMode:"custom",permissionIds:[1],remittancePermissions:["remittances.cash.view"]})};
  assert.equal(remittanceCashActivity(state,readOnly,box.id,actors).entries.length,9);
  for(const id of [other.id,"missing"]) assert.throws(()=>remittanceCashActivity(state,readOnly,id,actors),(error:unknown)=>(error as {code:string}).code==="CASH_NOT_FOUND");
  const noPermission:User = {...operator,access:effectiveAccess("cashier",{permissionMode:"custom",permissionIds:[1],remittancePermissions:[]})};
  assert.throws(()=>remittanceCashActivity(state,noPermission,box.id,actors),(error:unknown)=>(error as {code:string}).code==="FORBIDDEN");
  const euro = remittanceCashActivity(state,admin,other.id,actors);
  assert.equal(euro.cash.currency,"EUR"); assert.equal(euro.entries.length,0); assert.equal(euro.totals.expected,25000);
  assert.equal(remittanceCashActivity(state,{...admin,role:"supervisor"},box.id,actors).entries.length,9);
});

test("cash activity HTTP endpoint is authenticated, scoped, read-only and does not disclose another operator's box", async t => {
  const store = new MemoryStore(seed()), app = await buildApp({store,demo:true,secret:"synthetic-cash-detail-secret-at-least-32",origins:[]}); t.after(()=>app.close());
  const login = await app.inject({method:"POST",url:"/api/auth/login",payload:{email:"admin",password:DEMO_PASSWORD}});
  assert.equal(login.statusCode,200); const authorization = `Bearer ${login.json().token}`;
  const post = (url:string,payload:unknown) => app.inject({method:"POST",url,payload:payload as never,headers:{authorization,"idempotency-key":randomUUID()}});
  const email = `cash-detail-${randomUUID()}@example.invalid`;
  const created = await post("/api/usuarios",{role:"cashier",name:"Cajero de detalle",email,password:"Prueba-Detalle-2026!"}); assert.equal(created.statusCode,200,created.body);
  const today = new Date(), date = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Santo_Domingo",year:"numeric",month:"2-digit",day:"2-digit"}).format(today);
  const own = await post("/api/envios/cajas/abrir",{operatorId:created.json().id,currency:"DOP",openingAmount:10000}); assert.equal(own.statusCode,200,own.body);
  const other = await post("/api/envios/cajas/abrir",{operatorId:"demo-admin",currency:"EUR",openingAmount:5000}); assert.equal(other.statusCode,200,other.body);
  const cashierLogin = await app.inject({method:"POST",url:"/api/auth/login",payload:{email,password:"Prueba-Detalle-2026!"}}); assert.equal(cashierLogin.statusCode,200);
  const headers = {authorization:`Bearer ${cashierLogin.json().token}`}, before = (await store.read()).remittances;
  assert.equal((await app.inject({url:`/api/envios/cajas/${own.json().id}/movimientos`})).statusCode,401);
  const detail = await app.inject({url:`/api/envios/cajas/${own.json().id}/movimientos`,headers});
  assert.equal(detail.statusCode,200,detail.body); assert.equal(detail.json().cash.operatorName,"Cajero de detalle"); assert.equal(detail.json().cash.date,date);
  const forbidden = await app.inject({url:`/api/envios/cajas/${other.json().id}/movimientos`,headers}); assert.equal(forbidden.statusCode,404); assert(!forbidden.body.includes(other.json().id));
  assert.deepEqual((await store.read()).remittances,before);
});
