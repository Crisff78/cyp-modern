import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { parseImportCsv } from "../../client-admin/src/services/importCsv";
import { buildApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";

const header = "identificacion;servicio;importe\n";
const amountFile = (amount: string) => header + "CL-1;Servicio QA;" + amount;

test("CSV returns exact integer cents, preserving semantic row values", () => {
  const examples: Array<[string, number]> = [
    ["12", 1200], ["12.5", 1250], ["12.50", 1250], ["12,34", 1234],
    ["0.01", 1], ["00012.50", 1250], ["+12.50", 1250],
    ["0", 0], ["-12.50", -1250], ["10000000.01", 1_000_000_001],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
    ["-90071992547409.91", -Number.MAX_SAFE_INTEGER],
  ];
  for (const [decimal, cents] of examples) {
    const parsed = parseImportCsv(amountFile(decimal), "charges");
    assert.equal(parsed.filas[0].importe, cents, decimal);
    assert.ok(Number.isSafeInteger(parsed.filas[0].importe));
  }
});

test("CSV rejects malformed monetary text and excess decimals with location", () => {
  for (const amount of ["12oops34", "oops", "RD$ 12.50", "$12.50", "", "12 34",
    "1e3", "NaN", "Infinity", "--10", "12.3.4", "1,234.56", "1.234",
    "0.001", "10.075", ".50", "12."]) {
    assert.throws(() => parseImportCsv(amountFile(amount), "charges"),
      /CSV inválido\. Línea 2, columna \d+: El importe/, amount);
  }
});

test("CSV rejects unsafe cents before floating point conversion", () => {
  for (const amount of ["90071992547409.92", "90071992547409.93", "-90071992547409.92",
    "999999999999999999999999999999.99"]) {
    assert.throws(() => parseImportCsv(amountFile(amount), "charges"),
      /rango de enteros seguros/, amount);
  }
});

test("CSV recognizes reordered and accented headers without positional fallback", () => {
  assert.deepEqual(parseImportCsv(
    "\uFEFFimporte;identificación;requerido;servicio;fecha\r\n12,34;CL-1;sí;Servicio QA;2024-02-29\r\n",
    "charges"), {
    filas: [{ identificacion: "CL-1", servicio: "Servicio QA", importe: 1234,
      fecha: "2024-02-29", requerido: true }], lineas: 1,
  });
});

test("CSV preserves genuine headerless positional records", () => {
  assert.deepEqual(parseImportCsv("\nCL-1;servicio;12.50;2026-09-30;no\n", "charges"), {
    filas: [{ identificacion: "CL-1", servicio: "servicio", importe: 1250,
      fecha: "2026-09-30", requerido: false }], lineas: 1,
  });
  assert.deepEqual(parseImportCsv("CL-1;Entrega QA;8.00;;col-1", "payouts").filas,
    [{ identificacion: "CL-1", concepto: "Entrega QA", importe: 800, cobrador: "col-1" }]);
});

test("CSV preserves payout header mapping and exact cents", () => {
  assert.deepEqual(parseImportCsv(
    "cobrador;importe;concepto;identificacion\ncol-1;8.00;Entrega QA;CL-1", "payouts").filas,
    [{ identificacion: "CL-1", concepto: "Entrega QA", importe: 800, cobrador: "col-1" }]);
});

test("CSV headerless delimiter detection ignores punctuation in the service", () => {
  assert.deepEqual(parseImportCsv("CL-1;Servicio, uno, dos, tres;12.34", "charges").filas,
    [{ identificacion: "CL-1", servicio: "Servicio, uno, dos, tres", importe: 1234 }]);
  assert.deepEqual(parseImportCsv("CL-1,Servicio; uno; dos; tres,12.34", "charges").filas,
    [{ identificacion: "CL-1", servicio: "Servicio; uno; dos; tres", importe: 1234 }]);
});

test("CSV handles quoted separators, escaped quotes and decimal comma", () => {
  assert.deepEqual(parseImportCsv(
    'identificacion,servicio,importe,fecha,requerido\nCL-1,"QA, ""especial""","12,50",2026-09-30,true\n',
    "charges").filas, [{ identificacion: "CL-1", servicio: 'QA, "especial"',
      importe: 1250, fecha: "2026-09-30", requerido: true }]);
  assert.deepEqual(parseImportCsv('CL-1;"Servicio; especial";12.50', "charges").filas,
    [{ identificacion: "CL-1", servicio: "Servicio; especial", importe: 1250 }]);
});

test("CSV supports quoted multiline fields and preserves logical records", () => {
  assert.deepEqual(parseImportCsv('CL-1;"Servicio\r\nsegunda línea";1.01\r\n', "charges"),
    { filas: [{ identificacion: "CL-1", servicio: "Servicio\nsegunda línea", importe: 101 }], lineas: 1 });
});

test("CSV rejects unclosed, embedded and trailing malformed quotes", () => {
  for (const record of ['"CL-1;Servicio QA;12.50', 'CL-1;Servicio QA;"12.50',
    'CL-1;QA"incorrecto;12.50', 'CL-1;"Servicio QA"sobrante;12.50']) {
    assert.throws(() => parseImportCsv(header + record, "charges"),
      /CSV inválido\. Línea 2, columna \d+:/, record);
  }
});

test("CSV rejects incomplete, duplicated and unknown headers", () => {
  assert.throws(() => parseImportCsv("identificacion;importe\nCL-1;12.50", "charges"),
    /Línea 1, columna 1: Falta la columna obligatoria «servicio»/);
  assert.throws(() => parseImportCsv("servicio;importe\nServicio QA;12.50", "charges"),
    /Falta la columna obligatoria «identificacion»/);
  assert.throws(() => parseImportCsv(
    "identificacion;identificación;servicio;importe\nCL-1;CL-1;Servicio QA;12.50", "charges"), /repetida/);
  assert.throws(() => parseImportCsv(
    "identificacion;servicio;importe;desconocida\nCL-1;Servicio QA;12.50;x", "charges"), /cabecera desconocida/);
});

test("CSV rejects missing or extra columns instead of shifting or manufacturing fields", () => {
  for (const file of [
    header + "CL-1;Servicio QA",
    header + "CL-1;Servicio QA;12.50;extra",
    "CL-1;12.50",
    "CL-1;Servicio QA;12.50;;;;extra",
    header + "CL-1;;12.50",
    header + ";Servicio QA;12.50",
  ]) {
    assert.throws(() => parseImportCsv(file, "charges"), /CSV inválido/);
  }
});

test("CSV validates optional ISO calendar dates and nonempty required flags", () => {
  const dated = "identificacion;servicio;importe;fecha;requerido\n";
  for (const date of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-01",
    "2026-01-00", "30/09/2026", "not-a-date"]) {
    assert.throws(() => parseImportCsv(dated + "CL-1;Servicio QA;1.00;" + date + ";no", "charges"),
      /fecha/, date);
  }
  assert.throws(() => parseImportCsv(dated + "CL-1;Servicio QA;1.00;2026-09-30;maybe", "charges"),
    /requerido/);
  for (const flag of ["no", "false", "0"]) {
    assert.equal(parseImportCsv(dated + "CL-1;Servicio QA;1.00;2026-09-30;" + flag, "charges").filas[0].requerido, false);
  }
});

