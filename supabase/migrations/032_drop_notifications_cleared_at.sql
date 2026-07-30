-- Clear-all now deletes global admin rows in DB; per-user cutoff column is unused.
ALTER TABLE profiles DROP COLUMN IF EXISTS notifications_cleared_at;
    