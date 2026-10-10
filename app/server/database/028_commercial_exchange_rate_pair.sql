-- Compra/venta are separate administrative settings. The operational rate and
-- all existing quotes/revision foreign keys retain their original meaning.
-- Historical pairs remain NULL: migration time is not a business observation.
ALTER TABLE exchange_rates ADD COLUMN purchase_rate numeric(18,6), ADD COLUMN sale_rate numeric(18,6);
ALTER TABLE remittance_rate_history ADD COLUMN purchase_rate numeric(18,6), ADD COLUMN sale_rate numeric(18,6);
ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_commercial_pair CHECK (
  (purchase_rate IS NULL AND sale_rate IS NULL) OR
  (purchase_rate IS NOT NULL AND sale_rate IS NOT NULL AND purchase_rate > 0 AND sale_rate > 0 AND
    (currency <> 'DOP' OR (purchase_rate = 1 AND sale_rate = 1)))
);
ALTER TABLE remittance_rate_history ADD CONSTRAINT remittance_rate_history_commercial_pair CHECK (
  (purchase_rate IS NULL AND sale_rate IS NULL) OR
  (purchase_rate IS NOT NULL AND sale_rate IS NOT NULL AND purchase_rate > 0 AND sale_rate > 0 AND
    (currency <> 'DOP' OR (purchase_rate = 1 AND sale_rate = 1)))
);
