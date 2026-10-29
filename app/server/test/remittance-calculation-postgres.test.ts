import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { seed } from "../src/seed.js";
import { PostgresStore } from "../src/store.js";
import { businessDate, type User } from "../src/domain.js";
import { createRemittance, getCommissionPolicy, openRemittanceCash, payRemittance, quoteRemittance, saveDeliveryConcept, setCommissionPolicy, setDailyRate } from "../src/remittances.js";

// Migration 044 (meeting of 29-10-2026) on a dedicated synthetic database. The runner stops after 043, sets a former
// policy (5% commission, 2% manager) and then applies 044, which must turn it into 40% of the commission.
test("PostgreSQL 044 saves the whole calculation of a send and refuses forged numbers", { skip: !process.env.CYP_CALCULATION_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.CYP_CALCULATION_TEST_DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55437"); assert.equal(url.pathname, "/cyp_calculation_qa");
  assert.equal(url.username, "calculation_qa", "Dedicated owned synthetic database only");
  const store = new PostgresStore(url.toString()), parallel = new PostgresStore(url.toString());
  const sql = new pg.Client({ connectionString: url.toString() }); await sql.connect();
  const now = new Date(), day = businessDate(now), admin: User = { id: "demo-admin", name: "Synthetic Admin", role: "admin" };
  const copy = (id: string, changes: string, values: unknown[]) => sql.query(`INSERT INTO remittance_transfers SELECT (jsonb_populate_record(NULL::remittance_transfers,
    to_jsonb(t) || jsonb_build_object('id',$2::text,'sequence',99999999,'envio_reference','ENV99999999','recibo_reference','REC99999999','operating_code',$2::text${changes}))).*
    FROM remittance_transfers t WHERE id=$1`, [id, "forged-calculation", ...values]);
  try {
    const migrated = (await sql.query("SELECT manager_share_bps,receive_rounding FROM remittance_commission_policy WHERE id=1")).rows[0];
    assert.deepEqual(migrated, { manager_share_bps: 4000, receive_rounding: "none" }, "5% commission and 2% manager become 40% of the commission");
    await store.transaction((state) => { if (!state.clients.length) Object.assign(state, { ...seed(), remittances: state.remittances }); });
    assert.equal(getCommissionPolicy(await parallel.read()).managerShareBps, 4000);
    const saved = await store.transaction((state) => {
      setDailyRate(state, admin, { currency: "USD", rate: "60", purchaseRate: "58", saleRate: "61", date: day }, now);
      setDailyRate(state, admin, { currency: "EUR", rate: "68", purchaseRate: "66", saleRate: "70", date: day }, now);
      setCommissionPolicy(state, admin, { transactionCommissionBps: 500, managerShareBps: 4000, receiveRounding: "normal" }, now);
      const concept = saveDeliveryConcept(state, admin, { name: "Entrega a domicilio", commissionBps: 1000, active: true }, now);
      for (const currency of ["USD", "EUR"] as const) openRemittanceCash(state, admin, { operatorId: admin.id, currency, openingAmount: currency === "EUR" ? 1000000 : 0 }, [], now);
      const quoted = quoteRemittance(state, { sourceCurrency: "USD", destinationCurrency: "EUR", amount: 10500, amountMode: "total", deliveryConceptId: concept.id }, now);
      return createRemittance(state, admin, { sourceCurrency: "USD", destinationCurrency: "EUR", amount: quoted.amount, requestedTotalAmount: 10500,
        deliveryConceptId: concept.id, senderClientId: "cli-1", recipientClientId: "cli-5", quote: quoted.quote }, [], now);
    });
    // 100 USD bought at 58 = 5,800 DOP, sold at 70 = 82.86 EUR; 10% at the destination = 8.29; 74.57 rounded to 75.00.
    assert.equal(saved.amount, 10000); assert.equal(saved.receiveAmount, 8286);
    assert.equal(saved.calculation?.deliveryCommissionAmount, 829); assert.equal(saved.calculation?.payoutAmount, 7500); assert.equal(saved.calculation?.roundingAdjustment, 43);
    assert.equal(saved.calculation?.exchangeGain?.totalAmount, 63144); assert.equal(saved.commissionAllocation?.managerAmount, 200);
    const read = await parallel.read(), row = read.remittances.transfers.find((transfer) => transfer.id === saved.id)!;
    const { canPay: _pay, canCancel: _cancel, ...expected } = saved;
    assert.deepEqual(row, expected, "the send reads back exactly as it was saved");
    assert.deepEqual(getCommissionPolicy(read), getCommissionPolicy(await store.read()));
    assert.deepEqual(read.remittances.deliveryConcepts?.map(({ name, commissionBps, active }) => ({ name, commissionBps, active })), [{ name: "Entrega a domicilio", commissionBps: 1000, active: true }]);
    const stored = (await sql.query("SELECT payout_amount,commission_allocation,commission_split IS NOT NULL AS split FROM remittance_transfers WHERE id=$1", [saved.id])).rows[0];
    assert.deepEqual(stored, { payout_amount: 7500, commission_allocation: null, split: true });

    // Forged calculations are refused by the database itself.
    const calculation = saved.calculation!;
    for (const [label, forged] of [
      ["payout", { ...calculation, payoutAmount: 7600 }], ["rounding", { ...calculation, roundingAdjustment: 44 }], ["delivery", { ...calculation, deliveryCommissionAmount: 1 }],
      ["version", { ...calculation, version: 1 }], ["mode", { ...calculation, amountMode: "otro" }], ["extra", { ...calculation, extra: true }],
      ["gain", { ...calculation, exchangeGain: { ...calculation.exchangeGain, totalAmount: 1 } }],
      ["gain leg", { ...calculation, exchangeGain: { ...calculation.exchangeGain, sourceAmount: 1, totalAmount: 1 + calculation.exchangeGain!.destinationAmount } }],
    ] as const) await assert.rejects(copy(saved.id, ",'calculation',$3::jsonb,'payout_amount',$4::bigint", [JSON.stringify(forged), (forged as { payoutAmount: number }).payoutAmount]), /remittance_calculation_valid/, label);
    await assert.rejects(copy(saved.id, ",'payout_amount',NULL::bigint", []), /remittance_calculation_payout/);
    // Consistent numbers with rates that are not the revision's: the trigger compares them with the immutable history.
    const otherRates = { ...calculation, exchangeGain: { ...calculation.exchangeGain!, sourcePurchaseRate: "57.000000", sourceAmount: 40000, totalAmount: 40000 + calculation.exchangeGain!.destinationAmount } };
    await assert.rejects(copy(saved.id, ",'calculation',$3::jsonb", [JSON.stringify(otherRates)]), /Exchange gain does not match/);
    for (const tamper of [{ managerAmount: 1 }, { currency: "EUR" }, { version: 1 }]) await assert.rejects(copy(saved.id, ",'commission_split',$3::jsonb", [JSON.stringify({ ...saved.commissionAllocation, ...tamper })]), /remittance_commission_split_valid/);
    await assert.rejects(sql.query("UPDATE remittance_transfers SET payout_amount=1 WHERE id=$1", [saved.id]), /append-only/);

    // Paying moves what the person receives (75.00 EUR), never the converted 82.86.
    await store.transaction((state) => payRemittance(state, admin, saved.id, now));
    const paid = (await sql.query("SELECT amount FROM remittance_events WHERE transfer_id=$1 AND type='paid'", [saved.id])).rows[0];
    assert.equal(paid.amount, 7500);

    // The configuration tables keep their rules.
    await assert.rejects(sql.query("UPDATE remittance_commission_policy SET manager_share_bps=10001 WHERE id=1"));
    await assert.rejects(sql.query("UPDATE remittance_commission_policy SET receive_rounding='abajo' WHERE id=1"));
    await assert.rejects(sql.query("INSERT INTO remittance_delivery_concepts(id,name,commission_bps,active,updated_at) VALUES('sin-comision','Otra',0,true,now())"));
    await assert.rejects(sql.query("INSERT INTO remittance_delivery_concepts(id,name,commission_bps,active,updated_at) VALUES('qa-duplicate','ENTREGA A DOMICILIO',0,true,now())"));
    await assert.rejects(sql.query("INSERT INTO remittance_delivery_concepts(id,name,commission_bps,active,updated_at) VALUES('qa-total','Todo',10000,true,now())"));
  } finally { await sql.end(); await store.close(); await parallel.close(); }
});
