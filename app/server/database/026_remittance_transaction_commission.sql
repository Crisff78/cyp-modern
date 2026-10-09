BEGIN;

-- New operations use this central rate. Historical transfers and their
-- immutable allocation snapshots remain unchanged; no commercial rate inferred.
ALTER TABLE remittance_commission_policy
  ADD COLUMN transaction_commission_bps integer NOT NULL DEFAULT 0
    CHECK (transaction_commission_bps BETWEEN 0 AND 10000);

COMMIT;
