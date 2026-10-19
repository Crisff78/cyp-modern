-- Allow the Cajero role in accounts and sessions without rewriting existing rows or credentials.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('undefined', 'admin', 'supervisor', 'collector', 'user', 'cashier'));

ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_role_check;
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_role_check
  CHECK (role IN ('undefined', 'admin', 'supervisor', 'collector', 'user', 'cashier'));
