BEGIN;

-- Daytime withdrawals lower the open box balance. Previous discharges remain withdrawals
-- made after the closing count; their amounts and meaning are unchanged.
ALTER TABLE remittance_cash_movements DROP CONSTRAINT remittance_cash_movements_type_check;
ALTER TABLE remittance_cash_movements ADD CONSTRAINT remittance_cash_movements_type_check
  CHECK (type IN ('addition', 'withdrawal', 'discharge'));

COMMIT;
