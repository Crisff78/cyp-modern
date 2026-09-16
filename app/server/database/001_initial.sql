-- PostgreSQL reference implementation. Currency values are exact integer centavos.
-- The schema uses explicit business tables while the API keeps legacy CyP terms.
BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text UNIQUE,
  role text NOT NULL CHECK (role IN ('admin','collector')),
  collector_id text,
  password_hash text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zones (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sector text NOT NULL
);

CREATE TABLE IF NOT EXISTS collectors (
  id text PRIMARY KEY,
  name text NOT NULL,
  initials text NOT NULL,
  route_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','offline','limit')),
  collection_limit bigint NOT NULL CHECK (collection_limit > 0),
  payout_limit bigint NOT NULL CHECK (payout_limit > 0),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  last_seen timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS routes (
  id text PRIMARY KEY,
  name text NOT NULL,
  zone_id text NOT NULL REFERENCES zones(id),
  collector_id text NOT NULL REFERENCES collectors(id) DEFERRABLE INITIALLY DEFERRED
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collector_route_fk') THEN
    ALTER TABLE collectors ADD CONSTRAINT collector_route_fk
      FOREIGN KEY (route_id) REFERENCES routes(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_collector_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_collector_fk
      FOREIGN KEY (collector_id) REFERENCES collectors(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS collection_points (
  id text PRIMARY KEY,
  route_id text NOT NULL REFERENCES routes(id),
  address text NOT NULL,
  lat double precision CHECK (lat BETWEEN -90 AND 90),
  lng double precision CHECK (lng BETWEEN -180 AND 180),
  notes text
);

CREATE TABLE IF NOT EXISTS clients (
  id text PRIMARY KEY,
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  phone text NOT NULL,
  route_id text NOT NULL REFERENCES routes(id),
  collection_point_id text NOT NULL UNIQUE REFERENCES collection_points(id)
);

CREATE TABLE IF NOT EXISTS services (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  required_by_default boolean NOT NULL DEFAULT false,
  fixed_amount boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
);

CREATE TABLE IF NOT EXISTS recurring_charges (
  id text PRIMARY KEY,
  service_id text NOT NULL REFERENCES services(id),
  route_id text REFERENCES routes(id),
  amount bigint NOT NULL CHECK (amount > 0),
  required boolean NOT NULL DEFAULT false,
  fixed_amount boolean NOT NULL DEFAULT true,
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','quarterly')),
  next_run_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delay_reasons (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id text PRIMARY KEY,
  currency text NOT NULL,
  rate numeric(18,6) NOT NULL CHECK (rate > 0),
  effective_date date NOT NULL,
  UNIQUE (currency, effective_date)
);

CREATE TABLE IF NOT EXISTS charges (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id),
  service_id text NOT NULL REFERENCES services(id),
  amount bigint NOT NULL CHECK (amount > 0),
  collected bigint NOT NULL DEFAULT 0 CHECK (collected >= 0 AND collected <= amount),
  due_date date NOT NULL,
  required boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('pending','partial','paid','cancelled'))
);

CREATE TABLE IF NOT EXISTS payouts (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id),
  collector_id text NOT NULL REFERENCES collectors(id),
  concept text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  paid bigint NOT NULL DEFAULT 0 CHECK (paid >= 0 AND paid <= amount),
  status text NOT NULL CHECK (status IN ('pending','partial','paid','cancelled'))
);

CREATE TABLE IF NOT EXISTS collections (
  id text PRIMARY KEY,
  collector_id text NOT NULL REFERENCES collectors(id),
  client_id text NOT NULL REFERENCES clients(id),
  charge_id text NOT NULL REFERENCES charges(id),
  amount bigint NOT NULL CHECK (amount > 0),
  collected_at timestamptz NOT NULL,
  receipt_token text UNIQUE NOT NULL,
  receipt_revoked boolean NOT NULL DEFAULT false,
  actor_id text NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  collector_id text NOT NULL REFERENCES collectors(id),
  client_id text NOT NULL REFERENCES clients(id),
  payout_id text NOT NULL REFERENCES payouts(id),
  amount bigint NOT NULL CHECK (amount > 0),
  paid_at timestamptz NOT NULL,
  receipt_token text UNIQUE NOT NULL,
  receipt_revoked boolean NOT NULL DEFAULT false,
  actor_id text NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS cash_handovers (
  id text PRIMARY KEY,
  collector_id text NOT NULL REFERENCES collectors(id),
  type text NOT NULL CHECK (type IN ('deposit','office_delivery')),
  amount bigint NOT NULL CHECK (amount > 0),
  handed_over_at timestamptz NOT NULL,
  actor_id text NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS daily_settlements (
  id text PRIMARY KEY,
  collector_id text NOT NULL REFERENCES collectors(id),
  date date NOT NULL,
  collected bigint NOT NULL CHECK (collected >= 0),
  deposited bigint NOT NULL CHECK (deposited >= 0),
  office_delivered bigint NOT NULL CHECK (office_delivered >= 0),
  paid_to_clients bigint NOT NULL CHECK (paid_to_clients >= 0),
  difference bigint GENERATED ALWAYS AS ((collected - deposited) + (office_delivered - paid_to_clients)) STORED,
  status text NOT NULL CHECK (status = 'closed'),
  closed_at timestamptz NOT NULL,
  actor_id text NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (collector_id, date),
  CHECK ((collected - deposited) + (office_delivered - paid_to_clients) = 0)
);

CREATE TABLE IF NOT EXISTS idempotency (
  id text PRIMARY KEY,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS charges_client_due ON charges(client_id, due_date);
CREATE INDEX IF NOT EXISTS clients_route ON clients(route_id);
CREATE INDEX IF NOT EXISTS collections_collector_date ON collections(collector_id, collected_at);
CREATE INDEX IF NOT EXISTS payments_collector_date ON payments(collector_id, paid_at);
CREATE INDEX IF NOT EXISTS cash_handovers_collector_date ON cash_handovers(collector_id, handed_over_at);
CREATE INDEX IF NOT EXISTS payouts_collector_status ON payouts(collector_id, status);
CREATE INDEX IF NOT EXISTS recurring_charges_next_run ON recurring_charges(next_run_date, status);

CREATE OR REPLACE FUNCTION protect_receipted_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Ledger rows cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - 'receipt_revoked') IS DISTINCT FROM (to_jsonb(OLD) - 'receipt_revoked') THEN
    RAISE EXCEPTION 'Ledger rows are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_cash_handover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Cash handovers are immutable';
END $$;

DROP TRIGGER IF EXISTS immutable_collections ON collections;
CREATE TRIGGER immutable_collections BEFORE UPDATE OR DELETE ON collections
  FOR EACH ROW EXECUTE FUNCTION protect_receipted_ledger();

DROP TRIGGER IF EXISTS immutable_payments ON payments;
CREATE TRIGGER immutable_payments BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION protect_receipted_ledger();

DROP TRIGGER IF EXISTS immutable_cash_handovers ON cash_handovers;
CREATE TRIGGER immutable_cash_handovers BEFORE UPDATE OR DELETE ON cash_handovers
  FOR EACH ROW EXECUTE FUNCTION protect_cash_handover();

-- Legacy CyP naming compatibility for reverse-engineered Dionel modules.
CREATE OR REPLACE VIEW cobradores AS
  SELECT id, name AS nombre, initials AS iniciales, route_id AS ruta_id,
    status AS estado, collection_limit AS limite_cobro,
    payout_limit AS limite_pago, lat, lng, last_seen AS ultimo_reporte
  FROM collectors;

CREATE OR REPLACE VIEW clientes AS
  SELECT c.id, c.code AS codigo, c.name AS nombre, c.phone AS celular,
    c.route_id AS ruta_id, c.collection_point_id AS punto_cobro_pago_id
  FROM clients c;

CREATE OR REPLACE VIEW cargos AS
  SELECT id, client_id AS cliente_id, service_id AS servicio_id, amount AS monto,
    collected AS cobrado, due_date AS vencimiento, required AS obligado_cobrar,
    status AS estado
  FROM charges;

CREATE OR REPLACE VIEW cargos_recurrentes AS
  SELECT id, service_id AS servicio_id, route_id AS ruta_id, amount AS monto,
    required AS obligado_cobrar, fixed_amount AS monto_fijo,
    frequency AS frecuencia, next_run_date AS proxima_generacion,
    status AS estado
  FROM recurring_charges;

CREATE OR REPLACE VIEW descargos AS
  SELECT id, client_id AS cliente_id, collector_id AS cobrador_id,
    concept AS concepto, amount AS monto, paid AS pagado, status AS estado
  FROM payouts;

CREATE OR REPLACE VIEW cobros AS
  SELECT id, collector_id AS cobrador_id, client_id AS cliente_id,
    charge_id AS cargo_id, amount AS monto, collected_at AS cobrado_en,
    receipt_token AS recibo
  FROM collections;

CREATE OR REPLACE VIEW pagos AS
  SELECT id, collector_id AS cobrador_id, client_id AS cliente_id,
    payout_id AS descargo_id, amount AS monto, paid_at AS pagado_en,
    receipt_token AS recibo
  FROM payments;

CREATE OR REPLACE VIEW entregas AS
  SELECT id, collector_id AS cobrador_id, amount AS monto,
    handed_over_at AS entregado_en, actor_id
  FROM cash_handovers
  WHERE type = 'office_delivery';

CREATE OR REPLACE VIEW depositos AS
  SELECT id, collector_id AS cobrador_id, amount AS monto,
    handed_over_at AS depositado_en, actor_id
  FROM cash_handovers
  WHERE type = 'deposit';

CREATE OR REPLACE VIEW cuadres AS
  SELECT id, collector_id AS cobrador_id, date AS fecha, collected AS cobrado,
    deposited AS depositado, office_delivered AS entregado,
    paid_to_clients AS pagado, difference AS diferencia, status AS estado,
    closed_at AS cerrado_en
  FROM daily_settlements;

COMMIT;
