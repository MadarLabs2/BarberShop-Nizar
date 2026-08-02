-- Booking correctness fix (part 3): appointments and blocked_slots each got their own overlap
-- protection (040, 042), but nothing prevented the two tables from racing against *each other*.
-- A customer's POST /bookings and an admin's "block this time" could both read a snapshot before
-- the other committed, and both commit successfully — leaving a confirmed appointment sitting
-- inside a blocked window, with the customer never notified. Close this the same way migration
-- 041 closed the max-upcoming-appointments race: a per-staff Postgres advisory lock that
-- serializes every write that can affect a given staff member's schedule, taken by both the
-- blocked-slot path and the appointment create/reschedule path under the *same* key so they
-- can't interleave.

-- 1. add_blocked_slot_and_cancel_overlaps (042) takes the lock first, before it does anything else.
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
  PERFORM pg_advisory_xact_lock(hashtext(p_staff_id::text)::bigint);

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

REVOKE ALL ON FUNCTION add_blocked_slot_and_cancel_overlaps(UUID, DATE, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_blocked_slot_and_cancel_overlaps(UUID, DATE, TEXT, INTEGER) TO service_role;

-- 2. New atomic create-or-reschedule path for appointments, taking the SAME lock key as above.
-- Whichever of the two functions acquires the staff's lock first for a given staff_id fully
-- completes its transaction (insert/cancel, or blocked-slot re-check + insert/update) before the
-- other can proceed, closing the race in both directions. The existing appointments_no_overlap
-- exclusion constraint (040) and trg_enforce_max_upcoming_appointments trigger (041) still fire
-- normally on the INSERT/UPDATE inside this function — they're table-level and unaffected by
-- going through a function — so appointment-vs-appointment overlap and the 2-upcoming cap stay
-- exactly as protected as before.
CREATE OR REPLACE FUNCTION create_or_reschedule_appointment(
  p_id UUID,
  p_profile_id UUID,
  p_client_phone TEXT,
  p_client_name TEXT,
  p_branch_id UUID,
  p_staff_id UUID,
  p_service_id UUID,
  p_date DATE,
  p_time TEXT,
  p_duration INTEGER,
  p_service_name TEXT,
  p_staff_name TEXT,
  p_branch_name TEXT,
  p_price INTEGER
)
RETURNS TABLE (
  id UUID,
  date DATE,
  "time" TEXT,
  service_name TEXT,
  staff_name TEXT,
  branch_name TEXT,
  price INTEGER,
  created_at TIMESTAMPTZ
) AS $$
DECLARE
  v_start_mins INTEGER;
  v_end_mins INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_staff_id::text)::bigint);

  v_start_mins := (EXTRACT(HOUR FROM p_time::time)::int * 60 + EXTRACT(MINUTE FROM p_time::time)::int);
  v_end_mins := v_start_mins + p_duration;

  -- Re-check blocked_slots under the lock — the app-level check the API already did before
  -- calling this function can't see a block created concurrently between that check and now.
  IF EXISTS (
    SELECT 1 FROM blocked_slots b
    WHERE b.staff_id = p_staff_id
      AND b.date = p_date
      AND (EXTRACT(HOUR FROM b.time::time)::int * 60 + EXTRACT(MINUTE FROM b.time::time)::int) < v_end_mins
      AND ((EXTRACT(HOUR FROM b.time::time)::int * 60 + EXTRACT(MINUTE FROM b.time::time)::int) + COALESCE(b.duration, 40)) > v_start_mins
  ) THEN
    RAISE EXCEPTION 'SLOT_BLOCKED';
  END IF;

  IF p_id IS NULL THEN
    RETURN QUERY
    INSERT INTO appointments (
      profile_id, client_phone, client_name, branch_id, staff_id, service_id,
      date, time, duration, status, service_name, staff_name, branch_name, price
    ) VALUES (
      p_profile_id, p_client_phone, p_client_name, p_branch_id, p_staff_id, p_service_id,
      p_date, p_time::time, p_duration, 'confirmed', p_service_name, p_staff_name, p_branch_name, p_price
    )
    RETURNING
      appointments.id, appointments.date,
      lpad(EXTRACT(HOUR FROM appointments.time)::int::text, 2, '0') || ':' || lpad(EXTRACT(MINUTE FROM appointments.time)::int::text, 2, '0'),
      appointments.service_name, appointments.staff_name, appointments.branch_name,
      appointments.price, appointments.created_at;
  ELSE
    RETURN QUERY
    UPDATE appointments
    SET branch_id = p_branch_id,
        staff_id = p_staff_id,
        service_id = p_service_id,
        date = p_date,
        time = p_time::time,
        duration = p_duration,
        status = 'confirmed',
        service_name = p_service_name,
        staff_name = p_staff_name,
        branch_name = p_branch_name,
        price = p_price,
        updated_at = now()
    WHERE appointments.id = p_id
    RETURNING
      appointments.id, appointments.date,
      lpad(EXTRACT(HOUR FROM appointments.time)::int::text, 2, '0') || ':' || lpad(EXTRACT(MINUTE FROM appointments.time)::int::text, 2, '0'),
      appointments.service_name, appointments.staff_name, appointments.branch_name,
      appointments.price, appointments.created_at;
  END IF;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION create_or_reschedule_appointment(
  UUID, UUID, TEXT, TEXT, UUID, UUID, UUID, DATE, TEXT, INTEGER, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_or_reschedule_appointment(
  UUID, UUID, TEXT, TEXT, UUID, UUID, UUID, DATE, TEXT, INTEGER, TEXT, TEXT, TEXT, INTEGER
) TO service_role;
