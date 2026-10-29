BEGIN;

-- Envíos de dinero as explained in the meeting of 29-10-2026. Only additions: sends made before keep their
-- columns and numbers (calculation, commission_split and payout_amount stay null for them).

-- The manager takes a share of the commission of each send (never of the exchange). The former percentage of the
-- received amount is kept for history; the share starts as the one that pays the manager the same as before
-- (5% total and 2% manager → 40% of the commission).
ALTER TABLE remittance_commission_policy
  ADD COLUMN manager_share_bps integer NOT NULL DEFAULT 0 CHECK (manager_share_bps BETWEEN 0 AND 10000),
  ADD COLUMN receive_rounding text NOT NULL DEFAULT 'none' CHECK (receive_rounding IN ('none','normal','up'));
UPDATE remittance_commission_policy SET manager_share_bps = CASE WHEN transaction_commission_bps > 0
  THEN LEAST(10000, div(manager_commission_bps::numeric * 10000 * 2 + transaction_commission_bps, transaction_commission_bps * 2))::integer ELSE 0 END;

-- Concepts charged at the destination (a home delivery, for example). «Sin comisión» is built in and never stored.
CREATE TABLE remittance_delivery_concepts (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80 AND id <> 'sin-comision'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80 AND name = btrim(name)),
  commission_bps integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 9999),
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL,
  updated_by text REFERENCES users(id)
);
CREATE UNIQUE INDEX remittance_delivery_concepts_name ON remittance_delivery_concepts (lower(name));

ALTER TABLE remittance_transfers
  ADD COLUMN payout_amount bigint CHECK (payout_amount BETWEEN 1 AND 9007199254740991),
  ADD COLUMN calculation jsonb,
  ADD COLUMN commission_split jsonb;

-- The whole calculation of a send: what was typed, the commission at the destination, the rounding, what the
-- person receives and the company's exchange gain in pesos.
CREATE FUNCTION valid_remittance_calculation(c jsonb, amount bigint, receive bigint, payout bigint, source_currency text, destination_currency text)
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
  -- Only a leg that changes currency earns: buying a foreign currency of the sender, selling one to the recipient.
  IF g ? 'sourcePurchaseRate' THEN
    IF source_currency = 'DOP' OR source_currency = destination_currency
      OR (g->>'sourceAmount')::numeric <> round(amount::numeric * ((g->>'sourceSaleRate')::numeric - (g->>'sourcePurchaseRate')::numeric)) THEN RETURN false; END IF;
  ELSIF (g->>'sourceAmount')::numeric <> 0 THEN RETURN false; END IF;
  IF g ? 'destinationPurchaseRate' THEN
    IF destination_currency = 'DOP' OR source_currency = destination_currency
      OR (g->>'destinationAmount')::numeric <> round(receive::numeric * ((g->>'destinationSaleRate')::numeric - (g->>'destinationPurchaseRate')::numeric)) THEN RETURN false; END IF;
  ELSIF (g->>'destinationAmount')::numeric <> 0 THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- The manager's share of the commission, in the currency the sender pays it.
CREATE FUNCTION valid_commission_split(v jsonb, commission bigint, source_currency text, sending_user_id text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text; n numeric;
BEGIN
  IF jsonb_typeof(v) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(v)) <> 10
    OR NOT (v ?& ARRAY['version','currency','policyRevision','managerCommissionBps','baseAmount','transactionAmount','companyAmount','managerAmount','managerId','managerName']) THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['version','managerCommissionBps','baseAmount','transactionAmount','companyAmount','managerAmount'] LOOP
    IF jsonb_typeof(v->field) <> 'number' THEN RETURN false; END IF;
    n := (v->>field)::numeric;
    IF n < 0 OR n > 9007199254740991 OR n <> trunc(n) THEN RETURN false; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['currency','policyRevision','managerId','managerName'] LOOP
    IF jsonb_typeof(v->field) <> 'string' OR length(btrim(v->>field)) = 0 THEN RETURN false; END IF;
  END LOOP;
  RETURN (v->>'version')::numeric = 2 AND v->>'currency' = source_currency AND v->>'managerId' = sending_user_id
    AND length(v->>'policyRevision') <= 80 AND length(v->>'managerName') <= 160
    AND (v->>'managerCommissionBps')::numeric BETWEEN 0 AND 10000
    AND (v->>'baseAmount')::numeric = commission AND (v->>'transactionAmount')::numeric = commission
    AND (v->>'managerAmount')::numeric = div(commission::numeric * (v->>'managerCommissionBps')::numeric * 2 + 10000, 20000)
    AND (v->>'companyAmount')::numeric + (v->>'managerAmount')::numeric = commission;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

ALTER TABLE remittance_transfers
  ADD CONSTRAINT remittance_calculation_payout CHECK ((calculation IS NULL) = (payout_amount IS NULL)),
  ADD CONSTRAINT remittance_calculation_valid CHECK (calculation IS NULL OR valid_remittance_calculation(calculation, amount, receive_amount, payout_amount, source_currency, destination_currency)),
  ADD CONSTRAINT remittance_commission_split_valid CHECK (commission_split IS NULL OR valid_commission_split(commission_split, commission_amount, source_currency, sending_user_id)),
  ADD CONSTRAINT remittance_one_commission_allocation CHECK (commission_allocation IS NULL OR commission_split IS NULL);

-- The purchase and sale rates of the gain are the ones of the immutable rate revision used by the send.
CREATE FUNCTION check_remittance_exchange_gain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g jsonb; h remittance_rate_history%ROWTYPE;
BEGIN
  g := NEW.calculation->'exchangeGain';
  IF g IS NULL THEN RETURN NEW; END IF;
  IF g ? 'sourcePurchaseRate' THEN
    SELECT * INTO STRICT h FROM remittance_rate_history WHERE id=NEW.source_rate_change_id;
    IF h.purchase_rate IS DISTINCT FROM (g->>'sourcePurchaseRate')::numeric OR h.sale_rate IS DISTINCT FROM (g->>'sourceSaleRate')::numeric
      THEN RAISE EXCEPTION 'Exchange gain does not match the source rate revision'; END IF;
  END IF;
  IF g ? 'destinationPurchaseRate' THEN
    SELECT * INTO STRICT h FROM remittance_rate_history WHERE id=NEW.destination_rate_change_id;
    IF h.purchase_rate IS DISTINCT FROM (g->>'destinationPurchaseRate')::numeric OR h.sale_rate IS DISTINCT FROM (g->>'destinationSaleRate')::numeric
      THEN RAISE EXCEPTION 'Exchange gain does not match the destination rate revision'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER remittance_exchange_gain BEFORE INSERT ON remittance_transfers
  FOR EACH ROW EXECUTE FUNCTION check_remittance_exchange_gain();

-- What leaves the box when the money is delivered: what the person receives (after the commission at the
-- destination and the rounding). Sends made before keep their converted amount. Same rules as 038 otherwise.
CREATE OR REPLACE FUNCTION check_remittance_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW.type='paid' AND (NEW.amount<>COALESCE(t.payout_amount,t.receive_amount) OR NEW.currency<>t.destination_currency) THEN RAISE EXCEPTION 'Payout does not match frozen transfer'; END IF;
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

COMMIT;
