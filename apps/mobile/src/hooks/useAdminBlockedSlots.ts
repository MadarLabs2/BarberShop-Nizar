import { useState, useCallback, useEffect, useRef } from 'react';
import { getBlockedSlots, addBlockedSlot, removeBlockedSlot, type MyBlockedSlot } from '../services/admin.api';
import { getTodayDateString, toDateString } from '../utils/dates';
import { validateWorkingTimeRange, parseTimeToMins } from '../utils/validators';

export type BlockedSlotDisplay = MyBlockedSlot & { endTime: string };

/** Per-staff in-memory cache so switching between already-visited staff repaints instantly, no loading flash. */
const CACHE_TTL_MS = 60_000;
const cacheByStaffId = new Map<string, { slots: BlockedSlotDisplay[]; at: number }>();

function peekCache(staffId: string): BlockedSlotDisplay[] | null {
  const c = cacheByStaffId.get(staffId);
  if (!c) return null;
  if (Date.now() - c.at > CACHE_TTL_MS) return null;
  return c.slots;
}

function setCache(staffId: string, slots: BlockedSlotDisplay[]): void {
  cacheByStaffId.set(staffId, { slots, at: Date.now() });
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

async function fetchAndCache(token: string, staffId: string): Promise<BlockedSlotDisplay[]> {
  const from = getTodayDateString();
  const to = addDaysToDateStr(from, 90);
  const data = await getBlockedSlots(token, staffId, from, to);
  const mapped = data.map((s) => ({
    ...s,
    endTime: minsToTime(parseTimeToMins(s.time) + s.duration),
  }));
  setCache(staffId, mapped);
  return mapped;
}

const prefetchInFlight = new Map<string, Promise<void>>();

/**
 * Fire-and-forget warm of a staff's blocked-slot list before the screen mounts — call this
 * from onPressIn on whatever row navigates to the blocked-times screen, so the data is (often)
 * already cached by the time the screen actually renders, instead of showing an empty gap.
 */
export function prefetchAdminBlockedSlots(token: string | null, staffId: string | null): void {
  if (!token || !staffId) return;
  if (peekCache(staffId) != null) return;
  if (prefetchInFlight.has(staffId)) return;
  const p = fetchAndCache(token, staffId)
    .then(() => {})
    .catch(() => {})
    .finally(() => {
      prefetchInFlight.delete(staffId);
    });
  prefetchInFlight.set(staffId, p);
}

/** Admin-only management of blocked time slots for a chosen staff member (staffId is explicit, not inferred from token). */
export function useAdminBlockedSlots(token: string | null, staffId: string | null) {
  const [slots, setSlots] = useState<BlockedSlotDisplay[]>(() => (staffId ? peekCache(staffId) ?? [] : []));
  const [loading, setLoading] = useState(() => !!staffId && peekCache(staffId) == null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  /** Guards against a slow response for a previously-selected staff overwriting the currently-selected one. */
  const activeStaffIdRef = useRef<string | null>(staffId);

  const fetchForStaff = useCallback(
    async (targetStaffId: string, opts?: { silent?: boolean }) => {
      if (!token) return;
      if (!opts?.silent) setLoading(true);
      try {
        // A press-in prefetch (before navigation even completed) may already be in flight — piggyback on it.
        const inFlight = prefetchInFlight.get(targetStaffId);
        if (inFlight) await inFlight;
        const mapped = inFlight ? peekCache(targetStaffId) ?? [] : await fetchAndCache(token, targetStaffId);
        if (activeStaffIdRef.current === targetStaffId) setSlots(mapped);
      } catch {
        if (activeStaffIdRef.current === targetStaffId && peekCache(targetStaffId) == null) setSlots([]);
      } finally {
        if (activeStaffIdRef.current === targetStaffId) setLoading(false);
      }
    },
    [token],
  );

  // Switching staff: paint instantly from cache (if any) with no spinner, then silently revalidate in the background.
  useEffect(() => {
    activeStaffIdRef.current = staffId;
    if (!token || !staffId) {
      setSlots([]);
      setLoading(false);
      return;
    }
    const cached = peekCache(staffId);
    setSlots(cached ?? []);
    setLoading(cached == null);
    void fetchForStaff(staffId, { silent: cached != null });
  }, [token, staffId, fetchForStaff]);

  const onRefresh = useCallback(() => {
    if (!staffId) return Promise.resolve();
    return fetchForStaff(staffId);
  }, [staffId, fetchForStaff]);

  const add = useCallback(
    async (
      date: string,
      startTime: string,
      endTime: string,
    ): Promise<{ error?: string; cancelledAppointments?: number }> => {
      if (!token || !staffId) return { error: 'לא נבחר איש צוות' };
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
        setCache(staffId, optimistic);
        const { id, cancelledAppointments } = await addBlockedSlot(token, { staffId, date, startTime, endTime });
        const next = optimistic.map((x) => (x.id === tempId ? { ...x, id } : x)).sort(sortSlots);
        setSlots(next);
        setCache(staffId, next);
        return { cancelledAppointments: cancelledAppointments ?? 0 };
      } catch (e) {
        setSlots(prev);
        setCache(staffId, prev);
        return { error: e instanceof Error ? e.message : 'לא הצלחנו לחסום' };
      } finally {
        setSaving(false);
      }
    },
    [token, staffId, slots],
  );

  const remove = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      if (!token || !staffId) return { error: 'לא מחובר' };
      if (removingId) return { error: 'ממתין...' };
      setRemovingId(id);
      const prev = [...slots];
      try {
        const next = slots.filter((x) => x.id !== id);
        setSlots(next);
        setCache(staffId, next);
        await removeBlockedSlot(token, id);
        return {};
      } catch (e) {
        setSlots(prev);
        setCache(staffId, prev);
        return { error: e instanceof Error ? e.message : 'לא הצלחנו להסיר' };
      } finally {
        setRemovingId(null);
      }
    },
    [token, staffId, removingId, slots],
  );

  return { slots, loading, saving, removingId, add, remove, onRefresh };
}
