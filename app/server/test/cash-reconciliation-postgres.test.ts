import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { businessDate, postMovement, preview, snapshot, type User } from "../src/domain.js";
import { previousCashPreview, reconcilePreviousCash } from "../src/cash-reconciliation.js";
import { seed } from "../src/seed.js";
import { PostgresStore } from "../src/store.js";

test("isolated PostgreSQL 001–033 preserves movements and serializes immutable cash closing receipts", {
  skip: !process.env.CYP_CASH_RECONCILIATION_TEST_DATABASE_URL,
}, async () => {
  const target = new URL(process.env.CYP_CASH_RECONCILIATION_TEST_DATABASE_URL!);
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55438");
  assert.equal(target.username, "cash_reconciliation_qa"); assert.equal(target.pathname, "/cyp_cash_reconciliation_qa");
  assert.equal(target.search, ""); assert.equal(target.hash, "");
  const sql = new pg.Client({ connectionString: target.toString() });
  const store = new PostgresStore(target.toString()), parallel = new PostgresStore(target.toString());
  await sql.connect();
  const actor: User = { id: "demo-admin", name: "Administración ficticia", role: "admin" }, now = new Date();
  try {
    const server = (await sql.query("SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,current_setting('port') AS port")).rows[0];
    assert.deepEqual(server, { database: "cyp_cash_reconciliation_qa", role: "cash_reconciliation_qa", host: "127.0.0.1", port: "55438" });
    const directory = new URL("../database/", import.meta.url);
    const files = (await readdir(directory)).filter((file) => /^\d{3}_.+\.sql$/.test(file) && Number(file.slice(0, 3)) <= 33).sort();
    assert.equal(files.length, 33);
    const ledger = (await sql.query("SELECT name,sha256 FROM cyp_schema_migrations ORDER BY name")).rows;
    assert.equal(ledger.length, 33);
    for (const file of files) assert.equal(ledger.find((row) => row.name === file)?.sha256,
      createHash("sha256").update(await readFile(new URL(file, directory), "utf8")).digest("hex"), file);
    assert.equal((await store.read()).collectors.length, 0, "Use only a fresh disposable database.");
    const original = seed(); original.movements = []; original.settlements = [];
    const old = new Date(now.getTime() - 2 * 86400000);
    postMovement(original, actor, "office_delivery", { collectorId: "col-1", amount: 100000, currency: "DOP" }, old);
    postMovement(original, actor, "office_delivery", { collectorId: "col-1", amount: 2500, currency: "USD" }, old);
    await store.transaction((state) => { Object.assign(state, original); });
    const movementsBefore = (await sql.query("SELECT * FROM cash_handovers ORDER BY id")).rows;
    const periodsBefore = (await sql.query("SELECT * FROM daily_settlements ORDER BY id")).rows;
    const remittancesBefore = structuredClone((await store.read()).remittances);
    const pending = previousCashPreview(await store.read(), "col-1", now);
    const input = { collectorId: "col-1", revision: pending.revision, amounts: pending.amounts, note: "Devolución de datos ficticios PostgreSQL", confirmReceived: true as const };
    const attempts = await Promise.allSettled([store.transaction((state) => reconcilePreviousCash(state, actor, input, now)), parallel.transaction((state) => reconcilePreviousCash(state, actor, input, now))]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    const reopened = await parallel.read();
    assert.equal(reopened.cashReconciliations?.length, 2);
    assert.deepEqual(reopened.remittances, remittancesBefore);
    assert.deepEqual((await sql.query("SELECT * FROM cash_handovers ORDER BY id")).rows, movementsBefore);
    assert.deepEqual((await sql.query("SELECT * FROM daily_settlements ORDER BY id")).rows, periodsBefore);
    assert.equal(preview(reopened, "col-1").difference, 0); assert.equal(preview(reopened, "col-1", undefined, "USD").difference, 0);
    const closed = snapshot(reopened, actor).settlements.find((row) => row.collectorId === "col-1" && row.date === businessDate(old));
    assert.equal(closed?.cashReconciled, true); assert.equal(closed?.officeDelivered, 100000);
    const record = reopened.cashReconciliations![0];
    await assert.rejects(sql.query("UPDATE collector_cash_reconciliations SET note='modificada' WHERE id=$1", [record.id]), /immutable/);
    await assert.rejects(sql.query("DELETE FROM collector_cash_reconciliations WHERE id=$1", [record.id]), /immutable/);
    await assert.rejects(sql.query("INSERT INTO collector_cash_reconciliations SELECT 'duplicate-fixture',collector_id,date,currency,collected,deposited,office_delivered,paid_to_clients,returned_collection,returned_payout,note,actor_id,created_at FROM collector_cash_reconciliations WHERE id=$1", [record.id]), { code: "23505" });
    await assert.rejects(store.transaction((state) => { state.cashReconciliations![0].returnedPayout += 1; }), { code: "CASH_RECONCILIATION_IMMUTABLE" });
    await store.transaction((state) => postMovement(state, actor, "office_delivery", { collectorId: "col-1", amount: 50000 }, now));
    await parallel.transaction((state) => postMovement(state, actor, "office_delivery", { collectorId: "col-1", amount: 50000 }, now));
    const after = await store.read();
    assert.equal(preview(after, "col-1").difference, 100000); assert.equal(previousCashPreview(after, "col-1", now).rows.length, 0);
    const today = businessDate(now), closing = previousCashPreview(after, "col-1", now, false, today);
    await store.transaction((state) => reconcilePreviousCash(state, actor, { collectorId: "col-1", date: today, revision: closing.revision, amounts: closing.amounts,
      note: "Devolución de cierre del día actual", confirmReceived: true }, now));
    const sameDayReopened = await parallel.read();
    assert.equal(sameDayReopened.cashReconciliations?.filter((row) => row.date === today).length, 1);
    assert.equal(preview(sameDayReopened, "col-1").difference, 0);
    await assert.rejects(store.transaction((state) => postMovement(state, actor, "office_delivery", { collectorId: "col-1", amount: 1000 }, now)), { code: "DAY_CLOSED" });
    await assert.rejects(sql.query("INSERT INTO collector_cash_reconciliations SELECT 'future-fixture',collector_id,date+10,currency,collected,deposited,office_delivered,paid_to_clients,returned_collection,returned_payout,note,actor_id,created_at FROM collector_cash_reconciliations WHERE id=$1", [record.id]), { code: "23514" });
    await assert.rejects(sql.query("INSERT INTO collector_cash_reconciliations SELECT 'invalid-payout-fixture','col-2',date,currency,collected,deposited,office_delivered,paid_to_clients,returned_collection,returned_payout+1,note,actor_id,created_at FROM collector_cash_reconciliations WHERE id=$1", [record.id]), { code: "23514" });
    assert.deepEqual((await sql.query("SELECT * FROM cash_handovers WHERE id=ANY($1) ORDER BY id", [movementsBefore.map((row) => row.id)])).rows, movementsBefore);
    // The original gross balance CHECK was not relaxed to accept artificial closures.
    await assert.rejects(sql.query("INSERT INTO daily_settlements(id,collector_id,date,collected,deposited,office_delivered,paid_to_clients,closed_at,actor_id,status) VALUES('invalid-gross-close','col-1',$1,0,0,100,0,$2,'demo-admin','closed')", [businessDate(now), now.toISOString()]), { code: "23514" });
  } finally { await store.close(); await parallel.close(); await sql.end(); }
});
