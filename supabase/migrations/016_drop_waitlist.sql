-- Remove unused waitlist feature (app no longer references this table).
DROP TABLE IF EXISTS public.waitlist CASCADE;
