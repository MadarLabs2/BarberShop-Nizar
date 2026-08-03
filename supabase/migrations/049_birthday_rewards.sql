-- Birthday reward system: one free appointment per customer per birthday year, valid for a fixed
-- 30-calendar-day window starting on the birthday itself (e.g. birthday Oct 30 -> valid through end
-- of Nov 29). Granting is idempotent at the DB level via UNIQUE(profile_id, birthday_year) -- the
-- application layer never relies on its own logic alone to prevent duplicates. Redemption is atomic
-- (lock + book + mark-redeemed in one function call) via redeem_birthday_reward_and_book_appointment
-- below, which reuses create_or_reschedule_appointment (045) for the actual booking so it inherits
-- every existing safety check (advisory lock, blocked-slot re-check, exclusion constraint, max-
-- upcoming-appointments trigger) with zero duplicated logic.

CREATE TABLE IF NOT EXISTS public.birthday_rewards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Calendar year of the birthday OCCURRENCE this reward belongs to (not the year it happened to be
  -- granted in) -- a December birthday's reward window can straddle into January, so the app-layer
  -- window calculation always tags the row with the year of the birthday date itself, ensuring a
  -- late-December grant and a still-within-window January re-check resolve to the same row instead
  -- of a second one slipping through.
  birthday_year INTEGER NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exclusive boundary: first instant the reward is NO LONGER valid (start of the day after the
  -- last valid calendar day, Israel time) -- e.g. birthday Oct 30 -> expires_at = Nov 30 00:00
  -- Asia/Jerusalem, so all of Oct 30 through Nov 29 inclusive (30 calendar days) remain valid.
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  -- ON DELETE SET NULL (not CASCADE): if the linked appointment is later hard-deleted (admin can
  -- delete appointments), the reward stays permanently marked redeemed -- it must never become
  -- reusable just because the appointment record was removed afterwards.
  redeemed_appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'redeemed')),
  UNIQUE (profile_id, birthday_year)
);

CREATE INDEX IF NOT EXISTS idx_birthday_rewards_profile ON public.birthday_rewards(profile_id);

-- Locked down like every other table here: the API talks to Supabase with the service-role key
-- only (see apps/api/src/core/supabase.ts), so no anon/authenticated client should ever read or
-- write this directly -- ownership/eligibility is enforced entirely in the NestJS layer against the
-- app's own custom OTP/api_token session, which Postgres RLS (auth.uid()) has no visibility into.
ALTER TABLE public.birthday_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only" ON public.birthday_rewards;
CREATE POLICY "Service role only" ON public.birthday_rewards
  FOR ALL USING (false) WITH CHECK (false);

-- Atomic redemption: locks the caller's active reward row, books the appointment through the
-- existing proven RPC (price forced to 0 here -- never accepted as a parameter, so no caller can
-- ever pass a nonzero price through this path), then marks the reward redeemed. All in one
-- function invocation, so it is one Postgres transaction: if booking fails for any reason (slot
-- taken, blocked, over the upcoming-appointments cap), the whole call rolls back and the reward
-- row is left completely untouched, still unredeemed and reusable on the next attempt.
CREATE OR REPLACE FUNCTION public.redeem_birthday_reward_and_book_appointment(
  p_profile_id UUID,
  p_client_phone TEXT,
  p_client_name TEXT,
  p_branch_id UUID,
  p_staff_id UUID,
  p_service_id UUID,
  p_date DATE,
  p_time TEXT,
  p_duration INTEGER,
  p_service_name TEXT,
  p_staff_name TEXT,
  p_branch_name TEXT,
  p_service_name_he TEXT DEFAULT NULL,
  p_service_name_ar TEXT DEFAULT NULL,
  p_branch_name_he TEXT DEFAULT NULL,
  p_branch_name_ar TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  date DATE,
  "time" TEXT,
  service_name TEXT,
  staff_name TEXT,
  branch_name TEXT,
  price INTEGER,
  created_at TIMESTAMPTZ,
  service_name_he TEXT,
  service_name_ar TEXT,
  branch_name_he TEXT,
  branch_name_ar TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_reward_id UUID;
  v_result RECORD;
BEGIN
  -- Lock the caller's own active reward row first. Plain FOR UPDATE (no SKIP LOCKED) is correct
  -- here: a second concurrent redemption attempt must BLOCK until the first commits or rolls back,
  -- then re-evaluate the WHERE clause against the now-current row -- if the first attempt won,
  -- redeemed_at is no longer NULL and the row no longer matches, so the second attempt correctly
  -- sees "no reward available" instead of racing to redeem the same row twice.
  SELECT br.id INTO v_reward_id
  FROM public.birthday_rewards br
  WHERE br.profile_id = p_profile_id
    AND br.redeemed_at IS NULL
    AND br.expires_at > now()
  ORDER BY br.granted_at
  LIMIT 1
  FOR UPDATE;

  IF v_reward_id IS NULL THEN
    RAISE EXCEPTION 'NO_BIRTHDAY_REWARD';
  END IF;

  -- Reuses every existing booking safety check (advisory lock, blocked-slot re-check, the
  -- appointments_no_overlap exclusion constraint, the max-upcoming-appointments trigger) with zero
  -- duplicated logic. p_id is always NULL (birthday redemption only ever creates a brand-new
  -- appointment, never a reschedule) and p_price is hardcoded to 0, never taken as a parameter.
  SELECT * INTO v_result FROM public.create_or_reschedule_appointment(
    p_id := NULL,
    p_profile_id := p_profile_id,
    p_client_phone := p_client_phone,
    p_client_name := p_client_name,
    p_branch_id := p_branch_id,
    p_staff_id := p_staff_id,
    p_service_id := p_service_id,
    p_date := p_date,
    p_time := p_time,
    p_duration := p_duration,
    p_service_name := p_service_name,
    p_staff_name := p_staff_name,
    p_branch_name := p_branch_name,
    p_price := 0,
    p_service_name_he := p_service_name_he,
    p_service_name_ar := p_service_name_ar,
    p_branch_name_he := p_branch_name_he,
    p_branch_name_ar := p_branch_name_ar
  );

  -- Only reached if the booking insert above actually succeeded -- any exception raised inside it
  -- (SLOT_BLOCKED, exclusion violation, MAX_UPCOMING_APPOINTMENTS) propagates straight out of this
  -- function too, rolling back the reward lock/read above along with it.
  UPDATE public.birthday_rewards
  SET redeemed_at = now(),
      redeemed_appointment_id = v_result.id,
      status = 'redeemed'
  WHERE public.birthday_rewards.id = v_reward_id;

  RETURN QUERY SELECT
    v_result.id, v_result.date, v_result."time", v_result.service_name, v_result.staff_name,
    v_result.branch_name, v_result.price, v_result.created_at, v_result.service_name_he,
    v_result.service_name_ar, v_result.branch_name_he, v_result.branch_name_ar;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_birthday_reward_and_book_appointment(
  UUID, TEXT, TEXT, UUID, UUID, UUID, DATE, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_birthday_reward_and_book_appointment(
  UUID, TEXT, TEXT, UUID, UUID, UUID, DATE, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
