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
const syntheticLogo=(()=>{const c=document.createElement('canvas');c.width=220;c.height=72;const g=c.getContext('2d')!;g.fillStyle='#fff';g.fillRect(0,0,220,72);g.strokeStyle='#000';g.lineWidth=4;g.strokeRect(4,4,212,64);g.fillStyle='#000';g.font='bold 24px Arial';g.textAlign='center';g.fillText('DEMO LOGO',110,44);return c.toDataURL('image/png');})();
const pos80Invoice=remittanceReceipt({id:'qa-pos80',sequence:48,envioReference:'ENV00000048',reciboReference:'REC00000048',operatingCode:'AD0B35A22F305CA2',senderClientId:'s1',recipientClientId:'r1',sendingUserId:'demo-admin',registeredBy:'demo-admin',status:'pending',canPay:true,canCancel:true,createdAt:'2026-11-11T13:15:00.000Z',note:'',sourceCurrency:'DOP',destinationCurrency:'DOP',amount:50000,commissionBps:1000,commissionAmount:5000,totalAmount:55000,receiveAmount:50000,quote:{date:'2026-11-11',sourceRate:'1.000000',destinationRate:'1.000000',sourceRateKind:'base',destinationRateKind:'base'},senderContact:{id:'s1',code:'1111111111',name:'mayo lomb',identification:'03103103103',phone:'111-111-1111',cellular:'',address:'santiago'},recipientContact:{id:'r1',code:'CL-0002',name:'María Rodríguez',identification:'',phone:'8095550100',cellular:'',address:'Calle Las Damas 18'},receiptIssuer:{name:'Cobros y Pagos',address:'',phone:'',email:'admin@cyp.local',logoDataUrl:syntheticLogo,footerNote:'Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.'},payment:{version:2,method:'card',cardType:'credit',tenderedAmount:59400,changeAmount:0,cardSurchargeBps:800,cardSurchargeAmount:4400,reference:'658565',last4:'8888',bank:'Banreservas',confirmedBy:'demo-admin',confirmedAt:'2026-11-11T13:15:00.000Z'}},{name:'INVERSIONES DEMO S.R.L.',slogan:'Tu aliado en cobros, pagos y envíos',address:'Av. 27 de Febrero #2131, Local 12, Santiago',phone:'809-555-0222',rnc:'1-30-00100-1',email:'admin@cyp.local',footerNote:'Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.'},'Administración','Administración',true);
const recipientVoucher=remittanceReceipt({id:'qa-recipient',sequence:48,envioReference:'ENV00000048',reciboReference:'REC00000048',operatingCode:'AD0B35A22F305CA2',senderClientId:'s1',recipientClientId:'r1',sendingUserId:'demo-admin',registeredBy:'demo-admin',status:'paid',paidAt:'2026-11-11T15:58:10.000Z',canPay:false,canCancel:false,createdAt:'2026-11-11T13:15:00.000Z',note:'',sourceCurrency:'DOP',destinationCurrency:'DOP',amount:100000,commissionBps:1000,commissionAmount:10000,totalAmount:110000,receiveAmount:100000,quote:{date:'2026-11-11',sourceRate:'1.000000',destinationRate:'1.000000',sourceRateKind:'base',destinationRateKind:'base'},senderContact:{id:'s1',code:'1111111111',name:'mayo lomb',identification:'03103103103',phone:'111-111-1111',cellular:'',address:'santiago'},recipientContact:{id:'r1',code:'CL-0002',name:'María Rodríguez',identification:'',phone:'8095550100',cellular:'',address:'Calle Las Damas 18'},receiptIssuer:{name:'Cobros y Pagos',address:'',phone:'',email:'admin@cyp.local',logoDataUrl:syntheticLogo,footerNote:'Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.'},payment:{version:2,method:'card',cardType:'credit',tenderedAmount:118800,changeAmount:0,cardSurchargeBps:800,cardSurchargeAmount:8800,reference:'658565',last4:'8888',bank:'Banreservas',confirmedBy:'demo-admin',confirmedAt:'2026-11-11T13:15:00.000Z'}},{name:'INVERSIONES DEMO S.R.L.',slogan:'Tu aliado en cobros, pagos y envíos',address:'Av. 27 de Febrero #2131, Local 12, Santiago',phone:'809-555-0222',rnc:'1-30-00100-1',email:'admin@cyp.local',footerNote:'Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.'},'Administración','Administración',true,'recipient');
for(const [id,compact,mode] of [['pos80-full-text',false,'text'],['pos80-compact-text',true,'text'],['pos80-full-graphics',false,'graphics']] as const){const b=document.createElement('button');b.textContent=id;b.onclick=()=>printRemittanceReceipt(pos80Invoice,{paper:'80',compact,output:mode});document.body.append(b);}
for(const [id,paper,mode] of [['invoice-a4-graphics','a4','graphics'],['invoice-letter-graphics','letter','graphics']] as const){const b=document.createElement('button');b.textContent=id;b.onclick=()=>printRemittanceReceipt(pos80Invoice,{paper,orientation:'portrait',compact:false,output:mode});document.body.append(b);}
for(const [id,paper,mode] of [['recipient-pos80-graphics','80','graphics'],['recipient-pos80-text','80','text'],['recipient-58-graphics','58','graphics'],['recipient-a4-graphics','a4','graphics'],['recipient-a4-text','a4','text'],['recipient-letter-graphics','letter','graphics']] as const){const b=document.createElement('button');b.textContent=id;b.onclick=()=>printRemittanceReceipt(recipientVoucher,{paper,orientation:'portrait',compact:false,output:mode,audience:'recipient'});document.body.append(b);}
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
        state.__runs.push({text:value,left,right:left+width,y,widthMm:this.canvas.width/8,block:ids.get(this.canvas)});
        if(maxWidth===undefined)return original.call(this,value,x,y);return original.call(this,value,x,y,maxWidth);
      };
    });
    const page=await context.newPage();page.on("pageerror",(error:Error)=>errors.push(error.message));await page.goto(origin);
    for(const paper of ["51","76","80","58","102"]){
      const opening=page.waitForEvent("popup");await page.getByRole("button",{name:paper,exact:true}).click();const popup=await opening;
      popup.on("pageerror",(error:Error)=>errors.push(error.message));await popup.waitForFunction(()=>(window as any).__prints===1);
      assert.equal(await popup.evaluate(()=>(window as any).__readyAtPrint),true);
      const images=popup.locator("main.thermal-image-output img");assert(await images.count()>20);
      const result=await popup.evaluate(()=>({runs:(window as any).__runs,images:Array.from(document.querySelectorAll<HTMLImageElement>("main img")).map(image=>({alt:image.alt,src:image.src.slice(0,22),width:image.naturalWidth,heightMm:image.getBoundingClientRect().height*25.4/96,left:image.getBoundingClientRect().left})),bodyLeft:document.body.getBoundingClientRect().left}));
      assert.equal(result.bodyLeft,0);
      assert(!result.images.some((img:any)=>img.alt==="Margen superior"||img.alt==="Margen inferior"),"thermal graphic receipts omit blank top/bottom spacer blocks");
      for(const image of result.images){assert.equal(image.src,"data:image/png;base64,");assert.equal(image.width,(paper==="80"?66:paper==="58"?45:paper==="51"?42:paper==="102"?92:63)*8);assert.equal(image.left,0);assert(image.heightMm>0&&image.heightMm<60);}
      for(const run of result.runs){assert(run.left>=0.2,JSON.stringify(run));assert(run.right<=run.widthMm-0.3,JSON.stringify(run));}
      const text=result.runs.map((run:any)=>run.text).join("\n");for(const expected of ["Envío:","Código de operación:","José Núñez","María Rodríguez","Identificación:","Dirección:","DOP 2,200.00"])assert(text.includes(expected),expected);
      const blocks=new Map<number,any[]>();for(const run of result.runs){const group=blocks.get(run.block)??[];group.push(run);blocks.set(run.block,group);}
      for(const group of blocks.values())if(group.length>=2&&group[0].text.endsWith(":")&&group[0].y===group[1].y){const gapMm=group[1].left-group[0].right;assert(gapMm>=0.7&&gapMm<=1.5,`value must sit immediately next to field label (${gapMm}mm): ${JSON.stringify(group)}`);}
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
      assert(content.includes("Nombre: José Núñez"));assert(!/Nombre: {2,}/.test(content));assert(content.includes("Código de operación:"));assert(content.includes("Nombre: María Rodríguez"));
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
      for(const expected of ["INVERSIONES DEMO S.R.L.","Tu aliado en cobros, pagos y envíos","Av. 27 de Febrero","Tel. 809-555-0222 / RNC: 1-30-00100-1","----------------------------------------","RECIBO DE ENVIO","Fecha: 11/11/26 09:15 a.m.","Envío: ENV00000048","Remitente: mayo lomb","Destinatario: María Rodríguez","Teléfono: 8095550100","Importes del envío","Monto a enviar: DOP 500.00","DOP 594.00","Recibe el destinatario: DOP 500.00","Forma pago del remitente: TC","Registrado por: Administración","Nota: Conserve este recibo."])assert(preMetrics.text.includes(expected),`${id} missing ${expected}`);
      assert.equal((preMetrics.text.match(/-{40}/g)??[]).length,1,`${id}: only the header dashed line is drawn`);
      for(const forbidden of ["REC00000048","Cobros y Pagos","admin@cyp.local","Cargo del envío","Recargo tarjeta de crédito","Cargo adicional por tarjeta","DOP 44.00","DOP 94.00","8888","658565","Banreservas","Pendiente de entrega","Operador del envío","03103103103","111-111-1111","CL-0002","========================================"])assert(!preMetrics.text.includes(forbidden),`${id} unexpected ${forbidden}`);
      assert(preMetrics.text.indexOf("INVERSIONES DEMO S.R.L.")<preMetrics.text.indexOf("RECIBO DE ENVIO"),`${id}: company header must appear at the very top`);
      assert(preMetrics.text.indexOf("RECIBO DE ENVIO")<preMetrics.text.indexOf("Fecha:"),`${id}: RECIBO DE ENVIO precedes Fecha`);
      if(compact){assert(!preMetrics.text.includes("Cód. Operación:"));assert(!preMetrics.text.includes("Calle Las Damas 18"));assert(!preMetrics.text.includes("1111111111"));assert(!preMetrics.text.includes("Recibido por:"));}
      else{assert(preMetrics.text.includes("Cód. Operación: AD0B35A22F305CA2"));assert(preMetrics.text.includes("Dirección: Calle Las Damas 18"));assert(preMetrics.text.includes("Código del Cliente: 1111111111"));assert(preMetrics.text.includes("Recibido por: ________________________"));}
      await posPopup.pdf({path:path.join(output,`${id}-72.1mm.pdf`),width:"72.1mm",height:"297mm",preferCSSPageSize:false,printBackground:true});
      await posPopup.screenshot({path:path.join(output,`${id}-72.1mm.png`),fullPage:true});await posPopup.close();
    }
    const openingGraphicPos80=page.waitForEvent("popup");await page.getByRole("button",{name:"pos80-full-graphics",exact:true}).click();const posGraphic=await openingGraphicPos80;
    await posGraphic.waitForFunction(()=>(window as any).__prints===1);
    await posGraphic.setViewportSize({width:Math.floor(72.1*96/25.4),height:900});
    await posGraphic.emulateMedia({media:"print"});
    const graphicCheck=await posGraphic.evaluate(()=>({
      runs:(window as any).__runs,
      alts:Array.from(document.querySelectorAll<HTMLImageElement>("main.thermal-image-output img")).map(img=>img.alt),
      widths:Array.from(document.querySelectorAll<HTMLImageElement>("main.thermal-image-output img")).map(img=>img.naturalWidth),
      totalHeightMm:document.querySelector("main.thermal-image-output")!.getBoundingClientRect().height*25.4/96,
    }));
    assert.equal(graphicCheck.alts[0],"Logo de la empresa");
    assert(graphicCheck.alts.includes("Separador punteado"),"dashed separator line right below company header");
    assert(!graphicCheck.alts.includes("Separador"),"internal horizontal divider lines are removed on printed receipts");
    assert(!graphicCheck.alts.includes("Margen superior")&&!graphicCheck.alts.includes("Margen inferior"),"no blank top/bottom spacer blocks");
    assert(graphicCheck.totalHeightMm<130,`compact thermal graphic receipt avoids vertical whitespace bloat (${graphicCheck.totalHeightMm}mm)`);
    for(const w of graphicCheck.widths)assert.equal(w,66*8,"POS80 graphic canvas uses 66mm (528 dots), maximizing width inside ~67.4mm printhead limit");
    for(const run of graphicCheck.runs){assert(run.left>=0.2,JSON.stringify(run));assert(run.right<=65.7,`right edge clipped risk: ${JSON.stringify(run)}`);}
    const posGraphicBlocks=new Map<number,any[]>();for(const run of graphicCheck.runs){const group=posGraphicBlocks.get(run.block)??[];group.push(run);posGraphicBlocks.set(run.block,group);}
    let inlinePairs=0;
    for(const group of posGraphicBlocks.values())if(group.length>=2&&group[0].text.endsWith(":")&&group[0].y===group[1].y){inlinePairs++;const gapMm=group[1].left-group[0].right;assert(gapMm>=0.7&&gapMm<=1.6,`POS80 graphic value detached from label (${gapMm}mm): ${JSON.stringify(group)}`);}
    assert(inlinePairs>=13,`expected all POS80 invoice rows to render value immediately after label, got ${inlinePairs}`);
    const posGraphicText=graphicCheck.runs.map((r:any)=>r.text).join("\n");
    for(const expected of ["Tel. 809-555-0222 / RNC: 1-30-00100-1","RECIBO DE ENVIO","Cód. Operación:","Remitente:","Código del Cliente:","Destinatario:","Importes del envío","Total pagado por el remitente:","DOP 594.00","Recibe el destinatario:","Forma pago del remitente:","TC","Recibido por:","Registrado por:","Nota:"])assert(posGraphicText.includes(expected),`graphic receipt missing ${expected}`);
    for(const forbidden of ["Cargo del envío","Recargo tarjeta de crédito","Cargo adicional por tarjeta","8888","658565","Banreservas"])assert(!posGraphicText.includes(forbidden),`graphic receipt unexpected ${forbidden}`);
    await posGraphic.screenshot({path:path.join(output,"pos80-full-graphics-72.1mm.png"),fullPage:true});await posGraphic.close();
    for(const [id,widthMm,heightMm] of [["invoice-a4-graphics",210,297],["invoice-letter-graphics",215.9,279.4]] as const){
      const openingSheet=page.waitForEvent("popup");await page.getByRole("button",{name:id,exact:true}).click();const sheetPopup=await openingSheet;
      await sheetPopup.waitForFunction(()=>(window as any).__prints===1);
      await sheetPopup.setViewportSize({width:Math.round(widthMm*96/25.4),height:Math.round(heightMm*96/25.4)});
      await sheetPopup.emulateMedia({media:"print"});
      assert.equal(await sheetPopup.locator("header img").count(),1,`${id}: company logo rendered in header`);
      assert.equal(await sheetPopup.locator("main.thermal-image-output img").count(),0,`${id}: selectable text body`);
      assert.equal(await sheetPopup.locator("section.receipt-sheet-divided").count(),5,`${id}: 5 dashed divider lines below field blocks`);
      const dividedStyles=await sheetPopup.locator("section.receipt-sheet-divided").evaluateAll((nodes:Element[])=>nodes.map(node=>getComputedStyle(node).borderBottomStyle));
      assert.deepEqual(dividedStyles,["dashed","dashed","dashed","dashed","dashed"]);
      const bodyText=await sheetPopup.locator("body").innerText();
      for(const expected of ["INVERSIONES DEMO S.R.L.","Tu aliado en cobros, pagos y envíos","Av. 27 de Febrero #2131, Local 12, Santiago","Tel. 809-555-0222 / RNC: 1-30-00100-1","RECIBO DE ENVIO","Fecha: 11/11/26 09:15 a.m.","Envío: ENV00000048","Cód. Operación: AD0B35A22F305CA2","Remitente: mayo lomb","Código del Cliente: 1111111111","Destinatario: María Rodríguez","Teléfono: 8095550100","Dirección: Calle Las Damas 18","Importes del envío","Monto a enviar: DOP 500.00","Total pagado por el remitente: DOP 594.00","Recibe el destinatario: DOP 500.00","Forma pago del remitente: TC","Recibido por:","Registrado por: Administración","Nota: Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío."])assert(bodyText.includes(expected),`${id} missing ${expected}`);
      const pdf=await sheetPopup.pdf({path:path.join(output,`${id}.pdf`),preferCSSPageSize:true,printBackground:true});
      const boxes=[...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]/g)];
      assert.equal(boxes.length,1,`${id}: fits cleanly on a single page`);
      await sheetPopup.screenshot({path:path.join(output,`${id}.png`),fullPage:true});
      await sheetPopup.close();
    }
    for(const [id,widthMm] of [["recipient-pos80-graphics",66],["recipient-58-graphics",45]] as const){
      const openingRecThermal=page.waitForEvent("popup");await page.getByRole("button",{name:id,exact:true}).click();const recThermal=await openingRecThermal;
      await recThermal.waitForFunction(()=>(window as any).__prints===1);
      await recThermal.setViewportSize({width:Math.floor((widthMm===66?72.1:48)*96/25.4),height:760});
      await recThermal.emulateMedia({media:"print"});
      const recCheck=await recThermal.evaluate(()=>({
        runs:(window as any).__runs,
        alts:Array.from(document.querySelectorAll<HTMLImageElement>("main.thermal-image-output img")).map(img=>img.alt),
        widths:Array.from(document.querySelectorAll<HTMLImageElement>("main.thermal-image-output img")).map(img=>img.naturalWidth),
        lefts:Array.from(document.querySelectorAll<HTMLImageElement>("main.thermal-image-output img")).map(img=>img.getBoundingClientRect().left),
        bodyLeft:document.body.getBoundingClientRect().left,
      }));
      assert.equal(recCheck.bodyLeft,0);
      assert.equal(recCheck.alts.filter((a:string)=>a==="Separador").length,2,`${id}: two solid KEBEK horizontal rules`);
      assert(!recCheck.alts.includes("Logo de la empresa")&&!recCheck.alts.includes("Separador punteado"),`${id}: recipient voucher omits sender logo and dashed rule`);
      for(const w of recCheck.widths)assert.equal(w,widthMm*8);
      for(const l of recCheck.lefts)assert.equal(l,0);
      for(const run of recCheck.runs){assert(run.left>=0.2,JSON.stringify(run));assert(run.right<=widthMm-0.3,`recipient clip risk: ${JSON.stringify(run)}`);}
      const recText=recCheck.runs.map((r:any)=>r.text).join(" ").replace(/\s+/g," ");
      for(const expected of ["Envío #: ENV00000048","11-11-2026 |11:58:10","María Rodríguez","TELÉFONO: 8095550100","MONTO: DOP 1,000.00","RECIBE EN DOP:","1,000.00","Es importante que revise su recibo para asegurar que el número de teléfono esté correcto!","PARA RECLAMACIONES FAVOR COMUNICARSE A 809-555-0222"])assert(recText.includes(expected),`${id} missing ${expected}`);
      if(widthMm===66)assert(recCheck.runs.some((r:any)=>r.text==="Fecha  : 11-11-2026 |11:58:10"),"POS80 preserves exact spacing in Fecha  :");
      for(const forbidden of ["RECIBO DE ENVIO","mayo lomb","111-111-1111","Recibido por","Registrado por","Forma pago del remitente","Conserve este recibo"])assert(!recText.includes(forbidden),`${id} unexpected ${forbidden}`);
      await recThermal.screenshot({path:path.join(output,`${id}.png`),fullPage:true});
      await recThermal.close();
    }
    const openingRecText80=page.waitForEvent("popup");await page.getByRole("button",{name:"recipient-pos80-text",exact:true}).click();const recText80=await openingRecText80;
    await recText80.waitForFunction(()=>(window as any).__prints===1);
    await recText80.setViewportSize({width:Math.floor(72.1*96/25.4),height:760});
    await recText80.emulateMedia({media:"print"});
    const recPre=await recText80.locator("pre").textContent()??"";
    assert.equal((recPre.match(/-{40}/g)??[]).length,2,"POS80 text recipient voucher draws 2 solid horizontal rules");
    for(const line of recPre.split("\n"))assert(Array.from(line).length<=40);
    for(const expected of ["Envío #: ENV00000048","Fecha  : 11-11-2026 |11:58:10","María Rodríguez","TELÉFONO: 8095550100","MONTO: DOP 1,000.00","RECIBE EN DOP:","1,000.00"])assert(recPre.includes(expected),`recipient-pos80-text missing ${expected}`);
    assert(recPre.replace(/\s+/g," ").includes("PARA RECLAMACIONES FAVOR COMUNICARSE A 809-555-0222"));
    await recText80.screenshot({path:path.join(output,"recipient-pos80-text.png"),fullPage:true});
    await recText80.close();
    for(const [id,widthMm,heightMm,isText] of [["recipient-a4-graphics",210,297,false],["recipient-a4-text",210,297,true],["recipient-letter-graphics",215.9,279.4,false]] as const){
      const openingRecSheet=page.waitForEvent("popup");await page.getByRole("button",{name:id,exact:true}).click();const recSheet=await openingRecSheet;
      await recSheet.waitForFunction(()=>(window as any).__prints===1);
      await recSheet.setViewportSize({width:Math.round(widthMm*96/25.4),height:Math.round(heightMm*96/25.4)});
      await recSheet.emulateMedia({media:"print"});
      assert.equal(await recSheet.locator("main.thermal-image-output img").count(),0);
      assert.equal(await recSheet.locator("section.receipt-sheet-divided").count(),0,"recipient sheet voucher has no sender dashed block dividers");
      const recSheetBody=(await recSheet.locator("body").innerText()).replace(/\s+/g," ");
      for(const expected of ["Envío #: ENV00000048","11-11-2026 |11:58:10","María Rodríguez","TELÉFONO: 8095550100","MONTO: DOP 1,000.00","RECIBE EN DOP:","1,000.00","Es importante que revise su recibo para asegurar que el número de teléfono esté correcto!","PARA RECLAMACIONES FAVOR COMUNICARSE A 809-555-0222"])assert(recSheetBody.includes(expected),`${id} missing ${expected}`);
      assert(!recSheetBody.includes("RECIBO DE ENVIO")&&!recSheetBody.includes("mayo lomb"));
      if(!isText)assert.equal(await recSheet.locator(".recipient-voucher-header,.recipient-voucher-recipient").count(),2);
      const pdf=await recSheet.pdf({path:path.join(output,`${id}.pdf`),preferCSSPageSize:true,printBackground:true});
      const boxes=[...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]/g)];
      assert.equal(boxes.length,1,`${id}: fits cleanly on a single page`);
      await recSheet.screenshot({path:path.join(output,`${id}.png`),fullPage:true});
      await recSheet.close();
    }
    if(process.env.CYP_RECEIPT_SNAPSHOT_DIR){
      fs.mkdirSync(process.env.CYP_RECEIPT_SNAPSHOT_DIR,{recursive:true});
      for(const snap of ["recipient-pos80-graphics.png","recipient-pos80-text.png","recipient-58-graphics.png","recipient-a4-graphics.png","recipient-letter-graphics.png","pos80-full-graphics-72.1mm.png","invoice-a4-graphics.png"]){
        const src=path.join(output,snap);if(fs.existsSync(src))fs.copyFileSync(src,path.join(process.env.CYP_RECEIPT_SNAPSHOT_DIR,snap));
      }
    }
    // Failed raster preparation must not silently print a different format.
    await context.addInitScript(()=>{HTMLCanvasElement.prototype.toDataURL=()=>{throw new Error("Synthetic raster failure");};});
    const failing=page.waitForEvent("popup");await page.getByRole("button",{name:"80",exact:true}).click();const failed=await failing;
    await failed.getByRole("alert").waitFor();assert.equal(await failed.evaluate(()=>(window as any).__prints),0);await failed.close();
    const compatible=page.waitForEvent("popup");await page.getByRole("button",{name:"text-80",exact:true}).click();const noCanvas=await compatible;await noCanvas.waitForFunction(()=>(window as any).__prints===1);assert.equal(await noCanvas.locator("img,canvas").count(),0);await noCanvas.close();
    assert.deepEqual(errors,[]);assert.deepEqual(external.filter(url=>!/(^|\.)kaspersky-labs\.com$/i.test(new URL(url).hostname)),[]);await context.close();
    t.diagnostic(`Synthetic receipt screenshots: ${output}; no physical printer used.`);
  } finally {await browser?.close();if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}}
});
