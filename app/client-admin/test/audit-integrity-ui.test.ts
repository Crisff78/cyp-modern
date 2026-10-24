import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildApp } from "../../server/src/app.js";
import { MemoryStore } from "../../server/src/store.js";
import { seed } from "../../server/src/seed.js";
import { businessDate } from "../../server/src/domain.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const require=createRequire(path.join(root,"package.json"));
const edge=path.join(process.env["ProgramFiles(x86)"]??"C:/Program Files (x86)","Microsoft/Edge/Application/msedge.exe");
const cache=path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),"AppData/Local"),"npm-cache/_npx");
let playwrightEntry:string|undefined;
try{playwrightEntry=require.resolve("playwright");}catch{playwrightEntry=fs.existsSync(cache)?fs.readdirSync(cache).map((entry)=>path.join(cache,entry,"node_modules/playwright/index.mjs")).find((entry)=>fs.existsSync(entry)):undefined;}

test("active collector assignments save/cancel/reopen, recurring generation repeats safely, and route monitor totals stay unique",{skip:process.platform!=="win32"||!fs.existsSync(edge)||!playwrightEntry},async(t)=>{
  const output=fs.mkdtempSync(path.join(os.tmpdir(),"cyp-audit-integrity-ui-"));
  const initial=seed();initial.movements=[];initial.settlements=[];initial.cashReconciliations=[];
  for(const route of initial.routes){const zone=initial.zones.find((row)=>row.sector===route.sector)??{id:`zone-${route.id}`,name:route.sector,sector:route.sector};if(!initial.zones.includes(zone))initial.zones.push(zone);route.zoneId=zone.id;}
  initial.services.push({id:"service-ui",service:"Mensualidad sintética",abbr:"M",caption:"",obligated:false,fixedAmount:false,active:true});
  initial.recurringCharges=[{id:"template-ui",clientId:initial.clients[0].id,serviceId:"service-ui",service:"Mensualidad sintética",registeredAt:new Date().toISOString(),startDate:businessDate(),generationFrom:businessDate(),frequency:"Diaria",day1:"",day2:"",endDate:businessDate(),currency:"DOP",concept:"Cuota de prueba",useConceptAmount:false,amount:10000,note:"",active:true}];
  const store=new MemoryStore(initial),app=await buildApp({store,demo:true,secret:"synthetic-audit-browser-at-least-32-characters",origins:[],collectorUrl:"/collector/"});
  let browser:any,server:ReturnType<typeof createServer>|undefined;
  const errors:string[]=[];
  try{
    const token=(await app.inject({method:"POST",url:"/api/auth/login",payload:{email:"admin",password:"Demo-CyP-2026!"}})).json().token;
    const source=(name:string)=>JSON.stringify(path.join(root,"src",name).replaceAll("\\","/"));
    const fixture=path.join(output,"fixture.tsx");
    fs.writeFileSync(fixture,`import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {ConnectedCatalog} from ${source("ConnectedCatalog.tsx")};import FinancialMonitorView from ${source("FinancialMonitorView.tsx")};import {PageAccessContext} from ${source("PageAccess.tsx")};import {setToken,api} from ${source("api.ts")};import ${source("styles.css")};
setToken(${JSON.stringify(token)});const first=await api('/snapshot');
function Fixture(){const [snapshot,setSnapshot]=useState(first),[page,setPage]=useState('collectors');const refresh=async()=>setSnapshot(await api('/snapshot'));return <><nav>{['collectors','recurringCharges','monitorRoutes'].map((name)=><button key={name} onClick={()=>{setPage(name);void refresh();}}>{name}</button>)}</nav><PageAccessContext.Provider value={{actor:{role:'admin'},page}}>{page==='monitorRoutes'?<FinancialMonitorView page={page} snapshot={snapshot} refreshing={false} onRefresh={refresh}/>:<ConnectedCatalog key={page} page={page} snapshot={snapshot} actorId="demo-admin" onRefresh={refresh}/>}</PageAccessContext.Provider></>};createRoot(document.getElementById('root')).render(<Fixture/>);`,"utf8");
    const [{build},{default:react},{default:tailwind},{chromium}]=await Promise.all([import(pathToFileURL(require.resolve("vite")).href),import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href),import(pathToFileURL(require.resolve("@tailwindcss/vite")).href),import(pathToFileURL(playwrightEntry!).href)]);
    await build({root,configFile:false,envFile:false,publicDir:false,cacheDir:path.join(output,"cache"),resolve:{dedupe:["react","react-dom"]},plugins:[react(),tailwind()],define:{"process.env.NODE_ENV":JSON.stringify("production")},logLevel:"error",build:{target:"esnext",outDir:path.join(output,"dist"),emptyOutDir:false,cssCodeSplit:false,lib:{entry:fixture,formats:["es"],fileName:()=>"fixture.js",cssFileName:"fixture"}}});
    server=createServer(async(req,res)=>{try{const pathname=new URL(req.url??"/","http://127.0.0.1").pathname;if(pathname.startsWith("/api/")){const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const result=await app.inject({method:req.method as "GET"|"POST",url:req.url!,headers:req.headers,...(chunks.length?{payload:JSON.parse(Buffer.concat(chunks).toString("utf8"))}:{})});res.writeHead(result.statusCode,{"content-type":"application/json"});res.end(result.body);return;}
      if(pathname==="/fixture.js"||pathname==="/fixture.css"){res.writeHead(200,{"content-type":pathname.endsWith("css")?"text/css":"text/javascript"});res.end(fs.readFileSync(path.join(output,"dist",pathname.slice(1))));return;}res.writeHead(200,{"content-type":"text/html"});res.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');}catch(error){res.writeHead(500);res.end(String(error));}});
    await new Promise<void>((resolve)=>server!.listen(0,"127.0.0.1",resolve));const address=server.address();assert.ok(address&&typeof address!=="string");
    browser=await chromium.launch({executablePath:edge,headless:true});const context=await browser.newContext({viewport:{width:1280,height:900}});await context.route("**/*",(route:any)=>{const destination=new URL(route.request().url());return destination.hostname==="127.0.0.1"?route.continue():route.abort();});
    const page=await context.newPage();page.on("pageerror",(error:Error)=>errors.push(error.message));await page.goto(`http://127.0.0.1:${address.port}/`);
    const owner=initial.collectors[0], foreign=initial.routes.find((row)=>row.collectorId!==owner.id)!;
    await page.locator(".catalog-legacy tbody tr").filter({hasText:owner.name}).click();await page.getByRole("button",{name:"Rutas del Cobrador",exact:true}).click();
    let dialog=page.getByRole("dialog",{name:"Rutas del Cobrador...",exact:true});await dialog.getByRole("button",{name:"Agregar",exact:true}).waitFor({state:"visible"});
    await dialog.getByRole("button",{name:"Agregar",exact:true}).click();let picker=page.getByRole("dialog",{name:"Seleccionar...",exact:true});await picker.getByRole("row").filter({hasText:foreign.name}).click();await picker.getByRole("button",{name:"Aceptar",exact:true}).click();
    await dialog.getByRole("button",{name:"Aceptar",exact:true}).click();let confirmation=page.getByRole("dialog",{name:"Confirmar asignaciones",exact:true});await confirmation.getByRole("button",{name:"No",exact:true}).click();assert.notEqual((await store.read()).routes.find((row)=>row.id===foreign.id)?.collectorId,owner.id);
    await dialog.getByRole("button",{name:"Aceptar",exact:true}).click();await page.getByRole("dialog",{name:"Confirmar asignaciones",exact:true}).getByRole("button",{name:"Sí, guardar",exact:true}).click();await dialog.waitFor({state:"hidden"});assert.equal((await store.read()).routes.find((row)=>row.id===foreign.id)?.collectorId,owner.id);
    await page.getByRole("button",{name:"Rutas del Cobrador",exact:true}).click();dialog=page.getByRole("dialog",{name:"Rutas del Cobrador...",exact:true});await dialog.getByRole("row").filter({hasText:foreign.name}).waitFor();await dialog.getByRole("row").filter({hasText:foreign.name}).click();await dialog.getByRole("button",{name:"Eliminar",exact:true}).click();await page.getByRole("dialog",{name:"Confirm",exact:true}).getByRole("button",{name:"Sí",exact:true}).click();await dialog.getByRole("button",{name:"Cancelar",exact:true}).click();await page.getByRole("dialog",{name:"Descartar cambios",exact:true}).getByRole("button",{name:"Sí, descartar",exact:true}).click();assert.equal((await store.read()).routes.find((row)=>row.id===foreign.id)?.collectorId,owner.id);
    await page.getByRole("button",{name:"Límites del Cobrador",exact:true}).click();dialog=page.getByRole("dialog",{name:"Límites del Cobrador...",exact:true});await dialog.getByRole("button",{name:"Agregar",exact:true}).click();picker=page.getByRole("dialog",{name:"Seleccionar...",exact:true});await picker.getByLabel("Moneda:").selectOption("USD");await picker.getByLabel("Lím. de Cobro:").fill("234.56");await picker.getByLabel("Lím. de Pago:").fill("345.67");await picker.getByRole("button",{name:"Aceptar",exact:true}).click();await dialog.getByRole("button",{name:"Aceptar",exact:true}).click();await page.getByRole("dialog",{name:"Confirmar asignaciones",exact:true}).getByRole("button",{name:"Sí, guardar",exact:true}).click();await dialog.waitFor({state:"hidden"});assert.equal((await store.read()).collectors[0].currencyLimits?.USD?.collectionLimit,23456);
    await page.getByRole("button",{name:"recurringCharges",exact:true}).click();await page.getByRole("button",{name:"Generar vencimientos",exact:true}).click();await page.getByText(/1 cargo\(s\) generado/).waitFor();assert.equal((await store.read()).charges.filter((row)=>row.recurringTemplateId==="template-ui").length,1);
    await page.getByRole("button",{name:"Generar vencimientos",exact:true}).click();await page.getByText(/0 cargo\(s\) generado/).waitFor();
    await store.transaction((state)=>state.movements.push({id:"monitor-synthetic",collectorId:owner.id,clientId:initial.clients[0].id,type:"collection",amount:10000,currency:"DOP",createdAt:new Date().toISOString(),actorId:"demo-admin",receiptToken:"synthetic"}));
    await page.getByRole("button",{name:"monitorRoutes",exact:true}).click();await page.locator(".collector-monitor-table").waitFor();await page.waitForFunction(()=>document.querySelectorAll('.collector-monitor-table tbody tr').length>0);
    const collected=page.locator(".collector-monitor-total").nth(2);assert.match(await collected.textContent(),/100\.00/);await page.getByLabel("Moneda:",{exact:true}).selectOption("Dólar Americano");assert.match(await collected.textContent(),/0\.00/);assert.doesNotMatch(await collected.textContent(),/RD\$/);
    await page.screenshot({path:path.join(output,"monitor-currency-and-total.png"),fullPage:true});assert.deepEqual(errors,[]);console.log(`UI evidence: ${output}`);
  }finally{await browser?.close();if(server)await new Promise<void>((resolve)=>server!.close(()=>resolve()));await app.close();}
});
