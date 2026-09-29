BEGIN;
CREATE TABLE pcp_groups (
  id text PRIMARY KEY, name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160)
);
CREATE UNIQUE INDEX pcp_groups_name_ci ON pcp_groups(lower(name));
CREATE TABLE pcp_stations (
  id text PRIMARY KEY, number text NOT NULL CHECK (length(trim(number)) BETWEEN 1 AND 80),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160), device_id text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '', station_group text NOT NULL DEFAULT '', station_type text NOT NULL DEFAULT '',
  license text NOT NULL DEFAULT '', version text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX pcp_stations_number_ci ON pcp_stations(lower(number));
CREATE UNIQUE INDEX pcp_stations_name_ci ON pcp_stations(lower(name));
CREATE UNIQUE INDEX pcp_stations_device_ci ON pcp_stations(lower(device_id)) WHERE device_id <> '';
CREATE TABLE pcps (
  id text PRIMARY KEY, number text NOT NULL CHECK (length(trim(number)) BETWEEN 1 AND 80),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160), group_id text NOT NULL REFERENCES pcp_groups(id),
  address text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX pcps_number_ci ON pcps(lower(number));
CREATE TABLE pcp_station_links (
  pcp_id text NOT NULL REFERENCES pcps(id), station_id text NOT NULL REFERENCES pcp_stations(id),
  PRIMARY KEY (pcp_id,station_id)
);
CREATE TABLE auth_sessions (
  id text PRIMARY KEY, user_id text NOT NULL, user_name text NOT NULL, role text NOT NULL CHECK(role IN ('admin','collector')),
  collector_id text, started_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  revoked_at timestamptz, revoked_by text,
  CHECK(expires_at > started_at), CHECK((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX auth_sessions_user_start ON auth_sessions(user_id,started_at DESC);
CREATE TABLE authorization_requests (
  id text PRIMARY KEY, client_id text NOT NULL REFERENCES clients(id), collector_id text NOT NULL REFERENCES collectors(id),
  delay_reason_id text REFERENCES delay_reasons(id), for_collection boolean NOT NULL, note text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')),
  created_at timestamptz NOT NULL, created_by text NOT NULL, resolved_at timestamptz, resolved_by text, resolution_note text,
  CHECK((status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_note IS NULL) OR
        (status <> 'pending' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND length(trim(resolution_note)) > 0))
);
CREATE INDEX authorization_requests_status_date ON authorization_requests(status,created_at DESC);
CREATE TABLE admin_traces (
  id text PRIMARY KEY, actor_id text NOT NULL, action text NOT NULL, resource text NOT NULL, resource_id text, created_at timestamptz NOT NULL
);
CREATE INDEX admin_traces_date ON admin_traces(created_at DESC);
CREATE FUNCTION protect_admin_trace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Administrative traces are append-only';
END;
$$;
CREATE TRIGGER admin_traces_immutable BEFORE UPDATE OR DELETE ON admin_traces FOR EACH ROW EXECUTE FUNCTION protect_admin_trace();
COMMIT;
