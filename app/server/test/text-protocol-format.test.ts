import test from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../src/domain.js";
import {
  assertOneLine, clean, daysBetween, errorLine, invalid, isVersion, moneyText, namedParameters, okLine, parseDate, parseMoney, parsePage, percentText,
  protocolErrorOf, ProtocolError, protocolStamp, rawParameters, record, typedText, withoutVersion,
} from "../src/text-protocol.js";

const pin = (dato: string) => (error: unknown) => {
  assert.ok(error instanceof ProtocolError); assert.equal(error.code, "PIN"); assert.equal(error.dato, dato); return true;
};

test("the date and time are those of the Dominican Republic, also across midnight", () => {
  assert.equal(protocolStamp(new Date("2026-11-19T13:30:00Z")), "20261119093000");
  assert.equal(protocolStamp("2026-11-20T03:59:59.900Z"), "20261119235959");
  assert.equal(protocolStamp(new Date("2026-11-20T04:00:00Z")), "20261120000000");
  assert.equal(protocolStamp(undefined), "");
});

test("amounts, percentages, dates and pages are read and written as the document says", () => {
  assert.equal(moneyText(150000), "1500.00"); assert.equal(moneyText(5), "0.05"); assert.equal(moneyText(0), "0.00");
  assert.equal(moneyText(999999999999999), "9999999999999.99");
  assert.equal(parseMoney("1500.00"), 150000); assert.equal(parseMoney("0.05"), 5); assert.equal(parseMoney("9999999999999.99"), 999999999999999);
  for (const text of ["", "100", "100.5", "100.500", "1,500.00", "-1.00", "+1.00", " 1.00", "1.00 ", "1e3", ".50", "12345678901234.00", "1.0a"])
    assert.equal(parseMoney(text), undefined, text);
  assert.equal(percentText(500), "5.00"); assert.equal(percentText(1250), "12.50"); assert.equal(percentText(5), "0.05"); assert.equal(percentText(0), "0.00");
  assert.equal(parseDate("20261119"), "2026-11-19"); assert.equal(parseDate("20240229"), "2024-02-29");
  for (const text of ["", "2026-11-19", "20261301", "20260230", "2026111", "202611190", "abcdefgh"]) assert.equal(parseDate(text), undefined, text);
  assert.equal(daysBetween("2026-10-01", "2026-10-31"), 30); assert.equal(daysBetween("2026-11-19", "2026-11-19"), 0);
  assert.equal(parsePage(""), 1); assert.equal(parsePage("1"), 1); assert.equal(parsePage("250"), 250);
  assert.equal(parsePage("999999999"), 999999999, "a page past the end is only an empty page");
  for (const text of ["0", "01", "-1", "1.0", "a", " 2", "1234567890"]) assert.equal(parsePage(text), undefined, text);
});

test("a separator inside a piece of data never moves the fields", () => {
  assert.equal(clean("a|b!c;d@e"), "a b c d e"); assert.equal(clean("línea\r\nnueva\ttab"), "línea  nueva tab");
  assert.equal(clean(undefined), ""); assert.equal(clean("José Ñandú #12, 3-B"), "José Ñandú #12, 3-B");
  const lineSeparator = String.fromCharCode(0x2028), zeroWidth = String.fromCharCode(0x200b), rightToLeft = String.fromCharCode(0x200f);
  assert.equal(clean(`a${lineSeparator}b`), "a b");
  // What a person pasted: tabs and the marks that are not seen become spaces, and nothing else changes.
  assert.equal(typedText(`  TRF\t99${zeroWidth}812${rightToLeft} `), "TRF 99 812");
  assert.equal(typedText("Banco Popular (Ñ) #1; a|b"), "Banco Popular (Ñ) #1; a|b");
  assert.equal(record("id", "CLI;1", "Ana | Pérez", ""), "id;CLI 1;Ana   Pérez;");
  const now = new Date("2026-11-19T13:30:00Z");
  assert.equal(okLine(now), "OK|20261119093000");
  assert.equal(okLine(now, "0", "a;b!c;d"), "OK|20261119093000|0|a;b!c;d");
  assert.equal(errorLine(now, new ProtocolError("CNA")), "ER|20261119093000|CNA|No tiene abierta su Caja de Remesas|");
  assert.equal(errorLine(now, new ProtocolError("CNE", undefined, "0a1b")), "ER|20261119093000|CNE|Cliente no encontrado|0a1b");
  assert.equal(errorLine(now, new ProtocolError("PIN", "malo | peor", "a;b")).split("|").length, 5);
});

