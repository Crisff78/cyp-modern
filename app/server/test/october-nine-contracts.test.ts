import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { businessDate, closeDay, postMovement, type State } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore } from "../src/store.js";
import { createRemittance, openRemittanceCash, quoteRemittance, remittanceSnapshot, setDailyRate } from "../src/remittances.js";

async function setup(initial: State = seed()) {
  const store = new MemoryStore(initial);
  const app = await buildApp({ store, secret: "fictional-october-nine-test-only-secret-2026", demo: true, origins: [], collectorUrl: "http://localhost:5174" });
  const login = (email: string, password = "Demo-CyP-2026!") => app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  const token = (await login("admin")).json().token as string;
  const post = (url: string, payload: unknown, key = randomUUID(), auth = token) => app.inject({ method: "POST", url, payload,
    headers: { authorization: `Bearer ${auth}`, "idempotency-key": key } });
  const get = (url: string, auth = token) => app.inject({ url, headers: { authorization: `Bearer ${auth}` } });
  return { app, store, post, get, login, token };
}

test("client identity reservations are atomic, repeatable and distinct from legal documents", async () => {
  const env = await setup();
  try {
    const key = randomUUID();
    const [a, replay, b] = await Promise.all([env.post("/api/clientes/sugerencias", {}, key), env.post("/api/clientes/sugerencias", {}, key), env.post("/api/clientes/sugerencias", {})]);
    assert.equal(a.statusCode, 200); assert.deepEqual(a.json(), replay.json()); assert.notEqual(a.json().code, b.json().code);
    assert.notEqual(a.json().internalIdentification, b.json().internalIdentification);
    const createKey = randomUUID();
    const body = { name: "Persona ficticia", code: "MANUAL-SYNTHETIC", routeId: "route-1", identification: "LEGAL-SYNTHETIC", reservationId: a.json().reservationId };
    const created = await env.post("/api/clientes", body, createKey);
    assert.equal(created.statusCode, 200, created.body);
    assert.equal((await env.post("/api/usuarios", { name: "Cuenta ficticia reservada", email: "admin", role: "admin", password: "Old" })).statusCode, 409);
    assert.equal(created.json().code, body.code); assert.equal(created.json().identification, body.identification);
    assert.equal(created.json().internalIdentification, a.json().internalIdentification);
    assert.deepEqual((await env.post("/api/clientes", body, createKey)).json(), created.json());
    assert.equal((await env.post("/api/clientes", { ...body, code: "ANOTHER-CODE" })).statusCode, 409);
    assert.equal((await env.post("/api/clientes", { name: "Sin documento", routeId: "route-1" })).statusCode, 400);
    assert.equal((await env.post("/api/clientes", { ...body, internalIdentification: "FORGED" })).statusCode, 400);
    const automatic = await env.post("/api/clientes", { name: "Otra persona ficticia", routeId: "route-1", identification: "LEGAL-SYNTHETIC-2" });
    assert.equal(automatic.statusCode, 200, automatic.body); assert.match(automatic.json().code, /^CLI\d{8}$/);
    assert.match(automatic.json().internalIdentification, /^INT\d{8}$/);
    assert.equal((await env.store.read()).clients.filter((row) => row.id === created.json().id).length, 1);
  } finally { await env.app.close(); }
});

test("legacy clients can claim an internal identity once without changing UUID or legal identification", async () => {
  const env = await setup();
  try {
    const old = (await env.store.read()).clients[0];
    const reservation = (await env.post("/api/clientes/sugerencias", {})).json();
    const body = { name: old.name, code: old.code, routeId: old.routeId, identification: old.identification ?? "", phone: old.phone,
      address: old.address, reservationId: reservation.reservationId };
    const saved = await env.post(`/api/clientes/${old.id}`, body);
    assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().id, old.id);
    assert.equal(saved.json().identification, old.identification ?? ""); assert.equal(saved.json().internalIdentification, reservation.internalIdentification);
    const newer = (await env.post("/api/clientes/sugerencias", {})).json();
    assert.equal((await env.post(`/api/clientes/${old.id}`, { ...body, reservationId: newer.reservationId })).statusCode, 409);
  } finally { await env.app.close(); }
});

