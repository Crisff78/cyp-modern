-- Plantillas de descargos recurrentes (paridad con el original: Descargos Rec.),
-- espejo de recurring_charges: generan pagos autorizados periodicos por cliente.
CREATE TABLE IF NOT EXISTS recurring_payouts (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id),
  concept text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','quarterly')),
  next_run_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recurring_payouts_next_run ON recurring_payouts(next_run_date, status);
