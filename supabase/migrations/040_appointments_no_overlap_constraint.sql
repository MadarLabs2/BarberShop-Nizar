-- Booking correctness fix: the existing UNIQUE index on (staff_id, date, time) only
-- blocks two confirmed appointments starting at the *exact* same time. It does not stop
-- two overlapping appointments with different start times (e.g. different services with
-- different durations for the same staff member), which the application-level check
-- (SELECT then INSERT) cannot fully prevent under concurrent requests. Enforce the real
-- invariant — no two confirmed appointments for the same staff member may overlap in time —
-- directly in Postgres via a range exclusion constraint, so it holds regardless of any
-- race condition in the API layer.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS slot_range tsrange
  GENERATED ALWAYS AS (
    tsrange(
      (date + time)::timestamp,
      -- duration * INTERVAL '1 minute' (not `duration || ' minutes'`): GENERATED columns
      -- require every function/operator to be IMMUTABLE. int||text resolves to the polymorphic
      -- ||(anynonarray, text) operator, which Postgres marks STABLE and rejects here;
      -- interval multiplication has no such issue.
      (date + time)::timestamp + duration * INTERVAL '1 minute',
      '[)'
    )
  ) STORED;

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_no_overlap;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (staff_id WITH =, slot_range WITH &&)
  WHERE (status = 'confirmed');
