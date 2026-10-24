import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { seed } from "../src/seed.js";
import { businessDate, type RecurringCharge } from "../src/domain.js";
import { collectorAssignments, saveCollectorAssignments } from "../src/collector-assignments.js";
import { generateScheduledCharges, nextChargeDate } from "../src/recurring-charges.js";
import { effectiveAccess } from "../../shared/access.mjs";
import { consolidatedCommissionReport } from "../src/remittance-commission-report.js";
import { remittanceReports, visibleRemittanceResult } from "../src/remittances.js";
import { createAuthSession } from "../src/admin-tools.js";
import { registerStationInstallationRoutes } from "../src/station-installation-routes.js";
import Fastify from "fastify";
import type { RraaValidation } from "../src/rraa.js";

const actor = { id: "test-office", name: "Prueba", role: "admin" as const };
const scheduled = (extra: Partial<RecurringCharge> = {}): RecurringCharge => ({ id: "synthetic-template", clientId: "cli-1", service: "Servicio", registeredAt: "2026-01-01T00:00:00Z", startDate: "2026-01-31", endDate: "", frequency: "Mensual", day1: "31", day2: "", currency: "DOP", concept: "Mensualidad", useConceptAmount: false, amount: 10000, note: "", active: true, generationFrom: "2026-01-01", ...extra });

test("calendar clamps month-end and leap days, preserves anchors and optional twice-monthly days", () => {
  assert.equal(nextChargeDate(scheduled(), "2026-02-01"), "2026-02-28");
  assert.equal(nextChargeDate(scheduled(), "2026-03-01"), "2026-03-31");
  assert.equal(nextChargeDate(scheduled({ startDate:"2024-02-29", frequency:"Anual",day1:"",generationFrom:"2024-01-01" }), "2025-01-01"), "2025-02-28");
  assert.equal(nextChargeDate(scheduled({ startDate:"2026-01-01",frequency:"Quincenal",day1:"15",day2:"31" }), "2026-02-16"), "2026-02-28");
  assert.equal(nextChargeDate(scheduled({ startDate:"2026-01-01",frequency:"Quincenal",day1:"",day2:"" }), "2026-01-17"), "2026-01-31");
  assert.equal(nextChargeDate(scheduled({ startDate:"2026-01-01",frequency:"Quincenal",day1:"15",day2:"" }), "2026-01-17"), "2026-01-31");
  assert.equal(nextChargeDate(scheduled({ frequency:"No Definida" }), "2026-02-01"), undefined);
  assert.equal(nextChargeDate(scheduled({ endDate:"2026-02-15" }), "2026-02-01"), undefined);
});

test("scheduled charges are bounded, transactional and never duplicated or regenerated after cancellation", async () => {
  const state = seed(), client=state.clients[0], service={id:"synthetic-service",service:"Mensualidad",abbr:"M",caption:"",obligated:false,fixedAmount:false,active:true};
  state.services.push(service);
  state.recurringCharges=[scheduled({clientId:client.id,serviceId:service.id,service:service.service,startDate:"2026-01-01",frequency:"Diaria",generationFrom:"2026-02-01"})];
  const store=new MemoryStore(state);
  const [first,second]=await Promise.all([store.transaction((draft)=>generateScheduledCharges(draft,"2026-02-03",2)),store.transaction((draft)=>generateScheduledCharges(draft,"2026-02-03",2))]);
  assert.equal(first.generated.length+second.generated.length,3);
  await store.transaction((draft)=>{ const generated=draft.charges.filter((row)=>row.recurringTemplateId); assert.deepEqual(generated.map((row)=>row.dueDate),["2026-02-01","2026-02-02","2026-02-03"]); generated[0].status="cancelled"; });
  assert.deepEqual((await store.transaction((draft)=>generateScheduledCharges(draft,"2026-02-03"))).generated,[]);
  await store.close();
});

test("collector routes persist as canonical assignments, require reassignment confirmation and reject stale revisions", () => {
  const state=seed(), target=state.collectors[0], route=state.routes.find((row)=>row.collectorId!==target.id)!;
  const original=collectorAssignments(state,target.id,"rutas");
  assert.throws(()=>saveCollectorAssignments(state,actor,target.id,"rutas",{revision:original.revision,rows:[{id:route.id}]}),/Confirma/);
  const result=saveCollectorAssignments(state,actor,target.id,"rutas",{revision:original.revision,rows:[{id:route.id}],confirmReassignment:true});
  assert.equal(state.routes.find((row)=>row.id===route.id)?.collectorId,target.id);
  assert.equal(target.routeId,route.id);
  assert.throws(()=>saveCollectorAssignments(state,actor,target.id,"rutas",{revision:original.revision,rows:[]}),/cambiaron/);
  saveCollectorAssignments(state,actor,target.id,"rutas",{revision:result.revision,rows:[]});
  assert.equal(target.routeId,""); assert.equal(state.routes.find((row)=>row.id===route.id)?.collectorId,"");
});

test("collector currency limits save real amounts without FX conversion, removal means a zero limit", () => {
  const state=seed(), collector=state.collectors[0], before=collectorAssignments(state,collector.id,"limites");
  const after=saveCollectorAssignments(state,actor,collector.id,"limites",{revision:before.revision,rows:[{id:"USD",collectionLimit:23400,payoutLimit:45600}]});
  assert.equal(collector.currencyLimits?.USD?.collectionLimit,23400);assert.equal(collector.collectionLimit,0);
  assert.deepEqual(after.rows.map((row)=>row.id),["USD"]);
});