test("collection bank reference and note are captured once, survive renaming, and reject inactive banks", async () => {
  const env = await setup();
  try {
    const bank = (await env.post("/api/bancos", { name: "Banco ficticio A", active: true })).json();
    const before = await env.store.read();
    const key = randomUUID();
    const body = { clientId: "cli-1", collectorId: "col-1", currency: "DOP", lines: [{ chargeId: "chg-1", amount: 123 }],
      bankId: bank.id, reference: "REF-SYNTHETIC", note: "Nota ficticia\nSegunda línea" };
    const saved = await env.post("/api/cobros/central", body, key);
    assert.equal(saved.statusCode, 200, saved.body);
    const movement = saved.json().movements[0];
    assert.equal(movement.bankName, "Banco ficticio A"); assert.equal(movement.reference, body.reference); assert.equal(movement.note, body.note);
    assert.equal((await env.post(`/api/bancos/${bank.id}`, { name: "Banco ficticio B", active: false })).statusCode, 200);
    assert.deepEqual((await env.post("/api/cobros/central", body, key)).json(), saved.json());
    assert.equal((await env.post("/api/cobros/central", body)).statusCode, 422);
    const snap = (await env.get("/api/snapshot")).json();
    const retained = snap.movements.find((row: { id: string }) => row.id === movement.id);
    assert.equal(retained.bankName, "Banco ficticio A"); assert.equal(retained.reference, "REF-SYNTHETIC");
    assert.equal(snap.banks[0].name, "Banco ficticio B");
    const after = await env.store.read();
    assert.equal(after.movements.length, before.movements.length + 1);
    assert.equal(after.charges.find((row) => row.id === "chg-1")!.collected, before.charges.find((row) => row.id === "chg-1")!.collected + 123);
    assert.equal((await env.post("/api/bancos", { name: "banco ficticio b", active: true })).statusCode, 409);
  } finally { await env.app.close(); }
});

test("commercial purchase/sale settings retain operational conversion, historical revisions and no-op timestamps", async () => {
  const state = seed(), actor = { id: "demo-admin", name: "Admin", role: "admin" as const }, now = new Date();
  const date = businessDate(now);
  setDailyRate(state, actor, { currency: "USD", date, rate: "60" }, now);
  const original = quoteRemittance(state, { sourceCurrency: "USD", destinationCurrency: "DOP", amount: 1000 }, now);
  const oldHistory = structuredClone(state.remittances.rateHistory!);
  const rate = setDailyRate(state, actor, { currency: "USD", date, rate: "60", purchaseRate: "58.5", saleRate: "62" }, now);
  assert.equal(rate.purchaseRate, "58.500000"); assert.equal(rate.saleRate, "62.000000");
  const quote = quoteRemittance(state, { sourceCurrency: "USD", destinationCurrency: "DOP", amount: 1000 }, now);
  assert.equal(quote.receiveAmount, original.receiveAmount); assert.equal(quote.quote.sourceRate, "60.000000");
  assert.deepEqual(state.remittances.rateHistory!.slice(0, oldHistory.length), oldHistory);
  const current = structuredClone(rate), historyCount = state.remittances.rateHistory!.length;
  assert.deepEqual(setDailyRate(state, actor, { currency: "USD", date, rate: "60", purchaseRate: "58.5", saleRate: "62" }, new Date(now.getTime() + 1000)), current);
  assert.equal(state.remittances.rateHistory!.length, historyCount);
  assert.throws(() => setDailyRate(state, actor, { currency: "USD", date, rate: "60", purchaseRate: "59" }, now), /juntas/);
  assert.throws(() => setDailyRate(state, actor, { currency: "DOP", date, rate: "1", purchaseRate: "2", saleRate: "1" }, now), /deben ser uno/);
});

test("preview exposes separate currency totals and detail while close refuses cross-currency offsetting", async () => {
  const state = seed(); state.movements = []; state.settlements = [];
  const actor = { id: "demo-admin", name: "Admin", role: "admin" as const }, now = new Date();
  postMovement(state, actor, "office_delivery", { collectorId: "col-1", currency: "USD", amount: 500 }, now);
  // An imported fictional ledger can contain opposite balances. Reading and
  // closing must keep them separate even when normal posting rejects that state.
  state.movements.push({ ...state.movements[0], id: "synthetic-imported-deposit", type: "deposit", currency: "EUR" });
  const env = await setup(state);
  try {
    const response = await env.get(`/api/cuadres/preview?collectorId=col-1&date=${businessDate(now)}`);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().totalsByCurrency.USD.difference, 500); assert.equal(response.json().totalsByCurrency.EUR.difference, -500);
    assert.equal(response.json().totalsByCurrency.DOP.difference, 0); assert.equal(response.json().deliveriesByCurrency.USD.length, 1);
    assert.ok(Array.isArray(response.json().pendingByCurrency.DOP.charges));
    assert.throws(() => closeDay(state, actor, "col-1", businessDate(now), now), /cada moneda/);
  } finally { await env.app.close(); }
});

