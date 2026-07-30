-- ---------------------------------------------------------------------------
-- Public catalog reads: active / public-facing rows only
-- ---------------------------------------------------------------------------

-- branches
DROP POLICY IF EXISTS "Anyone can view branches" ON public.branches;
DROP POLICY IF EXISTS "Public read active branches" ON public.branches;

CREATE POLICY "Public read active branches"
  ON public.branches FOR SELECT
  USING (is_active = true);


-- services
DROP POLICY IF EXISTS "Anyone can view services" ON public.services;
DROP POLICY IF EXISTS "Public read active services" ON public.services;

CREATE POLICY "Public read active services"
  ON public.services FOR SELECT
  USING (is_active = true);


-- staff
DROP POLICY IF EXISTS "Anyone can view staff" ON public.staff;
DROP POLICY IF EXISTS "Public read active staff" ON public.staff;

CREATE POLICY "Public read active staff"
  ON public.staff FOR SELECT
  USING (is_active = true);


-- products
DROP POLICY IF EXISTS "Anyone can view products" ON public.products;
DROP POLICY IF EXISTS "Public read active products" ON public.products;

CREATE POLICY "Public read active products"
  ON public.products FOR SELECT
  USING (is_active = true);