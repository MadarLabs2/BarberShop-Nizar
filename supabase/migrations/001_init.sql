-- Barbershop V2 – Base schema
-- Inspired by barbershop-main, normalized and consistent naming.

-- Profiles: users (phone-based auth; auth.users link added in Sprint 5)
CREATE TABLE profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  birth_date DATE,
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_profiles_phone ON profiles(phone);

-- Branches
CREATE TABLE branches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  waze_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Services
CREATE TABLE services (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Staff (barbers; renamed for consistency)
CREATE TABLE staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_staff_phone ON staff(phone);

-- Branch–staff assignment
CREATE TABLE branch_staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(branch_id, staff_id)
);
CREATE INDEX idx_branch_staff_branch ON branch_staff(branch_id);
CREATE INDEX idx_branch_staff_staff ON branch_staff(staff_id);

-- Appointments
CREATE TABLE appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  client_phone TEXT,
  client_name TEXT,
  branch_id UUID REFERENCES branches(id),
  staff_id UUID REFERENCES staff(id),
  service_id UUID REFERENCES services(id),
  date DATE NOT NULL,
  time TIME NOT NULL,
  duration INTEGER NOT NULL,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  service_name TEXT,
  staff_name TEXT,
  branch_name TEXT,
  price INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_appointments_profile ON appointments(profile_id);
CREATE INDEX idx_appointments_client_phone ON appointments(client_phone);
CREATE INDEX idx_appointments_date ON appointments(date);
CREATE INDEX idx_appointments_status ON appointments(status);

-- Notifications
CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_phone TEXT,
  type TEXT NOT NULL CHECK (type IN ('personal', 'admin')),
  title TEXT NOT NULL,
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_notifications_user_phone ON notifications(user_phone);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- OTP requests (phone verification)
CREATE TABLE otp_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_otp_requests_phone ON otp_requests(phone);
CREATE INDEX idx_otp_requests_created ON otp_requests(created_at);
