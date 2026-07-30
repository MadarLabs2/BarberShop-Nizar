-- Add api_token to profiles for session-based auth
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_token TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_profiles_api_token ON profiles(api_token);
