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
import { cancelRemittance, cashBalance, createRemittance, openRemittanceCash, quoteRemittance,
  remittanceReports, remittanceSnapshot, setCommissionPolicy, type CreateRemittanceInput, type ManagerCommission } from "../src/remittances.js";

const at = new Date("2026-09-27T16:00:00.000Z");
const admin: User = { id: "demo-admin", name: "Synthetic admin", role: "admin" };
const outside: User = { id: "outside-fixture", name: "Synthetic outsider", role: "collector", collectorId: "col-3" };
const input = { sourceCurrency: "DOP" as const, destinationCurrency: "DOP" as const, amount: 10000, commissionBps: 100 };
const manual: ManagerCommission = { managerName: "Synthetic external gestor", amount: 375, currency: "EUR" };
function fixture() {
  const state = seed();
  setCommissionPolicy(state, admin, { transactionCommissionBps: 100, managerCommissionBps: 0 }, at);
  openRemittanceCash(state, admin, { operatorId: admin.id, currency: "DOP", openingAmount: 0 }, [], at);
  return state;
}
function body(state: State, managerCommission?: ManagerCommission): CreateRemittanceInput {
  return { ...input, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoteRemittance(state, input, at).quote,
    ...(managerCommission === undefined ? {} : { managerCommission }) };
}
const errorCode = (code: string) => (error: unknown) => { assert.equal((error as { code: string }).code, code); return true; };

test("6.8 manual manager snapshot is optional and has no financial or actor inference", () => {
  const without = fixture(), withManual = structuredClone(without);
  const old = createRemittance(without, admin, body(without), [], at);
  const supplied = { ...manual, managerName: `  ${manual.managerName}  ` };
  const created = createRemittance(withManual, admin, body(withManual, supplied), [], at);
  assert.equal(Object.hasOwn(old, "managerCommission"), false, "absence must not manufacture zero or an operator/manager");
  assert.deepEqual(created.managerCommission, manual);
  supplied.managerName = "Changed after registration"; supplied.amount = 999;
  assert.deepEqual(withManual.remittances.transfers[0].managerCommission, manual, "capture owns an immutable snapshot of the input values");
  for (const field of ["amount", "commissionAmount", "totalAmount", "receiveAmount", "commissionBps", "sendingUserId", "registeredBy"] as const)
    assert.equal(created[field], old[field]);
  assert.deepEqual(cashBalance(withManual, withManual.remittances.cashSessions[0]), cashBalance(without, without.remittances.cashSessions[0]));
  assert.deepEqual(withManual.remittances.events.map(({ type, amount, currency, operatorId }) => ({ type, amount, currency, operatorId })),
    without.remittances.events.map(({ type, amount, currency, operatorId }) => ({ type, amount, currency, operatorId })));
  assert.equal(withManual.remittances.cashSessions.length, 1, "informative EUR commission does not open or affect EUR cash");
});

test("6.8 invalid manual commission rejects atomically; explicit zero and exact safe maximum remain exact", () => {
  const state = fixture(), before = structuredClone(state.remittances);
  for (const value of [null, [], {}, { ...manual, managerName: "   " }, { ...manual, managerName: "\u00a0" },
    { ...manual, managerName: "\ufeff" }, { ...manual, managerName: "n".repeat(161) }, { ...manual, managerName: "\u{1f600}".repeat(81) },
    { ...manual, managerName: 12 }, { ...manual, currency: undefined }, { ...manual, currency: "HTG" },
    { ...manual, amount: -1 }, { ...manual, amount: 0.5 }, { ...manual, amount: Number.MAX_SAFE_INTEGER + 1 },
    { ...manual, amount: Infinity }, { ...manual, amount: "375" }, { ...manual, formula: "inferred" }]) {
    assert.throws(() => createRemittance(state, admin, { ...body(state), managerCommission: value as ManagerCommission }, [], at), errorCode("INVALID_MANAGER_COMMISSION"));
    assert.deepEqual(state.remittances, before);
  }
  const zero = createRemittance(state, admin, body(state, { ...manual, amount: 0 }), [], at);
  assert.equal(zero.managerCommission!.amount, 0, "only an explicit zero is recorded");
  const maximum = createRemittance(state, admin, body(state, { ...manual, amount: Number.MAX_SAFE_INTEGER }), [], at);
  assert.equal(maximum.managerCommission!.amount, 9007199254740991);
  const report = remittanceReports(state, admin, { from: "2026-09-27", to: "2026-09-27", grouping: "day" });
  assert.equal(report.managerCommissions.totals[0].amount, Number.MAX_SAFE_INTEGER);
  assert.equal(report.commissions.totals[0].commissionAmount, 200, "business commission is independent");
  const unicodeBoundary = createRemittance(state, admin, body(state, { ...manual, managerName: "\u{1f600}".repeat(80), amount: 0 }), [], at);
  assert.equal(unicodeBoundary.managerCommission!.managerName.length, 160);
  createRemittance(state, admin, body(state, { ...manual, amount: 1 }), [], at);
  const beforeReport = structuredClone(state.remittances);
  assert.throws(() => remittanceReports(state, admin, { from: "2026-09-27", to: "2026-09-27", grouping: "day" }), errorCode("MONEY_RANGE"));
  assert.deepEqual(state.remittances, beforeReport, "report overflow rejects without rounding or state changes");
});

