-- Booking correctness fix: the "max 2 upcoming appointments per customer" rule was only
-- enforced in application code as a check-then-act read+insert, so two concurrent booking
-- requests from the same customer (double-tap, multiple devices) could both pass the check
-- and leave the customer with 3+ upcoming appointments. Enforce it in Postgres instead, with
-- a per-customer advisory lock so the count-then-insert is race-free even under real
-- concurrency (not just a narrower window).

CREATE OR REPLACE FUNCTION enforce_max_upcoming_appointments()
RETURNS TRIGGER AS $$
DECLARE
  upcoming_count INTEGER;
  lock_key BIGINT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent inserts/updates for the same customer (by profile or phone) so the
  -- count below can't race with another in-flight booking for that same customer.
  lock_key := hashtext(COALESCE(NEW.profile_id::text, '') || '|' || COALESCE(NEW.client_phone, ''))::bigint;
  PERFORM pg_advisory_xact_lock(lock_key);

  SELECT COUNT(*) INTO upcoming_count
  FROM appointments
  WHERE status = 'confirmed'
    AND id IS DISTINCT FROM NEW.id
    AND (
      (NEW.profile_id IS NOT NULL AND profile_id = NEW.profile_id)
      OR (NEW.client_phone IS NOT NULL AND client_phone = NEW.client_phone)
    )
    AND (date + time)::timestamp > (now() AT TIME ZONE 'Asia/Jerusalem');

  IF upcoming_count >= 2 THEN
    RAISE EXCEPTION 'MAX_UPCOMING_APPOINTMENTS';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_max_upcoming_appointments ON appointments;

CREATE TRIGGER trg_enforce_max_upcoming_appointments
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_max_upcoming_appointments();
