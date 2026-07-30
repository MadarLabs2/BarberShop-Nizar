-- Replace the clock-based "clear" (hide-only) model with permanent, per-user deletion.
--
-- Personal notifications (user_phone = this user's phone) are hard-deleted — gone for good.
-- Broadcasts (user_phone IS NULL, type='admin') are shared rows other users still need, so they
-- can never be deleted from the table itself. Instead this profile gets a permanent per-row
-- "dismissal" record; every future read excludes broadcasts this profile has dismissed. Unlike the
-- old `notifications_cleared_at` timestamp cutoff, this has no dependency on any clock (device or
-- server) — it is keyed by notification id, so it cannot un-hide or over-hide rows due to clock skew,
-- and a NEW broadcast created after the delete is never dismissed and always shows normally.

CREATE TABLE IF NOT EXISTS public.notification_dismissals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, notification_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_dismissals_profile ON public.notification_dismissals(profile_id);

-- Locked down like every other table here: the API talks to Supabase with the service-role key
-- only, so no anon/authenticated client should ever read or write this directly.
ALTER TABLE public.notification_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only" ON public.notification_dismissals;
CREATE POLICY "Service role only" ON public.notification_dismissals
  FOR ALL USING (false) WITH CHECK (false);

-- Permanent delete-all for one profile: hard-deletes personal rows, dismisses current broadcasts.
-- Runs as a single function body (atomic — all statements commit together or none do).
CREATE OR REPLACE FUNCTION public.notifications_delete_all_for_profile(p_profile_id uuid)
RETURNS TABLE(deleted_personal integer, dismissed_broadcasts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  n_personal integer := 0;
  n_dismissed integer := 0;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  SELECT phone INTO v_phone FROM public.profiles WHERE id = p_profile_id;

  IF v_phone IS NOT NULL AND length(trim(v_phone)) > 0 THEN
    DELETE FROM public.notifications WHERE user_phone = trim(v_phone);
    GET DIAGNOSTICS n_personal = ROW_COUNT;
  END IF;

  INSERT INTO public.notification_dismissals (profile_id, notification_id)
  SELECT p_profile_id, n.id
  FROM public.notifications n
  WHERE n.user_phone IS NULL AND n.type = 'admin'
  ON CONFLICT (profile_id, notification_id) DO NOTHING;
  GET DIAGNOSTICS n_dismissed = ROW_COUNT;

  RETURN QUERY SELECT n_personal, n_dismissed;
END;
$$;

REVOKE ALL ON FUNCTION public.notifications_delete_all_for_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notifications_delete_all_for_profile(uuid) TO service_role;

-- Retire the old clock-based clear mechanism entirely — one delete-all behavior, not two.
DROP FUNCTION IF EXISTS public.notifications_clear_all_for_customer(text);
ALTER TABLE public.profiles DROP COLUMN IF EXISTS notifications_cleared_at;
