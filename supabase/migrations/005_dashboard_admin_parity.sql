-- Sprint 11: Dashboard & Admin backend parity
-- Adds: waitlist, blocked_slots, staff_rest_days

-- Waitlist (minimal: for count + optional entry)
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  client_phone TEXT,
  client_name TEXT,
  service_name TEXT,
  date DATE,
  prefer_morning BOOLEAN DEFAULT false,
  prefer_afternoon BOOLEAN DEFAULT false,
  prefer_evening BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_waitlist_staff ON waitlist(staff_id);
CREATE INDEX idx_waitlist_date ON waitlist(date);

-- Blocked slots (staff + date + time)
CREATE TABLE IF NOT EXISTS blocked_slots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time TEXT NOT NULL,
  duration INTEGER DEFAULT 40,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_blocked_slots_staff_date ON blocked_slots(staff_id, date);

-- Staff rest days (0=Sunday .. 6=Saturday)
CREATE TABLE IF NOT EXISTS staff_rest_days (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(staff_id, day_of_week)
);
CREATE INDEX idx_staff_rest_days_staff ON staff_rest_days(staff_id);

-- RLS (API uses service role; these allow anon/authenticated for flexibility)
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_rest_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all waitlist" ON waitlist FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all blocked_slots" ON blocked_slots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all staff_rest_days" ON staff_rest_days FOR ALL USING (true) WITH CHECK (true);
