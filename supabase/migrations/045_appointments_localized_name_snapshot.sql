-- The Hebrew/Arabic names added to services and branches (044) never reached the appointments
-- table: `service_name`/`branch_name` are frozen "snapshot" TEXT columns written once at booking
-- time, and the mobile side only tried to localize them via a tiny 2-entry hardcoded dictionary
-- (`CATALOG_HE_TO_AR`). Result: an Arabic-language customer books with the Arabic service name
-- correctly shown during picking, but the resulting appointment always displays the Hebrew
-- snapshot afterwards. Fix: widen the snapshot to carry both languages, same nullable-mirror
-- pattern as the base tables — `service_name`/`branch_name` are kept unchanged (still the
-- Hebrew/legacy value, still used as a fallback), no existing data is touched beyond the backfill.

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_name_he TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_name_ar TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS branch_name_he TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS branch_name_ar TEXT;

-- Historical rows predate real Arabic names — mirror the existing Hebrew snapshot into both
-- columns (identical to what the customer already sees today) so nothing regresses to blank.
UPDATE appointments SET service_name_he = service_name WHERE service_name_he IS NULL AND service_name IS NOT NULL;
UPDATE appointments SET service_name_ar = service_name WHERE service_name_ar IS NULL AND service_name IS NOT NULL;
UPDATE appointments SET branch_name_he = branch_name WHERE branch_name_he IS NULL AND branch_name IS NOT NULL;
UPDATE appointments SET branch_name_ar = branch_name WHERE branch_name_ar IS NULL AND branch_name IS NOT NULL;

-- Re-declare create_or_reschedule_appointment (043) with 4 new trailing DEFAULT-valued params.
-- Despite the new params having defaults, PostgreSQL treats a changed argument list as a distinct
-- overload rather than a true replace (confirmed empirically) — drop the old 14-arg signature
-- first so this stays a single function, not two, since every caller already passes all 18 args.
DROP FUNCTION IF EXISTS create_or_reschedule_appointment(
  UUID, UUID, TEXT, TEXT, UUID, UUID, UUID, DATE, TEXT, INTEGER, TEXT, TEXT, TEXT, INTEGER
);

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
  p_price INTEGER,
  p_service_name_he TEXT DEFAULT NULL,
  p_service_name_ar TEXT DEFAULT NULL,
  p_branch_name_he TEXT DEFAULT NULL,
  p_branch_name_ar TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  date DATE,
  "time" TEXT,
  service_name TEXT,
  staff_name TEXT,
  branch_name TEXT,
  price INTEGER,
  created_at TIMESTAMPTZ,
  service_name_he TEXT,
  service_name_ar TEXT,
  branch_name_he TEXT,
  branch_name_ar TEXT
) AS $$
DECLARE
  v_start_mins INTEGER;
  v_end_mins INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_staff_id::text)::bigint);

  v_start_mins := (EXTRACT(HOUR FROM p_time::time)::int * 60 + EXTRACT(MINUTE FROM p_time::time)::int);
  v_end_mins := v_start_mins + p_duration;

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
      date, time, duration, status, service_name, staff_name, branch_name, price,
      service_name_he, service_name_ar, branch_name_he, branch_name_ar
    ) VALUES (
      p_profile_id, p_client_phone, p_client_name, p_branch_id, p_staff_id, p_service_id,
      p_date, p_time::time, p_duration, 'confirmed', p_service_name, p_staff_name, p_branch_name, p_price,
      p_service_name_he, p_service_name_ar, p_branch_name_he, p_branch_name_ar
    )
    RETURNING
      appointments.id, appointments.date,
      lpad(EXTRACT(HOUR FROM appointments.time)::int::text, 2, '0') || ':' || lpad(EXTRACT(MINUTE FROM appointments.time)::int::text, 2, '0'),
      appointments.service_name, appointments.staff_name, appointments.branch_name,
      appointments.price, appointments.created_at,
      appointments.service_name_he, appointments.service_name_ar, appointments.branch_name_he, appointments.branch_name_ar;
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
        service_name_he = p_service_name_he,
        service_name_ar = p_service_name_ar,
        branch_name_he = p_branch_name_he,
        branch_name_ar = p_branch_name_ar,
        updated_at = now()
    WHERE appointments.id = p_id
    RETURNING
      appointments.id, appointments.date,
      lpad(EXTRACT(HOUR FROM appointments.time)::int::text, 2, '0') || ':' || lpad(EXTRACT(MINUTE FROM appointments.time)::int::text, 2, '0'),
      appointments.service_name, appointments.staff_name, appointments.branch_name,
      appointments.price, appointments.created_at,
      appointments.service_name_he, appointments.service_name_ar, appointments.branch_name_he, appointments.branch_name_ar;
  END IF;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION create_or_reschedule_appointment(
  UUID, UUID, TEXT, TEXT, UUID, UUID, UUID, DATE, TEXT, INTEGER, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_or_reschedule_appointment(
  UUID, UUID, TEXT, TEXT, UUID, UUID, UUID, DATE, TEXT, INTEGER, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT
) TO service_role;
