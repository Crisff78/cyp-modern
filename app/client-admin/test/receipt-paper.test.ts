import test from "node:test";
import assert from "node:assert/strict";
import { defaultReceiptPrintOptions, receiptPrintLayout, receiptPaperLabels, thermalReceiptSize, type ReceiptPrintOptions } from "../../shared/remittances/receiptPaper";
import { receiptTextColumns } from "../../shared/remittances/receiptText";
import { receiptHtml, type Receipt } from "../../shared/remittances/receipt";

const receipt:Receipt = {reference:"REC-PAPEL",date:"06/11/2026",status:"pending",issuer:{name:"Empresa Núñez",address:"",phone:"",email:"",footerNote:""},footer:"Conserve el recibo",sections:[{title:"Importes",columns:["Dato","Valor"],rows:[["Recibe el destinatario","DOP 1,000.00"]]}]};

test("two, three and four inch rolls keep readable type, zero extra @page margin on POS80, left-aligned content and bounded text widths", () => {
  assert.equal(defaultReceiptPrintOptions.paper, "80");
  assert.equal(defaultReceiptPrintOptions.output, "text");
  assert.match(receiptPaperLabels["80"], /3 pulgadas.*80 mm.*POS80/);
  for(const [paper,width,graphicWidth,columns] of [["51",45,40,24],["58",48,42,26],["76",70,60,38],["80",72,63,40],["102",96,88,54]] as const) {
    const options = {paper,compact:false,output:"text" as const}, layout = receiptPrintLayout(options);
    assert.equal(layout.widthMm,width); assert.equal(layout.marginMm,0); assert.equal(layout.textColumns,columns); assert.equal(receiptTextColumns(paper),columns);
    assert.equal(thermalReceiptSize(paper)?.graphicWidthMm,graphicWidth);
    assert.equal(layout.thermal,true); assert.equal(layout.landscape,false);
    const html = receiptHtml(receipt,options);
    assert(html.includes(`max-width:${width}mm`)); assert(html.includes("margin:0mm")); assert(html.includes("white-space:pre-wrap")); assert(html.includes("DOP 1,000.00"));
    const graphicHtml = receiptHtml(receipt,{paper,compact:false,output:"graphics"});
    assert(graphicHtml.includes(`max-width:${graphicWidth}mm`));
  }
});

test("sheet dimensions and orientation request exact physical pages without rotating or changing money", () => {
  const before = JSON.stringify(receipt);
  for(const [paper,width,height] of [["a4",210,297],["letter",215.9,279.4],["8x4",101.6,203.2],["8x11",203.2,279.4]] as const) {
    for(const orientation of ["portrait","landscape"] as const) {
      const layout = receiptPrintLayout({paper,orientation,compact:false});
      assert.equal(layout.pageSize,orientation === "portrait" ? `${width}mm ${height}mm` : `${height}mm ${width}mm`);
      assert.equal(layout.landscape,orientation === "landscape");
      const html = receiptHtml(receipt,{paper,orientation,compact:false});
      assert(html.includes(`size:${layout.pageSize}`)); assert(html.includes("DOP 1,000.00"));
    }
  }
  assert.equal(receiptPrintLayout({paper:"8x4",compact:false}).pageSize,"203.2mm 101.6mm");
  assert.equal(receiptPrintLayout({paper:"auto",compact:false}).pageSize,"auto");
  assert.equal(receiptPrintLayout({paper:"auto",orientation:"landscape",compact:false}).pageSize,"landscape");
  assert.equal(JSON.stringify(receipt),before);
});

test("custom dimensions are numeric, bounded and validated before opening a print window", () => {
  const options:ReceiptPrintOptions = {paper:"custom",customWidthMm:180,customHeightMm:90,orientation:"landscape",compact:false};
  assert.equal(receiptPrintLayout(options).pageSize,"180mm 90mm");
  for(const invalid of ["",0,-1,NaN,Infinity,49,321,"80mm;}body{display:none}"]) assert.throws(()=>receiptHtml(receipt,{...options,customWidthMm:invalid} as never));
  for(const invalid of ["",0,-1,NaN,Infinity,49,601]) assert.throws(()=>receiptHtml(receipt,{...options,customHeightMm:invalid} as never));
  for(const paper of ["constructor","__proto__","unknown","80;}body{display:none}"]) assert.throws(()=>receiptHtml(receipt,{...options,paper} as never));
  assert.throws(()=>receiptHtml(receipt,{...options,orientation:"injected"} as never));
  assert(Object.keys(receiptPaperLabels).includes("custom"));
});
