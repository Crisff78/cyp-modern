BEGIN;

-- A recorded external payment is not a card authorization. Never store PAN, expiry or CVV.
-- Existing transfers keep their original payment snapshot; only future quotes freeze this rate.
ALTER TABLE remittance_commission_policy
  ADD COLUMN credit_card_commission_bps integer NOT NULL DEFAULT 0
  CHECK (credit_card_commission_bps BETWEEN 0 AND 10000);
ALTER TABLE remittance_transfers
  ADD COLUMN quote_credit_card_commission_bps integer
  CHECK (quote_credit_card_commission_bps BETWEEN 0 AND 10000);

CREATE OR REPLACE FUNCTION valid_remittance_payment(v jsonb,total bigint,actor text,at_time timestamptz)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text; n numeric; rate numeric; fee numeric;
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT (v ?& ARRAY['version','method','tenderedAmount','changeAmount','confirmedBy','confirmedAt']) THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['version','tenderedAmount','changeAmount'] LOOP
    IF jsonb_typeof(v->field) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    n := (v->>field)::numeric;
    IF n < 0 OR n > 9007199254740991 OR n <> trunc(n) THEN RETURN false; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['method','confirmedBy','confirmedAt'] LOOP
    IF jsonb_typeof(v->field) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  END LOOP;
  IF v->>'confirmedBy' IS DISTINCT FROM actor OR (v->>'confirmedAt')::timestamptz IS DISTINCT FROM at_time THEN RETURN false; END IF;

  IF (v->>'version')::numeric = 2 THEN
    IF v->>'method' <> 'card' OR NOT (v ?& ARRAY['cardType','cardSurchargeBps','cardSurchargeAmount','reference'])
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN
        ('version','method','tenderedAmount','changeAmount','confirmedBy','confirmedAt','reference','bank','cardType','cardholderName','last4','cardSurchargeBps','cardSurchargeAmount'))
      OR jsonb_typeof(v->'cardType') IS DISTINCT FROM 'string' OR v->>'cardType' NOT IN ('credit','debit') THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['cardSurchargeBps','cardSurchargeAmount'] LOOP
      IF jsonb_typeof(v->field) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
      n := (v->>field)::numeric;
      IF n < 0 OR n > 9007199254740991 OR n <> trunc(n) THEN RETURN false; END IF;
    END LOOP;
    rate := (v->>'cardSurchargeBps')::numeric;
    fee := (v->>'cardSurchargeAmount')::numeric;
    IF rate > 10000 OR fee <> trunc((total::numeric * rate + 5000) / 10000)
      OR total::numeric + fee > 9007199254740991 THEN RETURN false; END IF;
    IF v->>'cardType' = 'credit' THEN
      IF jsonb_typeof(v->'cardholderName') IS DISTINCT FROM 'string' OR length(btrim(v->>'cardholderName')) NOT BETWEEN 1 AND 120
        OR v->>'cardholderName' ~ '[[:cntrl:]]' OR jsonb_typeof(v->'last4') IS DISTINCT FROM 'string'
        OR v->>'last4' !~ '^[0-9]{4}$' THEN RETURN false; END IF;
    ELSIF v ?| ARRAY['cardholderName','last4'] OR rate <> 0 OR fee <> 0 THEN RETURN false;
    END IF;
  ELSIF (v->>'version')::numeric = 1 THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN
      ('version','method','tenderedAmount','changeAmount','confirmedBy','confirmedAt','reference','bank')) THEN RETURN false; END IF;
    IF v->>'method' = 'cash' THEN
      RETURN NOT (v ?| ARRAY['reference','bank']) AND (v->>'tenderedAmount')::numeric - (v->>'changeAmount')::numeric = total;
    END IF;
    fee := 0;
  ELSE RETURN false;
  END IF;
  IF v->>'method' NOT IN ('card','transfer','deposit') OR jsonb_typeof(v->'reference') IS DISTINCT FROM 'string'
    OR length(btrim(v->>'reference')) NOT BETWEEN 1 AND 160 OR v->>'reference' ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  IF v ? 'bank' AND (jsonb_typeof(v->'bank') IS DISTINCT FROM 'string' OR length(v->>'bank') NOT BETWEEN 1 AND 160 OR v->>'bank' ~ '[[:cntrl:]]') THEN RETURN false; END IF;
  RETURN (v->>'tenderedAmount')::numeric = total::numeric + fee AND (v->>'changeAmount')::numeric = 0;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

ALTER TABLE remittance_transfers ADD CONSTRAINT remittance_card_rate_matches_quote CHECK (
  payment IS NULL OR CASE WHEN payment->>'version' = '2' THEN
    ((payment->>'cardSurchargeBps')::integer = CASE WHEN payment->>'cardType' = 'credit' THEN quote_credit_card_commission_bps ELSE 0 END) IS TRUE
  WHEN payment->>'method' = 'card' THEN COALESCE(quote_credit_card_commission_bps,0) = 0
  ELSE true END
);

COMMIT;