test("7.1 manual commission report groups literal manager/currency and separates cancellation by emission", () => {
  const state = fixture();
  const active = createRemittance(state, admin, body(state, manual), [], at);
  const cancelled = createRemittance(state, admin, body(state, { ...manual, amount: 125 }), [], at);
  cancelRemittance(state, admin, cancelled.id, "Synthetic cancellation", at);
  createRemittance(state, admin, body(state, { ...manual, currency: "USD", amount: 200 }), [], at);
  createRemittance(state, admin, body(state, { ...manual, managerName: "Another literal name", amount: 500 }), [], at);
  createRemittance(state, admin, body(state), [], at);
  const boundary = structuredClone(active); boundary.id = "manager-boundary"; boundary.createdAt = "2026-09-28T03:59:59Z";
  const nextDay = structuredClone(active); nextDay.id = "manager-next-day"; nextDay.createdAt = "2026-09-28T04:00:00Z";
  state.remittances.transfers.push(boundary, nextDay);
  const range = remittanceReports(state, admin, { from: "2026-09-27", to: "2026-09-27", grouping: "range" });
  assert.equal(range.managerCommissions.details.length, 5);
  assert.ok(range.managerCommissions.details.some(({ id }) => id === boundary.id));
  assert.ok(!range.managerCommissions.details.some(({ id }) => id === nextDay.id));
  assert.deepEqual(range.managerCommissions.totals.find(({ currency, managerName }) => currency === "EUR" && managerName === manual.managerName),
    { date: "2026-09-27/2026-09-27", managerName: manual.managerName, currency: "EUR", count: 2, amount: 750, cancelledCount: 1, cancelledAmount: 125 });
  assert.equal(range.managerCommissions.totals.length, 3, "do not combine currencies or infer equal managers");
  assert.equal(range.managerCommissions.details.find(({ id }) => id === cancelled.id)!.status, "cancelled");
  const day = remittanceReports(state, admin, { from: "2026-09-27", to: "2026-09-28", grouping: "day" });
  assert.equal(day.managerCommissions.totals.find(({ date }) => date === "2026-09-28")!.amount, 375);
  assert.deepEqual(remittanceReports(state, outside, { from: "2026-09-27", to: "2026-09-28", grouping: "day" }).managerCommissions, { details: [], totals: [] });
  assert.equal(remittanceSnapshot(state, outside, [], at).transfers.length, 0);
});

test("6.8 FileStore reopen preserves manual snapshot and leaves legacy field absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cyp-manual-manager-")), path = join(directory, "state.json");
  let store: FileStore | undefined;
  try {
    store = await FileStore.open(path, fixture());
    const old = await store.transaction((state) => createRemittance(state, admin, body(state), [], at));
    const created = await store.transaction((state) => createRemittance(state, admin, body(state, manual), [], at));
    await store.close(); store = await FileStore.open(path, seed());
    const rows = (await store.read()).remittances.transfers;
    assert.equal(Object.hasOwn(rows.find(({ id }) => id === old.id)!, "managerCommission"), false);
    assert.deepEqual(rows.find(({ id }) => id === created.id)!.managerCommission, manual);
  } finally { await store?.close(); await unlink(path).catch(() => {}); await unlink(`${path}.tmp`).catch(() => {}); await rmdir(directory); }
});

