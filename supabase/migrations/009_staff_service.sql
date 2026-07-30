-- Staff–service assignment (each staff provides only assigned services)
CREATE TABLE IF NOT EXISTS staff_service (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(staff_id, service_id)
);
CREATE INDEX idx_staff_service_staff ON staff_service(staff_id);
CREATE INDEX idx_staff_service_service ON staff_service(service_id);

-- Seed: assign all active services to all active staff (preserve current behavior)
-- Admins can then remove assignments as needed
INSERT INTO staff_service (staff_id, service_id)
SELECT s.id, svc.id
FROM staff s
CROSS JOIN services svc
WHERE s.is_active = true AND svc.is_active = true
ON CONFLICT (staff_id, service_id) DO NOTHING;
