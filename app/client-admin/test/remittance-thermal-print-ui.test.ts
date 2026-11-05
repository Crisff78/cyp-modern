import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root,"package.json"));
const edge = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)","Microsoft/Edge/Application/msedge.exe");
const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(),"AppData/Local"),"npm-cache/_npx");
let playwrightEntry: string | undefined;
try { playwrightEntry = require.resolve("playwright"); }
catch { playwrightEntry = fs.existsSync(cache) ? fs.readdirSync(cache).map(entry=>path.join(cache,entry,"node_modules/playwright/index.mjs")).find(fs.existsSync) : undefined; }

test("thermal receipt prints decoded raster blocks with Spanish glyphs, clear gaps, bounded wrapping and left alignment; A4 stays selectable text", {skip:process.platform==="win32"&&fs.existsSync(edge)&&playwrightEntry?false:"Installed Windows Edge and Playwright required; no download attempted."}, async t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(),"cyp-thermal-glyphs-"));
  const fixture = path.join(output,"fixture.ts");
  fs.writeFileSync(fixture,`import {printRemittanceReceipt} from ${JSON.stringify(path.resolve(root,"../shared/remittances/receipt.ts").replaceAll("\\","/"))};
const receipt={reference:'REC-QA-ACENTOS',date:'05/11/2026, 11:13 a. m.',status:'pending',issuer:{name:'Empresa Álvarez y Núñez',address:'Calle del Niño, Santo Domingo',phone:'8095550100'},footer:'Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.',sections:[{title:'Registro del recibo',columns:['Dato','Valor'],rows:[['Envío','ENV-QA-0001'],['Código de operación','OP-SYNTHETIC-01'],['Estado','Pendiente de entrega']]},{title:'Remitente',columns:['Dato','Valor'],rows:[['Nombre','José Núñez'],['Identificación','QA-001'],['Dirección','Calle de la Constitución, número doce, próximo al Parque de los Héroes']]},{title:'Destinatario',columns:['Dato','Valor'],rows:[['Nombre','María Rodríguez']]},{title:'Importes del envío',columns:['Dato','Valor'],rows:[['Monto a enviar','DOP 2,000.00'],['Cargo del envío','DOP 200.00'],['Total pagado por el remitente','DOP 2,200.00'],['Recibe el destinatario','DOP 2,000.00']]},{title:'Pago del remitente',columns:['Dato','Valor'],rows:[['Forma de pago','Efectivo'],['Dinero recibido','DOP 2,200.00'],['Devuelta','DOP 0.00']]},{title:'Nota',columns:['Dato','Valor'],rows:[['Nota de la operación','${"REFERENCIA".repeat(80)}']]}]};
for(const paper of ['76','80','58','auto']){const button=document.createElement('button');button.textContent=paper;button.onclick=()=>printRemittanceReceipt(receipt,{paper,compact:false});document.body.append(button);}`);
  let browser:any, server:ReturnType<typeof createServer>|undefined;
  const errors:string[]=[], external:string[]=[];
  try {
    const [{build},{chromium}] = await Promise.all([import(pathToFileURL(require.resolve("vite")).href),import(pathToFileURL(playwrightEntry!).href)]);
    await build({root,configFile:false,envFile:false,publicDir:false,cacheDir:path.join(output,"cache"),logLevel:"error",build:{outDir:output,emptyOutDir:false,lib:{entry:fixture,formats:["es"],fileName:()=>"fixture.js"}}});
    server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/fixture.js"?"text/javascript":"text/html; charset=utf-8");res.end(req.url==="/fixture.js"?fs.readFileSync(path.join(output,"fixture.js")):'<!doctype html><html lang="es"><meta charset="utf-8"><script type="module" src="/fixture.js"></script></html>');});
    await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
    const address=server.address();assert(address&&typeof address!=="string");const origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({executablePath:edge,headless:true});
    const context=await browser.newContext({viewport:{width:780,height:900},locale:"es-DO",serviceWorkers:"block"});
    await context.route("**/*",async(route:any)=>{const url=route.request().url();if(url.startsWith(origin)||url.startsWith("data:"))return route.continue();external.push(url);return route.abort();});
    await context.addInitScript(()=>{
      const state=window as any;state.__prints=0;state.__runs=[];state.__readyAtPrint=false;
      window.print=()=>{state.__prints++;state.__readyAtPrint=Array.from(document.images).every(image=>image.complete&&image.naturalWidth>0);};
      const original=CanvasRenderingContext2D.prototype.fillText;let count=0;const ids=new WeakMap<HTMLCanvasElement,number>();
      CanvasRenderingContext2D.prototype.fillText=function(value:string,x:number,y:number,maxWidth?:number){
        if(!ids.has(this.canvas))ids.set(this.canvas,++count);
        const width=this.measureText(value).width,left=this.textAlign==="right"?x-width:this.textAlign==="center"?x-width/2:x;
        state.__runs.push({text:value,left,right:left+width,widthMm:this.canvas.width/8,block:ids.get(this.canvas)});
        if(maxWidth===undefined)return original.call(this,value,x,y);return original.call(this,value,x,y,maxWidth);
      };
    });
    const page=await context.newPage();page.on("pageerror",(error:Error)=>errors.push(error.message));await page.goto(origin);
    for(const paper of ["76","80","58"]){
      const opening=page.waitForEvent("popup");await page.getByRole("button",{name:paper,exact:true}).click();const popup=await opening;
      popup.on("pageerror",(error:Error)=>errors.push(error.message));await popup.waitForFunction(()=>(window as any).__prints===1);
      assert.equal(await popup.evaluate(()=>(window as any).__readyAtPrint),true);
      const images=popup.locator("main.thermal-image-output img");assert(await images.count()>20);
      const result=await popup.evaluate(()=>({runs:(window as any).__runs,images:Array.from(document.querySelectorAll<HTMLImageElement>("main img")).map(image=>({src:image.src.slice(0,22),width:image.naturalWidth,heightMm:parseFloat(image.style.height),left:image.getBoundingClientRect().left})),bodyLeft:document.body.getBoundingClientRect().left}));
      assert.equal(result.bodyLeft,0);
      for(const image of result.images){assert.equal(image.src,"data:image/png;base64,");assert.equal(image.width,(paper==="80"?72:paper==="58"?48:70)*8);assert.equal(image.left,0);assert(image.heightMm<60);}
      for(const run of result.runs){assert(run.left>=-0.05,JSON.stringify(run));assert(run.right<=run.widthMm+0.05,JSON.stringify(run));}
      const text=result.runs.map((run:any)=>run.text).join("\n");for(const expected of ["Envío:","Código de operación:","José Núñez","María Rodríguez","Identificación:","Dirección:","DOP 2,200.00"])assert(text.includes(expected),expected);
      const blocks=new Map<number,any[]>();for(const run of result.runs){const group=blocks.get(run.block)??[];group.push(run);blocks.set(run.block,group);}
      for(const group of blocks.values())if(group.length===2&&group[0].text.endsWith(":"))assert(group[1].left-group[0].right>=3.9,"label/value gap is preserved in the bitmap");
      assert.equal(await popup.locator("dl,dt,dd").count(),0,"the printer receives images rather than device-encoded labels");
      await popup.emulateMedia({media:"print"});assert.equal(await popup.locator(".thermal-print-help").isVisible(),false);
      await popup.screenshot({path:path.join(output,`receipt-${paper}mm.png`),fullPage:true});await popup.close();
    }
    const opening=page.waitForEvent("popup");await page.getByRole("button",{name:"auto",exact:true}).click();const normal=await opening;await normal.waitForFunction(()=>(window as any).__prints===1);
    assert(await normal.locator("dt").count()>0);assert.equal(await normal.locator("main.thermal-image-output").count(),0);assert.match(await normal.locator("body").innerText(),/Nombre:\s+José Núñez/);await normal.close();
    // Failed raster preparation must not silently print the broken text fallback.
    await context.addInitScript(()=>{HTMLCanvasElement.prototype.toDataURL=()=>{throw new Error("Synthetic raster failure");};});
    const failing=page.waitForEvent("popup");await page.getByRole("button",{name:"80",exact:true}).click();const failed=await failing;
    await failed.getByRole("alert").waitFor();assert.equal(await failed.evaluate(()=>(window as any).__prints),0);await failed.close();
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();
    t.diagnostic(`Synthetic receipt screenshots: ${output}; no physical printer used.`);
  } finally {await browser?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));}
});
