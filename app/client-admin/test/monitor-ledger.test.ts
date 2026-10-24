import assert from "node:assert/strict";
import test from "node:test";
import { monitorLedger } from "../src/monitorLedger";
import type { Snapshot } from "../src/types";

function data(): Snapshot {
  return {collectors:[{id:"c",name:"Cobrador",collectionLimit:1000,payoutLimit:2000}],zones:[{id:"z1",name:"Zona 1"},{id:"z2",name:"Zona 2"}],
    routes:[{id:"r1",name:"Ruta 1",sector:"Zona 1",zoneId:"z1",collectorId:"c"},{id:"r2",name:"Ruta 2",sector:"Zona 2",zoneId:"z2",collectorId:"c"}],clients:[{id:"a",routeId:"r1"},{id:"b",routeId:"r2"}],
    movements:[{id:"m1",collectorId:"c",clientId:"a",type:"collection",amount:10000,currency:"DOP"},{id:"m2",collectorId:"c",clientId:"b",type:"payout",amount:1000,currency:"DOP"},{id:"m3",collectorId:"c",type:"deposit",amount:5000,currency:"DOP"},{id:"m4",collectorId:"c",type:"office_delivery",amount:2000,currency:"DOP"}],cashReconciliations:[] } as unknown as Snapshot;
}
for (const page of ["monitorRoutes","monitorZones","monitorCollectors"]) test(`${page}: one movement, one row and one total`,()=>{
  const rows=monitorLedger(page,data());
  assert.equal(rows.reduce((sum,row)=>sum+row.metrics.collected,0),10000);
  assert.equal(rows.reduce((sum,row)=>sum+row.metrics.deposited,0),5000);
  assert.equal(rows.reduce((sum,row)=>sum+row.metrics.difference,0),6000);
  assert.equal(rows.reduce((sum,row)=>sum+row.metrics.collectionLimit,0),1000);
  if(page!=="monitorCollectors") assert.equal(rows.find((row)=>row.entityId==="c")?.cashOnly,true);
});
test("currency selection isolates movements and uses per-currency limits",()=>{
  const snapshot=data();snapshot.collectors[0].currencyLimits={USD:{collectionLimit:222,payoutLimit:333}};
  snapshot.movements.push({...snapshot.movements[0],id:"usd",currency:"USD",amount:12345});
  const rows=monitorLedger("monitorZones",snapshot,"USD");assert.equal(rows.reduce((sum,row)=>sum+row.metrics.collected,0),12345);
  assert.equal(rows.reduce((sum,row)=>sum+row.metrics.collectionLimit,0),222);
});
