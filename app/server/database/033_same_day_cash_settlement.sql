-- Cuadres Diarios can receive remaining cash when closing today's operation.
-- Keep the append-only journal, amount checks and original migration intact.
ALTER TABLE collector_cash_reconciliations
  DROP CONSTRAINT collector_cash_reconciliations_check3;
ALTER TABLE collector_cash_reconciliations
  ADD CONSTRAINT collector_cash_reconciliations_operating_date_check
  CHECK (date <= (created_at AT TIME ZONE 'America/Santo_Domingo')::date);