test("preview retains unsupported and conflicting obligations without inventing DOP or reading another collector", async () => {
  const state = seed(), now = new Date(), date = businessDate(now);
  state.movements = []; state.settlements = [];
  const own = state.charges.find((row) => row.clientId === "cli-1")!;
  Object.assign(own, { currency: "Moneda histórica sin equivalencia", amount: 20000, collected: 5000, status: "partial", dueDate: date });
  const foreignRoute = state.routes.find((route) => route.collectorId !== "col-1")!;
  const foreignClient = state.clients.find((client) => client.routeId === foreignRoute.id)!;
  state.charges.push({ ...own, id: "foreign-unsupported-charge", clientId: foreignClient.id, currency: "Otra moneda desconocida" },
    { ...own, id: "orphan-unsupported-charge", clientId: "missing-historical-client" },
    { ...own, id: "own-conflicting-usd-charge", currency: "USD", amount: 5000, collected: 1000 });
  state.payouts.push({ ...state.payouts[0], id: "own-unsupported-payout", collectorId: "col-1", currency: "Pago sin equivalencia", amount: 5000, paid: 0, dueDate: date },
    { ...state.payouts[0], id: "own-conflicting-eur-payout", collectorId: "col-1", currency: "EUR", amount: 5000, paid: 1000, dueDate: date },
    { ...state.payouts[0], id: "foreign-unsupported-payout", collectorId: foreignRoute.collectorId, currency: "Otra moneda desconocida", amount: 5000, paid: 0, dueDate: date });
  state.movements.push({ id: "synthetic-historical-dop", type: "collection", collectorId: "col-1", clientId: "cli-1", chargeId: own.id,
    amount: 5000, actorId: "demo-admin", createdAt: now.toISOString() });
  const env = await setup(state);
  try {
    const before = await env.store.read();
    const response = await env.get(`/api/cuadres/preview?collectorId=col-1&date=${date}`);
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json(), unsupported = result.pendingUnsupported.charges.find((row: { id: string }) => row.id === own.id);
    assert.equal(unsupported.currency, own.currency); assert.equal(unsupported.currencyUnsupported, true); assert.equal(unsupported.currencyConflict, true);
    assert.deepEqual(unsupported.collectedByCurrency, { DOP: 5000, USD: 0, EUR: 0 });
    assert.equal(result.pendingUnsupported.payouts.find((row: { id: string }) => row.id === "own-unsupported-payout").currency, "Pago sin equivalencia");
    assert.ok(!JSON.stringify(result.pendingByCurrency).includes(own.currency));
    assert.ok(!JSON.stringify(result).includes("foreign-unsupported")); assert.ok(!JSON.stringify(result).includes("orphan-unsupported"));
    assert.equal(result.pendingByCurrency.USD.charges.find((row: { id: string }) => row.id === "own-conflicting-usd-charge").currencyConflict, true);
    assert.equal(result.pendingByCurrency.EUR.payouts.find((row: { id: string }) => row.id === "own-conflicting-eur-payout").currencyConflict, true);
    assert.equal(result.totalsByCurrency.DOP.collected, 5000); assert.equal(result.totalsByCurrency.USD.collected, 0);
    assert.deepEqual(await env.store.read(), before);
  } finally { await env.app.close(); }
});

test("configured footer reaches minimal and ESC/POS receipts and remittance snapshot with bounded raster logo", async () => {
  const env = await setup();
  try {
    const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
    const config = { receiptFooterNote: "Mensaje ficticio al pie", companyLogoDataUrl: logo };
    assert.equal((await env.post("/api/configuracion", { config })).statusCode, 200);
    const movement = (await env.post("/api/cobros", { chargeId: "chg-1", amount: 100 })).json().movement;
    const receipt = await env.app.inject(`/api/recibos/${movement.receiptToken}`);
    assert.equal(receipt.json().footerNote, config.receiptFooterNote);
    assert.match((await env.app.inject(`/api/recibos/${movement.receiptToken}/escpos`)).body, /Mensaje ficticio al pie/);
    assert.equal((await env.get("/api/envios/snapshot")).json().receiptFooterNote, config.receiptFooterNote);
    for (const bad of ["https://example.invalid/logo.png", "data:image/svg+xml;base64,PHN2Zy8+", "x".repeat(24577)])
      assert.equal((await env.post("/api/configuracion", { config: { companyLogoDataUrl: bad } })).statusCode, 400);
    assert.deepEqual((await env.get("/api/configuracion")).json().config, config);
  } finally { await env.app.close(); }
});