test("GET is decoded whole and then split; POST is taken as it comes", () => {
  assert.equal(rawParameters("GET", "/cyp_clients?idSesion|perez", undefined), "idSesion|perez");
  assert.equal(rawParameters("GET", "/cyp_clients?idSesion%7CJos%C3%A9%20P%C3%A9rez%7C2", undefined), "idSesion|José Pérez|2");
  assert.equal(rawParameters("GET", "/cyp_clients?a+b|c?d", undefined), "a+b|c?d");
  assert.equal(rawParameters("GET", "/cyp_logout", undefined), "");
  assert.throws(() => rawParameters("GET", "/cyp_clients?idSesion|%E0%A4%A", undefined), pin("Parametros"));
  assert.equal(rawParameters("POST", "/cyp_clients?ignorado", "idSesion|a%20b+c"), "idSesion|a%20b+c");
  assert.equal(rawParameters("POST", "/cyp_clients", undefined), "");
});

test("parameters get their names; one too many or a line break is PIN with its name", () => {
  assert.deepEqual(namedParameters("clients", ["s"]), { idSesion: "s", Texto: "", Pagina: "", Lado: "" });
  assert.deepEqual(namedParameters("clients", ["s", "", "2"]), { idSesion: "s", Texto: "", Pagina: "2", Lado: "" });
  assert.throws(() => namedParameters("clients", ["s", "", "", "", ""]), pin("Parametros"));
  assert.throws(() => assertOneLine("client", ["s", "id\ncon salto"]), pin("idCliente"));
  assert.throws(() => assertOneLine("clients", ["sesion\r\n"]), pin("idSesion"));
  assert.throws(() => assertOneLine("logout", ["s", "de más\n"]), pin("Parametros"));
  assert.throws(() => assertOneLine("recs", ["s", "", "", "", `1${String.fromCharCode(0x2029)}`]), pin("Pagina"));
  assert.doesNotThrow(() => assertOneLine("clients", ["s", "con\ttabulador", "1"]));
  assert.equal(Object.keys(namedParameters("send", Array.from({ length: 16 }, () => ""))).length, 16);
  assert.throws(() => namedParameters("send", Array.from({ length: 15 }, () => "")), pin("Parametros"));
  assert.throws(() => namedParameters("send", Array.from({ length: 17 }, () => "")), pin("Parametros"));
});

test("each failure gets its code; an unknown one is left for EIC", () => {
  const code = (error: unknown) => protocolErrorOf(error)?.code;
  for (const [domain, protocol] of [["SESSION_EXPIRED", "SNA"], ["INVALID_CREDENTIALS", "UCI"], ["COLLECTOR_INACTIVE", "CBI"], ["OPERATOR_INACTIVE", "CBI"],
    ["FORBIDDEN", "SPE"], ["PERMISSION_REQUIRED", "SPE"], ["ACCESS_REVOKED", "SPE"], ["OPERATOR_FORBIDDEN", "SPE"],
    ["CLIENT_NOT_FOUND", "CNE"], ["CLIENT_INACTIVE", "CIN"], ["SAME_CLIENT", "MCL"], ["RATE_MISSING", "TNE"], ["AMOUNT_TOO_SMALL", "MIN"], ["INVALID_AMOUNT", "MIN"],
    ["QUOTE_CHANGED", "CCA"], ["CASH_NOT_OPEN", "CNA"], ["INSUFFICIENT_TENDERED", "EIS"], ["PAYMENT_NOT_VERIFIED", "PNV"]]) {
    const error = protocolErrorOf(new DomainError(domain, "texto de la web, de tú"));
    assert.equal(error?.code, protocol, domain); assert.notEqual(error?.message, "texto de la web, de tú", "its own message, not the one of the web");
  }
  // A rule without a code of its own: ORC, never EIC (the application would repeat) nor PIN (no parameter is wrong).
  const configuration = protocolErrorOf(new DomainError("COMMISSION_EXCEEDS_TOTAL", "Un administrador debe revisar la configuración."));
  assert.equal(configuration?.code, "ORC"); assert.match(configuration!.message, /Avise al Administrador$/); assert.equal(configuration?.dato, "");
  const unforeseen = protocolErrorOf(new DomainError("REGLA_NUEVA", "Una regla que hoy no existe."));
  assert.equal(unforeseen?.code, "ORC"); assert.equal(unforeseen?.message, "Una regla que hoy no existe.");
  const range = protocolErrorOf(new DomainError("MONEY_RANGE", "El importe excede el rango monetario permitido."));
  assert.equal(range?.code, "PIN"); assert.equal(range?.dato, "Monto");
  assert.equal(protocolErrorOf(new DomainError("INVALID_PAYMENT", "x"))?.dato, "idForma_Pago");
  assert.equal(code(Object.assign(new Error("x"), { statusCode: 415 })), "PIN");
  assert.equal(code(Object.assign(new Error("x"), { statusCode: 429 })), "DML");
  assert.equal(code(Object.assign(new Error("x"), { statusCode: 413 })), "PIN");
  assert.equal(code(new Error("la base no responde")), undefined);
  assert.equal(code(invalid("Monto")), "PIN");
});

