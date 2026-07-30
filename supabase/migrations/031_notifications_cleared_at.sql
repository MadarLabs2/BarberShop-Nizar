-- Per-user inbox clear: hide broadcast rows (user_phone NULL) after the user clears notifications.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notifications_cleared_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.notifications_cleared_at IS
  'Broadcast notifications with created_at <= this instant are omitted for this user (personal rows are deleted on clear).';
