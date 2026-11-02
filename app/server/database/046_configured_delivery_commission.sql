BEGIN;

-- Applies only to future sends. Historical calculations keep their frozen percentages and amounts.
ALTER TABLE remittance_commission_policy
  ADD COLUMN delivery_commission_bps integer NOT NULL DEFAULT 0
  CHECK (delivery_commission_bps BETWEEN 0 AND 9999);

COMMIT;
