-- Ciclo de vida de depositos (paridad con el original):
-- pendiente -> aceptado (Aceptar deposito) o cancelado (Cancelar deposito).
-- Los movimientos siguen siendo inmutables en importe; solo cambia su estado.
ALTER TABLE cash_handovers ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE cash_handovers ADD COLUMN IF NOT EXISTS accepted_by text REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE cash_handovers ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE cash_handovers ADD COLUMN IF NOT EXISTS cancelled_by text REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_handovers_lifecycle_check') THEN
    ALTER TABLE cash_handovers ADD CONSTRAINT cash_handovers_lifecycle_check
      CHECK (NOT (accepted_at IS NOT NULL AND cancelled_at IS NOT NULL));
  END IF;
END $$;
