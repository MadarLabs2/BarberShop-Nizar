-- Waitlist: customer joins when day is fully booked; prefers morning/midday/evening windows.
-- Notified when a matching slot frees (cancel / unblock); first to book wins.

CREATE TABLE IF NOT EXISTS public.waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_phone TEXT NOT NULL,
  client_name TEXT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  prefer_morning BOOLEAN NOT NULL DEFAULT false,
  prefer_afternoon BOOLEAN NOT NULL DEFAULT false,
  prefer_evening BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX waitlist_one_active_per_day
  ON public.waitlist (profile_id, staff_id, service_id, date)
  WHERE status = 'active';

CREATE INDEX idx_waitlist_staff_date ON public.waitlist (staff_id, date);
CREATE INDEX idx_waitlist_profile ON public.waitlist (profile_id);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all waitlist" ON public.waitlist FOR ALL USING (true) WITH CHECK (true);
