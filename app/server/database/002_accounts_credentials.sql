-- Credentials for provisioned accounts. 001_initial.sql already declared
-- users(email, password_hash, status); this adds the salt, the per-account
-- credential version used to revoke outstanding sessions, and updated_at.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS salt text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS credential_version integer NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMIT;
