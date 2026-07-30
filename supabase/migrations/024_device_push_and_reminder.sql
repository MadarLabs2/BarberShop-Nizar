-- Device push tokens (Expo) per profile; appointment day reminder dedupe.

CREATE TABLE IF NOT EXISTS device_push_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  platform TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_profile_active
  ON device_push_tokens (profile_id)
  WHERE is_active = true;

ALTER TABLE device_push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "device_push_tokens service" ON device_push_tokens FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS day_reminder_sent_at TIMESTAMPTZ;
