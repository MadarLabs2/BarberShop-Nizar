-- Long-lived api_token session metadata (no forced short expiry; optional rolling activity signal).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS api_token_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS api_token_last_used_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.api_token_issued_at IS 'When the current api_token was minted (OTP verify).';
COMMENT ON COLUMN profiles.api_token_last_used_at IS 'Last successful auth validation; updated on a throttled schedule.';
