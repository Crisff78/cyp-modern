-- Historical station data stays intact. Only server-side VALSTAT validation
-- populates this binding; an existing license is not proof of authorization.
ALTER TABLE pcp_stations
  ADD COLUMN rraa_client_id text,
  ADD COLUMN rraa_station_code text,
  ADD COLUMN rraa_device_id text,
  ADD COLUMN rraa_validated_at timestamptz,
  ADD COLUMN rraa_validated_by text;

ALTER TABLE pcp_stations ADD CONSTRAINT pcp_stations_rraa_binding CHECK (
  (rraa_client_id IS NULL AND rraa_station_code IS NULL AND rraa_device_id IS NULL
   AND rraa_validated_at IS NULL AND rraa_validated_by IS NULL)
  OR (rraa_client_id IS NOT NULL AND rraa_station_code IS NOT NULL AND rraa_device_id IS NOT NULL
      AND rraa_validated_at IS NOT NULL AND rraa_validated_by IS NOT NULL
      AND rraa_station_code = name AND rraa_device_id = device_id AND length(license) > 0)
);
