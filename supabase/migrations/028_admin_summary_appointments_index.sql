-- Supports GET /admin/summary: COUNT confirmed appointments with date >= today (head-only count).
-- Partial index keeps the btree small (confirmed rows only) and matches the filter order.
CREATE INDEX IF NOT EXISTS idx_appointments_confirmed_date
  ON appointments (date)
  WHERE status = 'confirmed';
