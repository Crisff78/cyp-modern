CREATE OR REPLACE FUNCTION cyp_valid_currency_limits(data jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE currency text; limits jsonb; field text; amount numeric;
BEGIN
  IF jsonb_typeof(data) <> 'object' THEN RETURN false; END IF;
  FOR currency, limits IN SELECT * FROM jsonb_each(data) LOOP
    IF currency NOT IN ('DOP','USD','EUR') OR jsonb_typeof(limits) <> 'object'
      OR NOT (limits ?& ARRAY['collectionLimit','payoutLimit'])
      OR (limits - 'collectionLimit' - 'payoutLimit') <> '{}'::jsonb THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['collectionLimit','payoutLimit'] LOOP
      IF jsonb_typeof(limits->field) <> 'number' THEN RETURN false; END IF;
      amount := (limits->>field)::numeric;
      IF amount < 0 OR amount > 9007199254740991 OR amount <> trunc(amount) THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END $$;
ALTER TABLE collectors ADD CONSTRAINT collector_currency_limits_valid CHECK (cyp_valid_currency_limits(currency_limits));
ALTER TABLE charges ADD CONSTRAINT charge_schedule_identity_complete CHECK ((recurring_template_id IS NULL) = (scheduled_date IS NULL));
CREATE INDEX IF NOT EXISTS recurring_charges_due_active ON recurring_charges(next_run_date,generation_from) WHERE status='active';
CREATE INDEX IF NOT EXISTS admin_traces_recent ON admin_traces(created_at DESC,id);
CREATE INDEX IF NOT EXISTS auth_sessions_recent ON auth_sessions(started_at DESC,id);
