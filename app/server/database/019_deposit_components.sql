-- Suggestions 5.1: components informatively describe one existing deposit.
-- No bank ledger or integration is created. Historical rows remain NULL.
-- The original immutable_cash_handovers trigger already forbids ALL UPDATE
-- and DELETE, including this new column; its function and trigger are unchanged.
BEGIN;

ALTER TABLE cash_handovers ADD COLUMN deposit_components jsonb;

CREATE FUNCTION deposit_component_cash_total(components jsonb, deposit_amount bigint) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE component jsonb; component_amount numeric; total numeric := 0; cash_total numeric := 0; method text;
BEGIN
  IF jsonb_typeof(components) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Deposit components must be an array';
  END IF;
  IF jsonb_array_length(components) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Deposit requires between 1 and 20 components';
  END IF;
  IF deposit_amount NOT BETWEEN 1 AND 1000000000 THEN
    RAISE EXCEPTION 'Deposit amount outside supported range';
  END IF;
  FOR component IN SELECT value FROM jsonb_array_elements(components) LOOP
    IF jsonb_typeof(component) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid deposit component';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(component) AS k(key)
      WHERE key NOT IN ('method','amount','bank','reference')) THEN
      RAISE EXCEPTION 'Unknown deposit component field';
    END IF;
    method := component->>'method';
    IF jsonb_typeof(component->'method') IS DISTINCT FROM 'string' OR
      method IS NULL OR method NOT IN ('cash','cheque','bank_deposit') OR
      jsonb_typeof(component->'amount') IS DISTINCT FROM 'number' OR
      coalesce(component->>'amount','') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Invalid deposit method or amount';
    END IF;
    component_amount := (component->>'amount')::numeric;
    IF component_amount NOT BETWEEN 1 AND 1000000000 THEN
      RAISE EXCEPTION 'Deposit component amount outside supported range';
    END IF;
    IF method = 'cash' THEN
      IF component ? 'bank' OR component ? 'reference' THEN
        RAISE EXCEPTION 'Cash component cannot contain bank or reference';
      END IF;
      cash_total := cash_total + component_amount;
    ELSE
      IF jsonb_typeof(component->'bank') IS DISTINCT FROM 'string' OR
        jsonb_typeof(component->'reference') IS DISTINCT FROM 'string' OR
        char_length(btrim(component->>'bank')) NOT BETWEEN 1 AND 160 OR
        char_length(btrim(component->>'reference')) NOT BETWEEN 1 AND 160 THEN
        RAISE EXCEPTION 'Bank and reference are required for non-cash components';
      END IF;
    END IF;
    total := total + component_amount;
  END LOOP;
  IF total <> deposit_amount THEN
    RAISE EXCEPTION 'Deposit component sum must equal deposit amount';
  END IF;
  RETURN cash_total;
END $$;

CREATE FUNCTION deposit_denomination_total(lines jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE line jsonb; denomination numeric; quantity numeric; total numeric := 0;
BEGIN
  IF jsonb_typeof(lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Deposit denominations must be an array';
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(lines) LOOP
    IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR
      jsonb_typeof(line->'denominacion') IS DISTINCT FROM 'number' OR
      jsonb_typeof(line->'cantidad') IS DISTINCT FROM 'number' OR
      coalesce(line->>'denominacion','') !~ '^[0-9]+$' OR
      coalesce(line->>'cantidad','') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Invalid deposit denomination';
    END IF;
    denomination := (line->>'denominacion')::numeric;
    quantity := (line->>'cantidad')::numeric;
    IF denomination NOT BETWEEN 1 AND 9007199254740991 OR
      quantity NOT BETWEEN 0 AND 9007199254740991 OR
      denomination * quantity > 9007199254740991 OR
      total + denomination * quantity > 9007199254740991 THEN
      RAISE EXCEPTION 'Unsafe deposit denomination amount';
    END IF;
    total := total + denomination * quantity;
  END LOOP;
  RETURN total;
END $$;

CREATE FUNCTION validate_deposit_components_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cash_total numeric;
BEGIN
  IF NEW.deposit_components IS NULL THEN RETURN NEW; END IF;
  IF NEW.type <> 'deposit' THEN
    RAISE EXCEPTION 'Components are only allowed for deposits';
  END IF;
  cash_total := deposit_component_cash_total(NEW.deposit_components, NEW.amount);
  IF NEW.denominations IS NOT NULL AND deposit_denomination_total(NEW.denominations) <> cash_total THEN
    RAISE EXCEPTION 'Denominations must equal the cash component total';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_handovers_components_valid BEFORE INSERT ON cash_handovers
  FOR EACH ROW EXECUTE FUNCTION validate_deposit_components_insert();

CREATE FUNCTION validate_mixed_deposit_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE components jsonb; deposit_amount bigint;
BEGIN
  IF NEW.action <> 'accepted' OR NEW.denominations IS NULL THEN RETURN NEW; END IF;
  SELECT h.deposit_components,h.amount INTO components,deposit_amount
    FROM cash_handovers h WHERE h.id = NEW.movement_id;
  IF components IS NOT NULL AND deposit_denomination_total(NEW.denominations) <>
    deposit_component_cash_total(components,deposit_amount) THEN
    RAISE EXCEPTION 'Acceptance denominations must equal the cash component total';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deposit_lifecycle_cash_components_valid BEFORE INSERT ON deposit_lifecycle
  FOR EACH ROW EXECUTE FUNCTION validate_mixed_deposit_acceptance();

COMMIT;
