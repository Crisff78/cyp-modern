BEGIN;

-- Existing daily rates remain the current projection. Earlier timestamps and
-- contacts are unknown; never backfill them from migration time/current clients.
CREATE TABLE remittance_rate_history (
  id text PRIMARY KEY,
  currency text NOT NULL CHECK (currency IN ('DOP','USD','EUR')),
  effective_date date NOT NULL,
  rate numeric(18,6) NOT NULL CHECK (rate > 0),
  created_at timestamptz NOT NULL,
  actor_id text NOT NULL REFERENCES users(id),
  CHECK (currency <> 'DOP' OR rate = 1),
  UNIQUE(id,currency,effective_date,rate)
);
CREATE INDEX remittance_rate_history_date ON remittance_rate_history(currency,effective_date,created_at,id);
CREATE TRIGGER immutable_remittance_rate_history BEFORE UPDATE OR DELETE ON remittance_rate_history
  FOR EACH ROW EXECUTE FUNCTION protect_remittance_ledger();

ALTER TABLE exchange_rates ADD COLUMN last_change_id text;
ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_current_revision
  FOREIGN KEY(last_change_id,currency,effective_date,rate)
  REFERENCES remittance_rate_history(id,currency,effective_date,rate);

ALTER TABLE remittance_transfers ADD COLUMN quote_recorded_at timestamptz;
ALTER TABLE remittance_transfers ADD COLUMN source_rate_change_id text;
ALTER TABLE remittance_transfers ADD COLUMN destination_rate_change_id text;
ALTER TABLE remittance_transfers ADD COLUMN sender_contact jsonb;
ALTER TABLE remittance_transfers ADD COLUMN recipient_contact jsonb;
ALTER TABLE remittance_transfers ADD CONSTRAINT remittance_source_revision
  FOREIGN KEY(source_rate_change_id,source_currency,quote_date,source_rate)
  REFERENCES remittance_rate_history(id,currency,effective_date,rate);
ALTER TABLE remittance_transfers ADD CONSTRAINT remittance_destination_revision
  FOREIGN KEY(destination_rate_change_id,destination_currency,quote_date,destination_rate)
  REFERENCES remittance_rate_history(id,currency,effective_date,rate);
ALTER TABLE remittance_transfers ADD CONSTRAINT remittance_sender_contact_object
  CHECK (sender_contact IS NULL OR jsonb_typeof(sender_contact) = 'object');
ALTER TABLE remittance_transfers ADD CONSTRAINT remittance_recipient_contact_object
  CHECK (recipient_contact IS NULL OR jsonb_typeof(recipient_contact) = 'object');

COMMIT;
