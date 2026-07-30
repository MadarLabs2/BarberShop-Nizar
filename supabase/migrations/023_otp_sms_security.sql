-- Secure OTP for SMS login: hashed codes, resend cooldown, verify attempts, delivery metadata.
-- Legacy plaintext `code` is deprecated; new rows use otp_code_hash only.

ALTER TABLE otp_requests ALTER COLUMN code DROP NOT NULL;

ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS otp_code_hash TEXT;
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS resend_available_at TIMESTAMPTZ;
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS max_verify_attempts INTEGER NOT NULL DEFAULT 5;
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS delivery_status TEXT;
ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS delivery_error TEXT;

CREATE INDEX IF NOT EXISTS idx_otp_requests_phone_created_desc ON otp_requests (phone, created_at DESC);

-- Legacy rows: ensure expiry is defined so verification queries stay consistent
UPDATE otp_requests SET expires_at = created_at + interval '10 minutes' WHERE expires_at IS NULL;
