-- Tighten remaining permissive RLS on catalog/admin join tables.
-- Service role bypasses RLS; anon/authenticated direct PostgREST access is read-only where needed.

-- ---------------------------------------------------------------------------
-- staff_working_days: was FOR ALL USING (true)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all staff_working_days" ON public.staff_working_days;
CREATE POLICY "Public read staff_working_days active staff"
  ON public.staff_working_days FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_working_days.staff_id AND s.is_active = true
    )
  );

-- ---------------------------------------------------------------------------
-- staff_rest_days: was FOR ALL USING (true)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all staff_rest_days" ON public.staff_rest_days;
CREATE POLICY "Public read staff_rest_days active staff"
  ON public.staff_rest_days FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_rest_days.staff_id AND s.is_active = true
    )
  );

-- ---------------------------------------------------------------------------
-- branch_staff: replace open read with active branch + active staff
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view branch_staff" ON public.branch_staff;
CREATE POLICY "Public read branch_staff active ends"
  ON public.branch_staff FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = branch_staff.branch_id AND b.is_active = true
    )
    AND EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = branch_staff.staff_id AND s.is_active = true
    )
  );

-- ---------------------------------------------------------------------------
-- staff_service: table had no RLS — enable + catalog read only
-- ---------------------------------------------------------------------------
ALTER TABLE public.staff_service ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read staff_service catalog" ON public.staff_service;
CREATE POLICY "Public read staff_service catalog"
  ON public.staff_service FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_service.staff_id AND s.is_active = true
    )
    AND EXISTS (
      SELECT 1 FROM public.services svc
      WHERE svc.id = staff_service.service_id AND svc.is_active = true
    )
  );

-- ---------------------------------------------------------------------------
-- home_stories: keep public SELECT; ensure no accidental write policies
-- (021 only defined SELECT; replace same semantics with explicit name)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read home stories" ON public.home_stories;
CREATE POLICY "Public read home stories"
  ON public.home_stories FOR SELECT
  USING (true);

-- branches, services, staff, products: already restricted in 029 — no change.
