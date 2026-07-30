-- Same admin-controlled-permission pattern as can_block_own_time (036), applied to working hours:
-- by default a staff member cannot set their own working days/hours; admin grants/revokes it per staff member.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS can_set_own_working_hours BOOLEAN NOT NULL DEFAULT false;
