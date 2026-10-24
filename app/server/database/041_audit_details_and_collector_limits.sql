-- Additive: preserve existing audit history and DOP operating limits.
ALTER TABLE admin_traces ADD COLUMN IF NOT EXISTS details jsonb;
ALTER TABLE collectors ADD COLUMN IF NOT EXISTS currency_limits jsonb NOT NULL DEFAULT '{}';
-- Retain the previous numerical limits in every currency; no FX conversion.
UPDATE collectors SET currency_limits = jsonb_build_object(
  'DOP',jsonb_build_object('collectionLimit',collection_limit,'payoutLimit',payout_limit),
  'USD',jsonb_build_object('collectionLimit',collection_limit,'payoutLimit',payout_limit),
  'EUR',jsonb_build_object('collectionLimit',collection_limit,'payoutLimit',payout_limit))
WHERE currency_limits = '{}';
-- Unassignment keeps routes, clients and all historical movements intact.
ALTER TABLE routes ALTER COLUMN collector_id DROP NOT NULL;
ALTER TABLE collectors ALTER COLUMN route_id DROP NOT NULL;
ALTER TABLE collectors DROP CONSTRAINT IF EXISTS collectors_collection_limit_check;
ALTER TABLE collectors DROP CONSTRAINT IF EXISTS collectors_payout_limit_check;
ALTER TABLE collectors ADD CONSTRAINT collectors_collection_limit_check CHECK (collection_limit >= 0);
ALTER TABLE collectors ADD CONSTRAINT collectors_payout_limit_check CHECK (payout_limit >= 0);
