import test from "node:test";
import assert from "node:assert/strict";
import { defaultReceiptPrintOptions, printedReceiptAudienceLabels, readSavedReceiptPrintOptions, receiptPrintLayout, receiptPaperLabels, saveReceiptPrintOptions, thermalReceiptSize, type ReceiptPrintOptions } from "../../shared/remittances/receiptPaper";
import { receiptHtml, type Receipt } from "../../shared/remittances/receipt";

const receipt:Receipt = {reference:"REC-PAPEL",date:"06/11/2026",status:"pending",issuer:{name:"Empresa Núñez",address:"",phone:"",email:"",footerNote:""},footer:"Conserve el recibo",sections:[{title:"Importes",columns:["Dato","Valor"],rows:[["Recibe el destinatario","DOP 1,000.00"]]}]};

test("two, three and four inch rolls keep readable type, zero extra @page margin and the drawing width of each roll", () => {
  assert.equal(defaultReceiptPrintOptions.paper, "80");
  // 17-11-2026: «Solo texto» is gone; every receipt prints with its design.
  assert.equal("output" in defaultReceiptPrintOptions, false);
  assert.match(receiptPaperLabels["80"], /3 pulgadas.*80 mm/);
  // CyP is for any company (13-11-2026): what people read never names the printer model of one office.
  for (const label of Object.values(receiptPaperLabels)) assert.doesNotMatch(label, /POS[\s-]?80/i);
  for(const [paper,width,graphicWidth] of [["51",45,42],["58",48,45],["76",70,63],["80",72,66],["102",96,92]] as const) {
    const options = {paper,compact:false}, layout = receiptPrintLayout(options);
    assert.equal(layout.widthMm,width); assert.equal(layout.marginMm,0); assert.equal("textColumns" in layout,false);
    assert.equal(thermalReceiptSize(paper)?.graphicWidthMm,graphicWidth);
    assert.equal(layout.thermal,true); assert.equal(layout.landscape,false);
    const html = receiptHtml(receipt,options);
    assert(html.includes(`max-width:${graphicWidth}mm`)); assert(html.includes("margin:0mm")); assert(html.includes("DOP 1,000.00")); assert(!html.includes("<pre"));
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
  assert.equal(printedReceiptAudienceLabels.sender, "Para quien envía (recibo de envío)");
  assert.equal(printedReceiptAudienceLabels.recipient, "Para quien recibe (recibo de recepción)");
  const memory = new Map<string, string>();
  const previousStorage = (globalThis as { localStorage?: Storage }).localStorage;
  try {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
    };
    saveReceiptPrintOptions({ paper: "a4", compact: false, audience: "recipient" });
    const rawSaved = memory.get("cyp.remittances.receiptPrintOptions") ?? "";
    assert(!rawSaved.includes("audience"), "window-specific audience must not overwrite saved printer hardware defaults");
    const restored = readSavedReceiptPrintOptions();
    assert.equal(restored.paper, "a4");
    assert.equal("output" in restored, false);
    assert.equal(restored.audience, undefined);
    // A browser that had «Solo texto» saved keeps its paper and prints with the design.
    memory.set("cyp.remittances.receiptPrintOptions", JSON.stringify({ paper: "58", compact: true, output: "text" }));
    assert.deepEqual(readSavedReceiptPrintOptions(), { paper: "58", compact: true });
    const printer = { paper: "custom", compact: true, orientation: "landscape", customWidthMm: 180, customHeightMm: 90 } as const;
    const storageKey = "cyp.remittances.receiptPrintOptions";
    for (const legacyFormat of [{ receiptFormat: "haiti" }, { recipientFormat: "haiti" }, { recipientFormat: "common", receiptFormat: "haiti" }] as const) {
      const legacyOptions = { ...printer, audience: "recipient", ...legacyFormat } as const;
      memory.set(storageKey, JSON.stringify(legacyOptions));
      assert.deepEqual(readSavedReceiptPrintOptions(), printer);
      saveReceiptPrintOptions(legacyOptions);
      assert.deepEqual(JSON.parse(memory.get(storageKey)!), printer);
    }
  } finally {
    (globalThis as { localStorage?: Storage }).localStorage = previousStorage;
  }
});
