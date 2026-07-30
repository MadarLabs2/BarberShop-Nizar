-- Extend staff_working_days to support per-day time range.
-- One row per staff per weekday: day enabled = row exists with start_time, end_time.
-- Disabled day = row deleted.

ALTER TABLE staff_working_days
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time TIME;

-- Backfill: existing rows = 09:00–19:00 (current global hours)
UPDATE staff_working_days
SET start_time = '09:00'::TIME, end_time = '19:00'::TIME
WHERE start_time IS NULL;

-- Harden: NOT NULL and valid range
ALTER TABLE staff_working_days
  ALTER COLUMN start_time SET NOT NULL,
  ALTER COLUMN end_time SET NOT NULL;

ALTER TABLE staff_working_days
  ADD CONSTRAINT chk_staff_working_days_start_before_end
  CHECK (start_time < end_time);
