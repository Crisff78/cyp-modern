-- Extend account/session role checks without rewriting existing rows or credentials.
BEGIN;
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('undefined', 'admin', 'supervisor', 'collector', 'user'));
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'undefined';

ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_role_check;
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_role_check
  CHECK (role IN ('undefined', 'admin', 'supervisor', 'collector', 'user'));
COMMIT;