test("CSV rejects an entire file when a later structural row is malformed", () => {
  assert.throws(() => parseImportCsv(
    header + "CL-1;Servicio válido;12.50\nCL-1;Servicio inválido;12oops34\n", "charges"),
    /Línea 3, columna \d+: El importe/);
});

test("CSV handles empty files and complete header-only files without data", () => {
  assert.deepEqual(parseImportCsv("\uFEFF\r\n \t\r\n", "charges"), { filas: [], lineas: 0 });
  assert.deepEqual(parseImportCsv(header, "charges"), { filas: [], lineas: 0 });
});

test("CSV exact cents reach the real import API while business errors stay per row", async (t) => {
  const fixture = seed();
  fixture.charges = []; fixture.movements = []; fixture.idempotency = [];
  fixture.clients[0].code = "SINTETICO-CSV-REGRESION";
  const store = new MemoryStore(fixture);
  const app = await buildApp({ store, secret: "synthetic-csv-regression-only-secret",
    demo: true, origins: [], collectorUrl: "http://synthetic.invalid" });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login",
    payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } });
  assert.equal(login.statusCode, 200);
  const code = fixture.clients[0].code;
  const { filas } = parseImportCsv(header +
    code + ";Válido;12.50\n" +
    "SINTETICO-INEXISTENTE;Cliente ausente;1.00\n" +
    code + ";Negativo;-1.00\n" +
    code + ";Cero;0\n" +
    code + ";Fuera del límite;10000000.01\n", "charges");
  const response = await app.inject({ method: "POST", url: "/api/cargos/importar",
    headers: { authorization: "Bearer " + login.json().token, "idempotency-key": randomUUID() },
    payload: { filas } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().creados, 1);
  assert.deepEqual(response.json().errores.map((row: { fila: number }) => row.fila), [2, 3, 4, 5]);
  const state = await store.read();
  assert.equal(state.charges.length, 1);
  assert.equal(state.charges[0].amount, 1250);
  assert.equal(state.charges[0].service, "Válido");
  assert.equal(state.movements.length, 0);
});
