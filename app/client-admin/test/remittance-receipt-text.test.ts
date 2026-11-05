import test from "node:test";
import assert from "node:assert/strict";
import {receiptText,receiptTextColumns} from "../../shared/remittances/receiptText";
import {receiptHtml,type Receipt} from "../../shared/remittances/receipt";

const receipt:Receipt={reference:"REC-QA-TEXTO",date:"05/11/2026",status:"pending",issuer:{name:"Empresa Álvarez & Núñez"},footer:"Conserve este recibo. Para consultas o reclamaciones, presente la referencia del envío.",sections:[
  {title:"Remitente",columns:["Dato","Valor"],rows:[["Nombre","José Núñez"],["Dirección","Calle de la Constitución, próximo al Parque de los Héroes"]]},
  {title:"Destinatario",columns:["Dato","Valor"],rows:[["Nombre","Mari\u0301a Rodríguez"]]},
  {title:"Importes del envío",columns:["Dato","Valor"],rows:[["Total pagado por el remitente","DOP 2,200.00"],["Devuelta","DOP 100.00"]]},
  {title:"Nota",columns:["Dato","Valor"],rows:[["Nota", "REFERENCIA".repeat(30)]]}
]};
test("text-only receipt uses actual separators and bounded hard lines, preserves Spanish accents, amounts and every long reference character",()=>{
  const before=JSON.stringify(receipt);
  for(const paper of ["80","76","58","auto"]){
    const columns=receiptTextColumns(paper),text=receiptText(receipt,columns);
    for(const line of text.split("\n"))assert(Array.from(line).length<=columns);
    assert.match(text,/Nombre: {2,}José Núñez/);assert(text.includes("María Rodríguez"));assert(text.includes("Dirección:"));
    assert(text.includes("DOP 2,200.00"));assert(text.includes("DOP 100.00"));
    assert(text.replace(/\s/g,"").includes("REFERENCIA".repeat(30)));
    assert(text.includes("-".repeat(columns)));assert(text.endsWith("\n"));
  }
  assert.equal(JSON.stringify(receipt),before);
});
test("generic print HTML contains escaped selectable text, no images/scripts, and compact filtering keeps money and names",()=>{
  const data={...receipt,issuer:{name:"<script>alert('x')</script>"}};
  const full=receiptHtml(data,{paper:"80",compact:false,output:"text"});
  assert(full.includes('<meta charset="utf-8">'));assert(full.includes("&lt;script&gt;"));assert(full.includes("José Núñez"));
  assert(!/<(?:img|canvas|svg|script)\b/i.test(full));assert(full.includes("white-space:pre"));
  const compact=receiptHtml(data,{paper:"80",compact:true,output:"text"});
  assert(compact.includes("José Núñez"));assert(compact.includes("María Rodríguez"));assert(compact.includes("DOP 2,200.00"));
  assert(!compact.includes("Dirección:"));assert(!compact.includes("REFERENCIAREFERENCIA"));
});
test("text receipts never carry printer escape commands or hidden directional overrides from notes",()=>{
  const data={...receipt,footer:"José\u001b@\u001dV\u0001 Núñez\u202e DOP 2,200.00"},text=receiptText(data,40);
  assert(!/[\u001b\u001d\u0001\u202e]/.test(text));assert(text.includes("José"));assert(text.includes("Núñez"));assert(text.includes("DOP 2,200.00"));
});
