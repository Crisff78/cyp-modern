import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { businessDate, hashPassword, type State, type User } from "../src/domain.js";
import { seed } from "../src/seed.js";
import { MemoryStore, FileStore, PostgresStore, type Store } from "../src/store.js";
import {
  cashBalance, closeRemittanceCash, createRemittance, cancelRemittance, normalizeRate,
  openRemittanceCash, payRemittance, quoteRemittance, remittanceReports,
  remittanceSnapshot, setDailyRate, type Currency,
} from "../src/remittances.js";

const now = new Date("2026-09-27T16:00:00.000Z");
const tomorrow = new Date("2026-09-28T16:00:00.000Z");
const admin: User = { id: "admin-remittance", name: "Admin", role: "admin" };
const sender: User = { id: "sender-remittance", name: "Sender", role: "collector", collectorId: "col-1" };
const receiver: User = { id: "receiver-remittance", name: "Receiver", role: "collector", collectorId: "col-2" };
const outsider: User = { id: "outsider-remittance", name: "Other", role: "collector", collectorId: "col-3" };
const operators = [admin, sender, receiver, outsider];
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code: string }).code, expected); return true; };
function fixture(at = now) {
  const state = seed();
  for (const [currency, rate] of [["USD", "60"], ["EUR", "65"]] as const)
    setDailyRate(state, admin, { currency, rate, date: businessDate(at) }, at);
  return state;
}
function open(state: State, operatorId: string, currency: Currency, openingAmount = 0, at = now) {
  return openRemittanceCash(state, admin, { operatorId, currency, openingAmount }, operators, at);
}
function create(state: State, overrides: Record<string, unknown> = {}, actor = sender, at = now) {
  const base = { sourceCurrency: "USD" as Currency, destinationCurrency: "DOP" as Currency, amount: 10000, commissionBps: 100, ...overrides };
  const quote = quoteRemittance(state, base, at).quote;
  return createRemittance(state, actor, { senderClientId: "cli-1", recipientClientId: "cli-5", ...base, quote, ...overrides }, operators, at);
}

test("quote uses exact half-up, fees in source currency and safe BigInt intermediates", () => {
  const state = fixture();
  setDailyRate(state, admin, { currency: "EUR", rate: "2", date: businessDate(now) }, now);
  const quote = quoteRemittance(state, { sourceCurrency: "DOP", destinationCurrency: "EUR", amount: 1, commissionBps: 5000 }, now);
  assert.equal(quote.commissionAmount, 1); assert.equal(quote.totalAmount, 2); assert.equal(quote.receiveAmount, 1);
  assert.equal(normalizeRate("00060.1"), "60.100000");
  setDailyRate(state, admin, { currency: "USD", rate: "10000000000", date: businessDate(now) }, now);
  setDailyRate(state, admin, { currency: "EUR", rate: "10000000000.000001", date: businessDate(now) }, now);
  assert.equal(quoteRemittance(state, { sourceCurrency: "USD", destinationCurrency: "EUR", amount: 5000000000000001, commissionBps: 0 }, now).receiveAmount, 5000000000000000);
  assert.throws(() => quoteRemittance(state, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: Number.MAX_SAFE_INTEGER, commissionBps: 1 }, now), code("MONEY_RANGE"));
  assert.throws(() => normalizeRate("1.0000001"), code("INVALID_RATE"));
  assert.throws(() => normalizeRate("1e3"), code("INVALID_RATE"));
});

test("rates require exact date and quotes reject changed rate or day", () => {
  const state = fixture(); open(state, sender.id, "USD");
  const quote = quoteRemittance(state, { sourceCurrency: "USD", destinationCurrency: "DOP", amount: 10000, commissionBps: 100 }, now).quote;
  assert.throws(() => quoteRemittance(state, { sourceCurrency: "USD", destinationCurrency: "DOP", amount: 1, commissionBps: 0 }, tomorrow), code("RATE_MISSING"));
  setDailyRate(state, admin, { currency: "USD", rate: "61", date: businessDate(now) }, now);
  assert.throws(() => create(state, { quote }), code("QUOTE_CHANGED"));
  assert.throws(() => createRemittance(state, sender, { senderClientId: "cli-1", recipientClientId: "cli-5", sourceCurrency: "USD", destinationCurrency: "DOP", amount: 10000, commissionBps: 100, quote }, operators, tomorrow), code("QUOTE_CHANGED"));
  assert.throws(() => setDailyRate(state, admin, { currency: "DOP", rate: "2", date: businessDate(now) }, now), code("DOP_RATE"));
  assert.throws(() => setDailyRate(state, sender, { currency: "USD", rate: "61", date: businessDate(now) }, now), code("FORBIDDEN"));
});

