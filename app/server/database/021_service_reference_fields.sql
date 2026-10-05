-- Manual, optional catalog references only: no tax calculation or stock movement.
ALTER TABLE services
  ADD COLUMN reference_price_cents integer,
  ADD COLUMN reference_currency text,
  ADD COLUMN tax_reference text,
  ADD COLUMN benefit_reference text,
  ADD COLUMN reference_quantity text;

ALTER TABLE services ADD CONSTRAINT services_reference_price_pair CHECK (
  (reference_price_cents IS NULL AND reference_currency IS NULL) OR
  (reference_price_cents IS NOT NULL AND reference_currency IS NOT NULL AND
    reference_price_cents BETWEEN 0 AND 1000000000 AND reference_currency IN ('DOP','USD','EUR'))
);
ALTER TABLE services ADD CONSTRAINT services_reference_text_lengths CHECK (
  (tax_reference IS NULL OR char_length(tax_reference) BETWEEN 1 AND 160) AND
  (benefit_reference IS NULL OR char_length(benefit_reference) BETWEEN 1 AND 160) AND
  (reference_quantity IS NULL OR char_length(reference_quantity) BETWEEN 1 AND 64)
);