test("p= before the data of a GET is the habit of the other party's application: with it or without it, the same petition", () => {
  assert.equal(rawParameters("GET", "/cyp_clients?p=idSesion|perez", undefined), "idSesion|perez");
  assert.equal(rawParameters("GET", "/cyp_clients?p=idSesion%7CJuan%20P%C3%A9rez", undefined), "idSesion|Juan Pérez");
  assert.equal(rawParameters("GET", "/cyp_login?p=usuario|clave|3.0", undefined), "usuario|clave|3.0");
  assert.equal(rawParameters("GET", "/cyp_clients?p=", undefined), "");
  // Only a literal, lower-case p= right after the ? is the prefix. What follows it is all data, an & too.
  assert.equal(rawParameters("GET", "/cyp_clients?P=idSesion", undefined), "P=idSesion");
  assert.equal(rawParameters("GET", "/cyp_clients?p%3DidSesion", undefined), "p=idSesion");
  assert.equal(rawParameters("GET", "/cyp_clients?p=a|b&x=y", undefined), "a|b&x=y");
  assert.equal(rawParameters("GET", "/cyp_clients?p=p=raro|x", undefined), "p=raro|x");
  // In a body the data go as they are: with the prefix it would be read as a wrong user or a wrong session.
  assert.throws(() => rawParameters("POST", "/cyp_login", "p=usuario|clave"), pin("Parametros"));
  assert.equal(rawParameters("POST", "/cyp_login", "usuario|p=clave"), "usuario|p=clave");
});

test("the version of the application after the last datum is taken away, and only when it is one datum more", () => {
  for (const value of ["3.0", "1.14", "10.2.1", "100.00", "0.10"]) assert.ok(isVersion(value), value);
  for (const value of ["3", "3.", ".0", "v3.0", "3.0.0.0", "809.555.0100", "1500.00", "20261120", "cli-1", "", " 3.0", "3,0"]) assert.ok(!isVersion(value), value);
  // Optional data left out, all of them sent, and the session alone.
  assert.deepEqual(withoutVersion("clients", ["s", "perez", "3.0"]), ["s", "perez"]);
  assert.deepEqual(withoutVersion("clients", ["s", "perez", "2", "0", "3.0"]), ["s", "perez", "2", "0"]);
  assert.deepEqual(withoutVersion("logout", ["s", "3.0"]), ["s"]);
  assert.deepEqual(withoutVersion("recs", ["s", "3.0"]), ["s"]);
  assert.deepEqual(withoutVersion("client", ["s", "cli-1", "3.0"]), ["s", "cli-1"]);
  // The data a petition cannot go without are never the version: an amount is written as one.
  assert.deepEqual(withoutVersion("quote", ["s", "USD", "DOP", "100.00"]), ["s", "USD", "DOP", "100.00"]);
  assert.deepEqual(withoutVersion("quote", ["s", "USD", "DOP", "100.00", "3.0"]), ["s", "USD", "DOP", "100.00"]);
  assert.deepEqual(withoutVersion("quote", ["s", "USD", "DOP", "100.00", "1", "3.0"]), ["s", "USD", "DOP", "100.00", "1"]);
  assert.deepEqual(withoutVersion("client", ["s", "3.0"]), ["s", "3.0"]);
  assert.deepEqual(withoutVersion("logout", ["3.0"]), ["3.0"]);
  // Registrar Envío: sixteen data always, so the version can only be the seventeenth. A Nota that is a number stays.
  const sixteen = Array.from({ length: 16 }, (_value, index) => index === 15 ? "150.00" : "x");
  assert.deepEqual(withoutVersion("send", sixteen), sixteen);
  assert.deepEqual(withoutVersion("send", [...sixteen, "3.0"]), sixteen);
  // Entregar Envío: four data always, so 980.00 in last place is the amount. Envíos por Entregar: the session alone.
  assert.deepEqual(withoutVersion("pay", ["s", "operacion", "ENV00000001", "980.00"]), ["s", "operacion", "ENV00000001", "980.00"]);
  assert.deepEqual(withoutVersion("pay", ["s", "operacion", "ENV00000001", "980.00", "3.0"]), ["s", "operacion", "ENV00000001", "980.00"]);
  assert.deepEqual(withoutVersion("pend", ["s", "3.0"]), ["s"]);
  // Listado de Monedas and Tasas Vigentes: the session alone is enough, and a currency is never taken for a version.
  assert.deepEqual(withoutVersion("currencies", ["s", "3.0"]), ["s"]);
  assert.deepEqual(withoutVersion("rates", ["s", "USD", "3.0"]), ["s", "USD"]);
  assert.deepEqual(withoutVersion("rates", ["s", "USD"]), ["s", "USD"]);
  assert.deepEqual(withoutVersion("rates", ["s", "", "3.0"]), ["s", ""]);
  assert.deepEqual(withoutVersion("pend", ["s", "perez", "2", "3.0"]), ["s", "perez", "2"]);
  // What is not shaped as a version is left: one datum too many is still PIN.
  assert.deepEqual(withoutVersion("clients", ["s", "perez", "1", "0", "de más"]), ["s", "perez", "1", "0", "de más"]);
  assert.throws(() => namedParameters("clients", withoutVersion("clients", ["s", "perez", "1", "0", "de más"])), pin("Parametros"));
});
