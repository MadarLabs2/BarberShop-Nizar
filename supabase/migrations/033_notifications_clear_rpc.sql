-- Reliable inbox clear from API (service role): deletes personal rows for phone + all admin rows.
-- Bypasses PostgREST edge cases with chained deletes / returning limits.

CREATE OR REPLACE FUNCTION public.notifications_clear_all_for_customer(p_phone text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n1 integer := 0;
  n2 integer := 0;
BEGIN
  IF p_phone IS NOT NULL AND length(trim(p_phone)) > 0 THEN
    DELETE FROM public.notifications WHERE user_phone = trim(p_phone);
    GET DIAGNOSTICS n1 = ROW_COUNT;
  END IF;

  DELETE FROM public.notifications WHERE type = 'admin';
  GET DIAGNOSTICS n2 = ROW_COUNT;

  RETURN n1 + n2;
END;
$$;

REVOKE ALL ON FUNCTION public.notifications_clear_all_for_customer(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notifications_clear_all_for_customer(text) TO service_role;
