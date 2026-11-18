ALTER TABLE pcp_stations ADD COLUMN recipient_receipt_format text NOT NULL DEFAULT 'common'
  CHECK (recipient_receipt_format IN ('common', 'haiti'));
