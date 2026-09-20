-- Ciclo de vida de depositos como eventos append-only (respetar inmutabilidad
-- del ledger: nunca se actualiza cash_handovers; aceptaciones y cancelaciones
-- se registran como filas nuevas).
CREATE TABLE IF NOT EXISTS deposit_lifecycle (
  id text PRIMARY KEY,
  movement_id text NOT NULL REFERENCES cash_handovers(id),
  action text NOT NULL CHECK (action IN ('accepted','cancelled')),
  actor_id text NOT NULL REFERENCES users(id),
  denominations jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deposit_lifecycle_movement ON deposit_lifecycle(movement_id);
