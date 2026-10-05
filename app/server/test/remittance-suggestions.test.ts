import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { businessDate, type State, type User } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore, FileStore, PostgresStore } from "../src/store.js";
import { createRemittance, cancelRemittance, openRemittanceCash, quoteRemittance,
  remittanceReports, remittanceSnapshot, setDailyRate, type QuoteInput } from "../src/remittances.js";

const at = new Date("2026-09-25T16:00:00.000Z");
const admin: User = { id: "demo-admin", name: "Synthetic admin", role: "admin" };
const sender: User = { id: "demo-collector", name: "Synthetic sender", role: "collector", collectorId: "col-1" };
const outsider: User = { id: "outside-fixture", name: "Synthetic outsider", role: "collector", collectorId: "col-3" };
const operators = [admin, sender, outsider];
const moneyInput = { sourceCurrency: "USD" as const, destinationCurrency: "EUR" as const, amount: 10000, commissionBps: 100 };
const errorCode = (code: string) => (error: unknown) => { assert.equal((error as { code: string }).code, code); return true; };
function fixture() {
  const state = seed();
  state.clients[0].phone = "+509 2222 0001"; state.clients[0].cellular = "+509 3333 0001";
  state.clients[0].address = "Synthetic sender address"; state.clients[0].preferredCurrency = "USD";
  state.clients[4].phone = "+509 2222 0005"; state.clients[4].address = "Synthetic destination address";
  setDailyRate(state, admin, { currency: "USD", rate: "0.5", date: businessDate(at) }, at);
  setDailyRate(state, admin, { currency: "EUR", rate: "0.25", date: businessDate(at) }, at);
  for (const currency of ["USD", "EUR", "DOP"] as const)
    openRemittanceCash(state, admin, { operatorId: sender.id, currency, openingAmount: 0 }, operators, at);
  return state;
}
function create(state: State, input: QuoteInput = moneyInput, now = at) {
  return createRemittance(state, sender, { ...input, senderClientId: "cli-1", recipientClientId: "cli-5",
    quote: quoteRemittance(state, input, now).quote }, operators, now);
}

test("6.7 intraday history and A→B→A use an explicit revision even in the same millisecond", () => {
  const state = fixture(), first = structuredClone(state.remittances.rates.find((row) => row.currency === "USD")!);
  const oldQuote = quoteRemittance(state, moneyInput, at).quote;
  const count = state.remittances.rateHistory!.length;
  setDailyRate(state, admin, { currency: "USD", rate: "0.75", date: businessDate(at) }, at);
  const current = setDailyRate(state, admin, { currency: "USD", rate: "0.5", date: businessDate(at) }, at);
  assert.equal(current.id, first.id); assert.equal(current.rate, first.rate);
  assert.notEqual(current.changeId, first.changeId);
  assert.equal(state.remittances.rateHistory!.length, count + 2);
  assert.equal(state.remittances.rateHistory!.at(-1)!.createdAt, at.toISOString());
  assert.equal(state.remittances.rateHistory!.at(-1)!.actorId, admin.id);
  for (const quote of [oldQuote, { date: oldQuote.date, sourceRate: oldQuote.sourceRate, destinationRate: oldQuote.destinationRate }])
    assert.throws(() => createRemittance(state, sender, { ...moneyInput, senderClientId: "cli-1", recipientClientId: "cli-5", quote }, operators, at), errorCode("QUOTE_CHANGED"));
  assert.equal(state.remittances.transfers.length, 0);
  const history = structuredClone(state.remittances.rateHistory);
  setDailyRate(state, admin, { currency: "USD", rate: "0.500000", date: businessDate(at) }, at);
  assert.deepEqual(state.remittances.rateHistory, history, "unchanged value does not add a fabricated change");
  assert.equal(create(state).quote.sourceRateChangeId, current.changeId);
});

test("6.7 legacy daily rates keep unknown timestamps until explicitly confirmed", () => {
  const state = seed();
  state.remittances.rates.push({ id: "legacy-usd", currency: "USD", rate: "0.5", date: businessDate(at) });
  const before = structuredClone(state.remittances);
  const quote = quoteRemittance(state, { ...moneyInput, destinationCurrency: "DOP" }, at).quote;
  assert.equal(quote.sourceRateChangedAt, undefined); assert.equal(quote.sourceRateChangeId, undefined);
  assert.deepEqual(state.remittances, before, "reading/quoting must not backfill history");
  const confirmed = setDailyRate(state, admin, { currency: "USD", rate: "0.5", date: businessDate(at) }, at);
  assert.equal(confirmed.id, "legacy-usd"); assert.equal(confirmed.updatedAt, at.toISOString());
  assert.equal(state.remittances.rateHistory!.length, 1);
});

