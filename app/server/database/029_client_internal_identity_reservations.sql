-- Technical identifiers are independent of legal identification and UUIDs.
-- A cancelled form keeps its reservation; sequence gaps are deliberate.
ALTER TABLE clients ADD COLUMN internal_identification text UNIQUE;
ALTER TABLE clients ADD CONSTRAINT client_internal_identification_format
  CHECK (internal_identification IS NULL OR internal_identification ~ '^INT[0-9]{8,16}$');
CREATE TABLE client_identity_reservations (
  id text PRIMARY KEY,
  sequence bigint NOT NULL UNIQUE CHECK (sequence BETWEEN 1 AND 9007199254740991),
  code text NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 1 AND 80),
  internal_identification text NOT NULL UNIQUE CHECK (internal_identification ~ '^INT[0-9]{8,16}$'),
  actor_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  client_id text UNIQUE REFERENCES clients(id)
);
CREATE FUNCTION protect_client_internal_identification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.internal_identification IS NOT NULL AND NEW.internal_identification IS DISTINCT FROM OLD.internal_identification THEN
    RAISE EXCEPTION 'Technical client identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_client_internal_identification BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION protect_client_internal_identification();
CREATE FUNCTION protect_client_identity_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Client reservations cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - 'client_id') IS DISTINCT FROM (to_jsonb(OLD) - 'client_id') OR
    (OLD.client_id IS NOT NULL AND NEW.client_id IS DISTINCT FROM OLD.client_id) THEN
    RAISE EXCEPTION 'Client reservations are immutable once claimed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_client_identity_reservation BEFORE UPDATE OR DELETE ON client_identity_reservations
  FOR EACH ROW EXECUTE FUNCTION protect_client_identity_reservation();
