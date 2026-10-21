BEGIN;

-- Never reprice accepted transfers. A null kind means the historic operational rate.
ALTER TABLE remittance_transfers ADD COLUMN source_rate_kind text, ADD COLUMN destination_rate_kind text,
  ADD CONSTRAINT remittance_source_kind CHECK (source_rate_kind IS NULL OR source_rate_kind IN ('base','purchase','operative')),
  ADD CONSTRAINT remittance_destination_kind CHECK (destination_rate_kind IS NULL OR destination_rate_kind IN ('base','purchase','sale','operative')),
  ADD CONSTRAINT remittance_base_kinds CHECK ((source_rate_kind IS DISTINCT FROM 'base' OR source_currency='DOP') AND (destination_rate_kind IS DISTINCT FROM 'base' OR destination_currency='DOP')),
  ADD CONSTRAINT remittance_destination_purchase CHECK (destination_rate_kind IS DISTINCT FROM 'purchase' OR source_currency=destination_currency);

ALTER TABLE remittance_rate_history ADD CONSTRAINT remittance_rate_revision_identity UNIQUE(id,currency,effective_date);
ALTER TABLE remittance_transfers DROP CONSTRAINT remittance_source_revision, DROP CONSTRAINT remittance_destination_revision,
  ADD CONSTRAINT remittance_source_revision FOREIGN KEY(source_rate_change_id,source_currency,source_rate_date)
    REFERENCES remittance_rate_history(id,currency,effective_date),
  ADD CONSTRAINT remittance_destination_revision FOREIGN KEY(destination_rate_change_id,destination_currency,destination_rate_date)
    REFERENCES remittance_rate_history(id,currency,effective_date);

-- The FK keeps revision/currency/date linked; this trigger additionally binds
-- the exact applied buy/sell/legacy value to that immutable revision.
CREATE FUNCTION check_remittance_applied_rates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h remittance_rate_history%ROWTYPE; expected numeric;
BEGIN
  IF NEW.source_rate_change_id IS NOT NULL THEN
    SELECT * INTO STRICT h FROM remittance_rate_history WHERE id=NEW.source_rate_change_id;
    expected := CASE NEW.source_rate_kind WHEN 'purchase' THEN h.purchase_rate ELSE h.rate END;
    IF expected IS NULL OR NEW.source_rate<>expected THEN RAISE EXCEPTION 'Source rate does not match immutable revision'; END IF;
  END IF;
  IF NEW.destination_rate_change_id IS NOT NULL THEN
    SELECT * INTO STRICT h FROM remittance_rate_history WHERE id=NEW.destination_rate_change_id;
    expected := CASE NEW.destination_rate_kind WHEN 'purchase' THEN h.purchase_rate WHEN 'sale' THEN h.sale_rate ELSE h.rate END;
    IF expected IS NULL OR NEW.destination_rate<>expected THEN RAISE EXCEPTION 'Destination rate does not match immutable revision'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER remittance_applied_rates BEFORE INSERT ON remittance_transfers
  FOR EACH ROW EXECUTE FUNCTION check_remittance_applied_rates();

COMMIT;