test("4.2 contact snapshots and confirmed quote times come from the server and remain fixed", () => {
  const state = fixture();
  const oldQuote = quoteRemittance(state, moneyInput, at).quote;
  const later = new Date(at.getTime() + 120000);
  const created = createRemittance(state, sender, { ...moneyInput, senderClientId: "cli-1", recipientClientId: "cli-5",
    quote: { ...oldQuote, quotedAt: "2099-01-01T00:00:00Z", sourceRateChangedAt: "2099-01-01T00:00:00Z" } }, operators, later);
  assert.equal(created.quote.quotedAt, later.toISOString()); assert.equal(created.quote.sourceRateChangedAt, at.toISOString());
  assert.equal(created.receiveAmount, 20000); assert.equal(created.commissionAmount, 100);
  assert.equal(created.senderContact!.phone, "+509 2222 0001"); assert.equal(created.senderContact!.cellular, "+509 3333 0001");
  assert.equal(created.recipientContact!.address, "Synthetic destination address");
  state.clients[0].name = "Changed name"; state.clients[0].phone = "Changed phone"; state.clients[4].address = "Changed address";
  const visible = remittanceSnapshot(state, sender, operators, later);
  assert.equal(visible.clients.find((row) => row.id === "cli-1")!.preferredCurrency, "USD");
  assert.equal(visible.clients.find((row) => row.id === "cli-5")!.preferredCurrency, "DOP");
  assert.equal(visible.transfers[0].senderContact!.phone, "+509 2222 0001");
  assert.equal(visible.transfers[0].recipientContact!.address, "Synthetic destination address");
  for (const row of visible.clients) for (const field of ["phone", "cellular", "address", "note"])
    assert.equal(Object.hasOwn(row, field), false, "do not expose global contact data to collectors");
  assert.equal(visible.rateHistory.length, 0); assert.ok(visible.rates.every((row) => !Object.hasOwn(row, "updatedBy")));
  assert.equal(remittanceSnapshot(state, admin, operators, later).rateHistory.length, 2);
  assert.equal(remittanceSnapshot(state, outsider, operators, later).transfers.length, 0);
  // A real pre-upgrade row has none of the new information. Reading preserves it.
  delete state.remittances.transfers[0].senderContact; delete state.remittances.transfers[0].recipientContact;
  delete state.remittances.transfers[0].quote.quotedAt; delete state.remittances.transfers[0].quote.sourceRateChangedAt;
  assert.equal(remittanceSnapshot(state, admin, operators, later).transfers[0].senderContact, undefined);
  assert.equal(remittanceSnapshot(state, admin, operators, later).transfers[0].quote.quotedAt, undefined);
});

test("7.1 business commission report separates currency/cancellation and uses Dominican emission dates", () => {
  const state = fixture();
  const first = create(state);
  const cancelled = create(state);
  cancelRemittance(state, sender, cancelled.id, "Synthetic cancellation", new Date(at.getTime() + 1000));
  create(state, { ...moneyInput, sourceCurrency: "EUR", destinationCurrency: "USD", amount: 20000, commissionBps: 250 });
  // Emitted before Dominican midnight; cancelled on a later day, still shown as cancelled by emission.
  const boundary = structuredClone(first); boundary.id = "boundary"; boundary.createdAt = "2026-09-26T03:59:59Z";
  const nextDay = structuredClone(first); nextDay.id = "next-day"; nextDay.createdAt = "2026-09-26T04:00:00Z";
  state.remittances.transfers.push(boundary, nextDay);
  const report = remittanceReports(state, admin, { from: "2026-09-25", to: "2026-09-25", grouping: "range" });
  assert.equal(report.commissions.details.length, 4);
  assert.ok(report.commissions.details.some((row) => row.id === "boundary"));
  assert.ok(!report.commissions.details.some((row) => row.id === "next-day"));
  assert.deepEqual(report.commissions.totals.find((row) => row.currency === "USD"), { date: "2026-09-25/2026-09-25", currency: "USD", count: 2, commissionAmount: 200, cancelledCount: 1, cancelledCommissionAmount: 100 });
  assert.equal(report.commissions.totals.find((row) => row.currency === "EUR")!.commissionAmount, 500);
  assert.equal(remittanceReports(state, outsider, { from: "2026-09-25", to: "2026-09-26", grouping: "day" }).commissions.details.length, 0);
  assert.equal(Object.hasOwn(report.commissions, "managerCommission"), false);
});

