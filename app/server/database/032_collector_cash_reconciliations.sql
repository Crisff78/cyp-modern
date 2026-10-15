-- Append-only administrative receipts for cash left in earlier operating days.
-- Original movements and their immutable timestamps/amounts are preserved.
CREATE TABLE IF NOT EXISTS collector_cash_reconciliations (
  id text PRIMARY KEY,
  collector_id text NOT NULL REFERENCES collectors(id),
  date date NOT NULL,
  currency text NOT NULL CHECK (currency IN ('DOP','USD','EUR')),
  collected bigint NOT NULL CHECK (collected >= 0),
  deposited bigint NOT NULL CHECK (deposited >= 0),
  office_delivered bigint NOT NULL CHECK (office_delivered >= 0),
  paid_to_clients bigint NOT NULL CHECK (paid_to_clients >= 0),
  returned_collection bigint NOT NULL CHECK (returned_collection >= 0 AND returned_collection = collected - deposited),
  returned_payout bigint NOT NULL CHECK (returned_payout >= 0 AND returned_payout = office_delivered - paid_to_clients),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
  actor_id text NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL,
  CHECK (returned_collection + returned_payout > 0),
  CHECK (date < (created_at AT TIME ZONE 'America/Santo_Domingo')::date),
  UNIQUE (collector_id, date, currency)
);
CREATE OR REPLACE FUNCTION protect_collector_cash_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Cash reconciliation records are immutable';
END $$;
CREATE TRIGGER collector_cash_reconciliation_immutable
  BEFORE UPDATE OR DELETE ON collector_cash_reconciliations
  FOR EACH ROW EXECUTE FUNCTION protect_collector_cash_reconciliation();