test("6.8 API validates complete optional manual payload and replays exact snapshot without duplicate or legacy change", async () => {
  const initial = seed(); setCommissionPolicy(initial, admin, { transactionCommissionBps: 100, managerCommissionBps: 0 }, at);
  const store = new MemoryStore(initial);
  const app = await buildApp({ store, secret: "synthetic-manager-remittances-secret-32", demo: true, origins: [], collectorUrl: "http://127.0.0.1:5174" });
  try {
    const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@cyp.local", password: "Demo-CyP-2026!" } })).json().token;
    const headers = { authorization: `Bearer ${token}` };
    const post = (payload: Record<string, unknown>, key = randomUUID()) => app.inject({ method: "POST", url: "/api/envios", payload, headers: { ...headers, "idempotency-key": key } });
    assert.equal((await app.inject({ method: "POST", url: "/api/envios/cajas/abrir", payload: { operatorId: admin.id, currency: "DOP", openingAmount: 0 }, headers: { ...headers, "idempotency-key": randomUUID() } })).statusCode, 200);
    const quote = (await app.inject({ url: "/api/envios/cotizacion?sourceCurrency=DOP&destinationCurrency=DOP&amount=10000&commissionBps=100", headers })).json().quote;
    const payload = { ...input, senderClientId: "cli-1", recipientClientId: "cli-5", quote, managerCommission: manual }, key = randomUUID();
    const before = await store.read();
    for (const value of [null, {}, { ...manual, currency: undefined }, { ...manual, amount: Number.MAX_SAFE_INTEGER + 1 },
      { ...manual, managerName: "\u{1f600}".repeat(81) }, { ...manual, extra: true }]) {
      const invalid = await post({ ...payload, managerCommission: value });
      assert.equal(invalid.statusCode, 400, invalid.body); assert.equal(invalid.json().error.code, "VALIDATION");
      assert.deepEqual((await store.read()).remittances, before.remittances);
    }
    const results = await Promise.all([post(payload, key), post(payload, key)]);
    assert.ok(results.every(({ statusCode }) => statusCode === 200)); assert.deepEqual(results[0].json(), results[1].json());
    assert.deepEqual(results[0].json().managerCommission, manual);
    const after = await store.read();
    assert.deepEqual((await post(payload, key)).json(), results[0].json(), "lost response retry returns original capture");
    assert.deepEqual(await store.read(), after);
    assert.equal((await post({ ...payload, managerCommission: { ...manual, amount: 500 } }, key)).statusCode, 409);
    const { managerCommission: _unused, ...oldBody } = payload, oldKey = randomUUID();
    const old = await post(oldBody, oldKey); assert.equal(old.statusCode, 200, old.body);
    assert.equal(Object.hasOwn(old.json(), "managerCommission"), false);
    assert.deepEqual((await post(oldBody, oldKey)).json(), old.json());
    assert.equal((await store.read()).remittances.transfers.length, 2);
    const zero = await post({ ...payload, managerCommission: { ...manual, amount: 0 } });
    assert.equal(zero.statusCode, 200, zero.body); assert.equal(zero.json().managerCommission.amount, 0);
    const report = (await app.inject({ url: `/api/envios/reportes?from=${businessDate()}&to=${businessDate()}&grouping=day`, headers })).json();
    assert.equal(report.managerCommissions.details.length, 2); assert.equal(report.managerCommissions.totals[0].amount, 375);
  } finally { await app.close(); }
});

