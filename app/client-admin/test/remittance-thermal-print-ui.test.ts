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
  fs.writeFileSync(fixture,`import {printRemittanceReceipt,remittanceReceipt} from ${JSON.stringify(path.resolve(root,"../shared/remittances/receipt.ts").replaceAll("\\","/"))};
const receipt={reference:'REC-QA-ACENTOS',date:'05/11/2026, 11:13 a. m.',status:'pending',issuer:{name:'Empresa Álvarez y Núñez',address:'Calle del Niño, Santo Domingo',phone:'8095550100'},footer:'Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.',sections:[{title:'Registro del recibo',columns:['Dato','Valor'],rows:[['Envío','ENV-QA-0001'],['Código de operación','OP-SYNTHETIC-01'],['Estado','Pendiente de entrega']]},{title:'Remitente',columns:['Dato','Valor'],rows:[['Nombre','José Núñez'],['Identificación','QA-001'],['Dirección','Calle de la Constitución, número doce, próximo al Parque de los Héroes']]},{title:'Destinatario',columns:['Dato','Valor'],rows:[['Nombre','María Rodríguez']]},{title:'Importes del envío',columns:['Dato','Valor'],rows:[['Monto a enviar','DOP 2,000.00'],['Cargo del envío','DOP 200.00'],['Total pagado por el remitente','DOP 2,200.00'],['Recibe el destinatario','DOP 2,000.00']]},{title:'Pago del remitente',columns:['Dato','Valor'],rows:[['Forma de pago','Efectivo'],['Dinero recibido','DOP 2,200.00'],['Devuelta','DOP 0.00']]},{title:'Nota',columns:['Dato','Valor'],rows:[['Nota de la operación','${"REFERENCIA".repeat(80)}']]}]};
const pos80Invoice=remittanceReceipt({id:'qa-pos80',sequence:45,envioReference:'ENV00000045',reciboReference:'REC00000045',operatingCode:'6201F3A5752FDBC3',senderClientId:'s1',recipientClientId:'r1',sendingUserId:'demo-admin',registeredBy:'demo-admin',status:'pending',canPay:true,canCancel:true,createdAt:'2026-11-10T19:53:00.000Z',note:'',sourceCurrency:'DOP',destinationCurrency:'DOP',amount:10000,commissionBps:1000,commissionAmount:1000,totalAmount:11000,receiveAmount:10000,quote:{date:'2026-11-10',sourceRate:'1.000000',destinationRate:'1.000000',sourceRateKind:'base',destinationRateKind:'base'},senderContact:{id:'s1',code:'1111111111',name:'mayo lomb',identification:'03103103103',phone:'111-111-1111',cellular:'',address:'santiago'},recipientContact:{id:'r1',code:'CL-0002',name:'María Rodríguez',identification:'',phone:'8095550100',cellular:'',address:'Calle Las Damas 18'},receiptIssuer:{name:'Cobros y Pagos',address:'',phone:'',email:'admin@cyp.local',footerNote:'Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.'},payment:{version:3,method:'card',cardType:'credit',tenderedAmount:13000,changeAmount:0,cardSurchargeAmount:2000,reference:'wewe',last4:'2232',bank:'Banreservas',confirmedBy:'demo-admin',confirmedAt:'2026-11-10T19:53:00.000Z'}},undefined,'Administración','Administración',true);
for(const [id,compact,mode] of [['pos80-full-text',false,'text'],['pos80-compact-text',true,'text'],['pos80-full-graphics',false,'graphics']] as const){const b=document.createElement('button');b.textContent=id;b.onclick=()=>printRemittanceReceipt(pos80Invoice,{paper:'80',compact,output:mode});document.body.append(b);}
for(const paper of ['51','76','80','58','102','auto']){for(const output of ['graphics','text']){const button=document.createElement('button');button.textContent=output==='text'?'text-'+paper:paper;button.onclick=()=>printRemittanceReceipt(receipt,{paper,compact:false,output});document.body.append(button);}}
for(const [name,paper,orientation,customWidthMm,customHeightMm] of [['sheet-8x4','8x4','landscape'],['sheet-8x11','8x11','landscape'],['sheet-a4','a4','portrait'],['sheet-letter','letter','portrait'],['sheet-custom','custom','landscape',180,90]]){for(const output of ['graphics','text']){const button=document.createElement('button');button.textContent=output==='text'?'text-'+name:name;button.onclick=()=>printRemittanceReceipt(receipt,{paper,orientation,customWidthMm,customHeightMm,compact:false,output});document.body.append(button);}}`);
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
    for(const paper of ["51","76","80","58","102"]){
      const opening=page.waitForEvent("popup");await page.getByRole("button",{name:paper,exact:true}).click();const popup=await opening;
      popup.on("pageerror",(error:Error)=>errors.push(error.message));await popup.waitForFunction(()=>(window as any).__prints===1);
      assert.equal(await popup.evaluate(()=>(window as any).__readyAtPrint),true);
      const images=popup.locator("main.thermal-image-output img");assert(await images.count()>20);
      const result=await popup.evaluate(()=>({runs:(window as any).__runs,images:Array.from(document.querySelectorAll<HTMLImageElement>("main img")).map(image=>({src:image.src.slice(0,22),width:image.naturalWidth,heightMm:image.getBoundingClientRect().height*25.4/96,left:image.getBoundingClientRect().left})),bodyLeft:document.body.getBoundingClientRect().left}));
      assert.equal(result.bodyLeft,0);
      for(const image of result.images){assert.equal(image.src,"data:image/png;base64,");assert.equal(image.width,(paper==="80"?72:paper==="58"?48:paper==="51"?45:paper==="102"?96:70)*8);assert.equal(image.left,0);assert(image.heightMm>0&&image.heightMm<60);}
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
    for(const paper of ["51","80","76","58","102","auto"]){
      const opening=page.waitForEvent("popup");await page.getByRole("button",{name:`text-${paper}`,exact:true}).click();const plain=await opening;
      await plain.waitForFunction(()=>(window as any).__prints===1);
      assert.equal(await plain.locator("img,canvas,svg,dl").count(),0,"generic mode does not need graphics support");
      const content=await plain.locator("pre").textContent(),columns=paper==="80"?40:paper==="76"?38:paper==="58"?26:paper==="51"?24:paper==="102"?54:72;
      assert.match(content,/Nombre: {2,}José Núñez/);assert(content.includes("Código de operación:"));assert(content.includes("María Rodríguez"));
      for(const line of content.split("\n"))assert(Array.from(line).length<=columns);
      assert.equal(await plain.evaluate(()=>document.body.scrollWidth<=document.body.clientWidth+1),true);
      assert.equal(await plain.evaluate(()=>(window as any).__runs.length),0,"no canvas is used by the generic driver path");
      await plain.screenshot({path:path.join(output,`receipt-text-${paper}.png`),fullPage:true});await plain.close();
    }
    // The browser's PDF output proves the requested sheet size and orientation, not a physical printer result.
    for(const [name,widthMm,heightMm] of [["8x4",203.2,101.6],["8x11",279.4,203.2],["a4",210,297],["letter",215.9,279.4],["custom",180,90]] as const) {
      for(const textOnly of [false,true]) {
        const label=`${textOnly?"text-":""}sheet-${name}`, opened=page.waitForEvent("popup");
        await page.getByRole("button",{name:label,exact:true}).click(); const sheet=await opened;
        await sheet.waitForFunction(()=>(window as any).__prints===1);
        await sheet.emulateMedia({media:"print"});
        assert.equal(await sheet.locator("main.thermal-image-output img").count(),0);
        assert.match(await sheet.locator("body").innerText(),/José Núñez/);
        assert.match(await sheet.locator("body").innerText(),/DOP 2,200\.00/);
        assert.equal(await sheet.evaluate(()=>document.body.scrollWidth<=document.body.clientWidth+1),true);
        if(!textOnly) assert(parseFloat(await sheet.locator("body").evaluate((node:HTMLElement)=>getComputedStyle(node).fontSize))>=12,"sheet type is not shrunk to squeeze a receipt onto a page");
        const pdf=await sheet.pdf({path:path.join(output,`${label}.pdf`),preferCSSPageSize:true,printBackground:true});
        const boxes=[...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]/g)];
        assert(boxes.length>0,"PDF contains physical page dimensions");
        for(const box of boxes) { assert(Math.abs(Number(box[1])-widthMm*72/25.4)<1.5,`${label}: page width`); assert(Math.abs(Number(box[2])-heightMm*72/25.4)<1.5,`${label}: page height`); }
        await sheet.screenshot({path:path.join(output,`${label}.png`),fullPage:true}); await sheet.close();
      }
    }
    for(const [id,compact] of [["pos80-full-text",false],["pos80-compact-text",true]] as const){
      const openingPos80=page.waitForEvent("popup");await page.getByRole("button",{name:id,exact:true}).click();const posPopup=await openingPos80;
      await posPopup.waitForFunction(()=>(window as any).__prints===1);
      // Emulate exact 72.1 mm printable width reported by Windows driver 2connet POS80-01 V6 USB ("80(72.1) x 297 mm").
      await posPopup.setViewportSize({width:Math.floor(72.1*96/25.4),height:760});
      await posPopup.emulateMedia({media:"print"});
      const preMetrics=await posPopup.locator("pre").evaluate((pre:HTMLElement)=>{
        const text=pre.textContent??"",lines=text.replace(/\n$/,"").split("\n"),lineHeight=parseFloat(getComputedStyle(pre).lineHeight);
        return {text,lineCount:lines.length,renderedLines:Math.round(pre.getBoundingClientRect().height/lineHeight),scrollWidth:document.body.scrollWidth,clientWidth:document.body.clientWidth};
      });
      assert.equal(preMetrics.renderedLines,preMetrics.lineCount,`${id}: zero soft-wrapped lines on 72.1mm POS80 print preview`);
      assert.ok(preMetrics.scrollWidth<=preMetrics.clientWidth+1,`${id}: fits inside 72.1mm POS80 width`);
      for(const expected of ["Fecha:","ENV00000045","mayo lomb","María Rodríguez","8095550100","DOP 20.00","DOP 130.00","Registrado por:","Administración"])assert(preMetrics.text.includes(expected),`${id} missing ${expected}`);
      for(const forbidden of ["REC00000045","Cobros y Pagos","admin@cyp.local","Pendiente de entrega","Operador del envío","03103103103","111-111-1111","santiago","CL-0002"])assert(!preMetrics.text.includes(forbidden),`${id} unexpected ${forbidden}`);
      if(compact){assert(!preMetrics.text.includes("Código de operación:"));assert(!preMetrics.text.includes("Calle Las Damas 18"));assert(!preMetrics.text.includes("1111111111"));}
      else{assert(preMetrics.text.includes("6201F3A5752FDBC3"));assert(preMetrics.text.includes("Calle Las Damas 18"));assert(preMetrics.text.includes("1111111111"));}
      await posPopup.pdf({path:path.join(output,`${id}-72.1mm.pdf`),width:"72.1mm",height:"297mm",preferCSSPageSize:false,printBackground:true});
      await posPopup.screenshot({path:path.join(output,`${id}-72.1mm.png`),fullPage:true});await posPopup.close();
    }
    // Failed raster preparation must not silently print a different format.
    await context.addInitScript(()=>{HTMLCanvasElement.prototype.toDataURL=()=>{throw new Error("Synthetic raster failure");};});
    const failing=page.waitForEvent("popup");await page.getByRole("button",{name:"80",exact:true}).click();const failed=await failing;
    await failed.getByRole("alert").waitFor();assert.equal(await failed.evaluate(()=>(window as any).__prints),0);await failed.close();
    const compatible=page.waitForEvent("popup");await page.getByRole("button",{name:"text-80",exact:true}).click();const noCanvas=await compatible;await noCanvas.waitForFunction(()=>(window as any).__prints===1);assert.equal(await noCanvas.locator("img,canvas").count(),0);await noCanvas.close();
    assert.deepEqual(errors,[]);assert.deepEqual(external.filter(url=>!/(^|\.)kaspersky-labs\.com$/i.test(new URL(url).hostname)),[]);await context.close();
    t.diagnostic(`Synthetic receipt screenshots: ${output}; no physical printer used.`);
  } finally {await browser?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));}
});
