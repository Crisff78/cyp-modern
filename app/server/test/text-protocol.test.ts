import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import { businessDate, hashPassword, type State, type User } from "../src/domain.js";
import { DEMO_PASSWORD } from "../src/demo-credentials.js";
import { DEMO_CASHIER_EMAIL, enrichCashierDemo } from "../src/demo-cashier-scenarios.js";
import { cashBalance, closeRemittanceCash, openRemittanceCash, setCommissionPolicy, setDailyRate } from "../src/remittances.js";

// Synthetic data only. The figures are those of the example of the document: 5 % of commission, 2 % of delivery
// charge and the dollar bought at 59.25.
const admin: User = { id: "demo-admin", name: "Administración", role: "admin" };
const operators: User[] = [admin, { id: "demo-collector", name: "Cobrador", role: "collector", collectorId: "col-1" }];
const secret = "synthetic-text-protocol-secret-for-isolated-tests";
const account = (id: string, email: string, role: User["role"], password = DEMO_PASSWORD) => {
  const at = new Date().toISOString();
  return { id, name: `Cuenta ${id}`, email, role, ...hashPassword(password), credentialVersion: 1, status: "active" as const, createdAt: at, updatedAt: at };
};
function fixture() {
  const state = seed(), now = new Date(), date = businessDate(now);
  enrichCashierDemo(state, now);
  state.accounts.push(account("sup-1", "supervisora@cyp.local", "supervisor"), account("cli-user", "cliente@cyp.local", "client"),
    account("pipes", "pipes@cyp.local", "cashier", "Clave|con!pipes;y@signos 2026"));
  setCommissionPolicy(state, admin, { transactionCommissionBps: 500, managerCommissionBps: 0, deliveryCommissionBps: 200 }, now);
  setDailyRate(state, admin, { currency: "USD", rate: "59.25", purchaseRate: "59.25", saleRate: "60.00", date }, now);
  for (const operatorId of ["demo-admin", "demo-collector", "demo-cashier"])
    openRemittanceCash(state, admin, { operatorId, currency: "USD", openingAmount: 0 }, operators, now);
  Object.assign(state.clients.find((row) => row.id === "cli-2")!, { identification: "001-1234567-8", cellular: "8295550111", address: "Calle 5 #12, Santiago" });
  return state;
}
async function open(state = fixture(), demoAccess?: { code: string; origin: string }) {
  const store = new MemoryStore(state);
  const app = await buildApp({ store, demo: true, secret, origins: [], collectorUrl: "http://127.0.0.1:5174", ...(demoAccess ? { publicWeb: true, demoAccess } : {}) });
  type Reply = { statusCode: number; headers: Record<string, unknown>; body: string };
  const check = (reply: Reply) => {
    assert.equal(reply.statusCode, 200, reply.body);
    assert.equal(reply.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(reply.headers["cache-control"], "no-store");
    assert.ok(!/[\r\n]/.test(reply.body), "one line, no line break at the end");
    assert.match(reply.body, /^(OK|ER)\|\d{14}(\||$)/);
    return reply.body.split("|");
  };
  const post = async (command: string, body: string, headers: Record<string, string> = {}) =>
    check(await app.inject({ method: "POST", url: `/cyp_${command}`, payload: body, headers: { "content-type": "text/plain; charset=utf-8", ...headers } }));
  const get = async (command: string, parameters = "", headers: Record<string, string> = {}) =>
    check(await app.inject({ method: "GET", url: `/cyp_${command}${parameters ? `?${parameters}` : ""}`, headers }));
  const login = async (user: string, password = DEMO_PASSWORD) => {
    const parts = await post("login", `${user}|${password}`);
    assert.equal(parts[0], "OK", parts.join("|"));
    return parts[2];
  };
  return { app, store, post, get, login };
}
/** ER with its five parts, the code and the Dato. */
const er = (parts: string[], code: string, dato = "") => {
  assert.equal(parts.length, 5, parts.join("|")); assert.equal(parts[0], "ER"); assert.equal(parts[2], code, parts.join("|"));
  assert.ok(parts[3].length > 0, "a message to show"); assert.equal(parts[4], dato);
};
const fields = (group: string) => group.split(";");
type Send = { idOperacion: string; idRemitente: string; idDestinatario: string; idMonedaOrigen: string; idMonedaDestino: string; Monto: string; Modo: string;
  TotalAPagar: string; MontoARecibir: string; idForma_Pago: string; Recibido: string; Referencia: string; Banco: string; Verificado: string; Nota: string };
const sendBody = (token: string, change: Partial<Send> = {}) => {
  const v: Send = { idOperacion: randomUUID(), idRemitente: "cli-1", idDestinatario: "cli-5", idMonedaOrigen: "USD", idMonedaDestino: "DOP", Monto: "100.00", Modo: "0",
    TotalAPagar: "105.00", MontoARecibir: "5806.50", idForma_Pago: "1", Recibido: "120.00", Referencia: "", Banco: "", Verificado: "", Nota: "", ...change };
  return [token, v.idOperacion, v.idRemitente, v.idDestinatario, v.idMonedaOrigen, v.idMonedaDestino, v.Monto, v.Modo, v.TotalAPagar, v.MontoARecibir,
    v.idForma_Pago, v.Recibido, v.Referencia, v.Banco, v.Verificado, v.Nota].join("|");
};

test("login: only POST, the password keeps its separators and each role gets its two permissions", async () => {
  const { app, post, get } = await open();
  try {
    er(await get("login", "admin@cyp.local|x"), "PIN", "Parametros");
    const ok = await post("login", `admin@cyp.local|${DEMO_PASSWORD}`);
    assert.equal(ok.length, 4); assert.equal(ok[0], "OK");
    assert.match(ok[2], /^[A-Za-z0-9._-]{100,1000}$/, "idSesion: letters, digits, dot, hyphen and underscore");
    assert.deepEqual(fields(ok[3]), ["demo-admin", "Administración", "admin", "1", "1"]);
    assert.deepEqual(fields((await post("login", `  ${DEMO_CASHIER_EMAIL.toUpperCase()} |${DEMO_PASSWORD}`))[3]), ["demo-cashier", "Cajero de práctica", "cashier", "1", "1"]);
    assert.deepEqual(fields((await post("login", `supervisora@cyp.local|${DEMO_PASSWORD}`))[3]), ["sup-1", "Cuenta sup-1", "supervisor", "0", "1"]);
    assert.deepEqual(fields((await post("login", `cliente@cyp.local|${DEMO_PASSWORD}`))[3]), ["cli-user", "Cuenta cli-user", "client", "0", "0"]);
    assert.equal((await post("login", "pipes@cyp.local|Clave|con!pipes;y@signos 2026"))[0], "OK");
  } finally { await app.close(); }
});

test("login: wrong or missing data", async () => {
  const { app, post } = await open();
  try {
    er(await post("login", "admin@cyp.local|otra clave"), "UCI");
    er(await post("login", "nadie@cyp.local|x"), "UCI");
    er(await post("login", "admin@cyp.local|"), "PIN", "Clave");
    er(await post("login", "admin@cyp.local"), "PIN", "Clave");
    er(await post("login", `|${DEMO_PASSWORD}`), "PIN", "Usuario");
    er(await post("login", ""), "PIN", "Usuario");
    er(await post("login", `admin@cyp.local|${DEMO_PASSWORD}\n`), "PIN", "Clave");
    er(await post("login", `${"a".repeat(201)}|x`), "PIN", "Usuario");
  } finally { await app.close(); }
});

test("login: ten a minute from one address, then DML, still with HTTP 200", async () => {
  const { app, post } = await open();
  try {
    for (let attempt = 0; attempt < 10; attempt++) er(await post("login", "admin@cyp.local|mala"), "UCI");
    er(await post("login", `admin@cyp.local|${DEMO_PASSWORD}`), "DML");
  } finally { await app.close(); }
});

test("the general limit answers DML in the format of the protocol", async () => {
  const { app, get } = await open();
  try {
    for (let request = 0; request < 120; request++) er(await get("noexiste"), "PNE");
    er(await get("noexiste"), "DML");
  } finally { await app.close(); }
});

test("session: missing, broken, expired and closed sessions; an unknown command", async () => {
  const { app, post, get, login } = await open();
  try {
    er(await get("clients"), "PIN", "idSesion");
    er(await post("clients", ""), "PIN", "idSesion");
    er(await post("clients", "una-sesion\n"), "PIN", "idSesion");
    er(await post("recs", "una-sesion|20260101\r\n"), "PIN", "FechaInicial");
    er(await get("clients", "esto-no-es-una-sesion"), "SNE");
    er(await get("clients", "a.b.c|perez"), "SNE");
    const expired = app.jwt.sign({ id: "demo-admin", name: "Administración", role: "admin", exp: Math.floor(Date.now() / 1000) - 60 });
    er(await get("clients", expired), "SNA");
    er(await get("cuadre", "x"), "PNE");
    er(await post("LOGIN", `admin@cyp.local|${DEMO_PASSWORD}`), "PNE");
    const token = await login("admin@cyp.local");
    assert.equal((await get("clients", token))[0], "OK");
    er(await get("logout", `${token}|sobra`), "PIN", "Parametros");
    assert.deepEqual((await get("logout", token)).length, 2, "OK|FechayHora");
    er(await get("clients", token), "SNA");
    er(await post("logout", token), "SNA");
  } finally { await app.close(); }
});

test("clients: what is searched, by pages of 100, in order, and the side of the send for a collector", async () => {
  const state = fixture();
  const first = state.clients[0];
  for (let index = 0; index < 150; index++)
    state.clients.push({ ...first, id: `pag-${String(index).padStart(3, "0")}`, code: `PAG-${String(index).padStart(3, "0")}`, name: `Paginado ${String(149 - index).padStart(3, "0")}`, routeId: "route-2" });
  state.clients.push({ ...first, id: "sep", code: "SEP;1", name: "Ana | Pérez; hija @ casa", routeId: "route-1" }, { ...first, id: "inactivo", code: "INA-1", name: "Paginado inactivo", active: false });
  const { app, post, get, login } = await open(state);
  try {
    const token = await login("admin@cyp.local");
    const one = await get("clients", `${token}|paginado`);
    assert.equal(one[2], "1"); assert.equal(one[3].split("!").length, 100);
    assert.deepEqual(fields(one[3].split("!")[0]), ["pag-149", "PAG-149", "Paginado 000"], "by name, not by code or id");
    const two = await get("clients", `${token}|paginado|2`);
    assert.equal(two[2], "0"); assert.equal(two[3].split("!").length, 50);
    assert.deepEqual(fields(two[3].split("!").at(-1)!), ["pag-000", "PAG-000", "Paginado 149"]);
    er(await get("clients", `${token}|paginado|3`), "CNE");
    er(await get("clients", `${token}|nadie se llama así`), "CNE");
    const all = await get("clients", token);
    assert.equal(all[2], "1"); assert.equal(all[3].split("!").length, 100);
    assert.equal((await get("clients", `${token}||2`))[3].split("!").length, 59, "8 of the seed, 150 and one with separators, less the first 100");
    // A separator inside a name never moves the fields of the answer.
    const separators = await get("clients", `${token}|hija`);
    assert.equal(separators.length, 4); assert.deepEqual(fields(separators[3]), ["sep", "SEP 1", "Ana   Pérez  hija   casa"]);
    // Accents and capitals do not matter; the identification is found with or without hyphens; a phone, only with digits.
    for (const text of ["MARIA rodriguez", "001-1234567-8", "00112345678", "8295550111", "CL-0002"])
      assert.deepEqual(fields((await get("clients", `${token}|${encodeURIComponent(text)}`))[3]).slice(0, 2), ["cli-2", "CL-0002"], text);
    // GET: the pipe may come encoded, and a plus sign is a plus sign.
    assert.deepEqual(fields((await get("clients", `${token}%7CMar%C3%ADa%20Rodr%C3%ADguez%7C1%7C1`))[3])[0], "cli-2");
    er(await get("clients", `${token}|Maria+Rodriguez`), "CNE");
    assert.deepEqual(fields((await post("clients", `${token}|María Rodríguez`))[3])[0], "cli-2", "POST: the body as it comes");
    er(await get("clients", `${token}|x|0`), "PIN", "Pagina");
    er(await get("clients", `${token}|x|1|2`), "PIN", "Lado");
    er(await get("clients", `${token}|x|1|0|`), "PIN", "Parametros");
    er(await get("clients", `${token}|${"x".repeat(161)}`), "PIN", "Texto");
    er(await get("clients", `${token}|%0Aperez`), "PIN", "Texto");
    er(await get("clients", `${token}|%E0%A4%A`), "PIN", "Parametros");
    // A collector chooses the sender among the clients of his route and the recipient among all.
    const collector = await login("collector@cyp.local");
    const own = (await get("clients", `${collector}|cl-000`))[3].split("!").map((row) => fields(row)[0]);
    assert.deepEqual(own, ["cli-1", "cli-4", "cli-2", "cli-3"]);
    assert.equal((await get("clients", `${collector}|cl-000|1|1`))[3].split("!").length, 8);
    er(await get("clients", await login("supervisora@cyp.local")), "SPE");
    er(await get("clients", await login("cliente@cyp.local")), "SPE");
  } finally { await app.close(); }
});

test("client: the eight fields, and CNE, CIN and CFR with the idCliente", async () => {
  const state = fixture();
  state.clients.push({ ...state.clients[0], id: "inactivo", code: "INA-1", name: "Inactivo", active: false }, { ...state.clients[5], id: "euros", code: "EUR-1", name: "Con moneda", preferredCurrency: "EUR" });
  const { app, get, login } = await open(state);
  try {
    const token = await login("admin@cyp.local");
    const ok = await get("client", `${token}|cli-2`);
    assert.equal(ok.length, 3);
    assert.deepEqual(fields(ok[2]), ["cli-2", "CL-0002", "María Rodríguez", "001-1234567-8", "8095550100", "8295550111", "Calle 5 #12, Santiago", "DOP"]);
    assert.equal(fields((await get("client", `${token}|euros|1`))[2])[7], "EUR");
    assert.equal(fields((await get("client", `${token}|cli-1`))[2]).length, 8, "empty fields keep their place");
    er(await get("client", `${token}|no-existe`), "CNE", "no-existe");
    er(await get("client", `${token}|inactivo`), "CIN", "inactivo");
    er(await get("client", token), "PIN", "idCliente");
    er(await get("client", `${token}|cli-2|3`), "PIN", "Lado");
    er(await get("client", `${token}|${"x".repeat(81)}`), "PIN", "idCliente");
    const collector = await login("collector@cyp.local");
    er(await get("client", `${collector}|cli-5`), "CFR", "cli-5");
    er(await get("client", `${collector}|cli-5|0`), "CFR", "cli-5");
    assert.equal((await get("client", `${collector}|cli-5|1`))[0], "OK");
  } finally { await app.close(); }
});

test("quote: the example of the document, asked in its three ways", async () => {
  const { app, post, get, login } = await open();
  try {
    const token = await login(DEMO_CASHIER_EMAIL);
    const example = "100.00;5.00;105.00;5806.50;5.00;118.50;59.250000;1.000000";
    const ok = await get("quote", `${token}|USD|DOP|100.00`);
    assert.equal(ok.length, 3); assert.equal(ok[2], example);
    assert.equal((await get("quote", `${token}|USD|DOP|100.00|0`))[2], example);
    assert.equal((await get("quote", `${token}|USD|DOP|105.00|1`))[2], example);
    assert.equal((await get("quote", `${token}|USD|DOP|5806.50|2`))[2], example);
    assert.equal((await post("quote", `${token}|USD|DOP|100.00`))[2], example);
    // Dollars to dollars: bought at 59.25 and sold at 60.00.
    assert.deepEqual(fields((await get("quote", `${token}|USD|USD|100.00`))[2]).slice(6), ["59.250000", "60.000000"]);
    assert.deepEqual(fields((await get("quote", `${token}|DOP|DOP|1000.00`))[2]), ["1000.00", "50.00", "1050.00", "980.00", "5.00", "20.00", "1.000000", "1.000000"]);
    er(await get("quote", `${token}|EUR|DOP|100.00`), "TNE");
    er(await get("quote", `${token}|USD|DOP|0.00`), "MIN");
    er(await get("quote", `${token}|DOP|USD|0.10`), "MIN");
    for (const amount of ["100", "100.5", "100,00", "-100.00", "1e2"]) er(await get("quote", `${token}|USD|DOP|${amount}`), "PIN", "Monto");
    er(await get("quote", `${token}|USD|DOP`), "PIN", "Monto");
    er(await get("quote", `${token}|usd|DOP|100.00`), "PIN", "idMonedaOrigen");
    er(await get("quote", `${token}|USD|1|100.00`), "PIN", "idMonedaDestino");
    er(await get("quote", `${token}|USD|DOP|100.00|3`), "PIN", "Modo");
    er(await get("quote", await login("supervisora@cyp.local") + "|USD|DOP|100.00"), "SPE");
  } finally { await app.close(); }
});

test("send: cash with change, a transfer, and the same idOperacion never registers twice", async () => {
  const { app, store, post, get, login } = await open();
  try {
    const token = await login(DEMO_CASHIER_EMAIL);
    er(await get("send", sendBody(token)), "PIN", "Parametros");
    const body = sendBody(token, { Nota: "Envío de prueba" });
    const ok = await post("send", body);
    assert.equal(ok.length, 3);
    const envio = fields(ok[2]);
    assert.equal(envio.length, 10);
    assert.match(envio[0], /^[0-9a-f-]{36}$/); assert.equal(envio[1], "ENV00000001"); assert.equal(envio[2], "REC00000001");
    assert.match(envio[3], /^[0-9A-F]{16}$/); assert.match(envio[4], /^\d{14}$/);
    assert.deepEqual(envio.slice(5), ["100.00", "5.00", "105.00", "5806.50", "15.00"]);
    const saved = (await store.read()).remittances.transfers;
    assert.equal(saved.length, 1); assert.equal(saved[0].sendingUserId, "demo-cashier"); assert.equal(saved[0].note, "Envío de prueba");
    assert.equal(saved[0].payment?.method, "cash"); assert.equal(saved[0].payment?.tenderedAmount, 12000); assert.equal(saved[0].payment?.changeAmount, 1500);

    // The same petition again, also with another session of the same user: the same send, and still only one.
    assert.equal((await post("send", body))[2], ok[2]);
    const again = await login(DEMO_CASHIER_EMAIL);
    assert.equal((await post("send", [again, ...body.split("|").slice(1)].join("|")))[2], ok[2]);
    assert.equal((await store.read()).remittances.transfers.length, 1);
    // The same idOperacion with other data: the send was already registered, and the Dato says which one.
    const idOperacion = body.split("|")[1];
    er(await post("send", sendBody(token, { idOperacion, Nota: "otra nota" })), "OPD", "ENV00000001");
    er(await post("send", sendBody(token, { idOperacion, Monto: "200.00", TotalAPagar: "210.00", MontoARecibir: "11613.00" })), "OPD", "ENV00000001");
    // Another user may use the same idOperacion: it is his own.
    const other = await login("admin@cyp.local");
    assert.equal(fields((await post("send", sendBody(other, { idOperacion })))[2])[1], "ENV00000002");

    const transfer = fields((await post("send", sendBody(token, { idForma_Pago: "3", Recibido: "", Referencia: "TRF99812", Banco: "Banco Popular", Verificado: "1" })))[2]);
    assert.deepEqual(transfer.slice(1, 3), ["ENV00000003", "REC00000003"]); assert.equal(transfer[9], "0.00");
    const deposit = fields((await post("send", sendBody(token, { idForma_Pago: "4", Recibido: "", Referencia: "DEP-1", Verificado: "1", Modo: "2", Monto: "5806.50" })))[2]);
    assert.deepEqual(deposit.slice(5), ["100.00", "5.00", "105.00", "5806.50", "0.00"]);
    const exact = fields((await post("send", sendBody(token, { Recibido: "", Modo: "1", Monto: "105.00" })))[2]);
    assert.deepEqual(exact.slice(5), ["100.00", "5.00", "105.00", "5806.50", "0.00"]);
    const stored = (await store.read()).remittances.transfers;
    assert.deepEqual(stored.map((row) => row.payment?.method), ["cash", "cash", "transfer", "deposit", "cash"]);
    assert.equal(stored[2].payment?.reference, "TRF99812"); assert.equal(stored[2].payment?.bank, "Banco Popular");
  } finally { await app.close(); }
});

test("send: each error of the document, and a failed attempt leaves the idOperacion free", async () => {
  const state = fixture();
  state.clients.push({ ...state.clients[0], id: "inactivo", code: "INA-1", name: "Inactivo", active: false });
  const { app, store, post, login } = await open(state);
  try {
    const token = await login(DEMO_CASHIER_EMAIL);
    const send = (change: Partial<Send> = {}, session = token) => post("send", sendBody(session, change));
    er(await post("send", sendBody(token).split("|").slice(0, 15).join("|")), "PIN", "Parametros");
    er(await post("send", `${sendBody(token)}|`), "PIN", "Parametros");
    er(await send({ idOperacion: "corto" }), "PIN", "idOperacion");
    er(await send({ idOperacion: "con espacios y más" }), "PIN", "idOperacion");
    er(await send({ idRemitente: "" }), "PIN", "idRemitente");
    er(await send({ idMonedaDestino: "PESO" }), "PIN", "idMonedaDestino");
    er(await send({ Monto: "100" }), "PIN", "Monto");
    er(await send({ Modo: "" }), "PIN", "Modo");
    er(await send({ TotalAPagar: "" }), "PIN", "TotalAPagar");
    er(await send({ MontoARecibir: "5806.5" }), "PIN", "MontoARecibir");
    er(await send({ idForma_Pago: "2" }), "PIN", "idForma_Pago");
    er(await send({ idForma_Pago: "" }), "PIN", "idForma_Pago");
    er(await send({ Recibido: "120" }), "PIN", "Recibido");
    er(await send({ Referencia: "no va con efectivo" }), "PIN", "Referencia");
    er(await send({ Verificado: "1" }), "PIN", "Verificado");
    er(await send({ idForma_Pago: "3", Referencia: "TRF-1", Verificado: "1" }), "PIN", "Recibido");
    er(await send({ idForma_Pago: "3", Recibido: "", Verificado: "1" }), "PIN", "Referencia");
    er(await send({ idForma_Pago: "4", Recibido: "", Referencia: "DEP-1", Verificado: "sí" }), "PIN", "Verificado");
    er(await send({ idForma_Pago: "4", Recibido: "", Referencia: "DEP-1", Banco: "x".repeat(161), Verificado: "1" }), "PIN", "Banco");
    er(await send({ Nota: "x".repeat(2001) }), "PIN", "Nota");
    er(await post("send", `${sendBody(token)}\n`), "PIN", "Nota");

    er(await send({ idDestinatario: "cli-1" }), "MCL");
    er(await send({ idRemitente: "no-existe" }), "CNE", "no-existe");
    er(await send({ idDestinatario: "no-existe" }), "CNE", "no-existe");
    er(await send({ idDestinatario: "inactivo" }), "CIN", "inactivo");
    er(await send({ idMonedaOrigen: "EUR" }), "TNE");
    er(await send({ Monto: "0.00" }), "MIN");
    er(await send({ TotalAPagar: "104.99" }), "CCA");
    er(await send({ MontoARecibir: "5925.00" }), "CCA");
    er(await send({ Recibido: "104.99" }), "EIS");
    er(await send({ idForma_Pago: "3", Recibido: "", Referencia: "TRF-1" }), "PNV");
    er(await send({ idForma_Pago: "4", Recibido: "", Referencia: "DEP-1", Verificado: "0" }), "PNV");
    const collector = await login("collector@cyp.local");
    er(await send({ idRemitente: "cli-5", idDestinatario: "cli-1" }, collector), "CFR", "cli-5");
    er(await send({}, await login("supervisora@cyp.local")), "SPE");
    assert.equal((await store.read()).remittances.transfers.length, 0, "nothing was registered by a petition that answered ER");

    // No box in pesos: CNA. Once it is open, the same petition with the same idOperacion registers the send.
    const pesos: Partial<Send> = { idOperacion: randomUUID(), idMonedaOrigen: "DOP", Monto: "1000.00", TotalAPagar: "1050.00", MontoARecibir: "980.00", Recibido: "" };
    er(await send(pesos), "CNA");
    await store.transaction((draft) => { openRemittanceCash(draft, admin, { operatorId: "demo-cashier", currency: "DOP", openingAmount: 0 }, operators); });
    assert.equal(fields((await send(pesos))[2])[1], "ENV00000001");
    assert.equal(fields((await send(pesos))[2])[1], "ENV00000001");
    // A rate that changed after the quote: the amounts no longer match.
    await store.transaction((draft) => { setDailyRate(draft, admin, { currency: "USD", rate: "59.50", purchaseRate: "59.50", saleRate: "60.00", date: businessDate() }); });
    er(await send(), "CCA");
    assert.equal((await store.read()).remittances.transfers.length, 1);
  } finally { await app.close(); }
});

test("recs: the nineteen fields, by date and status, newest first, and each user sees what is his", async () => {
  const { app, store, post, get, login } = await open();
  try {
    const cashier = await login(DEMO_CASHIER_EMAIL), boss = await login("admin@cyp.local");
    er(await get("recs", cashier), "RNE");
    const first = fields((await post("send", sendBody(cashier, { idRemitente: "cli-1", idDestinatario: "cli-2" })))[2]);
    const second = fields((await post("send", sendBody(boss, { idForma_Pago: "3", Recibido: "", Referencia: "TRF-7", Verificado: "1" })))[2]);
    const own = await get("recs", cashier);
    assert.equal(own.length, 4); assert.equal(own[2], "0");
    const row = fields(own[3]);
    assert.equal(row.length, 19);
    assert.deepEqual(row, [first[0], "ENV00000001", "REC00000001", first[3], first[4], "0", "cli-1", "Colmado La Esquina", "cli-2", "María Rodríguez", "8095550100",
      "USD", "100.00", "5.00", "105.00", "DOP", "5806.50", "1", ""]);
    const everything = (await get("recs", boss))[3].split("!").map(fields);
    assert.deepEqual(everything.map((item) => item[1]), ["ENV00000002", "ENV00000001"], "newest first");
    assert.equal(everything[0][17], "3"); assert.equal(everything[0][0], second[0]);
    assert.equal((await get("recs", await login("supervisora@cyp.local")))[3].split("!").length, 2, "supervision reads every send");
    assert.equal((await get("recs", await login("collector@cyp.local")))[3].split("!").length, 2, "a collector also sees the sends of the clients of his route");
    // The recipient has been paid: status 1 and its date; then the filters by status.
    await store.transaction((draft) => { const paid = draft.remittances.transfers[0]; paid.status = "paid"; paid.paidAt = new Date().toISOString(); paid.paidBy = "demo-admin"; });
    const paid = fields((await get("recs", `${cashier}|||1`))[3]);
    assert.equal(paid[5], "1"); assert.match(paid[18], /^\d{14}$/);
    er(await get("recs", `${cashier}|||0`), "RNE");
    er(await get("recs", `${cashier}|||2`), "RNE");
    assert.equal((await get("recs", `${boss}|||0`))[3].split("!").length, 1);
    assert.equal((await get("recs", `${boss}|||3`))[3].split("!").length, 2);
    // Dates: today by default; a range of 31 days counting both ends; nothing outside.
    const today = businessDate().replaceAll("-", "");
    assert.equal((await get("recs", `${boss}|${today}|${today}`))[3].split("!").length, 2);
    assert.equal((await post("recs", `${boss}|${today}`))[3].split("!").length, 2);
    er(await get("recs", `${boss}|20200101|20200131`), "RNE");
    er(await get("recs", `${boss}|20200101|20200201`), "PIN", "FechaFinal");
    er(await get("recs", `${boss}|20200102|20200101`), "PIN", "FechaFinal");
    er(await get("recs", `${boss}|2020-01-01`), "PIN", "FechaInicial");
    er(await get("recs", `${boss}|20200230`), "PIN", "FechaInicial");
    er(await get("recs", `${boss}|||4`), "PIN", "idEstado");
    er(await get("recs", `${boss}||||0`), "PIN", "Pagina");
    er(await get("recs", `${boss}||||2`), "RNE");
    er(await get("recs", await login("cliente@cyp.local")), "SPE");
  } finally { await app.close(); }
});

test("recs: more than 100 come by pages", async () => {
  const state = fixture(), now = new Date();
  const { app, store, post, get, login } = await open(state);
  try {
    const token = await login("admin@cyp.local");
    const one = fields((await post("send", sendBody(token)))[2]);
    await store.transaction((draft) => {
      const model = draft.remittances.transfers[0];
      for (let index = 2; index <= 130; index++) draft.remittances.transfers.push({ ...structuredClone(model), id: randomUUID(), sequence: index,
        envioReference: `ENV${String(index).padStart(8, "0")}`, reciboReference: `REC${String(index).padStart(8, "0")}`, createdAt: new Date(now.getTime() - index * 1000).toISOString() });
    });
    const first = await get("recs", token);
    assert.equal(first[2], "1"); assert.equal(first[3].split("!").length, 100); assert.equal(fields(first[3].split("!")[0])[0], one[0]);
    const second = await get("recs", `${token}||||2`);
    assert.equal(second[2], "0"); assert.equal(second[3].split("!").length, 30); assert.equal(fields(second[3].split("!").at(-1)!)[1], "ENV00000130");
  } finally { await app.close(); }
});

test("the body is the petition whatever its Content-Type, and the JSON API is the one it was", async () => {
  const { app, login } = await open();
  try {
    const token = await login("admin@cyp.local");
    for (const type of ["application/json", "application/x-www-form-urlencoded", "application/octet-stream", "text/plain", "text", ""]) {
      const reply = await app.inject({ method: "POST", url: "/cyp_quote", payload: `${token}|USD|DOP|100.00`, headers: { "content-type": type } });
      assert.equal(reply.statusCode, 200, type); assert.match(reply.body, /^OK\|\d{14}\|100\.00;5\.00;105\.00;5806\.50;/, type);
    }
    const large = await app.inject({ method: "POST", url: "/cyp_clients", payload: `${token}|${"x".repeat(70000)}`, headers: { "content-type": "text/plain" } });
    assert.equal(large.statusCode, 200); assert.match(large.body, /^ER\|\d{14}\|PIN\|[^|]+\|Parametros$/);
    assert.notEqual((await app.inject({ method: "HEAD", url: `/cyp_logout?${token}` })).statusCode, 200, "a HEAD never runs a petition");
    assert.match((await app.inject({ url: `/cyp_quote?${token}|USD|DOP|100.00` })).body, /^OK|/, "the session is still open");
    assert.equal((await app.inject({ url: "/api/envios" })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/auth/login", payload: "admin@cyp.local|x", headers: { "content-type": "text/plain" } })).statusCode, 400);
    const web = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: DEMO_PASSWORD } });
    assert.equal(web.statusCode, 200);
    // An idSesion may travel in an address, so it opens the seven petitions and nothing else of the API.
    for (const url of ["/api/auth/me", "/api/snapshot", "/api/envios", "/api/usuarios"]) {
      const refused = await app.inject({ url, headers: { authorization: `Bearer ${token}` } });
      assert.equal(refused.statusCode, 401, url); assert.equal(refused.json().error.code, "UNAUTHORIZED");
    }
    assert.equal((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${web.json().token}` } })).json().id, "demo-admin");
    assert.match((await app.inject({ url: `/cyp_quote?${web.json().token}|USD|DOP|100.00` })).body, /^OK\|/, "a session of the web is a session");
    assert.equal(Object.keys((await app.inject({ url: "/api/openapi.json" })).json().paths).filter((path) => path.includes("cyp_")).length, 0);
  } finally { await app.close(); }
});

test("public demo: the invitation travels in a header, and the gate stays closed for everything else", async () => {
  const code = "invitacion-sintetica-de-prueba";
  const { app, post, get } = await open(fixture(), { code, origin: "https://demo.example.test" });
  const invited = { "x-cyp-invitacion": code };
  try {
    er(await post("login", `admin@cyp.local|${DEMO_PASSWORD}`), "PIN", "X-CyP-Invitacion");
    er(await get("clients", "lo-que-sea"), "PIN", "X-CyP-Invitacion");
    const login = await post("login", `admin@cyp.local|${DEMO_PASSWORD}`, invited);
    assert.equal(login[0], "OK");
    assert.equal((await get("clients", login[2], invited))[0], "OK");
    er(await get("noexiste", "", invited), "PNE");
    // The header opens the protocol only: the JSON API and the pages still ask for the invitation of the browser.
    const api = await app.inject({ url: "/api/snapshot", headers: { ...invited, authorization: `Bearer ${login[2]}` } });
    assert.equal(api.statusCode, 401); assert.equal(api.json().error.code, "DEMO_INVITATION_REQUIRED");
    assert.equal((await app.inject({ url: "/", headers: invited })).statusCode, 303);
    assert.equal((await app.inject({ url: "/cyp_clients/otra-cosa", headers: invited })).statusCode, 303);
    // Ten wrong invitations in a minute from one address: after that none is looked at, not even the right one.
    for (let attempt = 0; attempt < 10; attempt++) er(await get("clients", "x", { "x-cyp-invitacion": `mala-${attempt}` }), "PIN", "X-CyP-Invitacion");
    er(await get("clients", "x", { "x-cyp-invitacion": "mala-11" }), "DML");
    er(await get("clients", login[2], invited), "DML");
  } finally { await app.close(); }
});

test("send: the same petition answers the same send after a rate changed and the box was closed, and at the same time", async () => {
  const { app, store, post, login } = await open();
  try {
    const token = await login(DEMO_CASHIER_EMAIL), body = sendBody(token);
    // Twice at once, as when the application repeats because the answer is late: one send.
    const [one, two] = await Promise.all([post("send", body), post("send", body)]);
    assert.equal(one[0], "OK"); assert.equal(one[2], two[2]);
    assert.equal((await store.read()).remittances.transfers.length, 1);
    await store.transaction((draft) => {
      setDailyRate(draft, admin, { currency: "USD", rate: "61.00", purchaseRate: "61.00", saleRate: "62.00", date: businessDate() });
      const cash = draft.remittances.cashSessions.find((row) => row.operatorId === "demo-cashier" && row.currency === "USD")!;
      closeRemittanceCash(draft, admin, cash.id, cashBalance(draft, cash).expected);
    });
    er(await post("send", sendBody(token)), "CCA");
    er(await post("send", sendBody(token, { TotalAPagar: "105.00", MontoARecibir: "5978.00" })), "CNA");
    assert.equal((await post("send", body))[2], one[2], "the registered send, whatever changed afterwards");
    assert.equal((await store.read()).remittances.transfers.length, 1);
  } finally { await app.close(); }
});

test("send: tabs and invisible marks in what the user typed become spaces; an amount of zero to pay never matches", async () => {
  const { app, store, post, get, login } = await open();
  try {
    const token = await login(DEMO_CASHIER_EMAIL), zeroWidth = String.fromCharCode(0x200b);
    const ok = await post("send", sendBody(token, { idForma_Pago: "3", Recibido: "", Referencia: ` TRF\t99${zeroWidth}812 `, Banco: `Banco${zeroWidth}Popular`, Verificado: "1", Nota: "línea\tcon tabulador" }));
    assert.equal(ok[0], "OK", ok.join("|"));
    const saved = (await store.read()).remittances.transfers[0];
    assert.equal(saved.payment?.reference, "TRF 99 812"); assert.equal(saved.payment?.bank, "Banco Popular"); assert.equal(saved.note, "línea con tabulador");
    assert.equal(fields((await get("clients", `${token}|Mar%C3%ADa%09Rodr%C3%ADguez`))[3])[0], "cli-2", "a tab in what is searched is a space");
    er(await post("send", sendBody(token, { TotalAPagar: "0.00" })), "CCA");
    er(await post("send", sendBody(token, { MontoARecibir: "0.00" })), "CCA");
    er(await post("send", sendBody(token, { Recibido: "0.00" })), "EIS");
    er(await get("quote", `${token}|USD|DOP|0.01|2`), "MIN");
    er(await post("send", sendBody(token, { Monto: "0.01", Modo: "2", MontoARecibir: "0.01", TotalAPagar: "0.01" })), "MIN");
  } finally { await app.close(); }
});

test("permissions: asked by name too, so a personalised account gets exactly what it was given", async () => {
  const state = fixture();
  const custom = (id: string, remittancePermissions: string[]) => ({ ...account(id, `${id}@cyp.local`, "cashier"), permissionMode: "custom" as const,
    permissionIds: [1], permissionRevision: 1, remittancePermissions: remittancePermissions as never });
  state.accounts.push(custom("solo-ver", ["remittances.view"]), custom("solo-entregar", ["remittances.receipts"]), account("sin-rol", "sinrol@cyp.local", "undefined"));
  const { app, post, get, login } = await open(state);
  try {
    assert.deepEqual(fields((await post("login", `solo-ver@cyp.local|${DEMO_PASSWORD}`))[3]).slice(2), ["cashier", "0", "1"]);
    assert.deepEqual(fields((await post("login", `solo-entregar@cyp.local|${DEMO_PASSWORD}`))[3]).slice(2), ["cashier", "0", "0"]);
    assert.deepEqual(fields((await post("login", `sinrol@cyp.local|${DEMO_PASSWORD}`))[3]).slice(2), ["undefined", "0", "0"]);
    const viewer = await login("solo-ver@cyp.local"), payer = await login("solo-entregar@cyp.local");
    er(await get("clients", viewer), "SPE");
    er(await get("client", `${viewer}|cli-1`), "SPE");
    er(await get("quote", `${viewer}|USD|DOP|100.00`), "SPE");
    er(await post("send", sendBody(viewer)), "SPE");
    er(await get("recs", viewer), "RNE");
    for (const command of ["clients", "recs"]) er(await get(command, payer), "SPE");
    er(await get("recs", await login("sinrol@cyp.local")), "SPE");
  } finally { await app.close(); }
});

test("a collector made inactive is told so in every petition but can still close his session", async () => {
  const { app, store, get, login } = await open();
  try {
    const token = await login("collector@cyp.local");
    assert.equal((await get("clients", token))[0], "OK");
    await store.transaction((draft) => { draft.collectors.find((row) => row.id === "col-1")!.active = false; });
    for (const command of ["clients", "recs"]) er(await get(command, token), "CBI");
    er(await get("quote", `${token}|USD|DOP|100.00`), "CBI");
    assert.equal((await get("logout", token))[0], "OK");
  } finally { await app.close(); }
});

test("a failure of the central that is not a rule answers EIC with a reference, and nothing of its inside", async () => {
  class Failing extends MemoryStore { broken = false; override async read() { if (this.broken) throw new Error("connection refused 10.0.0.7:5432 secreto"); return super.read(); } }
  const store = new Failing(fixture());
  const app = await buildApp({ store, demo: true, secret, origins: [], collectorUrl: "http://127.0.0.1:5174" });
  const logged: unknown[][] = [], original = console.error;
  try {
    const token = (await app.inject({ method: "POST", url: "/cyp_login", payload: `admin@cyp.local|${DEMO_PASSWORD}` })).body.split("|")[2];
    store.broken = true; console.error = (...values: unknown[]) => { logged.push(values); };
    const reply = await app.inject({ url: `/cyp_clients?${token}` });
    assert.equal(reply.statusCode, 200);
    const parts = reply.body.split("|");
    er(parts, "EIC"); assert.match(parts[3], /Referencia para soporte: [A-Za-z0-9_-]+$/); assert.ok(!reply.body.includes("10.0.0.7"));
    assert.equal(logged.length, 1, "the cause stays in the log of the server");
  } finally { console.error = original; await app.close(); }
});

test("recs: the day of a send is the one of the Dominican Republic, not the one of UTC", async () => {
  const { app, store, post, get, login } = await open();
  try {
    const token = await login("admin@cyp.local");
    await post("send", sendBody(token));
    // Ten at night of the 9th of March in Santo Domingo is already the 10th in UTC.
    await store.transaction((draft) => { draft.remittances.transfers[0].createdAt = "2026-03-10T02:00:00.000Z"; });
    const found = await get("recs", `${token}|20260309|20260309`);
    assert.equal(fields(found[3])[4], "20260309220000");
    er(await get("recs", `${token}|20260310|20260310`), "RNE");
    er(await get("recs", token), "RNE");
  } finally { await app.close(); }
});
