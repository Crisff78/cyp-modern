BEGIN;

-- Freeze the actual effective dates independently from the date of the quote.
-- Unknown legacy dates remain null. The only metadata backfill comes from the
-- exact immutable history references already recorded on the transfer.
ALTER TABLE remittance_transfers
  ADD COLUMN source_rate_date date,
  ADD COLUMN destination_rate_date date,
  ADD CONSTRAINT remittance_source_rate_date_valid CHECK (source_rate_date IS NULL OR source_rate_date <= quote_date),
  ADD CONSTRAINT remittance_destination_rate_date_valid CHECK (destination_rate_date IS NULL OR destination_rate_date <= quote_date);

ALTER TABLE remittance_transfers DISABLE TRIGGER immutable_remittance_transfers;
UPDATE remittance_transfers t SET source_rate_date=h.effective_date
  FROM remittance_rate_history h WHERE h.id=t.source_rate_change_id;
UPDATE remittance_transfers t SET destination_rate_date=h.effective_date
  FROM remittance_rate_history h WHERE h.id=t.destination_rate_change_id;
ALTER TABLE remittance_transfers ENABLE TRIGGER immutable_remittance_transfers;

-- Keep revision, currency, price and date linked. Using quote_date here would
-- reject a valid carried-forward rate as soon as a new business day begins.
ALTER TABLE remittance_transfers
  DROP CONSTRAINT remittance_source_revision,
  DROP CONSTRAINT remittance_destination_revision,
  ADD CONSTRAINT remittance_source_revision_date_required CHECK (source_rate_change_id IS NULL OR source_rate_date IS NOT NULL),
  ADD CONSTRAINT remittance_destination_revision_date_required CHECK (destination_rate_change_id IS NULL OR destination_rate_date IS NOT NULL),
  ADD CONSTRAINT remittance_source_revision FOREIGN KEY(source_rate_change_id,source_currency,source_rate_date,source_rate)
    REFERENCES remittance_rate_history(id,currency,effective_date,rate),
  ADD CONSTRAINT remittance_destination_revision FOREIGN KEY(destination_rate_change_id,destination_currency,destination_rate_date,destination_rate)
    REFERENCES remittance_rate_history(id,currency,effective_date,rate);

COMMIT;
