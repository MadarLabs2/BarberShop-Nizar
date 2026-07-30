-- Restore per-user notification clear semantics.
-- Clear-all should never delete broadcast admin rows for other users.
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS notifications_cleared_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.notifications_cleared_at IS
  'Hide broadcast notifications (user_phone IS NULL) with created_at <= this timestamp for this profile.';

CREATE OR REPLACE FUNCTION public.notifications_clear_all_for_customer(p_phone text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n1 integer := 0;
  normalized text := null;
BEGIN
  normalized := nullif(trim(p_phone), '');

  IF normalized IS NOT NULL THEN
    DELETE FROM public.notifications WHERE user_phone = normalized;
    GET DIAGNOSTICS n1 = ROW_COUNT;

    UPDATE public.profiles
    SET notifications_cleared_at = NOW()
    WHERE phone = normalized;
  END IF;

  RETURN n1;
END;
$$;

REVOKE ALL ON FUNCTION public.notifications_clear_all_for_customer(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notifications_clear_all_for_customer(text) TO service_role;