test("6.7 FileStore reopen preserves the exact current revision/history and frozen contacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-suggestions-remittance-")), path = join(directory, "state.json");
  let store: FileStore | undefined;
  try {
    store = await FileStore.open(path, fixture());
    const transfer = await store.transaction((state) => create(state));
    await store.transaction((state) => {
      setDailyRate(state, admin, { currency: "USD", rate: "0.75", date: businessDate(at) }, at);
      state.clients[0].phone = "Changed after confirmation";
    });
    const before = await store.read(); await store.close();
    store = await FileStore.open(path, seed());
    assert.deepEqual((await store.read()).remittances, before.remittances);
    assert.equal((await store.read()).remittances.transfers.find((row) => row.id === transfer.id)!.senderContact!.phone, "+509 2222 0001");
  } finally { await store?.close(); await unlink(path).catch(() => {}); await unlink(`${path}.tmp`).catch(() => {}); await rmdir(directory); }
});

async function apiSetup(state = seed()) {
  const store = new MemoryStore(state);
  const app = await buildApp({ store, secret: "synthetic-suggestions-remittances-secret-32", demo: true, origins: [], collectorUrl: "http://127.0.0.1:5174" });
  const login = async (email: string) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } })).json().token as string;
  const adminToken = await login("admin@cyp.local"), collectorToken = await login("collector@cyp.local");
  const post = (url: string, payload: Record<string, unknown>, key = randomUUID(), token = adminToken) => app.inject({ method: "POST", url, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  const get = (url: string, token = adminToken) => app.inject({ url, headers: { authorization: `Bearer ${token}` } });
  return { app, store, post, get, collectorToken };
}

test("6.7 API concurrent/replayed rate changes do not duplicate history or reset a later revision", async () => {
  const { app, store, post, get, collectorToken } = await apiSetup();
  try {
    const payload = { currency: "USD", rate: "0.5", date: businessDate() }, key = randomUUID();
    const results = await Promise.all([post("/api/envios/tasas", payload, key), post("/api/envios/tasas", payload, key)]);
    assert.ok(results.every((row) => row.statusCode === 200)); assert.deepEqual(results[0].json(), results[1].json());
    assert.equal((await store.read()).remittances.rateHistory!.length, 1);
    await post("/api/envios/tasas", { ...payload, rate: "0.75" });
    const afterChange = structuredClone((await store.read()).remittances);
    assert.deepEqual((await post("/api/envios/tasas", payload, key)).json(), results[0].json());
    assert.deepEqual((await store.read()).remittances, afterChange);
    assert.equal((await post("/api/envios/tasas", { ...payload, rate: "0.9" }, key)).statusCode, 409);
    assert.equal((await post("/api/envios/tasas", payload, randomUUID(), collectorToken)).statusCode, 403);
    assert.equal((await get("/api/envios/snapshot", collectorToken)).json().rateHistory.length, 0);
    assert.equal((await get("/api/envios/snapshot")).json().rateHistory.length, 2);
  } finally { await app.close(); }
});

test("4.2/6.7 API lost-response retry keeps frozen contacts/quote after edits and rate changes", async () => {
  const initial = seed(); initial.clients[0].phone = "+509 5555 0001";
  const { app, store, post, get } = await apiSetup(initial);
  try {
    await post("/api/envios/tasas", { currency: "USD", rate: "0.5", date: businessDate() });
    await post("/api/envios/cajas/abrir", { operatorId: admin.id, currency: "USD", openingAmount: 0 });
    const quote = (await get("/api/envios/cotizacion?sourceCurrency=USD&destinationCurrency=DOP&amount=10000&commissionBps=100")).json().quote;
    const body = { ...moneyInput, destinationCurrency: "DOP", senderClientId: "cli-1", recipientClientId: "cli-5", quote }, key = randomUUID();
    const original = await post("/api/envios", body, key); assert.equal(original.statusCode, 200, original.body);
    await store.transaction((state) => { state.clients[0].phone = "Changed phone"; });
    await post("/api/envios/tasas", { currency: "USD", rate: "0.75", date: businessDate() });
    const beforeReplay = await store.read();
    const replay = await post("/api/envios", body, key);
    assert.deepEqual(replay.json(), original.json()); assert.deepEqual(await store.read(), beforeReplay);
    assert.equal(replay.json().senderContact.phone, "+509 5555 0001");
    const fresh = await post("/api/envios", body); assert.equal(fresh.statusCode, 409); assert.equal(fresh.json().error.code, "QUOTE_CHANGED");
    assert.equal((await store.read()).remittances.transfers.length, 1);
  } finally { await app.close(); }
});

test("6.7 legacy payload/cache replay stays compatible after rate history is introduced", async () => {
  const initial = seed(); initial.remittances.rates.push({ id: "legacy-rate", currency: "USD", rate: "0.500000", date: businessDate() });
  const { app, store, post } = await apiSetup(initial);
  try {
    await post("/api/envios/cajas/abrir", { operatorId: admin.id, currency: "USD", openingAmount: 0 });
    const body = { ...moneyInput, destinationCurrency: "DOP", senderClientId: "cli-1", recipientClientId: "cli-5",
      quote: { date: businessDate(), sourceRate: "0.500000", destinationRate: "1.000000" } }, key = randomUUID();
    const original = await post("/api/envios", body, key); assert.equal(original.statusCode, 200, original.body);
    // Represent an actual older stored response without changing any real ledger.
    const legacyResponse = original.json(); delete legacyResponse.senderContact; delete legacyResponse.recipientContact; delete legacyResponse.quote.quotedAt;
    await store.transaction((state) => { state.idempotency.find((row) => row.id.endsWith(key))!.response = legacyResponse; });
    await post("/api/envios/tasas", { currency: "USD", rate: "0.75", date: businessDate() });
    const replay = await post("/api/envios", body, key); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), legacyResponse);
    assert.equal((await post("/api/envios", body)).statusCode, 409);
  } finally { await app.close(); }
});

