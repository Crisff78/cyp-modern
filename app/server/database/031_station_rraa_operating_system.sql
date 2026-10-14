-- Preserve the operating-system code provided by STATDAT separately from the
-- station's software version. Historical stations keep their existing values.
ALTER TABLE pcp_stations ADD COLUMN operating_system text;
ALTER TABLE pcp_stations ADD CONSTRAINT pcp_stations_operating_system_valid CHECK (
  operating_system IS NULL OR (
    char_length(operating_system) BETWEEN 1 AND 160
    AND operating_system = btrim(operating_system)
    AND operating_system !~ '[[:cntrl:]|]'
  )
);
