BEGIN;

-- Historical transfers have no proven payment method or company snapshot.
-- Leave them null; all new application writes include these immutable snapshots.
ALTER TABLE remittance_transfers ADD COLUMN payment jsonb, ADD COLUMN receipt_issuer jsonb;
ALTER TABLE remittance_events ADD COLUMN refund_confirmation jsonb;

CREATE FUNCTION valid_remittance_payment(v jsonb,total bigint,actor text,at_time timestamptz)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text; n numeric;
BEGIN
  IF jsonb_typeof(v) <> 'object' OR NOT (v ?& ARRAY['version','method','tenderedAmount','changeAmount','confirmedBy','confirmedAt'])
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN ('version','method','tenderedAmount','changeAmount','confirmedBy','confirmedAt','reference','bank')) THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['version','tenderedAmount','changeAmount'] LOOP
    IF jsonb_typeof(v->field) <> 'number' THEN RETURN false; END IF;
    n := (v->>field)::numeric;
    IF n < 0 OR n > 9007199254740991 OR n <> trunc(n) THEN RETURN false; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['method','confirmedBy','confirmedAt'] LOOP
    IF jsonb_typeof(v->field) <> 'string' THEN RETURN false; END IF;
  END LOOP;
  IF (v->>'version')::numeric <> 1 OR v->>'confirmedBy' <> actor OR (v->>'confirmedAt')::timestamptz <> at_time THEN RETURN false; END IF;
  IF v->>'method' = 'cash' THEN
    RETURN NOT (v ?| ARRAY['reference','bank']) AND (v->>'tenderedAmount')::numeric - (v->>'changeAmount')::numeric = total;
  END IF;
  IF v->>'method' NOT IN ('card','transfer','deposit') OR jsonb_typeof(v->'reference') IS DISTINCT FROM 'string'
    OR length(btrim(v->>'reference')) NOT BETWEEN 1 AND 160 OR v->>'reference' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  IF v ? 'bank' AND (jsonb_typeof(v->'bank') <> 'string' OR length(v->>'bank') NOT BETWEEN 1 AND 160 OR v->>'bank' ~ '[[:cntrl:]]') THEN RETURN false; END IF;
  RETURN (v->>'tenderedAmount')::numeric = total AND (v->>'changeAmount')::numeric = 0;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE remittance_transfers ADD CONSTRAINT remittance_payment_valid
  CHECK (payment IS NULL OR valid_remittance_payment(payment,total_amount,registered_by,created_at)),
  ADD CONSTRAINT remittance_receipt_issuer_object CHECK (receipt_issuer IS NULL OR jsonb_typeof(receipt_issuer)='object');

CREATE FUNCTION check_remittance_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t remittance_transfers%ROWTYPE; cash_amount bigint; v jsonb;
BEGIN
  IF NEW.transfer_id IS NULL THEN
    IF NEW.refund_confirmation IS NOT NULL THEN RAISE EXCEPTION 'Refund requires a cancelled transfer'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT t FROM remittance_transfers WHERE id=NEW.transfer_id;
  cash_amount := CASE WHEN t.payment IS NULL OR t.payment->>'method'='cash' THEN t.total_amount ELSE 0 END;
  IF NEW.type IN ('sent','cancelled') AND (NEW.amount<>cash_amount OR NEW.currency<>t.source_currency OR NEW.operator_id<>t.sending_user_id) THEN
    RAISE EXCEPTION 'Payment method and physical cash movement do not match';
  END IF;
  IF NEW.type='paid' AND (NEW.amount<>t.receive_amount OR NEW.currency<>t.destination_currency) THEN RAISE EXCEPTION 'Payout does not match frozen transfer'; END IF;
  v := NEW.refund_confirmation;
  IF NEW.type='cancelled' AND t.payment IS NOT NULL AND t.payment->>'method'<>'cash' THEN
    IF v IS NULL OR jsonb_typeof(v)<>'object' OR NOT(v ?& ARRAY['method','reference','confirmedBy','confirmedAt'])
      OR (SELECT count(*) FROM jsonb_object_keys(v))<>4
      OR v->>'method' IS DISTINCT FROM t.payment->>'method'
      OR jsonb_typeof(v->'reference') IS DISTINCT FROM 'string' OR length(btrim(v->>'reference')) NOT BETWEEN 1 AND 160
      OR v->>'reference' ~ '[[:cntrl:]]' OR v->>'confirmedBy' IS DISTINCT FROM NEW.actor_id
      OR (v->>'confirmedAt')::timestamptz IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'Verified external refund is required';
    END IF;
  ELSIF v IS NOT NULL THEN RAISE EXCEPTION 'Unexpected external refund'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER remittance_payment_event BEFORE INSERT ON remittance_events
  FOR EACH ROW EXECUTE FUNCTION check_remittance_payment_event();

COMMIT;
