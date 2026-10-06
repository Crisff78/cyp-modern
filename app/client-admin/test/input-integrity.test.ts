import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { encodeCsvCell, neutralizeCsvFormula } from "../../shared/csv";
import { recurringDayFromInput } from "../../shared/recurringDays";
import { exportSections } from "../../shared/remittances/output";

test("CSV protects direct and whitespace-prefixed formulas, including control characters", () => {
  for (const prefix of ["", " ", "  ", "\t", "\r", "\n"]) for (const formula of ["=1+1", "+1+1", "-1+1", "@SUM(A1:A2)"]) {
    const value = prefix + formula;
    assert.equal(neutralizeCsvFormula(value), `'${value}`);
  }
  for (const value of ["\tTexto", "\rTexto", "\nTexto"]) assert.equal(neutralizeCsvFormula(value), `'${value}`);
  assert.equal(neutralizeCsvFormula("'=1+1"), "'=1+1");
});

test("CSV preserves legitimate text and escapes delimiters, quotes and multiline data", () => {
  for (const value of ["José O'Connor & Hijos", "Calle #2 / local B", "correo+ventas@example.com", "Saldo < 100", "100.25", "texto normal"]) assert.equal(encodeCsvCell(value), value);
  assert.equal(encodeCsvCell('Cliente; "Centro"'), '"Cliente; ""Centro"""');
  assert.equal(encodeCsvCell("Primera\nSegunda"), '"Primera\nSegunda"');
  assert.equal(encodeCsvCell("A,B", ","), '"A,B"');
  assert.equal(encodeCsvCell("Texto", ";", true), '"Texto"');
  assert.equal(encodeCsvCell("=1+1"), "'=1+1");
});

test("recurring form translates unused inputs to null and rejects non-strict numbers", () => {
  for (const value of ["", null, undefined]) assert.equal(recurringDayFromInput(value), null);
  for (const value of [1, 31, "1", "31", "01"]) assert.equal(recurringDayFromInput(value), Number(value));
  for (const value of [0, 32, 1.5, "abc", "1e1", "+1", "1.0", " 1", "001", " ", true, false, {}, []]) assert.throws(() => recurringDayFromInput(value));
});

test("the shared exporter downloads safe CSV with real data and unchanged quoting", async (t) => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  let blob: Blob | undefined, clicks = 0;
  const link = { href: "", download: "", click: () => { clicks += 1; } };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => link } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout: () => 0 } });
  URL.createObjectURL = (value) => { blob = value as Blob; return "blob:synthetic-integrity"; };
  URL.revokeObjectURL = () => {};
  t.after(() => {
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
  });
  exportSections("integridad", [{ title: "=Título", columns: ["Cliente", "Importe"], rows: [["  @SUM(A1)", "100.25"], ["José O'Connor", 200]] }]);
  assert.equal(clicks, 1);
  assert.equal(link.download, "integridad.csv");
  const csv = await blob!.text();
  assert.ok(csv.includes('"\'=Título"'));
  assert.ok(csv.includes('"\'  @SUM(A1)";"100.25"'));
  assert.ok(csv.includes('"José O\'Connor";"200"'));
});

test("App report CSV and XLS-compatible downloads use the shared formula protection", async () => {
  // Exercise the actual report download functions without mounting the entire ERP.
  const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = file.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && ["csvCell", "downloadReportTable"].includes(node.name?.text ?? ""));
  assert.equal(functions.length, 2);
  const code = ts.transpileModule(functions.map((node) => node.getText(file)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const format of ["1", "7"]) {
    let blob: Blob | undefined, clicks = 0;
    const link = { href: "", download: "", click: () => { clicks += 1; }, remove: () => {} };
    const download = runInNewContext(`${code}\ndownloadReportTable`, {
      encodeCsvCell, Blob,
      reportTableMatrix: () => [["Cliente", "Importe"], ["=1+1", "100.25"], ["  @SUM(A1)", "200.00"], ["José O'Connor", "300.00"]],
      document: { createElement: () => link, body: { appendChild: () => {} } },
      URL: { createObjectURL: (value: Blob) => { blob = value; return "blob:synthetic-report"; }, revokeObjectURL: () => {} },
      window: { setTimeout: () => 0 },
    });
    download(format, "Reporte de prueba", {});
    const csv = await blob!.text();
    assert.equal(clicks, 1);
    assert.equal(link.download, "reporte-de-prueba.csv");
    assert.ok(csv.includes("'=1+1;100.25"));
    assert.ok(csv.includes("'  @SUM(A1);200.00"));
    assert.ok(csv.includes("José O'Connor;300.00"));
  }
});
