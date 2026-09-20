-- Desglose de denominaciones del deposito (paridad con el Panel de Detalles
-- del original): se guarda al aceptar el deposito y debe cuadrar con el importe.
ALTER TABLE cash_handovers ADD COLUMN IF NOT EXISTS denominations jsonb;
