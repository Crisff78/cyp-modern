BEGIN;

-- Manual informative snapshots only. Existing transfers remain NULL; no formula,
-- inferred manager, payout, currency conversion or cash-ledger change is introduced.
ALTER TABLE remittance_transfers ADD COLUMN manager_commission jsonb;

CREATE FUNCTION valid_manual_manager_commission(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  field_count integer;
  manager_name text;
  manager_name_units integer := 0;
  character_index integer;
  commission_amount numeric;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  SELECT count(*) INTO field_count FROM jsonb_object_keys(value);
  IF field_count <> 3 OR NOT (value ?& ARRAY['managerName','amount','currency']) THEN RETURN false; END IF;
  IF jsonb_typeof(value->'managerName') <> 'string'
     OR jsonb_typeof(value->'amount') <> 'number'
     OR jsonb_typeof(value->'currency') <> 'string' THEN RETURN false; END IF;
  -- Match ECMAScript String.trim(), including Unicode whitespace used by the API.
  manager_name := btrim(value->>'managerName', ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)
    || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196)
    || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
    || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279));
  IF length(manager_name) NOT BETWEEN 1 AND 160 OR value->>'currency' NOT IN ('DOP','USD','EUR') THEN RETURN false; END IF;
  -- JS/Zod count UTF-16 units: a four-byte UTF-8 character takes two units.
  FOR character_index IN 1..length(manager_name) LOOP
    manager_name_units := manager_name_units + CASE
      WHEN octet_length(convert_to(substr(manager_name, character_index, 1), 'UTF8')) = 4 THEN 2 ELSE 1 END;
  END LOOP;
  IF manager_name_units > 160 THEN RETURN false; END IF;
  commission_amount := (value->>'amount')::numeric;
  RETURN commission_amount BETWEEN 0 AND 9007199254740991 AND commission_amount = trunc(commission_amount);
END $$;

ALTER TABLE remittance_transfers ADD CONSTRAINT remittance_manager_commission_valid
  CHECK (manager_commission IS NULL OR valid_manual_manager_commission(manager_commission));

-- The existing immutable_remittance_transfers trigger protects this snapshot too.
COMMIT;
