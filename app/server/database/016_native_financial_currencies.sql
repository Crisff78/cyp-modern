-- Existing financial movements remain DOP. Adding a constant default preserves
-- the historical ledger; never derive old movement currency from mutable charges.
ALTER TABLE payouts ADD COLUMN currency text NOT NULL DEFAULT 'DOP'
  CHECK (currency IN ('DOP','USD','EUR'));
ALTER TABLE payouts ADD COLUMN due_date date;
ALTER TABLE recurring_payouts ADD COLUMN currency text NOT NULL DEFAULT 'DOP'
  CHECK (currency IN ('DOP','USD','EUR'));
ALTER TABLE collections ADD COLUMN currency text NOT NULL DEFAULT 'DOP'
  CHECK (currency IN ('DOP','USD','EUR'));
ALTER TABLE payments ADD COLUMN currency text NOT NULL DEFAULT 'DOP'
  CHECK (currency IN ('DOP','USD','EUR'));
ALTER TABLE cash_handovers ADD COLUMN currency text NOT NULL DEFAULT 'DOP'
  CHECK (currency IN ('DOP','USD','EUR'));
ALTER TABLE cash_handovers ADD COLUMN note text;
ALTER TABLE daily_settlements ADD COLUMN totals_by_currency jsonb;

-- The existing immutable triggers also protect these new financial fields.
CREATE FUNCTION validate_financial_movement_currency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text;
BEGIN
  IF TG_TABLE_NAME = 'collections' THEN
    SELECT CASE lower(btrim(translate(currency, 'Ó', 'ó'))) WHEN 'dop' THEN 'DOP' WHEN 'peso dominicano' THEN 'DOP'
      WHEN 'usd' THEN 'USD' WHEN 'dólar americano' THEN 'USD' WHEN 'dolar americano' THEN 'USD'
      WHEN 'dólar estadounidense' THEN 'USD' WHEN 'dolar estadounidense' THEN 'USD'
      WHEN 'eur' THEN 'EUR' WHEN 'euro' THEN 'EUR'
      ELSE currency END INTO expected FROM charges WHERE id = NEW.charge_id;
  ELSE
    SELECT currency INTO expected FROM payouts WHERE id = NEW.payout_id;
  END IF;
  IF expected IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'Movement currency must match its obligation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER collections_currency_matches BEFORE INSERT ON collections
  FOR EACH ROW EXECUTE FUNCTION validate_financial_movement_currency();
CREATE TRIGGER payments_currency_matches BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION validate_financial_movement_currency();
CREATE INDEX collections_collector_currency_date ON collections(collector_id,currency,collected_at);
CREATE INDEX payments_collector_currency_date ON payments(collector_id,currency,paid_at);
CREATE INDEX cash_handovers_collector_currency_date ON cash_handovers(collector_id,currency,handed_over_at);
