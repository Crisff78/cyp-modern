BEGIN;

-- Align the existing SQL guard with the approved purchase -> DOP -> sale calculation.
-- No historical transfers or amounts are rewritten. Rate revision triggers remain in force.
CREATE OR REPLACE FUNCTION valid_remittance_calculation(c jsonb, amount bigint, receive bigint, payout bigint, source_currency text, destination_currency text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text; n numeric; g jsonb; adjustment numeric; delivery numeric;
BEGIN
  IF jsonb_typeof(c) <> 'object' OR NOT (c ?& ARRAY['version','amountMode','requestedAmount','convertedAmount','deliveryConceptId','deliveryConceptName',
      'deliveryCommissionBps','deliveryCommissionAmount','receiveRounding','roundingAdjustment','payoutAmount'])
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(c) k WHERE k NOT IN ('version','amountMode','requestedAmount','convertedAmount','deliveryConceptId','deliveryConceptName',
      'deliveryCommissionBps','deliveryCommissionAmount','receiveRounding','roundingAdjustment','payoutAmount','exchangeGain')) THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['version','requestedAmount','convertedAmount','deliveryCommissionBps','deliveryCommissionAmount','roundingAdjustment','payoutAmount'] LOOP
    IF jsonb_typeof(c->field) <> 'number' THEN RETURN false; END IF;
    n := (c->>field)::numeric;
    IF n <> trunc(n) OR abs(n) > 9007199254740991 THEN RETURN false; END IF;
    IF field <> 'roundingAdjustment' AND n < 0 THEN RETURN false; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['amountMode','deliveryConceptId','deliveryConceptName','receiveRounding'] LOOP
    IF jsonb_typeof(c->field) <> 'string' OR length(btrim(c->>field)) NOT BETWEEN 1 AND 80 THEN RETURN false; END IF;
  END LOOP;
  adjustment := (c->>'roundingAdjustment')::numeric;
  delivery := div(receive::numeric * (c->>'deliveryCommissionBps')::numeric * 2 + 10000, 20000);
  IF (c->>'version')::numeric <> 2 OR c->>'amountMode' NOT IN ('source','total','destination') OR c->>'receiveRounding' NOT IN ('none','normal','up')
    OR (c->>'requestedAmount')::numeric < 1 OR (c->>'deliveryCommissionBps')::numeric > 9999
    OR (c->>'convertedAmount')::numeric <> receive OR (c->>'payoutAmount')::numeric <> payout OR payout < 1
    OR (c->>'deliveryCommissionAmount')::numeric <> delivery OR payout <> receive - delivery + adjustment
    OR (c->>'deliveryConceptId' = 'sin-comision' AND (c->>'deliveryCommissionBps')::numeric <> 0)
    OR (c->>'receiveRounding' = 'none' AND adjustment <> 0)
    OR (c->>'receiveRounding' = 'normal' AND (payout % 100 <> 0 OR abs(adjustment) > 50))
    OR (c->>'receiveRounding' = 'up' AND (payout % 100 <> 0 OR adjustment < 0 OR adjustment > 99)) THEN RETURN false; END IF;
  IF c->>'amountMode' = 'source' AND (c->>'requestedAmount')::numeric <> amount THEN RETURN false; END IF;
  g := c->'exchangeGain';
  IF g IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(g) <> 'object' OR NOT (g ?& ARRAY['currency','sourceAmount','destinationAmount','totalAmount']) OR g->>'currency' <> 'DOP'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(g) k WHERE k NOT IN ('currency','sourceAmount','destinationAmount','totalAmount',
      'sourcePurchaseRate','sourceSaleRate','destinationPurchaseRate','destinationSaleRate')) THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['sourceAmount','destinationAmount','totalAmount'] LOOP
    IF jsonb_typeof(g->field) <> 'number' THEN RETURN false; END IF;
    n := (g->>field)::numeric;
    IF n <> trunc(n) OR abs(n) > 9007199254740991 THEN RETURN false; END IF;
  END LOOP;
  IF (g->>'totalAmount')::numeric <> (g->>'sourceAmount')::numeric + (g->>'destinationAmount')::numeric
    OR (g ? 'sourcePurchaseRate') <> (g ? 'sourceSaleRate') OR (g ? 'destinationPurchaseRate') <> (g ? 'destinationSaleRate') THEN RETURN false; END IF;
  -- Both foreign-currency legs apply through DOP, including USD/USD and EUR/EUR.
  IF g ? 'sourcePurchaseRate' THEN
    IF source_currency = 'DOP'
      OR (g->>'sourceAmount')::numeric <> round(amount::numeric * ((g->>'sourceSaleRate')::numeric - (g->>'sourcePurchaseRate')::numeric)) THEN RETURN false; END IF;
  ELSIF (g->>'sourceAmount')::numeric <> 0 THEN RETURN false; END IF;
  IF g ? 'destinationPurchaseRate' THEN
    IF destination_currency = 'DOP'
      OR (g->>'destinationAmount')::numeric <> round(receive::numeric * ((g->>'destinationSaleRate')::numeric - (g->>'destinationPurchaseRate')::numeric)) THEN RETURN false; END IF;
  ELSIF (g->>'destinationAmount')::numeric <> 0 THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

COMMIT;
