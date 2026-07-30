-- Optional promotional price for retail products (admin shop + staff listings).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sale_price INTEGER NULL CHECK (sale_price IS NULL OR sale_price >= 0);

COMMENT ON COLUMN public.products.sale_price IS 'When set and lower than price, product is shown on sale.';
