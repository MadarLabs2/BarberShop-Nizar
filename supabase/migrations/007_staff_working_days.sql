-- Sprint 15: staff_working_days (opt-in working days)
-- Admin selects days staff DOES work. No dependency on staff_rest_days.

CREATE TABLE IF NOT EXISTS staff_working_days (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(staff_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_staff_working_days_staff ON staff_working_days(staff_id);

ALTER TABLE staff_working_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all staff_working_days" ON staff_working_days;
CREATE POLICY "Allow all staff_working_days" ON staff_working_days FOR ALL USING (true) WITH CHECK (true);

DROP TABLE IF EXISTS staff_rest_days;