test("sender differs from registrar, routes are enforced, inactive clients cannot create", () => {
  const state = fixture(); open(state, sender.id, "USD");
  const transfer = create(state, { sendingUserId: sender.id }, admin);
  assert.equal(transfer.sendingUserId, sender.id); assert.equal(transfer.registeredBy, admin.id);
  assert.throws(() => create(state, { sendingUserId: receiver.id }), code("OPERATOR_FORBIDDEN"));
  assert.throws(() => create(state, { senderClientId: "cli-5" }), code("SAME_CLIENT"));
  assert.throws(() => create(state, { senderClientId: "cli-6" }), code("FORBIDDEN"));
  state.clients[0].active = false;
  assert.throws(() => create(state), code("CLIENT_INACTIVE"));
  assert.equal(remittanceSnapshot(state, outsider, operators, now).transfers.length, 0);
  assert.equal(remittanceSnapshot(state, receiver, operators, now).transfers[0].canPay, true);
  assert.equal(remittanceSnapshot(state, sender, operators, now).transfers[0].canPay, false);
});

test("payment is full, once, uses frozen quote and recipient operator cash", () => {
  const state = fixture(); open(state, sender.id, "USD");
  const originalLedger = structuredClone(state.movements);
  const transfer = create(state);
  assert.throws(() => payRemittance(state, sender, transfer.id, now), code("FORBIDDEN"));
  assert.throws(() => payRemittance(state, receiver, transfer.id, now), code("CASH_NOT_OPEN"));
  const cash = open(state, receiver.id, "DOP", 600000);
  setDailyRate(state, admin, { currency: "USD", rate: "80", date: businessDate(now) }, now);
  state.clients[4].active = false;
  const paid = payRemittance(state, receiver, transfer.id, new Date(now.getTime() + 65000));
  assert.equal(paid.receiveAmount, 600000); assert.equal(paid.paidBy, receiver.id);
  assert.equal(cashBalance(state, cash).expected, 0);
  assert.throws(() => payRemittance(state, receiver, transfer.id, now), code("TRANSFER_NOT_PENDING"));
  assert.throws(() => cancelRemittance(state, sender, transfer.id, "duplicate", now), code("TRANSFER_NOT_PENDING"));
  assert.deepEqual(state.movements, originalLedger);
});

test("cancellation refunds principal and fee to sender current open cash, preserves old close", () => {
  const state = fixture(), old = open(state, sender.id, "USD");
  const transfer = create(state); assert.equal(transfer.totalAmount, 10100);
  closeRemittanceCash(state, sender, old.id, 10100, now);
  assert.throws(() => cancelRemittance(state, sender, transfer.id, "No procede", now), code("CASH_NOT_OPEN"));
  const next = open(state, sender.id, "USD", 10100, tomorrow);
  cancelRemittance(state, sender, transfer.id, "No procede", tomorrow);
  assert.equal(cashBalance(state, old).expected, 10100); assert.equal(cashBalance(state, next).expected, 0);
  assert.equal(state.remittances.events.find((e) => e.type === "cancelled")!.cashSessionId, next.id);
  assert.equal(state.remittances.transfers[0].cancelReason, "No procede");
});

test("cash opening/closing constraints, funds and previous-day guard", () => {
  const state = fixture(), cash = open(state, sender.id, "USD");
  assert.throws(() => open(state, sender.id, "USD"), code("CASH_EXISTS"));
  assert.throws(() => open(state, sender.id, "USD", 0, tomorrow), code("PREVIOUS_CASH_OPEN"));
  assert.throws(() => openRemittanceCash(state, sender, { operatorId: sender.id, currency: "DOP", openingAmount: 0 }, operators, now), code("FORBIDDEN"));
  const transfer = create(state); open(state, receiver.id, "DOP", 1);
  assert.throws(() => payRemittance(state, receiver, transfer.id, now), code("INSUFFICIENT_CASH"));
  assert.throws(() => closeRemittanceCash(state, sender, cash.id, 0, now), code("CASH_UNBALANCED"));
  assert.throws(() => closeRemittanceCash(state, receiver, cash.id, 10100, now), code("FORBIDDEN"));
  closeRemittanceCash(state, sender, cash.id, 10100, now);
  assert.throws(() => create(state), code("CASH_NOT_OPEN"));
});

