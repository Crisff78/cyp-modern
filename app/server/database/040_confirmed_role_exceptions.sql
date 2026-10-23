-- Existing personalized lists retain their previous role limits. Only a new,
-- explicitly confirmed assignment may enable permissions outside that profile.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_exceptions boolean NOT NULL DEFAULT false;
