BEGIN;
-- Optional archive, disabled until an external private key and a retention period are configured.
-- No PAN, expiry or CVV columns; only an authenticated envelope is stored.
CREATE TABLE remittance_card_vault (
  transfer_id text PRIMARY KEY REFERENCES remittance_transfers(id),
  actor_id text NOT NULL REFERENCES users(id),
  key_id text NOT NULL CHECK (key_id ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + interval '365 days'),
  envelope jsonb NOT NULL CHECK (
    jsonb_typeof(envelope)='object' AND envelope ?& ARRAY['version','wrappedKey','iv','tag','ciphertext']
    AND envelope - ARRAY['version','wrappedKey','iv','tag','ciphertext'] = '{}'::jsonb
    AND envelope->'version' = '1'::jsonb
    AND jsonb_typeof(envelope->'wrappedKey')='string' AND length(envelope->>'wrappedKey') BETWEEN 344 AND 1024 AND (envelope->>'wrappedKey') ~ '^[A-Za-z0-9+/]+={0,2}$'
    AND jsonb_typeof(envelope->'iv')='string' AND (envelope->>'iv') ~ '^[A-Za-z0-9+/]{16}$'
    AND jsonb_typeof(envelope->'tag')='string' AND (envelope->>'tag') ~ '^[A-Za-z0-9+/]{22}==$'
    AND jsonb_typeof(envelope->'ciphertext')='string' AND length(envelope->>'ciphertext') BETWEEN 4 AND 256 AND (envelope->>'ciphertext') ~ '^[A-Za-z0-9+/]+={0,2}$'
  )
);
CREATE FUNCTION protect_card_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' OR OLD.expires_at > CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'Card archive is immutable until expiration'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER card_archive_immutable BEFORE UPDATE OR DELETE ON remittance_card_vault FOR EACH ROW EXECUTE FUNCTION protect_card_archive();
REVOKE ALL ON remittance_card_vault FROM PUBLIC;
COMMIT;
