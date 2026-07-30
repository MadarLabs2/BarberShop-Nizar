import { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  getMyWorkingHours,
  upsertMyWorkingDay,
  removeMyWorkingDay,
  type MyWorkingHoursEntry,
} from '../services/admin.api';
import { peekStaffWorkingHours, setStaffWorkingHoursCache } from '../services/staffPrefetchCache';
import { DAY_NAMES, WEEK_DAYS_ORDER } from '../utils/dates';
import { validateWorkingTimeRange } from '../utils/validators';

export type WorkingDayLocal = {
  dayOfWeek: number;
  enabled: boolean;
  startTime: string;
  endTime: string;
};

const FOCUS_STALE_MS = 45_000;

function entriesToWorkingLocal(entries: MyWorkingHoursEntry[]): WorkingDayLocal[] {
  const map = new Map(entries.map((e) => [e.dayOfWeek, e]));
  return WEEK_DAYS_ORDER.map((d) => {
    const e = map.get(d);
    if (e) {
      return {
        dayOfWeek: d,
        enabled: true,
        startTime: e.startTime,
        endTime: e.endTime,
      };
    }
    return { dayOfWeek: d, enabled: false, startTime: '09:00', endTime: '19:00' };
  });
}

export function useMyWorkingHours(token: string | null) {
  const peek = peekStaffWorkingHours();
  const [days, setDays] = useState<WorkingDayLocal[]>(() =>
    peek != null
      ? entriesToWorkingLocal(peek)
      : WEEK_DAYS_ORDER.map((d) => ({
          dayOfWeek: d,
          enabled: false,
          startTime: '09:00',
          endTime: '19:00',
        })),
  );
  const [loading, setLoading] = useState(() => peek == null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef<WorkingDayLocal[]>(
    peek != null ? entriesToWorkingLocal(peek).map((x) => ({ ...x })) : [],
  );
  const hasLoadedRef = useRef(peek != null);
  const lastLoadAtRef = useRef(peek != null ? Date.now() : 0);

  const load = useCallback(async () => {
    if (!token) {
      hasLoadedRef.current = false;
      lastLoadAtRef.current = 0;
      return;
    }
    const initial = !hasLoadedRef.current;
    if (initial) setLoading(true);
    setError(null);
    try {
      const entries = await getMyWorkingHours(token);
      const next = entriesToWorkingLocal(entries);
      setDays(next);
      savedRef.current = next.map((x) => ({ ...x }));
      setStaffWorkingHoursCache(entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'טעינה נכשלה');
      if (initial) {
        setDays(WEEK_DAYS_ORDER.map((d) => ({ dayOfWeek: d, enabled: false, startTime: '09:00', endTime: '19:00' })));
      }
    } finally {
      setLoading(false);
      hasLoadedRef.current = true;
      lastLoadAtRef.current = Date.now();
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      const stale = Date.now() - lastLoadAtRef.current > FOCUS_STALE_MS;
      if (!hasLoadedRef.current || stale) {
        void load();
      }
    }, [token, load])
  );

  const toggleDay = useCallback((dayOfWeek: number) => {
    setDays((prev) =>
      prev.map((d) =>
        d.dayOfWeek === dayOfWeek ? { ...d, enabled: !d.enabled } : d
      )
    );
  }, []);

  const setDayTimes = useCallback((dayOfWeek: number, startTime: string, endTime: string) => {
    setDays((prev) =>
      prev.map((d) =>
        d.dayOfWeek === dayOfWeek ? { ...d, startTime, endTime } : d
      )
    );
  }, []);

  const validate = useCallback((): string | null => {
    for (const d of days) {
      if (!d.enabled) continue;
      const r = validateWorkingTimeRange(d.startTime, d.endTime);
      if (!r.valid) return `${DAY_NAMES[d.dayOfWeek]}: ${r.error}`;
    }
    return null;
  }, [days]);

  const save = useCallback(async (): Promise<{ success: boolean; error?: string; cancelledAppointments?: number }> => {
    if (!token) return { success: false, error: 'לא מחובר' };
    const err = validate();
    if (err) return { success: false, error: err };
    if (saving) return { success: false, error: 'ממתין...' };

    setSaving(true);
    setError(null);
    const prev = [...days];

    try {
      const saved = savedRef.current;
      const savedMap = new Map(saved.filter((x) => x.enabled).map((x) => [x.dayOfWeek, x]));

      let cancelledAppointments = 0;
      for (const d of prev) {
        if (d.enabled) {
          const was = savedMap.get(d.dayOfWeek);
          const changed = !was || was.startTime !== d.startTime || was.endTime !== d.endTime;
          if (!was || changed) {
            const res = await upsertMyWorkingDay(token, d.dayOfWeek, d.startTime, d.endTime);
            cancelledAppointments += res.cancelledAppointments ?? 0;
          }
        } else if (savedMap.has(d.dayOfWeek)) {
          const res = await removeMyWorkingDay(token, d.dayOfWeek);
          cancelledAppointments += res.cancelledAppointments ?? 0;
        }
      }

      savedRef.current = prev.map((x) => ({ ...x }));
      try {
        const fresh = await getMyWorkingHours(token);
        setStaffWorkingHoursCache(fresh);
      } catch {
        /* ignore */
      }
      return { success: true, cancelledAppointments };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שמירה נכשלה');
      return { success: false, error: e instanceof Error ? e.message : 'שמירה נכשלה' };
    } finally {
      setSaving(false);
    }
  }, [token, days, saving, validate]);

  const hasChanges = useCallback(() => {
    const saved = savedRef.current;
    if (saved.length !== days.length) return true;
    for (let i = 0; i < days.length; i++) {
      const a = days[i];
      const b = saved[i];
      if (
        a.enabled !== b.enabled ||
        a.startTime !== b.startTime ||
        a.endTime !== b.endTime
      ) {
        return true;
      }
    }
    return false;
  }, [days]);

  return {
    days,
    loading,
    saving,
    error,
    DAY_NAMES,
    toggleDay,
    setDayTimes,
    save,
    validate,
    hasChanges,
    onRefresh: load,
  };
}
