-- Unknown provenance stays NULL for historical movements. New movements record
-- whether the authenticated actor was an administrator when they were posted.
ALTER TABLE collections ADD COLUMN registered_centrally boolean;
ALTER TABLE payments ADD COLUMN registered_centrally boolean;

-- Original ledger rows remain immutable. Each movement has at most one reversal,
-- linked to its actual source table rather than an unvalidated polymorphic ID.
CREATE TABLE movement_cancellations (
  id text PRIMARY KEY,
  movement_id text NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('collection','payout','office_delivery')),
  collection_id text GENERATED ALWAYS AS (CASE WHEN movement_type = 'collection' THEN movement_id END) STORED REFERENCES collections(id),
  payment_id text GENERATED ALWAYS AS (CASE WHEN movement_type = 'payout' THEN movement_id END) STORED REFERENCES payments(id),
  handover_id text GENERATED ALWAYS AS (CASE WHEN movement_type = 'office_delivery' THEN movement_id END) STORED REFERENCES cash_handovers(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  actor_id text NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (movement_type,movement_id)
);

CREATE FUNCTION protect_movement_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Movement cancellations are append-only';
  END IF;
  IF NEW.movement_type = 'office_delivery' AND NOT EXISTS (
    SELECT 1 FROM cash_handovers WHERE id = NEW.movement_id AND type = 'office_delivery'
  ) THEN
    RAISE EXCEPTION 'Only office deliveries can use this cancellation lifecycle';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER immutable_movement_cancellations BEFORE INSERT OR UPDATE OR DELETE ON movement_cancellations
  FOR EACH ROW EXECUTE FUNCTION protect_movement_cancellation();