test("PostgreSQL 018 preserves legacy unknowns and persists rate revisions/contacts immutably", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Loopback disposable PostgreSQL only");
  assert.equal(url.pathname, "/cyp_suggestions_backend", "Use only the explicit disposable synthetic database");
  const store = new PostgresStore(url.toString()), second = new PostgresStore(url.toString());
  const client = new pg.Client({ connectionString: url.toString() });
  try {
    await store.transaction((state) => { if (!state.clients.length) Object.assign(state, seed()); });
    await client.connect();
    const legacyId = `legacy-${randomUUID()}`;
    await client.query("INSERT INTO exchange_rates(id,currency,rate,effective_date) VALUES($1,'EUR',0.25,'2026-09-24')", [legacyId]);
    const legacy = (await second.read()).remittances.rates.find((row) => row.id === legacyId)!;
    assert.equal(legacy.changeId, undefined); assert.equal(legacy.updatedAt, undefined); assert.equal(legacy.updatedBy, undefined);
    const transfer = await store.transaction((state) => {
      setDailyRate(state, admin, { currency: "USD", rate: "0.5", date: businessDate(at) }, at);
      openRemittanceCash(state, admin, { operatorId: admin.id, currency: "USD", openingAmount: 0 }, [], at);
      const input = { ...moneyInput, destinationCurrency: "DOP" as const };
      return createRemittance(state, admin, { ...input, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoteRemittance(state, input, at).quote }, [], at);
    });
    await store.transaction((state) => {
      setDailyRate(state, admin, { currency: "USD", rate: "0.75", date: businessDate(at) }, at);
      setDailyRate(state, admin, { currency: "USD", rate: "0.5", date: businessDate(at) }, at);
      state.clients[0].phone = "Changed after confirmed synthetic transfer";
    });
    const fresh = await second.read(), saved = fresh.remittances.transfers.find((row) => row.id === transfer.id)!;
    assert.deepEqual(saved.senderContact, transfer.senderContact); assert.deepEqual(saved.quote, transfer.quote);
    assert.notEqual(fresh.remittances.rates.find((row) => row.currency === "USD" && row.date === businessDate(at))!.changeId, transfer.quote.sourceRateChangeId);
    assert.throws(() => createRemittance(fresh, admin, { ...moneyInput, destinationCurrency: "DOP", senderClientId: "cli-1", recipientClientId: "cli-5", quote: transfer.quote }, [], at), errorCode("QUOTE_CHANGED"));
    await assert.rejects(client.query("UPDATE remittance_rate_history SET rate=1 WHERE id=$1", [transfer.quote.sourceRateChangeId]), /append-only/);
    await assert.rejects(client.query("DELETE FROM remittance_rate_history WHERE id=$1", [transfer.quote.sourceRateChangeId]), /append-only/);
    await assert.rejects(client.query("UPDATE remittance_transfers SET sender_contact='{}' WHERE id=$1", [transfer.id]), /append-only/);
    const incompatible = fresh.remittances.rateHistory!.find((row) => row.currency === "USD" && row.rate === "0.750000")!;
    await assert.rejects(client.query("UPDATE exchange_rates SET last_change_id=$1 WHERE currency='USD' AND effective_date=$2", [incompatible.id, businessDate(at)]), /foreign key/);
  } finally { await client.end(); await store.close(); await second.close(); }
});
