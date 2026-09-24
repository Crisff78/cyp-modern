ALTER TABLE clients ADD COLUMN IF NOT EXISTS identification text NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lat double precision CHECK (lat BETWEEN -90 AND 90);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lng double precision CHECK (lng BETWEEN -180 AND 180);

CREATE TABLE IF NOT EXISTS client_machines (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id),
  number integer NOT NULL CHECK (number > 0),
  entry text NOT NULL DEFAULT '',
  exit text NOT NULL DEFAULT '',
  currency_value numeric(18,4) NOT NULL DEFAULT 0 CHECK (currency_value >= 0),
  percentage numeric(8,4) NOT NULL DEFAULT 0 CHECK (percentage >= 0),
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, number)
);

CREATE TABLE IF NOT EXISTS client_machine_logs (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id),
  machine_id text NOT NULL REFERENCES client_machines(id),
  registered_at timestamptz NOT NULL DEFAULT now(),
  previous_entry text NOT NULL DEFAULT '',
  entry text NOT NULL DEFAULT '',
  entry_difference text NOT NULL DEFAULT '',
  previous_exit text NOT NULL DEFAULT '',
  exit text NOT NULL DEFAULT '',
  exit_difference text NOT NULL DEFAULT '',
  difference text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'DOP',
  amount numeric(18,4) NOT NULL DEFAULT 0,
  percentage numeric(8,4) NOT NULL DEFAULT 0,
  charge numeric(18,4) NOT NULL DEFAULT 0,
  modified_at timestamptz,
  cancelled_at timestamptz
);

CREATE INDEX IF NOT EXISTS client_machine_logs_client_date
  ON client_machine_logs(client_id, registered_at DESC);