test("recycled cash cannot overflow accumulated sent totals or corrupt the next snapshot", async () => {
  const state = fixture(); open(state, sender.id, "DOP");
  const store = new MemoryStore(state);
  const transfer = await store.transaction((s) => create(s, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: Number.MAX_SAFE_INTEGER, commissionBps: 0 }));
  await store.transaction((s) => cancelRemittance(s, sender, transfer.id, "Devolución", now));
  await assert.rejects(store.transaction((s) => create(s, { sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 1, commissionBps: 0 })), code("MONEY_RANGE"));
  const fresh = await store.read();
  assert.equal(fresh.remittances.transfers.length, 1);
  assert.equal(remittanceSnapshot(fresh, sender, operators, now).cashSessions[0].expected, 0);
});

test("parallel pay/cancel and close/create serialize with one committed outcome", async () => {
  const state = fixture(); open(state, sender.id, "USD"); open(state, receiver.id, "DOP", 600000);
  const t = create(state), store = new MemoryStore(state);
  const results = await Promise.allSettled([
    store.transaction((s) => payRemittance(s, receiver, t.id, now)),
    store.transaction((s) => cancelRemittance(s, sender, t.id, "Carrera", now)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await store.read()).remittances.events.filter((e) => e.transferId === t.id && ["paid", "cancelled"].includes(e.type)).length, 1);
  const fresh = fixture(), cash = open(fresh, sender.id, "USD"), second = new MemoryStore(fresh);
  const closed = await Promise.allSettled([
    second.transaction((s) => closeRemittanceCash(s, sender, cash.id, 0, now)),
    second.transaction((s) => create(s)),
  ]);
  assert.equal(closed[0].status, "fulfilled"); assert.equal(closed[1].status, "rejected");
});

test("reports group all four families by inclusive business date, preserve currency pairs and opening/closing semantics", () => {
  const state = fixture(); const first = open(state, sender.id, "USD"); open(state, receiver.id, "DOP", 2000000);
  const t = create(state); payRemittance(state, receiver, t.id, new Date(now.getTime() + 90000));
  const cancelled = create(state); cancelRemittance(state, sender, cancelled.id, "Sin efecto", now);
  closeRemittanceCash(state, sender, first.id, 10100, now);
  open(state, sender.id, "USD", 10100, tomorrow);
  setDailyRate(state, admin, { currency: "USD", rate: "60", date: businessDate(tomorrow) }, tomorrow);
  create(state, {}, sender, tomorrow);
  open(state, sender.id, "EUR", 0, tomorrow);
  setDailyRate(state, admin, { currency: "EUR", rate: "65", date: businessDate(tomorrow) }, tomorrow);
  create(state, { sourceCurrency: "EUR", commissionBps: 0 }, sender, tomorrow);
  const range = remittanceReports(state, admin, { from: "2026-09-27", to: "2026-09-28", grouping: "range" });
  assert.equal(range.amounts.length, 2); assert.equal(range.amounts[0].cancelledCount, 1);
  assert.equal(range.amounts[0].amount, 20000);
  assert.deepEqual(range.deliveryTimeSummary, [{ date: "2026-09-27/2026-09-28", count: 1, minSeconds: 90, maxSeconds: 90, averageSeconds: 90 }]);
  const usd = range.cashSummary.find((c) => c.operatorId === sender.id && c.currency === "USD")!;
  assert.equal(usd.sessionCount, 2); assert.equal(usd.firstOpening, 0); assert.equal(usd.lastExpected, 20200);
  assert.equal(usd.sentTotal, 30300); assert.equal(usd.cancelRefund, 10100);
  assert.equal(range.delivered[0].currency, "DOP"); assert.equal(range.delivered[0].amount, 600000);
  const days = remittanceReports(state, admin, { from: "2026-09-27", to: "2026-09-28", grouping: "day" });
  assert.equal(days.amounts.length, 3); assert.ok(days.cashSummary.every((c) => c.sessionCount === 1));
  assert.equal(remittanceReports(state, outsider, { from: "2026-09-27", to: "2026-09-28", grouping: "range" }).amounts.length, 0);
  assert.throws(() => remittanceReports(state, admin, { from: "2026-09-28", to: "2026-09-27", grouping: "range" }), code("INVALID_DATE_RANGE"));
  assert.equal(businessDate(new Date("2026-09-28T03:59:59Z")), "2026-09-27");
});

test("FileStore upgrades old shape and reloads transfer, activity, references and cash history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-remittances-file-")), path = join(directory, "state.json");
  try {
    const old = seed() as Partial<State>; delete old.remittances;
    await writeFile(path, JSON.stringify(old));
    let store = await FileStore.open(path, seed());
    assert.deepEqual((await store.read()).remittances.transfers, []);
    await store.transaction((s) => {
      setDailyRate(s, admin, { currency: "USD", rate: "60", date: businessDate(now) }, now);
      open(s, sender.id, "USD"); const t = create(s); cancelRemittance(s, sender, t.id, "Prueba persistencia", now);
      s.clients[0].active = false;
    });
    await store.close(); store = await FileStore.open(path, seed());
    await store.transaction((s) => { s.clients[0].active = true; assert.equal(create(s).envioReference, "ENV00000002"); });
    const state = await store.read();
    assert.equal(state.remittances.transfers[0].status, "cancelled"); assert.equal(state.remittances.events.length, 4);
    assert.equal(cashBalance(state, state.remittances.cashSessions[0]).expected, 10100);
    await store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function apiSetup(store: Store = new MemoryStore(seed())) {
  const app = await buildApp({ store, secret: "synthetic-remittance-test-secret-at-least-32", demo: true, origins: [], collectorUrl: "http://127.0.0.1:5174" });
  const login = async (email: string) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo-CyP-2026!" } })).json().token as string;
  const adminToken = await login("admin@cyp.local"), senderToken = await login("collector@cyp.local");
  const post = (path: string, payload: Record<string, unknown>, token = adminToken, key = randomUUID()) => app.inject({ method: "POST", url: path, payload, headers: { authorization: `Bearer ${token}`, "idempotency-key": key } });
  const get = (path: string, token = adminToken) => app.inject({ url: path, headers: { authorization: `Bearer ${token}` } });
  return { app, post, get, adminToken, senderToken, store };
}

test("API validates DTO, idempotence, activity, representation, receipt scope and both report modes", async () => {
  const { app, post, get, senderToken, store } = await apiSetup();
  try {
    assert.equal((await app.inject("/api/envios/snapshot")).statusCode, 401);
    assert.equal((await post("/api/envios/tasas", { currency: "USD", rate: "60", date: businessDate() })).statusCode, 200);
    assert.equal((await post("/api/envios/cajas/abrir", { operatorId: "demo-collector", currency: "USD", openingAmount: 0 })).statusCode, 200);
    assert.equal((await post("/api/envios/cajas/abrir", { operatorId: "demo-admin", currency: "DOP", openingAmount: 1000000 })).statusCode, 200);
    const quote = (await get("/api/envios/cotizacion?sourceCurrency=USD&destinationCurrency=DOP&amount=10000&commissionBps=100")).json().quote;
    const payload = { senderClientId: "cli-1", recipientClientId: "cli-5", sendingUserId: "demo-collector", sourceCurrency: "USD", destinationCurrency: "DOP", amount: 10000, commissionBps: 100, quote };
    const key = randomUUID();
    const created = await post("/api/envios", payload, undefined, key);
    assert.equal(created.statusCode, 200, created.body);
    const transfer = created.json(); assert.equal(transfer.registeredBy, "demo-admin"); assert.equal(transfer.sendingUserId, "demo-collector");
    assert.deepEqual((await post("/api/envios", payload, undefined, key)).json(), transfer);
    assert.equal((await post("/api/envios", { ...payload, amount: 1 }, undefined, key)).statusCode, 409);
    assert.equal((await post("/api/envios", { ...payload, sendingUserId: "demo-admin" }, senderToken)).statusCode, 403);
    assert.equal((await get("/api/envios/recibos", senderToken)).json().length, 0);
    assert.equal((await post(`/api/envios/${transfer.id}/pagar`, {}, senderToken)).statusCode, 403);
    assert.equal((await post(`/api/envios/${transfer.id}/pagar`, { amount: 1 })).statusCode, 400);
    const paid = await post(`/api/envios/${transfer.id}/pagar`, {}); assert.equal(paid.statusCode, 200, paid.body);
    assert.equal((await post(`/api/envios/${transfer.id}/pagar`, {})).statusCode, 409);
    assert.equal((await post(`/api/envios/${transfer.id}/cancelar`, { reason: "Tarde" })).statusCode, 409);
    assert.equal((await post("/api/clientes/cli-1/actividad", { active: false }, senderToken)).statusCode, 403);
    assert.equal((await post("/api/clientes/cli-1/actividad", { active: false })).statusCode, 200);
    assert.equal((await post("/api/envios", payload)).json().error.code, "CLIENT_INACTIVE");
    assert.equal((await get("/api/envios/snapshot")).json().clients.find((c: { id: string }) => c.id === "cli-1").active, false);
    for (const grouping of ["range", "day"]) {
      const report = (await get(`/api/envios/reportes?from=${businessDate()}&to=${businessDate()}&grouping=${grouping}`)).json();
      assert.equal(report.deliveryTimeSummary.length, 1); assert.equal(report.cashSummary.length, 2); assert.equal(report.delivered[0].amount, 600000);
    }
    assert.equal((await store.read()).remittances.transfers.length, 1);
  } finally { await app.close(); }
});

test("API simultaneous repeated create, pay/cancel and close/send cannot duplicate money", async () => {
  const { app, post, get, senderToken, store } = await apiSetup();
  try {
    await post("/api/envios/cajas/abrir", { operatorId: "demo-collector", currency: "DOP", openingAmount: 0 });
    await post("/api/envios/cajas/abrir", { operatorId: "demo-admin", currency: "DOP", openingAmount: 10000 });
    const quote = (await get("/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=1000&commissionBps=0")).json().quote;
    const body = { senderClientId: "cli-1", recipientClientId: "cli-5", sourceCurrency: "DOP", destinationCurrency: "DOP", amount: 1000, commissionBps: 0, quote };
    const key = randomUUID(), results = await Promise.all([post("/api/envios", body, senderToken, key), post("/api/envios", body, senderToken, key)]);
    assert.ok(results.every((r) => r.statusCode === 200)); assert.equal(results[0].json().id, results[1].json().id);
    const id = results[0].json().id;
    const race = await Promise.all([post(`/api/envios/${id}/pagar`, {}), post(`/api/envios/${id}/cancelar`, { reason: "Carrera" }, senderToken)]);
    assert.equal(race.filter((r) => r.statusCode === 200).length, 1); assert.equal(race.filter((r) => r.statusCode === 409).length, 1);
    assert.equal((await store.read()).remittances.events.filter((e) => e.transferId === id && ["paid", "cancelled"].includes(e.type)).length, 1);
  } finally { await app.close(); }
});

test("PostgreSQL remittances persist exact rates, actor split, immutable events and serialized races", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  // Explicit guard: this test is only for the named disposable synthetic database.
  assert.ok(["/cyp_remittances_backend", "/cyp_remittances_backend_install_20260928"].includes(new URL(url).pathname), "Use only the approved disposable synthetic databases.");
  const store = new PostgresStore(url);
  await store.transaction((s) => { if (!s.clients.length) Object.assign(s, seed()); });
  const uniqueSender: User = { ...sender, id: `sender-${randomUUID()}` };
  const uniqueReceiver: User = { ...receiver, id: `receiver-${randomUUID()}` };
  const uniqueOperators = [admin, uniqueSender, uniqueReceiver];
  const transfer = await store.transaction((s) => {
    for (const actor of uniqueOperators) {
      const existing = s.accounts.find((account) => account.id === actor.id);
      if (existing) {
        assert.equal(existing.role, actor.role);
        assert.equal(existing.collectorId, actor.collectorId);
        assert.equal(existing.status, "active");
        continue;
      }
      s.accounts.push({
        ...actor, email: `${actor.id}@example.test`, ...hashPassword("Synthetic-Remittance-Fixture-2026!"),
        status: "active", credentialVersion: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      });
    }
    setDailyRate(s, admin, { currency: "USD", rate: "10000000000", date: businessDate(now) }, now);
    setDailyRate(s, admin, { currency: "EUR", rate: "10000000000.000001", date: businessDate(now) }, now);
    openRemittanceCash(s, admin, { operatorId: uniqueSender.id, currency: "USD", openingAmount: 0 }, uniqueOperators, now);
    openRemittanceCash(s, admin, { operatorId: uniqueReceiver.id, currency: "EUR", openingAmount: 5000000000000000 }, uniqueOperators, now);
    const amounts = { sourceCurrency: "USD" as const, destinationCurrency: "EUR" as const, amount: 5000000000000001, commissionBps: 0 };
    return createRemittance(s, admin, { ...amounts, senderClientId: "cli-1", recipientClientId: "cli-5", sendingUserId: uniqueSender.id, quote: quoteRemittance(s, amounts, now).quote }, uniqueOperators, now);
  });
  assert.equal(transfer.receiveAmount, 5000000000000000);
  const parallel = new PostgresStore(url);
  try {
    const outcomes = await Promise.allSettled([
      store.transaction((s) => payRemittance(s, uniqueReceiver, transfer.id, now)),
      parallel.transaction((s) => cancelRemittance(s, uniqueSender, transfer.id, "Carrera SQL", now)),
    ]);
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    const state = await parallel.read(), saved = state.remittances.transfers.find((t) => t.id === transfer.id)!;
    assert.equal(saved.registeredBy, admin.id); assert.equal(saved.sendingUserId, uniqueSender.id);
    assert.equal(saved.quote.destinationRate, "10000000000.000001");
    assert.notEqual(saved.status, "pending");
    assert.equal(state.remittances.events.filter((e) => e.transferId === saved.id && ["paid", "cancelled"].includes(e.type)).length, 1);
    const client = new pg.Client({ connectionString: url }); await client.connect();
    try {
      await assert.rejects(client.query("UPDATE remittance_transfers SET note='bad' WHERE id=$1", [saved.id]), /append-only/);
      await assert.rejects(client.query("DELETE FROM remittance_events WHERE transfer_id=$1", [saved.id]), /append-only/);
      const cash = state.remittances.cashSessions.find((c) => c.operatorId === uniqueSender.id)!;
      await store.transaction((s) => closeRemittanceCash(s, uniqueSender, cash.id, cashBalance(s, cash).expected, now));
      const closed = (await parallel.read()).remittances.cashSessions.find((c) => c.id === cash.id)!;
      assert.equal(closed.status, "closed"); assert.equal(closed.closedBy, uniqueSender.id);
    } finally { await client.end(); }
  } finally { await store.close(); await parallel.close(); }
});

