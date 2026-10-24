ALTER TABLE recurring_charges ADD COLUMN IF NOT EXISTS generation_from date;
ALTER TABLE recurring_charges ALTER COLUMN next_run_date DROP NOT NULL;
-- Existing templates begin prospectively, never backfill historical obligations.
UPDATE recurring_charges SET generation_from = (now() AT TIME ZONE 'America/Santo_Domingo')::date + 1
WHERE generation_from IS NULL;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS recurring_template_id text REFERENCES recurring_charges(id);
ALTER TABLE charges ADD COLUMN IF NOT EXISTS scheduled_date date;
CREATE UNIQUE INDEX IF NOT EXISTS charges_recurring_occurrence_unique ON charges(recurring_template_id,scheduled_date)
WHERE recurring_template_id IS NOT NULL;
