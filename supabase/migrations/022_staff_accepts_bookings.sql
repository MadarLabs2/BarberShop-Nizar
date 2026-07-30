-- Public booking catalog: staff may opt out of being bookable while keeping a staff profile (e.g. admin-only).
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS accepts_bookings BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.staff.accepts_bookings IS
  'When false, staff is excluded from customer booking/team catalog even if otherwise configured.';