test("a username without email works and own password requires current value and revokes the session", async () => {
  const env = await setup();
  try {
    const created = await env.post("/api/usuarios", { name: "Cuenta ficticia", email: "synthetic.operator", role: "collector", collectorId: "col-1", password: "Old" });
    assert.equal(created.statusCode, 200, created.body);
    const login = await env.login("SYNTHETIC.OPERATOR", "Old"); assert.equal(login.statusCode, 200);
    const userToken = login.json().token as string, path = `/api/usuarios/${created.json().id}/clave`;
    assert.equal((await env.post(path, { password: "New" }, randomUUID(), userToken)).statusCode, 422);
    assert.equal((await env.post(path, { password: "New", currentPassword: "Bad" }, randomUUID(), userToken)).statusCode, 401);
    assert.equal((await env.post(path, { password: "New", currentPassword: "Old" }, randomUUID(), userToken)).statusCode, 200);
    assert.equal((await env.get("/api/auth/me", userToken)).statusCode, 401);
    assert.equal((await env.login("synthetic.operator", "Old")).statusCode, 401);
    assert.equal((await env.login("synthetic.operator", "New")).statusCode, 200);
    assert.equal((await env.post("/api/usuarios", { name: "Inválida", email: "control\u0000name", role: "admin", password: "Old" })).statusCode, 400);
  } finally { await env.app.close(); }
});

test("bootstrap demo account changes its own password without keeping the old fallback", async () => {
  const env = await setup();
  try {
    assert.equal((await env.post("/api/usuarios/demo-admin/clave", { password: "New", currentPassword: "Wrong" })).statusCode, 401);
    assert.equal((await env.store.read()).accounts.some((row) => row.id === "demo-admin"), false);
    assert.equal((await env.post("/api/usuarios/demo-admin/clave", { password: "New", currentPassword: "Demo-CyP-2026!" })).statusCode, 200);
    assert.equal((await env.get("/api/auth/me")).statusCode, 401);
    assert.equal((await env.login("admin", "Demo-CyP-2026!")).statusCode, 401);
    const login = await env.login("admin", "New"); assert.equal(login.statusCode, 200);
    assert.equal((await env.get("/api/auth/me", login.json().token)).statusCode, 200);
    const account = (await env.store.read()).accounts.find((row) => row.id === "demo-admin")!;
    assert.notEqual(account.passwordHash, "New"); assert.equal(account.credentialVersion, 1);
  } finally { await env.app.close(); }
});

test("legal contact identification freezes on new remittances without filling legacy contacts", () => {
  const state = seed(), now = new Date(), actor = { id: "demo-admin", name: "Admin", role: "admin" as const };
  state.clients.find((client) => client.id === "cli-1")!.identification = "DOCUMENTO-LEGAL-FICTICIO";
  setDailyRate(state, actor, { currency: "USD", date: businessDate(now), rate: "60" }, now);
  openRemittanceCash(state, actor, { operatorId: actor.id, currency: "USD", openingAmount: 0 }, [], now);
  const quoted = quoteRemittance(state, { sourceCurrency: "USD", destinationCurrency: "DOP", amount: 1000 }, now);
  const saved = createRemittance(state, actor, { sourceCurrency: "USD", destinationCurrency: "DOP", amount: 1000,
    senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoted.quote }, [], now);
  assert.equal(saved.senderContact?.identification, "DOCUMENTO-LEGAL-FICTICIO");
  state.clients.find((client) => client.id === "cli-1")!.identification = "DOCUMENTO-POSTERIOR";
  assert.equal(remittanceSnapshot(state, actor, []).transfers[0].senderContact?.identification, "DOCUMENTO-LEGAL-FICTICIO");
  delete state.remittances.transfers.find((row) => row.id === saved.id)!.senderContact;
  assert.equal(remittanceSnapshot(state, actor, []).transfers[0].senderContact, undefined);
});
