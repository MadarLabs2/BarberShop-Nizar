-- Pre-Sprint 7: Schema hardening for booking integrity
-- Minimal changes only. Do not add waitlist, blocked_slots, etc.

-- 1. is_active for catalog entities (soft delete / hide without removing)
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 2. updated_at where useful
ALTER TABLE branches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE staff ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Tighten nullability for booking integrity
-- branch_staff: junction table must have both FKs
ALTER TABLE branch_staff
  ALTER COLUMN branch_id SET NOT NULL,
  ALTER COLUMN staff_id SET NOT NULL;

-- appointments: core booking FKs required (fails if existing rows have NULLs)
ALTER TABLE appointments
  ALTER COLUMN branch_id SET NOT NULL,
  ALTER COLUMN staff_id SET NOT NULL,
  ALTER COLUMN service_id SET NOT NULL;
-- duration is already NOT NULL in 001_init

-- 4. otp_requests: explicit expiry and verification tracking
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- 5. Booking conflict protection: no two confirmed appointments same staff/date/time
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_staff_date_time_confirmed
  ON appointments (staff_id, date, time)
  WHERE status = 'confirmed';
