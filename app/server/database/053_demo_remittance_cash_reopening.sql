BEGIN;

-- Los cierres anteriores siguen inmutables. La demo puede continuar la misma caja de hoy.
ALTER TABLE remittance_events DROP CONSTRAINT remittance_events_type_check;
ALTER TABLE remittance_events ADD CONSTRAINT remittance_events_type_check
  CHECK (type IN ('opened','sent','paid','cancelled','closed','reopened'));
ALTER TABLE remittance_events DROP CONSTRAINT remittance_events_check;
ALTER TABLE remittance_events ADD CONSTRAINT remittance_events_check
  CHECK ((type IN ('opened','closed','reopened')) = (transfer_id IS NULL));
ALTER TABLE remittance_events ADD CONSTRAINT remittance_reopening_reason_check
  CHECK (type <> 'reopened' OR (reason IS NOT NULL AND length(trim(reason)) BETWEEN 1 AND 500));
DROP INDEX remittance_one_cash_event;
CREATE UNIQUE INDEX remittance_one_cash_event ON remittance_events(cash_session_id,type) WHERE type = 'opened';

-- Conserva la restricción de un cierre por ciclo, incluso con inserciones directas.
CREATE FUNCTION check_remittance_cash_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_type text; previous_at timestamptz;
BEGIN
  IF NEW.type NOT IN ('closed','reopened') THEN RETURN NEW; END IF;
  PERFORM 1 FROM remittance_cash_sessions WHERE id=NEW.cash_session_id FOR UPDATE;
  SELECT type,created_at INTO previous_type,previous_at FROM remittance_events
    WHERE cash_session_id=NEW.cash_session_id AND type IN ('opened','closed','reopened')
    ORDER BY created_at DESC,id DESC LIMIT 1;
  IF previous_type IS NULL OR NEW.created_at <= previous_at
    OR (NEW.type='closed' AND previous_type NOT IN ('opened','reopened'))
    OR (NEW.type='reopened' AND previous_type<>'closed') THEN
    RAISE EXCEPTION 'Invalid remittance cash lifecycle';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER remittance_cash_lifecycle BEFORE INSERT ON remittance_events
  FOR EACH ROW EXECUTE FUNCTION check_remittance_cash_lifecycle();

COMMIT;
