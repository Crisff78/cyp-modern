import type pg from "pg";
import { type Remittance, type CashSession, type ExchangeRate, type RateChange, type RemittanceEvent, type RemittanceState } from "./remittances.js";
import { DomainError } from "./domain.js";

const clean = <T>(row: Record<string, unknown>): T => Object.fromEntries(
  Object.entries(row).filter(([, value]) => value !== null).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
) as T;

export async function readRemittances(client: pg.PoolClient): Promise<RemittanceState> {
  const rates = (await client.query(`SELECT r.id,r.currency,r.rate::text,r.effective_date::text AS date,
    r.last_change_id AS "changeId",h.created_at AS "updatedAt",h.actor_id AS "updatedBy"
    FROM exchange_rates r LEFT JOIN remittance_rate_history h ON h.id=r.last_change_id
    WHERE r.currency IN ('DOP','USD','EUR') ORDER BY r.effective_date,r.currency`)).rows.map((row) => clean<ExchangeRate>(row));
  const rateHistory = (await client.query(`SELECT id,currency,rate::text,effective_date::text AS date,
    created_at AS "createdAt",actor_id AS "actorId" FROM remittance_rate_history
    ORDER BY effective_date,created_at,id`)).rows.map((row) => clean<RateChange>(row));
  const cashSessions = (await client.query(`SELECT id,operator_id AS "operatorId",currency,date::text,
    opening_amount AS "openingAmount",opened_by AS "openedBy",opened_at AS "openedAt"
    FROM remittance_cash_sessions ORDER BY date,opened_at,id`)).rows.map((row) => ({ ...clean<CashSession>(row), status: "open" as const }));
  const transfers = (await client.query(`SELECT t.id,t.sequence,t.envio_reference AS "envioReference",t.recibo_reference AS "reciboReference",
    t.operating_code AS "operatingCode",t.sender_client_id AS "senderClientId",t.recipient_client_id AS "recipientClientId",
    t.sending_user_id AS "sendingUserId",t.registered_by AS "registeredBy",t.source_currency AS "sourceCurrency",
    t.destination_currency AS "destinationCurrency",t.amount,t.commission_bps AS "commissionBps",t.commission_amount AS "commissionAmount",
    t.total_amount AS "totalAmount",t.receive_amount AS "receiveAmount",t.quote_date::text AS "quoteDate",
    t.source_rate::text AS "sourceRate",t.destination_rate::text AS "destinationRate",t.note,t.created_at AS "createdAt",
    t.quote_recorded_at AS "quotedAt",t.source_rate_change_id AS "sourceRateChangeId",t.destination_rate_change_id AS "destinationRateChangeId",
    sh.created_at AS "sourceRateChangedAt",dh.created_at AS "destinationRateChangedAt",
    t.sender_contact AS "senderContact",t.recipient_contact AS "recipientContact",t.manager_commission AS "managerCommission"
    FROM remittance_transfers t LEFT JOIN remittance_rate_history sh ON sh.id=t.source_rate_change_id
    LEFT JOIN remittance_rate_history dh ON dh.id=t.destination_rate_change_id ORDER BY t.sequence`)).rows.map((row) => {
      const { quoteDate, sourceRate, destinationRate, quotedAt, sourceRateChangeId, destinationRateChangeId, sourceRateChangedAt, destinationRateChangedAt, ...rest } = row;
      return { ...clean<Remittance>(rest), status: "pending" as const, quote: clean<Remittance["quote"]>({ date: quoteDate, sourceRate, destinationRate,
        quotedAt, sourceRateChangeId, destinationRateChangeId, sourceRateChangedAt, destinationRateChangedAt }) };
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
  return { rates, rateHistory, cashSessions, transfers, events };
}

export async function saveRemittances(client: pg.PoolClient, state: RemittanceState, before: RemittanceState) {
  const oldHistory = new Map((before.rateHistory ?? []).map((row) => [row.id, row]));
  for (const old of oldHistory.values()) {
    if (JSON.stringify(state.rateHistory?.find((row) => row.id === old.id)) !== JSON.stringify(old))
      throw new DomainError("RATE_HISTORY_IMMUTABLE", "El historial de tasas es inmutable.", 409);
  }
  for (const change of state.rateHistory ?? []) {
    if (oldHistory.has(change.id)) continue;
    await client.query(`INSERT INTO remittance_rate_history(id,currency,effective_date,rate,created_at,actor_id)
      VALUES($1,$2,$3,$4,$5,$6)`, [change.id,change.currency,change.date,change.rate,change.createdAt,change.actorId]);
  }
  for (const rate of state.rates) {
    const old = before.rates.find((r) => r.id === rate.id);
    if (old && JSON.stringify(old) === JSON.stringify(rate)) continue;
    await client.query(`INSERT INTO exchange_rates(id,currency,rate,effective_date,last_change_id) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(currency,effective_date) DO UPDATE SET rate=EXCLUDED.rate,last_change_id=EXCLUDED.last_change_id`, [rate.id, rate.currency, rate.rate, rate.date,rate.changeId ?? null]);
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
      amount,commission_bps,commission_amount,total_amount,receive_amount,quote_date,source_rate,destination_rate,note,created_at,
      quote_recorded_at,source_rate_change_id,destination_rate_change_id,sender_contact,recipient_contact,manager_commission)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [t.id,t.sequence,t.envioReference,t.reciboReference,t.operatingCode,t.senderClientId,t.recipientClientId,
        t.sendingUserId,t.registeredBy,t.sourceCurrency,t.destinationCurrency,t.amount,t.commissionBps,
        t.commissionAmount,t.totalAmount,t.receiveAmount,t.quote.date,t.quote.sourceRate,t.quote.destinationRate,t.note,t.createdAt,
        t.quote.quotedAt ?? null,t.quote.sourceRateChangeId ?? null,t.quote.destinationRateChangeId ?? null,
        t.senderContact ? JSON.stringify(t.senderContact) : null,t.recipientContact ? JSON.stringify(t.recipientContact) : null,
        t.managerCommission ? JSON.stringify(t.managerCommission) : null]);
  }
  for (const event of state.events) {
    if (before.events.some((old) => old.id === event.id)) continue;
    await client.query(`INSERT INTO remittance_events(id,type,transfer_id,cash_session_id,operator_id,currency,amount,actor_id,created_at,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [event.id,event.type,event.transferId ?? null,event.cashSessionId,event.operatorId,event.currency,event.amount,event.actorId,event.createdAt,event.reason ?? null]);
  }
}
