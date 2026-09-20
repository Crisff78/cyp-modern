-- Campos de contacto del cliente heredados del original (paridad G9):
-- layout verificado del .bak: id, nombre, alias, sector, telefono, celular,
-- direccion, nota, email. telefono/direccion ya existian.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS alias text NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sector text NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cellular text NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';
