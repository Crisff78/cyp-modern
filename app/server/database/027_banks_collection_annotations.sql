-- Optional operational annotations. Existing receipted rows are never rewritten.
CREATE TABLE banks (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX banks_unique_name ON banks(lower(name));

ALTER TABLE collections
  ADD COLUMN bank_id text REFERENCES banks(id),
  ADD COLUMN bank_name text,
  ADD COLUMN bank_reference text,
  ADD COLUMN note text;
ALTER TABLE collections ADD CONSTRAINT collections_annotation_lengths CHECK (
  (bank_name IS NULL OR char_length(bank_name) BETWEEN 1 AND 160) AND
  (bank_reference IS NULL OR char_length(bank_reference) <= 160) AND
  (note IS NULL OR char_length(note) <= 2000) AND
  ((bank_id IS NULL AND bank_name IS NULL) OR (bank_id IS NOT NULL AND bank_name IS NOT NULL))
);
-- protect_receipted_ledger compares complete JSON rows, so annotations receive
-- the same immutability protection as their original amount and currency.