test("report access alone never reveals the company/manager split", () => {
  const state=seed();
  const limited={...actor,access:effectiveAccess("admin",{permissionMode:"custom",permissionIds:[1],remittancePermissions:["remittances.reports"]})};
  const input={from:"2026-01-01",to:"2026-12-31",grouping:"range" as const};
  assert.throws(()=>consolidatedCommissionReport(state,limited,{...input,groupBy:"managerCurrency",status:"all"}),/reparto de comisiones/);
  const reports=remittanceReports(state,limited,input);
  assert.deepEqual(reports.commissionAllocations,{details:[],totals:[]});
  assert.deepEqual(reports.managerCommissions,{details:[],totals:[]});
  const frozen={id:"saved",amount:12345,quote:{date:"2026-10-23",managerCommissionBps:500},commissionAllocation:{companyAmount:240,managerAmount:160}};
  const publicRetry=visibleRemittanceResult(limited,frozen);
  assert.equal(publicRetry.amount,12345);assert.equal(Object.hasOwn(publicRetry,"commissionAllocation"),false);
  assert.equal(Object.hasOwn(publicRetry.quote,"managerCommissionBps"),false);
  assert.equal(frozen.commissionAllocation.companyAmount,240,"redaction never mutates the saved financial evidence");
});

test("new passwords require 15 characters while existing demo credentials still sign in, and permission deltas are audited", async (t) => {
  const store=new MemoryStore(seed()), app=await buildApp({store,demo:true,secret:"synthetic-integrity-test-secret-more-than-32",origins:[],collectorUrl:"/collector/"}); t.after(()=>app.close());
  const login=await app.inject({method:"POST",url:"/api/auth/login",payload:{email:"admin",password:"Demo-CyP-2026!"}});
  assert.equal(login.statusCode,200,login.body);
  const token=login.json().token;
  const post=(url:string,payload:object)=>app.inject({method:"POST",url,payload,headers:{authorization:`Bearer ${token}`,"idempotency-key":randomUUID()}});
  const account={name:"Cuenta sintética",email:`${randomUUID()}@example.invalid`,role:"client",password:"12345678901234"};
  assert.equal((await post("/api/usuarios",account)).statusCode,400);
  account.password="Frase segura con ñ, ' y símbolos!";
  const created=await post("/api/usuarios",account);assert.equal(created.statusCode,200,created.body);
  const granted=await post(`/api/usuarios/${created.json().id}/permisos`,{mode:"custom",revision:0,permissionIds:[1],remittancePermissions:[]});assert.equal(granted.statusCode,200,granted.body);
  const trace=(await store.read()).adminTools.traces.find((row)=>row.action==="permissions.changed" && row.resourceId===created.json().id);
  assert.ok(trace);assert.equal(trace.details?.revision,1);assert.equal(trace.details?.previousRevision,0);
  assert.equal(JSON.stringify(trace).includes(account.password),false);
  assert.equal(typeof businessDate(),"string");
});

test("a slow RRAA lookup does not retain the write lock or block another administrative mutation", async (t) => {
  let release!: (value: RraaValidation) => void, entered!: () => void;
  const waiting=new Promise<RraaValidation>((resolve)=>{release=resolve;}), started=new Promise<void>((resolve)=>{entered=resolve;});
  const store=new MemoryStore(seed()), app=await buildApp({store,demo:true,secret:"synthetic-rraa-concurrency-more-than-32",origins:[],collectorUrl:"/collector/",
    rraa:{clientId:"synthetic-company",validate:async ()=>{entered();return waiting;}}});t.after(()=>app.close());
  const token=(await app.inject({method:"POST",url:"/api/auth/login",payload:{email:"admin",password:"Demo-CyP-2026!"}})).json().token;
  const post=(url:string,payload:object)=>app.inject({method:"POST",url,payload,headers:{authorization:`Bearer ${token}`,"idempotency-key":randomUUID()}});
  const station=post("/api/estaciones",{name:"SYNTHETIC-STATION",deviceId:"SYNTHETIC-DEVICE"}).then((response)=>response);
  await started;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const other=await Promise.race([post("/api/grupos-pcp",{name:"Grupo concurrente"}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("RRAA blocked an unrelated write")),3000);})]);
    assert.equal(other.statusCode,200,other.body);
  } finally {
    clearTimeout(timer);release({clientId:"synthetic-company",stationCode:"SYNTHETIC-STATION",deviceId:"SYNTHETIC-DEVICE",license:"synthetic-license",validatedAt:new Date().toISOString()});
    assert.equal((await station).statusCode,200);
  }
});

test("installation routes reconstruct individual permissions inside their own transaction", async (t) => {
  const state=seed(), stale={...actor,role:"admin" as const}, session=createAuthSession(state,stale);
  state.accounts.push({id:stale.id,name:stale.name,email:"revoked@example.invalid",role:"admin",status:"active",salt:"synthetic",passwordHash:"synthetic",credentialVersion:0,
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),permissionMode:"custom",permissionIds:[1],remittancePermissions:[]});
  const store=new MemoryStore(state), app=Fastify();t.after(()=>app.close());
  app.setErrorHandler((error,_req,reply)=>reply.code((error as {status?:number}).status??500).send({error:{code:(error as {code?:string}).code}}));
  registerStationInstallationRoutes(app,store,()=>({...stale,sid:session.id}),()=>{}, {origins:["http://localhost:5173"]});
  const before=(await store.read()).adminTools.installationChallenges.length;
  const response=await app.inject({method:"POST",url:"/api/estaciones/station-a/instalaciones/desafios",headers:{origin:"http://localhost:5173"},payload:{purpose:"query",installationId:`CYP-INST-${"a".repeat(64)}`}});
  assert.equal(response.statusCode,403,response.body);assert.equal(response.json().error.code,"PERMISSION_REQUIRED");
  assert.equal((await store.read()).adminTools.installationChallenges.length,before);
});
