-- Sprint 13: Link staff to profiles for real staff role
-- Enables profile_id -> staff so a logged-in user can be identified as staff.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_profile_id ON staff(profile_id) WHERE profile_id IS NOT NULL;
