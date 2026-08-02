-- Multilingual names: admin now enters both a Hebrew and an Arabic name for every service and
-- branch (no auto-translation anywhere). Existing single `name` values are preserved as the
-- Hebrew value (name_he); name_ar is backfilled with the same existing text purely as a safe
-- non-blank placeholder — identical to today's actual behavior, where the same string is shown
-- regardless of app language — until an admin edits it. Standard safe pattern already used in
-- this codebase (008_staff_working_hours_extend.sql, 010_staff_service_price_duration.sql):
-- add nullable, backfill, then enforce NOT NULL.
--
-- The original `name` column is intentionally kept (still NOT NULL) as a server-maintained
-- mirror of name_he (apps/api/src/modules/admin-catalog.ts sets it on every write). Many other
-- read paths still depend on it unchanged: the appointments.service_name/branch_name
-- booking-time snapshot written by the create_or_reschedule_appointment RPC (migration 043),
-- waitlist.service.ts's live-joined push-notification text, products/staff-report sorting.
-- None of that is being touched here.

ALTER TABLE services ADD COLUMN IF NOT EXISTS name_he TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS name_ar TEXT;
UPDATE services SET name_he = name WHERE name_he IS NULL;
UPDATE services SET name_ar = name WHERE name_ar IS NULL;
ALTER TABLE services ALTER COLUMN name_he SET NOT NULL;
ALTER TABLE services ALTER COLUMN name_ar SET NOT NULL;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS name_he TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS name_ar TEXT;
UPDATE branches SET name_he = name WHERE name_he IS NULL;
UPDATE branches SET name_ar = name WHERE name_ar IS NULL;
ALTER TABLE branches ALTER COLUMN name_he SET NOT NULL;
ALTER TABLE branches ALTER COLUMN name_ar SET NOT NULL;
