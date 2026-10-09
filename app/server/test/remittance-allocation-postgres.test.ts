import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { seed } from "../src/seed.js";
import { PostgresStore } from "../src/store.js";
import { businessDate, type User } from "../src/domain.js";
import { setDailyRate, setCommissionPolicy, quoteRemittance, createRemittance, cancelRemittance,
  openRemittanceCash, remittanceReports, getCommissionPolicy } from "../src/remittances.js";

test("PostgreSQL 024 preserves server rounding, policy snapshots and annulments; rejects forged allocation", { skip: !process.env.CYP_PHASE234_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.CYP_PHASE234_TEST_DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55434"); assert.equal(url.pathname, "/cyp_phase234_qa");
  assert.equal(url.username, "phase234_qa", "Dedicated owned synthetic cluster only");
  const store = new PostgresStore(url.toString()), parallel = new PostgresStore(url.toString());
  const sql = new pg.Client({ connectionString: url.toString() }); await sql.connect();
  const now = new Date("2026-10-09T16:00:00Z"), admin: User = { id: "demo-admin", name: "Synthetic Admin", role: "admin" };
  try {
    await store.transaction((state) => { if (!state.clients.length) Object.assign(state, seed()); });
    const saved = await store.transaction((state) => {
      setDailyRate(state, admin, { currency: "USD", rate: "60", date: businessDate(now) }, now);
      setDailyRate(state, admin, { currency: "EUR", rate: "75", date: businessDate(now) }, now);
      setCommissionPolicy(state, admin, 200, now);
      const existing = state.remittances.cashSessions.find((cash) => cash.operatorId === admin.id && cash.currency === "USD" && cash.date === businessDate(now));
      if (!existing) openRemittanceCash(state, admin, { operatorId: admin.id, currency: "USD", openingAmount: 0 }, [], now);
      const quote = quoteRemittance(state, { sourceCurrency: "USD", destinationCurrency: "EUR", amount: 8000, amountMode: "destination", commissionBps: 500 }, now);
      return createRemittance(state, admin, { sourceCurrency: quote.sourceCurrency, destinationCurrency: quote.destinationCurrency, amount: quote.amount,
        requestedReceiveAmount: 8000, commissionBps: 500, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quote.quote }, [], now);
    });
    const read = await parallel.read(), transfer = read.remittances.transfers.find((row) => row.id === saved.id)!;
    assert.equal(getCommissionPolicy(read).managerCommissionBps, 200);
    assert.deepEqual(transfer.commissionAllocation, saved.commissionAllocation); assert.deepEqual(transfer.quote, saved.quote);
    assert.equal(transfer.amountDop, 600000); assert.equal(transfer.requestedReceiveAmount, 8000); assert.equal(transfer.receiveRoundingDifference, 0);
    await assert.rejects(sql.query("UPDATE remittance_transfers SET commission_allocation=NULL WHERE id=$1", [saved.id]), /append-only/);
    for (const tamper of [{ managerAmount: 9999 }, { currency: "USD" }, { managerId: "forged" }, { baseAmount: 8001 }, { policyRevision: null }, { extra: true }]) {
      await assert.rejects(sql.query(`INSERT INTO remittance_transfers SELECT (jsonb_populate_record(NULL::remittance_transfers,
        to_jsonb(t) || jsonb_build_object('id',$2::text,'sequence',99999999,'envio_reference','ENV99999999','recibo_reference','REC99999999','operating_code',$2::text,'commission_allocation',$3::jsonb))).*
        FROM remittance_transfers t WHERE id=$1`, [saved.id, `forged-${Object.keys(tamper)[0]}`, JSON.stringify({ ...saved.commissionAllocation, ...tamper })]), /remittance_commission_allocation_valid/);
    }
    await store.transaction((state) => { setCommissionPolicy(state, admin, 300, now); cancelRemittance(state, admin, saved.id, "Cancelación QA", now); });
    const cancelled = await parallel.read(), row = cancelled.remittances.transfers.find((transfer) => transfer.id === saved.id)!;
    assert.equal(row.status, "cancelled"); assert.deepEqual(row.commissionAllocation, saved.commissionAllocation);
    assert.equal(getCommissionPolicy(cancelled).managerCommissionBps, 300);
    const report = remittanceReports(cancelled, admin, { from: "2026-10-09", to: "2026-10-09", grouping: "day" });
    assert.equal(report.commissionAllocations.totals[0].managerAmount, 0); assert.ok(report.commissionAllocations.totals[0].cancelledManagerAmount >= 160);
    const legacy = (await sql.query("SELECT id FROM remittance_transfers WHERE commission_allocation IS NULL")).rows;
    for (const row of legacy) assert.equal(cancelled.remittances.transfers.find((transfer) => transfer.id === row.id)!.commissionAllocation, undefined);
  } finally { await sql.end(); await store.close(); await parallel.close(); }
});
