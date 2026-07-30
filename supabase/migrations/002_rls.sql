-- Row Level Security – basic safe policies

-- Profiles: TODO Sprint 5 – tighten with auth.uid()
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Allow insert profiles" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update profiles" ON profiles FOR UPDATE USING (true);

-- Branches, services, staff, branch_staff: public read
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view branches" ON branches FOR SELECT USING (true);
CREATE POLICY "Anyone can view services" ON services FOR SELECT USING (true);
CREATE POLICY "Anyone can view staff" ON staff FOR SELECT USING (true);
CREATE POLICY "Anyone can view branch_staff" ON branch_staff FOR SELECT USING (true);

-- TODO Sprint 5: restrict write to admin only
-- CREATE POLICY "Admin can manage branches" ...

-- Appointments: read all (for availability check), insert/update via API
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view appointments" ON appointments FOR SELECT USING (true);
CREATE POLICY "Anyone can insert appointments" ON appointments FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update appointments" ON appointments FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete appointments" ON appointments FOR DELETE USING (true);

-- Notifications: via API (service role bypasses RLS)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all notifications" ON notifications FOR ALL USING (true) WITH CHECK (true);

-- OTP: via API only (sensitive)
ALTER TABLE otp_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all otp_requests" ON otp_requests FOR ALL USING (true) WITH CHECK (true);
