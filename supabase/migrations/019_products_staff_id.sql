-- Shop catalog: staff_id IS NULL (admin-only CRUD). Barber rows: staff_id → staff(id).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_products_staff_id ON public.products (staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_shop_global ON public.products (is_active) WHERE staff_id IS NULL;

COMMENT ON COLUMN public.products.staff_id IS 'NULL = public shop product (admin); set = barber listing for connected customers.';

NOTIFY pgrst, 'reload schema';
