-- Configuracion general persistente del sistema (paridad G6).
-- Una unica fila 'default' con las opciones del dialogo Configuracion General.
CREATE TABLE IF NOT EXISTS system_config (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
