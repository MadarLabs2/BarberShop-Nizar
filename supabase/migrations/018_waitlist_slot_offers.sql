-- Claimable slot offers when a waitlist-matching time frees; first to confirm books (others stay on waitlist).

CREATE TABLE IF NOT EXISTS public.waitlist_slot_offers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  waitlist_id UUID NOT NULL REFERENCES public.waitlist(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_slot_offers_profile_pending
  ON public.waitlist_slot_offers (profile_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_waitlist_slot_offers_slot_pending
  ON public.waitlist_slot_offers (staff_id, date, time, service_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_slot_one_pending_per_slot
  ON public.waitlist_slot_offers (profile_id, staff_id, service_id, date, time)
  WHERE status = 'pending';

ALTER TABLE public.waitlist_slot_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all waitlist_slot_offers" ON public.waitlist_slot_offers FOR ALL USING (true) WITH CHECK (true);
