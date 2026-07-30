import { useState, useCallback, useEffect } from 'react';
import { getMyBlockedSlots, addMyBlockedSlot, removeMyBlockedSlot, type MyBlockedSlot } from '../services/admin.api';
import { getTodayDateString, toDateString } from '../utils/dates';
import { validateWorkingTimeRange, parseTimeToMins } from '../utils/validators';

export type BlockedSlotDisplay = MyBlockedSlot & { endTime: string };

/** Single-slot cache (always "my own" blocked times — no staff key needed) so re-entering the
 * screen or coming back from elsewhere in the app repaints instantly with no loading flash. */
const CACHE_TTL_MS = 60_000;
let cached: { slots: BlockedSlotDisplay[]; at: number } | null = null;

function peekCache(): BlockedSlotDisplay[] | null {
  if (!cached) return null;
  if (Date.now() - cached.at > CACHE_TTL_MS) return null;
  return cached.slots;
}

function setCache(slots: BlockedSlotDisplay[]): void {
  cached = { slots, at: Date.now() };
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

function minsToTime(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function sortSlots(a: BlockedSlotDisplay, b: BlockedSlotDisplay): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return a.time.localeCompare(b.time);
}

async function fetchAndCache(token: string): Promise<BlockedSlotDisplay[]> {
  const from = getTodayDateString();
  const to = addDaysToDateStr(from, 90);
  const data = await getMyBlockedSlots(token, from, to);
  const mapped = data.map((s) => ({
    ...s,
    endTime: minsToTime(parseTimeToMins(s.time) + s.duration),
  }));
  setCache(mapped);
  return mapped;
}

let prefetchInFlight: Promise<void> | null = null;

/** Fire-and-forget warm before the staff-blocked-times screen mounts — call from onPressIn on
 * whatever row navigates to it, so the list is (often) already cached by the time it renders. */
export function prefetchMyBlockedSlots(token: string | null): void {
  if (!token) return;
  if (peekCache() != null) return;
  if (prefetchInFlight) return;
  prefetchInFlight = fetchAndCache(token)
    .then(() => {})
    .catch(() => {})
    .finally(() => {
      prefetchInFlight = null;
    });
}

/**
 * Staff self-service — only usable when the admin has granted `can_block_own_time`
 * (the server enforces this independently; the screen this backs is only reachable
 * when the currently logged-in staff member has the permission).
 */
export function useMyBlockedSlots(token: string | null) {
  const [slots, setSlots] = useState<BlockedSlotDisplay[]>(() => peekCache() ?? []);
  const [loading, setLoading] = useState(() => peekCache() == null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!token) return;
      if (!opts?.silent) setLoading(true);
      try {
        const inFlight = prefetchInFlight;
        if (inFlight) await inFlight;
        const mapped = inFlight ? peekCache() ?? [] : await fetchAndCache(token);
        setSlots(mapped);
      } catch {
        if (peekCache() == null) setSlots([]);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const c = peekCache();
    void load({ silent: c != null });
  }, [load]);

  const add = useCallback(
    async (
      date: string,
      startTime: string,
      endTime: string,
    ): Promise<{ error?: string; cancelledAppointments?: number }> => {
      if (!token) return { error: 'לא מחובר' };
      const vr = validateWorkingTimeRange(startTime, endTime);
      if (!vr.valid) return { error: vr.error };
      setSaving(true);
      const tempId = `temp-${Date.now()}`;
      const tempSlot: BlockedSlotDisplay = {
        id: tempId,
        date,
        time: startTime,
        duration: parseTimeToMins(endTime) - parseTimeToMins(startTime),
        endTime,
      };
      const prev = [...slots];
      try {
        const optimistic = [...slots, tempSlot].sort(sortSlots);
        setSlots(optimistic);
        setCache(optimistic);
        const { id, cancelledAppointments } = await addMyBlockedSlot(token, { date, startTime, endTime });
        const next = optimistic.map((x) => (x.id === tempId ? { ...x, id } : x)).sort(sortSlots);
        setSlots(next);
        setCache(next);
        return { cancelledAppointments: cancelledAppointments ?? 0 };
      } catch (e) {
        setSlots(prev);
        setCache(prev);
        return { error: e instanceof Error ? e.message : 'לא הצלחנו לחסום' };
      } finally {
        setSaving(false);
      }
    },
    [token, slots],
  );

  const remove = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      if (!token) return { error: 'לא מחובר' };
      if (removingId) return { error: 'ממתין...' };
      setRemovingId(id);
      const prev = [...slots];
      try {
        const next = slots.filter((x) => x.id !== id);
        setSlots(next);
        setCache(next);
        await removeMyBlockedSlot(token, id);
        return {};
      } catch (e) {
        setSlots(prev);
        setCache(prev);
        return { error: e instanceof Error ? e.message : 'לא הצלחנו להסיר' };
      } finally {
        setRemovingId(null);
      }
    },
    [token, removingId, slots],
  );

  const onRefresh = useCallback(() => load(), [load]);

  return { slots, loading, saving, removingId, add, remove, onRefresh };
}
