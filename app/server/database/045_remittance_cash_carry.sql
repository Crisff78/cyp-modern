BEGIN;

-- Caja de remesas as the review of Mayo asks (26-10-2026). Only additions: the boxes, events and permissions saved
-- before stay as they are.

-- The opening of a day comes from the close of the box before (same operator and currency): the box it came from.
ALTER TABLE remittance_cash_sessions ADD COLUMN IF NOT EXISTS carried_from text REFERENCES remittance_cash_sessions(id);

-- Money given to an open box after its opening (entregas adicionales) and money taken from the operator when his box
-- closes (descargo). A discharge lowers what the next opening brings; it never changes a box already closed.
CREATE TABLE IF NOT EXISTS remittance_cash_movements (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('addition','discharge')),
  cash_session_id text NOT NULL,
  operator_id text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('DOP','USD','EUR')),
  amount bigint NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
  actor_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  FOREIGN KEY(cash_session_id,operator_id,currency)
    REFERENCES remittance_cash_sessions(id,operator_id,currency)
);
CREATE INDEX IF NOT EXISTS remittance_cash_movements_session ON remittance_cash_movements(cash_session_id,created_at,id);
DROP TRIGGER IF EXISTS immutable_remittance_cash_movements ON remittance_cash_movements;
CREATE TRIGGER immutable_remittance_cash_movements BEFORE UPDATE OR DELETE ON remittance_cash_movements
  FOR EACH ROW EXECUTE FUNCTION protect_remittance_ledger();

-- New permission «Cambiar el efectivo inicial de la caja de remesas»: the list of allowed keys grows by one.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_remittance_permissions_check;
ALTER TABLE users ADD CONSTRAINT users_remittance_permissions_check
  CHECK (cardinality(remittance_permissions) <= 15 AND remittance_permissions <@ ARRAY[
    'remittances.view','remittances.create','remittances.receipts','remittances.pay',
    'remittances.cancel','remittances.clients.create','remittances.cash.view',
    'remittances.cash.open','remittances.cash.close','remittances.cash.opening.edit','remittances.reports',
    'remittances.rates.view','remittances.rates.manage',
    'remittances.commissions.view','remittances.commissions.manage'
  ]::text[]);

COMMIT;
