-- Legacy screen assignments are separate from authentication and role authorization.
-- NULL preserves historical defaults; an empty array explicitly clears all assignments.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_permission_ids integer[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_permission_revision integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD CONSTRAINT users_legacy_permission_ids_check CHECK (
  legacy_permission_ids IS NULL OR (
    coalesce(array_ndims(legacy_permission_ids), 1) = 1
    AND legacy_permission_ids <@ ARRAY[1,2,3,4,5,6,10,101,102,103,104,106,107,109,111,112,113,114,115,116,120,121,122,123,130,131,132,133,134,140,141,142,143,144,145,150,151,152,153,154,155,156,160,161,162,163,170,171,172,173,174,175,176,180,181,182,183,190,191,192,193,200,201,300,301,302,303,304,310,311,312,313,320,321,322,323,330,331,332,333,334,340,341,342,343,350,351,352,353,360,361,362,363,364,370,371,372,373,374,380,381,382,383,390,391,392,393,400,401,402,403,410,411,412,413,414,415,500,501]::integer[]
    AND array_position(legacy_permission_ids, NULL) IS NULL
    AND cardinality(legacy_permission_ids) <= 119
  )
);
ALTER TABLE users ADD CONSTRAINT users_legacy_permission_revision_check CHECK (legacy_permission_revision >= 0);
COMMIT;
