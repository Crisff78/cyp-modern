import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresStore } from "../src/store.js";
import { type User } from "../src/domain.js";
import { cashBalance, cancelRemittance, createRemittance, openRemittanceCash, quoteRemittance, setDailyRate } from "../src/remittances.js";

test("PostgreSQL 037–039 preserve history, freeze applied buy/sell rates, payments, receipts and verified refunds", {
  skip: !process.env.CYP_EFFECTIVE_RATES_TEST_DATABASE_URL,
}, async () => {
  const target = new URL(process.env.CYP_EFFECTIVE_RATES_TEST_DATABASE_URL!);
  assert.equal(target.protocol, "postgresql:"); assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55438");
  assert.equal(target.username, "effective_rates_qa"); assert.equal(target.pathname, "/cyp_effective_rates_qa");
  assert.equal(target.search, ""); assert.equal(target.hash, "");
  const sql = new pg.Client({ connectionString: target.toString() }); await sql.connect();
  let store: PostgresStore | undefined;
  try {
    assert.equal((await sql.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'")).rows[0].count, 0, "Requires a fresh, empty, owned disposable database");
    const directory = new URL("../database/", import.meta.url);
    const sources = (await readdir(directory)).filter((name) => /^\d{3}_.+\.sql$/.test(name) && Number(name.slice(0, 3)) <= 36).sort();
    assert.equal(sources.length, 36);
    await sql.query("BEGIN");
    for (const file of sources) {
      const body = (await readFile(new URL(file, directory), "utf8")).replace(/^\s*(?:--[^\n]*\n\s*)*BEGIN\s*;/i, "").replace(/COMMIT\s*;\s*$/i, "");
      await sql.query(body);
    }
    await sql.query("COMMIT");
    // Minimal fictional pre-037 records. No operational database or real contacts.
    await sql.query(`BEGIN;
      INSERT INTO users(id,name,email,role) VALUES('rate-admin','Synthetic office','rate-office@example.test','admin');
      INSERT INTO zones(id,name,sector) VALUES('rate-zone','Synthetic zone','Synthetic sector');
      INSERT INTO collectors(id,name,initials,route_id,status,collection_limit,payout_limit,last_seen)
        VALUES('rate-collector','Synthetic collector','SC','rate-route','active',100000000,100000000,'2026-10-16T16:00:00Z');
      INSERT INTO routes(id,name,zone_id,collector_id) VALUES('rate-route','Synthetic route','rate-zone','rate-collector');
      INSERT INTO collection_points(id,route_id,address) VALUES('rate-point-1','rate-route','Fictional address 1'),('rate-point-2','rate-route','Fictional address 2');
      INSERT INTO clients(id,name,code,phone,route_id,collection_point_id) VALUES
        ('rate-sender','Synthetic sender','RATE001','8095550101','rate-route','rate-point-1'),
        ('rate-recipient','Synthetic recipient','RATE002','8095550102','rate-route','rate-point-2');
      INSERT INTO remittance_rate_history(id,currency,effective_date,rate,created_at,actor_id) VALUES
        ('rate-usd-rev','USD','2026-10-16',60,'2026-10-16T16:00:00Z','rate-admin'),
        ('rate-eur-rev','EUR','2026-10-16',75,'2026-10-16T16:00:00Z','rate-admin');
      INSERT INTO exchange_rates(id,currency,rate,effective_date,last_change_id) VALUES
        ('rate-usd','USD',60,'2026-10-16','rate-usd-rev'),('rate-eur','EUR',75,'2026-10-16','rate-eur-rev');
      INSERT INTO remittance_transfers(id,sequence,envio_reference,recibo_reference,operating_code,sender_client_id,recipient_client_id,sending_user_id,registered_by,
        source_currency,destination_currency,amount,commission_bps,commission_amount,total_amount,receive_amount,quote_date,source_rate,destination_rate,note,created_at,source_rate_change_id,destination_rate_change_id)
        VALUES('rate-known',1,'ENV00000001','REC00000001','KNOWN','rate-sender','rate-recipient','rate-admin','rate-admin','USD','EUR',10000,0,0,10000,8000,'2026-10-16',60,75,'Fictional known revision','2026-10-16T16:00:00Z','rate-usd-rev','rate-eur-rev'),
        ('rate-unknown',2,'ENV00000002','REC00000002','UNKNOWN','rate-sender','rate-recipient','rate-admin','rate-admin','USD','EUR',10000,0,0,10000,8000,'2026-10-16',60,75,'Fictional legacy unknown','2026-10-16T16:00:00Z',NULL,NULL);
      COMMIT;`);
    const before = (await sql.query("SELECT to_jsonb(t) AS value FROM remittance_transfers t ORDER BY id")).rows;
    await sql.query(await readFile(new URL("037_remittance_effective_rate_dates.sql", directory), "utf8"));
    const after = (await sql.query("SELECT to_jsonb(t)-'source_rate_date'-'destination_rate_date' AS value FROM remittance_transfers t ORDER BY id")).rows;
    assert.deepEqual(after, before, "Migration must preserve every existing financial and historical field");
    const dates = (await sql.query("SELECT id,source_rate_date::text AS source,destination_rate_date::text AS destination FROM remittance_transfers ORDER BY id")).rows;
    assert.deepEqual(dates, [{ id: "rate-known", source: "2026-10-16", destination: "2026-10-16" }, { id: "rate-unknown", source: null, destination: null }]);
    for (const file of ["038_remittance_payments_receipts.sql", "039_remittance_applied_commercial_rates.sql"]) await sql.query(await readFile(new URL(file, directory), "utf8"));
    assert.equal((await sql.query("SELECT count(*)::int AS count FROM remittance_transfers WHERE payment IS NOT NULL OR receipt_issuer IS NOT NULL OR source_rate_kind IS NOT NULL")).rows[0].count, 0, "No invented historical payment, issuer or applied rate kind");
    assert.equal((await sql.query("SELECT tgenabled FROM pg_trigger WHERE tgname='immutable_remittance_transfers'")).rows[0].tgenabled, "O");
    store = new PostgresStore(target.toString());
    const admin: User = { id: "rate-admin", name: "Synthetic office", role: "admin" }, now = new Date("2026-10-21T16:00:00Z");
    const saved = await store.transaction((state) => {
      openRemittanceCash(state, admin, { operatorId: admin.id, currency: "USD", openingAmount: 0 }, [], now);
      const input = { sourceCurrency: "USD" as const, destinationCurrency: "EUR" as const, amount: 100000 };
      return createRemittance(state, admin, { ...input, senderClientId: "rate-sender", recipientClientId: "rate-recipient", quote: quoteRemittance(state, input, now).quote }, [], now);
    });
    const read = await store.read(), restored = read.remittances.transfers.find((row) => row.id === saved.id)!;
    assert.equal(restored.receiveAmount, 80000); assert.deepEqual(restored.quote, saved.quote); assert.equal(restored.quote.sourceRateDate, "2026-10-16");
    await store.transaction((state) => setDailyRate(state, admin, { currency: "USD", rate: "61", date: "2026-10-21" }, now));
    assert.deepEqual((await store.read()).remittances.transfers.find((row) => row.id === saved.id)!.quote, saved.quote);
    await assert.rejects(sql.query("UPDATE remittance_transfers SET source_rate_date='2026-10-15' WHERE id=$1", [saved.id]), /append-only/);
    for (const [field, value] of [["source_rate_date", "2026-10-15"], ["source_rate", 61], ["source_currency", "DOP"], ["source_rate_date", null]] as const) {
      const id = randomUUID();
      await assert.rejects(sql.query(`INSERT INTO remittance_transfers SELECT (jsonb_populate_record(NULL::remittance_transfers,
        to_jsonb(t) || $2::jsonb)).* FROM remittance_transfers t WHERE id=$1`, [saved.id, JSON.stringify({ id, sequence: 90000000, envio_reference: "ENV90000000", recibo_reference: "REC90000000", operating_code: id, [field]: value })]), /foreign key|check constraint|does not match immutable revision/);
    }
    assert.equal((await sql.query("SELECT count(*)::int AS count FROM remittance_transfers")).rows[0].count, 3);
    const bank = await store.transaction((state) => {
      setDailyRate(state, admin, { currency: "USD", rate: "60", purchaseRate: "59", saleRate: "61", date: "2026-10-21" }, now);
      setDailyRate(state, admin, { currency: "EUR", rate: "70", purchaseRate: "69", saleRate: "75", date: "2026-10-21" }, now);
      state.systemConfig = { ...state.systemConfig, "general.empresa": "Fictional receipt company", receiptFooterNote: "Preserve this synthetic reference." };
      const input = { sourceCurrency: "USD" as const, destinationCurrency: "EUR" as const, amount: 100000 };
      return createRemittance(state, admin, { ...input, senderClientId: "rate-sender", recipientClientId: "rate-recipient", quote: quoteRemittance(state, input, now).quote,
        payment: { method: "transfer", reference: "QA-BANK-123", verified: true } }, [], now);
    });
    assert.equal(bank.receiveAmount, 78667); assert.equal(bank.quote.sourceRateKind, "purchase"); assert.equal(bank.quote.destinationRateKind, "sale");
    let restoredBank = (await store.read()).remittances.transfers.find((row) => row.id === bank.id)!;
    assert.deepEqual(restoredBank.payment, bank.payment); assert.deepEqual(restoredBank.receiptIssuer, bank.receiptIssuer); assert.deepEqual(restoredBank.quote, bank.quote);
    const frozenCash = cashBalance(await store.read(), (await store.read()).remittances.cashSessions[0]).expected;
    await store.transaction((state) => cancelRemittance(state, admin, bank.id, "Fictional bank refund", now, { reference: "QA-REFUND-123", verified: true }));
    const afterRefund = await store.read(); restoredBank = afterRefund.remittances.transfers.find((row) => row.id === bank.id)!;
    assert.equal(restoredBank.status, "cancelled"); assert.equal(restoredBank.refund?.reference, "QA-REFUND-123");
    assert.equal(cashBalance(afterRefund, afterRefund.remittances.cashSessions[0]).expected, frozenCash);
    for (const forged of [{ ...bank.payment!, changeAmount: 1 }, { ...bank.payment!, tenderedAmount: 1 }, { ...bank.payment!, reference: "" }]) {
      const id = randomUUID();
      await assert.rejects(sql.query(`INSERT INTO remittance_transfers SELECT (jsonb_populate_record(NULL::remittance_transfers,to_jsonb(t)||$2::jsonb)).*
        FROM remittance_transfers t WHERE id=$1`, [bank.id, JSON.stringify({ id, sequence: 90000000, envio_reference: "ENV90000000", recibo_reference: "REC90000000", operating_code: id, payment: forged })]), /check constraint/);
    }
    await assert.rejects(sql.query("UPDATE remittance_transfers SET payment=NULL WHERE id=$1", [bank.id]), /append-only/);
    await assert.rejects(sql.query("UPDATE remittance_events SET refund_confirmation=NULL WHERE transfer_id=$1 AND type='cancelled'", [bank.id]), /append-only/);
  } finally { await store?.close(); await sql.end(); }
});
