import type pg from "pg";
import type { Remittance, CashSession, ExchangeRate, RemittanceEvent, RemittanceState } from "./remittances.js";

const clean = <T>(row: Record<string, unknown>): T => Object.fromEntries(
  Object.entries(row).filter(([, value]) => value !== null).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
) as T;

export async function readRemittances(client: pg.PoolClient): Promise<RemittanceState> {
  const rates = (await client.query(`SELECT id,currency,rate::text,effective_date::text AS date
    FROM exchange_rates WHERE currency IN ('DOP','USD','EUR') ORDER BY effective_date,currency`)).rows.map((row) => clean<ExchangeRate>(row));
  const cashSessions = (await client.query(`SELECT id,operator_id AS "operatorId",currency,date::text,
    opening_amount AS "openingAmount",opened_by AS "openedBy",opened_at AS "openedAt"
    FROM remittance_cash_sessions ORDER BY date,opened_at,id`)).rows.map((row) => ({ ...clean<CashSession>(row), status: "open" as const }));
  const transfers = (await client.query(`SELECT id,sequence,envio_reference AS "envioReference",recibo_reference AS "reciboReference",
    operating_code AS "operatingCode",sender_client_id AS "senderClientId",recipient_client_id AS "recipientClientId",
    sending_user_id AS "sendingUserId",registered_by AS "registeredBy",source_currency AS "sourceCurrency",
    destination_currency AS "destinationCurrency",amount,commission_bps AS "commissionBps",commission_amount AS "commissionAmount",
    total_amount AS "totalAmount",receive_amount AS "receiveAmount",quote_date::text AS "quoteDate",
    source_rate::text AS "sourceRate",destination_rate::text AS "destinationRate",note,created_at AS "createdAt"
    FROM remittance_transfers ORDER BY sequence`)).rows.map((row) => {
      const { quoteDate, sourceRate, destinationRate, ...rest } = row;
      return { ...clean<Remittance>(rest), status: "pending" as const, quote: { date: quoteDate, sourceRate, destinationRate } };
    });
  const events = (await client.query(`SELECT id,type,transfer_id AS "transferId",cash_session_id AS "cashSessionId",
    operator_id AS "operatorId",currency,amount,actor_id AS "actorId",created_at AS "createdAt",reason
    FROM remittance_events ORDER BY created_at,id`)).rows.map((row) => clean<RemittanceEvent>(row));
  for (const event of events) {
    if (event.type === "closed") {
      const cash = cashSessions.find((c) => c.id === event.cashSessionId);
      if (cash) Object.assign(cash, { status: "closed", closedAt: event.createdAt, closedBy: event.actorId, countedAmount: event.amount });
    }
    if (event.type === "paid" || event.type === "cancelled") {
      const transfer = transfers.find((t) => t.id === event.transferId);
      if (transfer) Object.assign(transfer, event.type === "paid"
        ? { status: "paid", paidAt: event.createdAt, paidBy: event.actorId }
        : { status: "cancelled", cancelledAt: event.createdAt, cancelledBy: event.actorId, cancelReason: event.reason });
    }
  }
  return { rates, cashSessions, transfers, events };
}

export async function saveRemittances(client: pg.PoolClient, state: RemittanceState, before: RemittanceState) {
  for (const rate of state.rates) {
    const old = before.rates.find((r) => r.id === rate.id);
    if (old && JSON.stringify(old) === JSON.stringify(rate)) continue;
    await client.query(`INSERT INTO exchange_rates(id,currency,rate,effective_date) VALUES($1,$2,$3,$4)
      ON CONFLICT(currency,effective_date) DO UPDATE SET rate=EXCLUDED.rate`, [rate.id, rate.currency, rate.rate, rate.date]);
  }
  for (const cash of state.cashSessions) {
    if (before.cashSessions.some((c) => c.id === cash.id)) continue;
    await client.query(`INSERT INTO remittance_cash_sessions(id,operator_id,currency,date,opening_amount,opened_by,opened_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [cash.id,cash.operatorId,cash.currency,cash.date,cash.openingAmount,cash.openedBy,cash.openedAt]);
  }
  for (const t of state.transfers) {
    if (before.transfers.some((old) => old.id === t.id)) continue;
    await client.query(`INSERT INTO remittance_transfers(id,sequence,envio_reference,recibo_reference,operating_code,
      sender_client_id,recipient_client_id,sending_user_id,registered_by,source_currency,destination_currency,
      amount,commission_bps,commission_amount,total_amount,receive_amount,quote_date,source_rate,destination_rate,note,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [t.id,t.sequence,t.envioReference,t.reciboReference,t.operatingCode,t.senderClientId,t.recipientClientId,
        t.sendingUserId,t.registeredBy,t.sourceCurrency,t.destinationCurrency,t.amount,t.commissionBps,
        t.commissionAmount,t.totalAmount,t.receiveAmount,t.quote.date,t.quote.sourceRate,t.quote.destinationRate,t.note,t.createdAt]);
  }
  for (const event of state.events) {
    if (before.events.some((old) => old.id === event.id)) continue;
    await client.query(`INSERT INTO remittance_events(id,type,transfer_id,cash_session_id,operator_id,currency,amount,actor_id,created_at,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [event.id,event.type,event.transferId ?? null,event.cashSessionId,event.operatorId,event.currency,event.amount,event.actorId,event.createdAt,event.reason ?? null]);
  }
}
