-- Dev seed – catalog data for development

-- Branches
INSERT INTO branches (id, name, name_he, name_ar, address, waze_link) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'דיר אל אסד', 'דיר אל אסד', 'דיר אל אסד', NULL, NULL),
  ('a0000002-0000-0000-0000-000000000002', 'סניף מרכז', 'סניף מרכז', 'סניף מרכז', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Staff (barbers)
INSERT INTO staff (id, name, phone, avatar_url) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'מוחמד מוסא', NULL, NULL),
  ('b0000002-0000-0000-0000-000000000002', 'אחמד חסן', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Services (duration in minutes)
INSERT INTO services (id, name, name_he, name_ar, price, duration) VALUES
  ('c0000001-0000-0000-0000-000000000001', 'תספורת', 'תספורת', 'תספורת', 60, 40),
  ('c0000002-0000-0000-0000-000000000002', 'תספורת וזקן', 'תספורת וזקן', 'תספורת וזקן', 70, 40),
  ('c0000003-0000-0000-0000-000000000003', 'שאמפו בלבד', 'שאמפו בלבד', 'שאמפו בלבד', 30, 20)
ON CONFLICT (id) DO NOTHING;

-- Branch–staff assignment
INSERT INTO branch_staff (branch_id, staff_id) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000001'),
  ('a0000001-0000-0000-0000-000000000001', 'b0000002-0000-0000-0000-000000000002'),
  ('a0000002-0000-0000-0000-000000000002', 'b0000002-0000-0000-0000-000000000002')
ON CONFLICT (branch_id, staff_id) DO NOTHING;
