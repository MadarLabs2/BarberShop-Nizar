-- Read paths: GET /bookings/my (profile or phone + status + date/time) and GET /notifications/my (phone + created_at).
-- Avoid duplicating identical indexes; add composites missing from 001_init.

-- Appointments: "my list" filters (profile_id OR client_phone), status <> cancelled, ordered by date/time.
CREATE INDEX IF NOT EXISTS idx_appointments_my_profile_date_time
  ON appointments (profile_id, date DESC, time DESC)
  WHERE status <> 'cancelled' AND profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_my_phone_date_time
  ON appointments (client_phone, date DESC, time DESC)
  WHERE status <> 'cancelled' AND client_phone IS NOT NULL;

-- Notifications: newest-first per recipient phone (broadcast rows use user_phone IS NULL and stay on global created_at index).
CREATE INDEX IF NOT EXISTS idx_notifications_user_phone_created_desc
  ON notifications (user_phone, created_at DESC)
  WHERE user_phone IS NOT NULL;
