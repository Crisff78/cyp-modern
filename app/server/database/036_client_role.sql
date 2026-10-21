-- The Usuario role gives way to Cliente (2026-10-20): an account of a client of the business, with
-- no access for now. Existing Usuario accounts become Cajero, which attends remittances the same way.
-- Their open sessions are closed: the next sign-in carries the new role.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_role_check;

UPDATE auth_sessions SET revoked_at = now(), revoked_by = 'migration-036-client-role'
  WHERE role = 'user' AND revoked_at IS NULL;
UPDATE auth_sessions SET role = 'cashier' WHERE role = 'user';
UPDATE users SET role = 'cashier' WHERE role = 'user';

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('undefined', 'admin', 'supervisor', 'collector', 'client', 'cashier'));
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_role_check
  CHECK (role IN ('undefined', 'admin', 'supervisor', 'collector', 'client', 'cashier'));
