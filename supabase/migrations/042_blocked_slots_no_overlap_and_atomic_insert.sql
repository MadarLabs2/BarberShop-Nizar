-- Booking correctness fix (part 2): blocked_slots had the same check-then-act overlap race as
-- appointments did before migration 040 (two concurrent "block my time" requests for the same
-- staff member could both pass the app-level overlap check and insert overlapping blocks), and
-- creating a block + cancelling the confirmed appointments it overlaps was two separate
-- non-transactional steps — if the cancellation step failed, the block would already exist while
-- the conflicting appointment stayed confirmed, leaving an inconsistent state with no rollback.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Same overlap protection appointments got in migration 040, applied to blocked_slots.
ALTER TABLE blocked_slots
  ADD COLUMN IF NOT EXISTS slot_range tsrange
  -- blocked_slots.time is TEXT (unlike appointments.time, which is native TIME — see
  -- migration 040), so this can't just add the column directly like 040 does. `time::time`
  -- looked like the obvious fix but Postgres rejects it too: confirmed live (42P17 "generation
  -- expression is not immutable") that the TEXT->TIME cast itself is not IMMUTABLE here, same
  -- class of restriction as the int||text case duration*INTERVAL fixed above. Parsing "HH:MM"
  -- via split_part + integer arithmetic avoids any cast/operator PostgreSQL considers non-immutable.
  GENERATED ALWAYS AS (
    tsrange(
      date + (split_part(time, ':', 1)::int * 60 + split_part(time, ':', 2)::int) * INTERVAL '1 minute',
      date + (split_part(time, ':', 1)::int * 60 + split_part(time, ':', 2)::int) * INTERVAL '1 minute'
        + COALESCE(duration, 40) * INTERVAL '1 minute',
      '[)'
    )
  ) STORED;

ALTER TABLE blocked_slots
  DROP CONSTRAINT IF EXISTS blocked_slots_no_overlap;

ALTER TABLE blocked_slots
  ADD CONSTRAINT blocked_slots_no_overlap
  EXCLUDE USING gist (staff_id WITH =, slot_range WITH &&);

-- 2. Atomic "insert block + cancel overlapping confirmed appointments" as a single Postgres
-- function, so both happen in one transaction (all-or-nothing) instead of two separate API calls.
-- Returns one row per cancelled appointment (so the caller can still notify affected customers
-- and the waitlist per-slot, exactly as before), plus a guaranteed row carrying block_id even
-- when nothing was cancelled.
CREATE OR REPLACE FUNCTION add_blocked_slot_and_cancel_overlaps(
  p_staff_id UUID,
  p_date DATE,
  p_time TEXT,
  p_duration INTEGER
)
RETURNS TABLE (
  block_id UUID,
  cancelled_appointment_id UUID,
  cancelled_client_phone TEXT,
  cancelled_service_name TEXT,
  cancelled_time TEXT,
  cancelled_service_id UUID
) AS $$
DECLARE
  v_block_id UUID;
  v_start_mins INTEGER;
  v_end_mins INTEGER;
BEGIN
  INSERT INTO blocked_slots (staff_id, date, time, duration)
  VALUES (p_staff_id, p_date, p_time, p_duration)
  RETURNING id INTO v_block_id;

  v_start_mins := (EXTRACT(HOUR FROM p_time::time)::int * 60 + EXTRACT(MINUTE FROM p_time::time)::int);
  v_end_mins := v_start_mins + p_duration;

  RETURN QUERY
  WITH cancelled AS (
    UPDATE appointments a
    SET status = 'cancelled', updated_at = now()
    WHERE a.staff_id = p_staff_id
      AND a.date = p_date
      AND a.status = 'confirmed'
      AND (
        (EXTRACT(HOUR FROM a.time)::int * 60 + EXTRACT(MINUTE FROM a.time)::int) < v_end_mins
        AND
        ((EXTRACT(HOUR FROM a.time)::int * 60 + EXTRACT(MINUTE FROM a.time)::int) + COALESCE(a.duration, 40)) > v_start_mins
      )
    RETURNING a.id, a.client_phone, a.service_name,
      lpad(EXTRACT(HOUR FROM a.time)::int::text, 2, '0') || ':' || lpad(EXTRACT(MINUTE FROM a.time)::int::text, 2, '0') AS time_str,
      a.service_id
  )
  SELECT v_block_id, c.id, c.client_phone, c.service_name, c.time_str, c.service_id FROM cancelled c
  UNION ALL
  SELECT v_block_id, NULL, NULL, NULL, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM cancelled);
END;
$$ LANGUAGE plpgsql;
