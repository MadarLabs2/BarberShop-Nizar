-- Customer can hide past appointments from "My appointments" without deleting the row (staff/admin still see full history).
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_hidden_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_client_hidden ON appointments(client_hidden_at) WHERE client_hidden_at IS NOT NULL;
