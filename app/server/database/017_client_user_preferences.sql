-- Informative account fields and the client's preference for future remittances.
-- Existing obligations, ledger entries, auth claims and credentials are unchanged.
BEGIN;

ALTER TABLE clients ADD COLUMN preferred_currency text NOT NULL DEFAULT 'DOP'
  CONSTRAINT clients_preferred_currency_check CHECK (preferred_currency IN ('DOP', 'USD', 'EUR'));
ALTER TABLE users ADD COLUMN nickname text NOT NULL DEFAULT ''
  CONSTRAINT users_nickname_length_check CHECK (char_length(nickname) <= 120);
ALTER TABLE users ADD COLUMN note text NOT NULL DEFAULT ''
  CONSTRAINT users_note_length_check CHECK (char_length(note) <= 1000);

COMMIT;
