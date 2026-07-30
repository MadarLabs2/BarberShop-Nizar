-- Admin-controlled permission: by default a staff member cannot manage their own blocked time
-- (that moved to admin-only). Admin can grant/revoke this per staff member from the staff tab.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS can_block_own_time BOOLEAN NOT NULL DEFAULT false;