test("server refuses invalid selected PostgreSQL and missing real configuration without demo fallback", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const base: NodeJS.ProcessEnv = { ...process.env, JWT_SECRET: "synthetic-startup-test-secret-at-least-32", DEMO_MODE: "true", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/missing?connect_timeout=1", PORT: "0" };
  delete base.NODE_OPTIONS;
  const result = spawnSync(process.execPath, ["app/server/node_modules/tsx/dist/cli.mjs", "app/server/src/index.ts"], { cwd: root, env: base, encoding: "utf8", timeout: 15000 });
  assert.notEqual(result.status, 0); assert.equal(result.error, undefined);
  assert.match(result.stderr, /PostgreSQL no está disponible/);
  assert.doesNotMatch(result.stdout + result.stderr, /API ready|MemoryStore demo fallback|usando MemoryStore/);
  const second = spawnSync(process.execPath, ["app/server/node_modules/tsx/dist/cli.mjs", "app/server/src/index.ts"], { cwd: root, env: { ...base, DEMO_MODE: "false", DATABASE_URL: "" }, encoding: "utf8", timeout: 15000 });
  assert.notEqual(second.status, 0); assert.match(second.stderr, /DATABASE_URL es obligatorio/); assert.doesNotMatch(second.stdout, /API ready/);
});
