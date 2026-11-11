import assert from "node:assert/strict";
import test from "node:test";
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

test("full number entry stays out of React drafts, native form data, storage and payment intents; sensitive DOM is cleared", {skip: process.platform === "win32" && fs.existsSync(edge) && playwrightEntry ? false : "Installed Windows Edge and Playwright required; no download attempted."}, async t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(),"cyp-card-number-ui-"));
  const module = JSON.stringify(path.resolve(root,"../shared/remittances/PaymentFields.tsx").replaceAll("\\","/"));
  const fixture = path.join(output,"fixture.tsx");
  fs.writeFileSync(fixture,`import {StrictMode,useState} from "react";import {createRoot} from "react-dom/client";import {PaymentFields,paymentDraftFor,paymentInput} from ${module};
const initial=()=>paymentDraftFor(11000,{method:"card",cardType:"credit",cardholderName:"Persona de prueba",reference:"TEST-EXTERNAL",verified:false});
function Test(){const[draft,setDraft]=useState(initial),[open,setOpen]=useState(true),[locked,setLocked]=useState(false),[saved,setSaved]=useState(""),[result,setResult]=useState(""),[count,setCount]=useState(0);
return <main><form onSubmit={e=>e.preventDefault()}>{open&&<PaymentFields total={11000} currency="DOP" creditCardCommissionBps={250} value={draft} onChange={setDraft} locked={locked}/>}</form>
<output aria-label="Borrador seguro">{JSON.stringify(draft)}</output><output aria-label="Enviado">{saved}</output><output aria-label="Resultado">{result}</output><output aria-label="Cantidad guardada">{count}</output>
<button onClick={()=>{try{setSaved(JSON.stringify(paymentInput(11000,draft,250)));setResult("Registrado");setCount(c=>c+1)}catch(e){setResult(e.message)}}}>Guardar</button>
<button onClick={()=>setLocked(true)}>Bloquear</button><button onClick={()=>setLocked(false)}>Desbloquear</button>
<button onClick={()=>setOpen(false)}>Desmontar</button><button onClick={()=>setOpen(true)}>Restaurar</button>
<button onClick={()=>setDraft({...initial(),bank:"Banco histórico"})}>Registro anterior</button>
<button onClick={()=>{setOpen(false);setDraft(initial());setLocked(false)}}>Cancelar</button></main>};createRoot(document.getElementById("root")).render(<StrictMode><Test/></StrictMode>);`);
  let browser: any, server: ReturnType<typeof createServer> | undefined;
  const errors: string[] = [], requests: string[] = [];
  try {
    const [{build},{default:react},{chromium}] = await Promise.all([import(pathToFileURL(require.resolve("vite")).href),import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href),import(pathToFileURL(playwrightEntry!).href)]);
    await build({root,configFile:false,envFile:false,publicDir:false,cacheDir:path.join(output,"cache"),plugins:[react()],resolve:{dedupe:["react","react-dom"]},logLevel:"error",define:{"process.env.NODE_ENV":JSON.stringify("development")},build:{outDir:output,emptyOutDir:false,lib:{entry:fixture,formats:["es"],fileName:()=>"fixture.js"}}});
    server = createServer((request,response)=>{
      requests.push(request.url ?? "");
      if (request.url === "/fixture.js") {response.setHeader("Content-Type","text/javascript");response.end(fs.readFileSync(path.join(output,"fixture.js")));}
      else {response.setHeader("Content-Type","text/html");response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script></html>');}
    });
    await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
    const address = server.address(); assert(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({executablePath:edge,headless:true});
    for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) await t.test(`${viewport.width}px: entry, masking, correction, cancel and restored intent`, async()=>{
      const context = await browser.newContext({viewport,serviceWorkers:"block"});
      try {
        await context.route("**/*",(route:any)=>new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
        const page = await context.newPage(); page.setDefaultTimeout(10000);page.on("pageerror",(error:Error)=>errors.push(error.message));await page.goto(origin);
        const number = page.getByLabel("Número de tarjeta (16 dígitos)",{exact:true});
        const verified = page.getByLabel("Comprobé que el pago fue recibido",{exact:true});
        assert.equal(await page.getByLabel("Vencimiento (MM/YY)",{exact:true}).count(),0);
        assert.equal(await page.getByLabel("CVV",{exact:true}).count(),0);
        const holder = page.getByLabel("Nombre del titular",{exact:true});
        await holder.fill("Titular 123");assert.equal(await holder.inputValue(),"Persona de prueba");
        await holder.fill("María O'Connor");
        const pan = "4111111111110042", grouped = "4111 1111 1111 0042", mask = "•••• •••• •••• 0042";
        const bank = page.getByLabel("Banco o proveedor (opcional)",{exact:true});
        assert.equal(await bank.evaluate((element:HTMLSelectElement)=>element.tagName),"SELECT");
        for (const name of ["Banreservas","Banco Popular","BHD"]) { await bank.selectOption(name); assert.equal(JSON.parse((await page.getByLabel("Borrador seguro").textContent())!).bank,name); }
        await number.click(); await number.pressSequentially(pan); assert.equal(await number.inputValue(),grouped);
        assert.equal(await number.getAttribute("name"),null); assert.equal(await number.getAttribute("autocomplete"),"off");
        assert(!(await page.getByLabel("Borrador seguro").textContent()).includes(pan));
        assert(!(await page.getByLabel("Borrador seguro").textContent()).includes(grouped));
        assert(!(await number.getAttribute("value") ?? "").includes(grouped));
        assert(!(await page.evaluate(()=>JSON.stringify([...new FormData(document.querySelector("form")!).entries()]))).includes(pan));
        assert.deepEqual(await page.evaluate(()=>[...new FormData(document.querySelector("form")!).entries()]),[]);
        await verified.check(); assert.equal(await number.inputValue(),grouped,"all digits stay visible for verification before saving");
        await page.getByRole("button",{name:"Guardar",exact:true}).click();
        const sent = JSON.parse((await page.getByLabel("Enviado").textContent())!); assert.equal(sent.last4,"0042");assert.equal(sent.cardNumber,undefined);assert.equal(sent.cvv,undefined);
        assert.equal(sent.expiry,undefined);assert(!(await page.getByLabel("Borrador seguro").textContent()).includes("12/99"));
        assert(!JSON.stringify(sent).includes(pan) && !JSON.stringify(sent).includes(grouped));
        const paste = (value:string)=>number.evaluate((input:HTMLInputElement,text:string)=>{const data=new DataTransfer();data.setData("text",text);input.dispatchEvent(new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}));},value);
        await number.focus(); await paste(pan+"1"); assert.equal(await number.inputValue(),grouped);
        await page.getByRole("button",{name:"Guardar",exact:true}).click(); assert.equal(await page.getByLabel("Cantidad guardada").textContent(),"1");
        await number.selectText(); await paste(grouped);assert.equal(await number.inputValue(),grouped);assert.equal(await verified.isChecked(),false,"a new entry requires checking the external payment again");
        await number.press("x"); assert.equal(await number.inputValue(),grouped);assert.equal(await number.getAttribute("aria-invalid"),"true");
        await number.fill(pan); await number.evaluate((input:HTMLInputElement)=>input.setSelectionRange(5,5));await number.press("Backspace");
        assert.equal((await number.inputValue()).replace(/ /g,"").length,15); assert.equal(JSON.parse((await page.getByLabel("Borrador seguro").textContent())!).last4,"");
        await verified.focus(); assert.equal(await number.inputValue(),"","an unfinished full number is discarded on blur");
        await number.fill(pan);await number.focus();
        await page.getByRole("button",{name:"Bloquear",exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
        assert.equal(await number.inputValue(),mask);assert.equal(await number.isDisabled(),true);
        await page.getByRole("button",{name:"Desbloquear",exact:true}).click();
        await number.fill(pan);await number.evaluate((input:HTMLInputElement)=>{(window as any).heldNumber=input;});
        await page.getByRole("button",{name:"Desmontar",exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
        assert.equal(await page.evaluate(()=>(window as any).heldNumber.value),"");assert.equal(await page.evaluate(()=>(window as any).heldNumber.defaultValue),"");
        await page.getByRole("button",{name:"Restaurar",exact:true}).click(); assert.equal(await number.inputValue(),mask,"restoring a draft never reconstructs the full number");
        await number.fill(pan);await number.focus();await page.evaluate(()=>window.dispatchEvent(new Event("pagehide")));assert.equal(await number.inputValue(),mask);
        await number.fill("41111111");await page.evaluate(()=>window.dispatchEvent(new Event("pagehide")));assert.equal(await number.inputValue(),"");
        await number.fill(pan);await number.focus();
        await page.evaluate(()=>{Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});document.dispatchEvent(new Event("visibilitychange"));delete (document as any).visibilityState;});
        assert.equal(await number.inputValue(),mask);
        await verified.focus();
        await number.evaluate((input:HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));},pan);
        assert.equal(await number.inputValue(),mask,"unfocused autofill does not leave the complete number on view");
        const storage = await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert(!storage.includes(pan) && !storage.includes(grouped));
        await number.fill(pan);await number.evaluate((input:HTMLInputElement)=>{(window as any).cancelNumber=input;});
        await page.getByRole("button",{name:"Cancelar",exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
        assert.equal(await page.evaluate(()=>(window as any).cancelNumber.value),"");
        await page.getByRole("button",{name:"Restaurar",exact:true}).click();assert.equal(await number.inputValue(),"");
        await number.fill(pan);await number.evaluate((input:HTMLInputElement)=>{(window as any).methodNumber=input;});
        await page.getByLabel("Forma de pago",{exact:true}).selectOption("debit");
        assert.equal(await page.getByRole("dialog",{name:"Cargo adicional por tarjeta",exact:true}).count(),0,"selecting debit card never opens a manual card charge dialog");
        assert.equal(await page.getByRole("button",{name:"Modificar cargo",exact:true}).count(),0);
        assert.equal(await page.evaluate(()=>(window as any).methodNumber.value),"","switching card type destroys the former full number");
        assert.equal(await number.inputValue(),""); assert.equal(await holder.inputValue(),"");
        assert.equal(await page.getByLabel("CVV",{exact:true}).count(),0);
        assert.equal(await page.getByLabel("Vencimiento (MM/YY)",{exact:true}).count(),0);
        await page.getByRole("button",{name:"Guardar",exact:true}).click();
        assert.match((await page.getByLabel("Resultado").textContent())!,/nombre del titular/);
        await holder.fill("Titular de Débito"); await number.fill(pan);
        await page.getByLabel("Referencia del comprobante",{exact:true}).fill("QA-DEBIT");
        await bank.selectOption("BHD"); await verified.check();
        assert.deepEqual(await page.locator("form label").evaluateAll((labels:HTMLLabelElement[])=>labels.map(label=>label.childNodes[0]?.textContent)),["Forma de pago","Banco o proveedor (opcional)","Nombre del titular","Número de tarjeta (16 dígitos)","Referencia del comprobante",""]);
        await page.getByRole("button",{name:"Guardar",exact:true}).click();
        const debit = JSON.parse((await page.getByLabel("Enviado").textContent())!);
        assert.equal(debit.cardType,"debit"); assert.equal(debit.last4,"0042"); assert.equal(debit.cardholderName,"Titular de Débito");
        assert.equal(debit.cvv,undefined); assert.equal(debit.expiry,undefined); assert(!JSON.stringify(debit).includes(pan));
        await number.evaluate((input:HTMLInputElement)=>{(window as any).methodNumber=input;});
        await page.getByLabel("Forma de pago",{exact:true}).selectOption("credit");
        assert.equal(await page.getByRole("dialog",{name:"Cargo adicional por tarjeta",exact:true}).count(),0,"selecting credit card never opens a manual card charge dialog");
        assert.equal(await page.evaluate(()=>(window as any).methodNumber.value),"");
        assert.equal(await number.inputValue(),""); assert.equal(await holder.inputValue(),"");
        await number.fill(pan); await number.evaluate((input:HTMLInputElement)=>{(window as any).methodNumber=input;});
        await page.getByLabel("Forma de pago",{exact:true}).selectOption("cash");assert.equal(await number.count(),0);
        assert.equal(await page.evaluate(()=>(window as any).methodNumber.value),"");
        await page.getByRole("button",{name:"Registro anterior",exact:true}).click();
        assert.equal(await bank.inputValue(),"Banco histórico");
        await bank.selectOption("Banco Popular");assert.equal(await bank.inputValue(),"Banco Popular");
      } finally {await context.close();}
    });
    assert.deepEqual(errors,[]);assert(!requests.some(url=>url.includes("4111111111110042") || url.includes("4111%201111")));
    t.diagnostic("Synthetic card entry only; no external requests, bank operations or real card data.");
  } finally {await browser?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));}
});
