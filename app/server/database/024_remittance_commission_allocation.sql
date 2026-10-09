BEGIN;

-- Additive: historical manual annotations remain untouched. The existing
-- immutable transfer trigger also protects these new snapshots.
CREATE TABLE remittance_commission_policy (
  id smallint PRIMARY KEY CHECK (id=1),
  revision text NOT NULL CHECK (length(revision) BETWEEN 1 AND 80),
  manager_commission_bps integer NOT NULL CHECK (manager_commission_bps BETWEEN 0 AND 10000),
  updated_at timestamptz,
  updated_by text REFERENCES users(id)
);
INSERT INTO remittance_commission_policy(id,revision,manager_commission_bps) VALUES(1,'default',0);

ALTER TABLE remittance_transfers
  ADD COLUMN amount_dop bigint CHECK (amount_dop BETWEEN 0 AND 9007199254740991),
  ADD COLUMN requested_receive_amount bigint CHECK (requested_receive_amount BETWEEN 1 AND 9007199254740991),
  ADD COLUMN commission_allocation jsonb,
  ADD CONSTRAINT remittance_dop_equivalent CHECK (amount_dop IS NULL OR amount_dop = div(amount::numeric * source_rate * 1000000 * 2 + 1000000,2000000)),
  ADD CONSTRAINT remittance_destination_input CHECK (requested_receive_amount IS NULL OR amount = div(requested_receive_amount::numeric * destination_rate * 1000000 * 2 + source_rate * 1000000,source_rate * 1000000 * 2));

CREATE FUNCTION valid_commission_allocation(value jsonb,received bigint,commission bigint,
  source_rate numeric,destination_rate numeric,destination_currency text,sending_user_id text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  field text;
  n numeric;
BEGIN
  IF jsonb_typeof(value) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(value)) <> 10
    OR NOT (value ?& ARRAY['version','currency','policyRevision','managerCommissionBps','baseAmount','transactionAmount','companyAmount','managerAmount','managerId','managerName']) THEN RETURN false; END IF;
  FOR field IN SELECT unnest(ARRAY['version','managerCommissionBps','baseAmount','transactionAmount','companyAmount','managerAmount']) LOOP
    IF jsonb_typeof(value->field) <> 'number' THEN RETURN false; END IF;
    n := (value->>field)::numeric;
    IF n < 0 OR n > 9007199254740991 OR n <> trunc(n) THEN RETURN false; END IF;
  END LOOP;
  FOR field IN SELECT unnest(ARRAY['currency','policyRevision','managerId','managerName']) LOOP
    IF jsonb_typeof(value->field) <> 'string' OR length(btrim(value->>field))=0 THEN RETURN false; END IF;
  END LOOP;
  RETURN (value->>'version')::numeric=1
    AND value->>'currency'=destination_currency AND value->>'managerId'=sending_user_id
    AND length(value->>'policyRevision') <= 80 AND length(value->>'managerName') <= 160
    AND (value->>'managerCommissionBps')::numeric BETWEEN 0 AND 10000
    AND (value->>'baseAmount')::numeric=received
    AND (value->>'transactionAmount')::numeric=div(commission::numeric * source_rate * 1000000 * 2 + destination_rate * 1000000,destination_rate * 1000000 * 2)
    AND (value->>'managerAmount')::numeric=div(received::numeric * (value->>'managerCommissionBps')::numeric * 2 + 10000,20000)
    AND (value->>'companyAmount')::numeric + (value->>'managerAmount')::numeric = (value->>'transactionAmount')::numeric;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE remittance_transfers ADD CONSTRAINT remittance_commission_allocation_valid
  CHECK (commission_allocation IS NULL OR valid_commission_allocation(commission_allocation,receive_amount,commission_amount,source_rate,destination_rate,destination_currency,sending_user_id));

COMMIT;