test("PostgreSQL 020 preserves nullable history and validates immutable manual snapshot exactly", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Loopback disposable PostgreSQL only");
  assert.equal(url.pathname, "/cyp_suggestions_backend", "Use only the explicit disposable synthetic database");
  const store = new PostgresStore(url.toString()), second = new PostgresStore(url.toString()), client = new pg.Client({ connectionString: url.toString() });
  try {
    const rows = await store.transaction((state) => {
      if (!state.clients.length) Object.assign(state, seed());
      openRemittanceCash(state, admin, { operatorId: admin.id, currency: "DOP", openingAmount: 0 }, [], at);
      return [createRemittance(state, admin, body(state), [], at),
        createRemittance(state, admin, body(state, { ...manual, amount: Number.MAX_SAFE_INTEGER }), [], at),
        createRemittance(state, admin, body(state, { ...manual, amount: 0 }), [], at),
        createRemittance(state, admin, body(state, { ...manual, managerName: "\u{1f600}".repeat(80), amount: 0 }), [], at)];
    });
    const fresh = (await second.read()).remittances.transfers;
    assert.equal(Object.hasOwn(fresh.find(({ id }) => id === rows[0].id)!, "managerCommission"), false);
    assert.deepEqual(fresh.find(({ id }) => id === rows[1].id)!.managerCommission, { ...manual, amount: Number.MAX_SAFE_INTEGER });
    assert.equal(fresh.find(({ id }) => id === rows[2].id)!.managerCommission!.amount, 0);
    assert.equal(fresh.find(({ id }) => id === rows[3].id)!.managerCommission!.managerName.length, 160);
    await client.connect();
    const stored = await client.query("SELECT manager_commission FROM remittance_transfers WHERE id=$1", [rows[0].id]);
    assert.equal(stored.rows[0].manager_commission, null, "legacy absence is SQL NULL, never fabricated zero");
    for (const [index, invalid] of [null, {}, { ...manual, managerName: " " }, { ...manual, managerName: "\t\n" },
      { ...manual, managerName: "\u00a0" }, { ...manual, managerName: "\ufeff" }, { ...manual, managerName: "\u{1f600}".repeat(81) }, { ...manual, managerName: null },
      { ...manual, amount: null }, { ...manual, currency: null }, { managerName: "Synthetic", amount: 1 }, { managerName: "Synthetic", currency: "EUR" },
      { amount: 1, currency: "EUR" }, { ...manual, amount: 1.5 }, { ...manual, amount: "375" },
      { ...manual, amount: Number.MAX_SAFE_INTEGER + 1 }, { ...manual, currency: "HTG" }, { ...manual, extra: true }].entries()) {
      const sequence = rows[1].sequence + 1000 + index;
      // Assign JSONB directly: jsonb_populate_record would turn JSON null into
      // SQL NULL and accidentally exercise the permitted historical absence.
      await assert.rejects(client.query(`INSERT INTO remittance_transfers(
        id,sequence,envio_reference,recibo_reference,operating_code,
        sender_client_id,recipient_client_id,sending_user_id,registered_by,source_currency,destination_currency,
        amount,commission_bps,commission_amount,total_amount,receive_amount,quote_date,source_rate,destination_rate,note,created_at,
        quote_recorded_at,source_rate_change_id,destination_rate_change_id,sender_contact,recipient_contact,manager_commission)
        SELECT $1::text,$2::bigint,$3::text,$4::text,$5::text,
          t.sender_client_id,t.recipient_client_id,t.sending_user_id,t.registered_by,t.source_currency,t.destination_currency,
          t.amount,t.commission_bps,t.commission_amount,t.total_amount,t.receive_amount,t.quote_date,t.source_rate,t.destination_rate,t.note,t.created_at,
          t.quote_recorded_at,t.source_rate_change_id,t.destination_rate_change_id,t.sender_contact,t.recipient_contact,$6::jsonb
        FROM remittance_transfers t WHERE t.id=$7`, [randomUUID(), sequence, `ENV${String(sequence).padStart(8, "0")}`,
        `REC${String(sequence).padStart(8, "0")}`, randomUUID(), JSON.stringify(invalid), rows[1].id]), /manager_commission_valid/);
    }
    await assert.rejects(client.query("UPDATE remittance_transfers SET manager_commission=$1 WHERE id=$2", [JSON.stringify(manual), rows[1].id]), /append-only/);
    await assert.rejects(client.query("DELETE FROM remittance_transfers WHERE id=$1", [rows[1].id]), /append-only/);
    assert.deepEqual((await second.read()).remittances.transfers.find(({ id }) => id === rows[1].id)!.managerCommission, { ...manual, amount: Number.MAX_SAFE_INTEGER });
  } finally { await client.end(); await store.close(); await second.close(); }
});
