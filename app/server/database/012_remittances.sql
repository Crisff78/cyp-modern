BEGIN;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Separate cash ledger for remittances. Existing DOP collections/payments stay intact.
CREATE TABLE IF NOT EXISTS remittance_cash_sessions (
  id text PRIMARY KEY,
  operator_id text NOT NULL REFERENCES users(id),
  currency text NOT NULL CHECK (currency IN ('DOP','USD','EUR')),
  date date NOT NULL,
  opening_amount bigint NOT NULL CHECK (opening_amount BETWEEN 0 AND 9007199254740991),
  opened_by text NOT NULL REFERENCES users(id),
  opened_at timestamptz NOT NULL,
  UNIQUE(operator_id,currency,date),
  UNIQUE(id,operator_id,currency)
);

CREATE TABLE IF NOT EXISTS remittance_transfers (
  id text PRIMARY KEY,
  sequence bigint NOT NULL UNIQUE CHECK (sequence BETWEEN 1 AND 99999999),
  envio_reference text NOT NULL UNIQUE,
  recibo_reference text NOT NULL UNIQUE,
  operating_code text NOT NULL UNIQUE,
  sender_client_id text NOT NULL REFERENCES clients(id),
  recipient_client_id text NOT NULL REFERENCES clients(id),
  sending_user_id text NOT NULL REFERENCES users(id),
  registered_by text NOT NULL REFERENCES users(id),
  source_currency text NOT NULL CHECK (source_currency IN ('DOP','USD','EUR')),
  destination_currency text NOT NULL CHECK (destination_currency IN ('DOP','USD','EUR')),
  amount bigint NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
  commission_bps integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  commission_amount bigint NOT NULL CHECK (commission_amount BETWEEN 0 AND 9007199254740991),
  total_amount bigint NOT NULL CHECK (total_amount BETWEEN 1 AND 9007199254740991),
  receive_amount bigint NOT NULL CHECK (receive_amount BETWEEN 1 AND 9007199254740991),
  quote_date date NOT NULL,
  source_rate numeric(18,6) NOT NULL CHECK (source_rate > 0),
  destination_rate numeric(18,6) NOT NULL CHECK (destination_rate > 0),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  CHECK (sender_client_id <> recipient_client_id),
  CHECK (envio_reference = 'ENV' || lpad(sequence::text,8,'0')),
  CHECK (recibo_reference = 'REC' || lpad(sequence::text,8,'0')),
  CHECK (source_currency <> 'DOP' OR source_rate = 1),
  CHECK (destination_currency <> 'DOP' OR destination_rate = 1),
  CHECK (commission_amount = div(amount::numeric * commission_bps * 2 + 10000, 20000)),
  CHECK (total_amount = amount + commission_amount),
  -- Integer quotient preserves half-up exactly, including values near a half cent.
  CHECK (receive_amount = div(amount::numeric * (source_rate * 1000000) * 2 + (destination_rate * 1000000), (destination_rate * 1000000) * 2))
);

CREATE TABLE IF NOT EXISTS remittance_events (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('opened','sent','paid','cancelled','closed')),
  transfer_id text REFERENCES remittance_transfers(id),
  cash_session_id text NOT NULL,
  operator_id text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('DOP','USD','EUR')),
  amount bigint NOT NULL CHECK (amount BETWEEN 0 AND 9007199254740991),
  actor_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  reason text,
  FOREIGN KEY(cash_session_id,operator_id,currency)
    REFERENCES remittance_cash_sessions(id,operator_id,currency),
  CHECK ((type IN ('opened','closed')) = (transfer_id IS NULL)),
  CHECK (type <> 'cancelled' OR (reason IS NOT NULL AND length(trim(reason)) BETWEEN 1 AND 500))
);
CREATE UNIQUE INDEX IF NOT EXISTS remittance_one_terminal
  ON remittance_events(transfer_id) WHERE type IN ('paid','cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS remittance_one_sent
  ON remittance_events(transfer_id) WHERE type = 'sent';
CREATE UNIQUE INDEX IF NOT EXISTS remittance_one_cash_event
  ON remittance_events(cash_session_id,type) WHERE type IN ('opened','closed');
CREATE INDEX IF NOT EXISTS remittance_created ON remittance_transfers(created_at);
CREATE INDEX IF NOT EXISTS remittance_sender ON remittance_transfers(sending_user_id,created_at);
CREATE INDEX IF NOT EXISTS remittance_recipient ON remittance_transfers(recipient_client_id,created_at);
CREATE INDEX IF NOT EXISTS remittance_cash_events ON remittance_events(cash_session_id,created_at,id);

CREATE OR REPLACE FUNCTION protect_remittance_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Remittance ledger is append-only';
END $$;
DROP TRIGGER IF EXISTS immutable_remittance_transfers ON remittance_transfers;
CREATE TRIGGER immutable_remittance_transfers BEFORE UPDATE OR DELETE ON remittance_transfers
  FOR EACH ROW EXECUTE FUNCTION protect_remittance_ledger();
DROP TRIGGER IF EXISTS immutable_remittance_cash_sessions ON remittance_cash_sessions;
CREATE TRIGGER immutable_remittance_cash_sessions BEFORE UPDATE OR DELETE ON remittance_cash_sessions
  FOR EACH ROW EXECUTE FUNCTION protect_remittance_ledger();
DROP TRIGGER IF EXISTS immutable_remittance_events ON remittance_events;
CREATE TRIGGER immutable_remittance_events BEFORE UPDATE OR DELETE ON remittance_events
  FOR EACH ROW EXECUTE FUNCTION protect_remittance_ledger();

COMMIT;
