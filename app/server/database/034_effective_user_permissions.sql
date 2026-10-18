-- Existing referential assignments remain intact. Accounts keep their role
-- profile until an administrator deliberately saves a personalized policy.
ALTER TABLE users ADD COLUMN permission_mode text NOT NULL DEFAULT 'role'
  CHECK (permission_mode IN ('role', 'custom'));
ALTER TABLE users ADD COLUMN remittance_permissions text[] NOT NULL DEFAULT '{}'
  CHECK (cardinality(remittance_permissions) <= 14 AND remittance_permissions <@ ARRAY[
    'remittances.view','remittances.create','remittances.receipts','remittances.pay',
    'remittances.cancel','remittances.clients.create','remittances.cash.view',
    'remittances.cash.open','remittances.cash.close','remittances.reports',
    'remittances.rates.view','remittances.rates.manage',
    'remittances.commissions.view','remittances.commissions.manage'
  ]::text[]);
