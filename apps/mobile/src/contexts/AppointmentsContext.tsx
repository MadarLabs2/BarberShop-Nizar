import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearPastHistory as clearPastHistoryApi, getMyAppointments } from '../services/bookings.api';
import type { AppointmentDto } from '../services/bookings.api';
import {
  CUSTOMER_APPOINTMENTS_CACHE_WARMED,
  peekCustomerAppointments,
} from '../services/customerPrefetchCache';
import { filterCustomerPastAppointmentsForDisplay } from '../utils/customerAppointmentsDisplay';
import { isAppointmentUpcoming } from '../utils/dates';
import { getAuthState, subscribeAuth } from '../store/auth.store';

/** Exported for screens that need the same staleness window as `refresh` (e.g. focus sync). */
export const APPOINTMENTS_STALE_MS = 60_000;

export type AppointmentsRefreshResult = { upcoming: AppointmentDto[]; past: AppointmentDto[] };

export type AppointmentsState = {
  upcoming: AppointmentDto[];
  past: AppointmentDto[];
  loading: boolean;
  refreshing: boolean;
  lastFetchedAt: number | null;
  /** True after at least one successful fetch while logged in (empty lists are still "loaded"). */
  hasLoadedOnce: boolean;
};

export type AppointmentsContextValue = AppointmentsState & {
  refresh: (token: string | null, options?: { silent?: boolean }) => Promise<AppointmentsRefreshResult | null>;
  forceRefresh: (token: string | null) => Promise<AppointmentsRefreshResult | null>;
  invalidate: () => void;
  updateUpcoming: (updater: (prev: AppointmentDto[]) => AppointmentDto[]) => void;
  /** Call after optimistic local updates so `refresh` does not immediately overwrite with a stale server fetch. */
  bumpLastFetched: () => void;
  clearPastHistory: (token: string | null) => Promise<{ cleared: number }>;
};

const defaultState: AppointmentsState = {
  upcoming: [],
  past: [],
  loading: false,
  refreshing: false,
  lastFetchedAt: null,
  hasLoadedOnce: false,
};

const AppointmentsContext = createContext<AppointmentsContextValue | null>(null);

function quickHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function diskKey(token: string): string {
  return `appointments_v1_t_${quickHash(token)}`;
}

async function loadAppointmentsDisk(
  token: string,
): Promise<{ upcoming: AppointmentDto[]; past: AppointmentDto[]; at: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(diskKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      upcoming?: AppointmentDto[];
      past?: AppointmentDto[];
      at?: number;
    } | null;
    if (
      !parsed ||
      !Array.isArray(parsed.upcoming) ||
      !Array.isArray(parsed.past) ||
      typeof parsed.at !== 'number'
    ) {
      return null;
    }
    return {
      upcoming: sanitizeUpcoming(parsed.upcoming),
      past: filterCustomerPastAppointmentsForDisplay(parsed.past),
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

async function saveAppointmentsDisk(
  token: string,
  upcoming: AppointmentDto[],
  past: AppointmentDto[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      diskKey(token),
      JSON.stringify({
        upcoming: dedupeUpcomingById(upcoming),
        past: filterCustomerPastAppointmentsForDisplay(past),
        at: Date.now(),
      }),
    );
  } catch {
    /* ignore */
  }
}

function isStale(lastFetchedAt: number | null): boolean {
  if (!lastFetchedAt) return true;
  return Date.now() - lastFetchedAt > APPOINTMENTS_STALE_MS;
}

/** Avoid duplicate React keys when optimistic updates race with refresh (same id twice in `upcoming`). */
function dedupeUpcomingById(rows: AppointmentDto[]): AppointmentDto[] {
  const seen = new Set<string>();
  const out: AppointmentDto[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * Same as `dedupeUpcomingById`, plus drops any row whose start time has already passed. Only for
 * data read back from a cache (disk across app restarts, or the in-memory prefetch peek) — that
 * data was correct when it was written, but time keeps moving after that, and neither cache
 * self-corrects until the next network fetch lands. Without this, an appointment can sit in
 * `upcoming` and render on Home/Appointments as still-upcoming long after it actually ended.
 * Freshly server-fetched data doesn't need this — the API already applies the same cutoff.
 */
function sanitizeUpcoming(rows: AppointmentDto[]): AppointmentDto[] {
  const seen = new Set<string>();
  const out: AppointmentDto[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    if (!isAppointmentUpcoming(r.date, r.time)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export function AppointmentsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppointmentsState>(defaultState);
  const fetchVersionRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const refreshInFlightRef = useRef<Promise<AppointmentsRefreshResult | null> | null>(null);

  useEffect(() => {
    const hydrate = async (token: string | null) => {
      if (!token) {
        setState(defaultState);
        refreshInFlightRef.current = null;
        return;
      }
      const peeked = peekCustomerAppointments();
      if (peeked && (peeked.upcoming.length > 0 || peeked.past.length > 0)) {
        setState({
          upcoming: sanitizeUpcoming(peeked.upcoming),
          past: filterCustomerPastAppointmentsForDisplay(peeked.past),
          loading: false,
          refreshing: false,
          lastFetchedAt: Date.now(),
          hasLoadedOnce: true,
        });
        return;
      }
      const disk = await loadAppointmentsDisk(token);
      if (!disk) return;
      setState((s) => ({
        ...s,
        upcoming: disk.upcoming,
        past: disk.past,
        loading: false,
        refreshing: false,
        lastFetchedAt: disk.at,
        hasLoadedOnce: true,
      }));
    };

    void hydrate(getAuthState().token);
    return subscribeAuth(() => {
      void hydrate(getAuthState().token);
    });
  }, []);

  /** Prefetch bundle writes `/bookings/my` before Home focus refresh finishes — mirror into context so appointment cards appear immediately. */
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(CUSTOMER_APPOINTMENTS_CACHE_WARMED, () => {
      const token = getAuthState().token;
      if (!token) return;
      const peeked = peekCustomerAppointments();
      if (!peeked) return;
      const upcoming = sanitizeUpcoming(peeked.upcoming);
      const past = filterCustomerPastAppointmentsForDisplay(peeked.past);
      setState({
        upcoming,
        past,
        loading: false,
        refreshing: false,
        lastFetchedAt: Date.now(),
        hasLoadedOnce: true,
      });
      void saveAppointmentsDisk(token, upcoming, past);
    });
    return () => sub.remove();
  }, []);

  const refresh = useCallback(async (token: string | null, options?: { silent?: boolean }): Promise<AppointmentsRefreshResult | null> => {
    if (!token) {
      setState((s) => ({
        ...s,
        upcoming: [],
        past: [],
        loading: false,
        refreshing: false,
        lastFetchedAt: null,
        hasLoadedOnce: false,
      }));
      refreshInFlightRef.current = null;
      return null;
    }
    const snap = stateRef.current;
    let effectiveUpcoming = snap.upcoming;
    let effectivePast = snap.past;
    let effectiveLastFetched = snap.lastFetchedAt;
    let effectiveHasLoaded = snap.hasLoadedOnce;

    if (!effectiveHasLoaded && effectiveUpcoming.length === 0 && effectivePast.length === 0) {
      const peeked = peekCustomerAppointments();
      if (peeked) {
        effectiveUpcoming = sanitizeUpcoming(peeked.upcoming);
        effectivePast = filterCustomerPastAppointmentsForDisplay(peeked.past);
        effectiveLastFetched = Date.now();
        effectiveHasLoaded = true;
        setState({
          upcoming: effectiveUpcoming,
          past: effectivePast,
          loading: false,
          refreshing: false,
          lastFetchedAt: effectiveLastFetched,
          hasLoadedOnce: true,
        });
      }
      if (effectiveUpcoming.length === 0 && effectivePast.length === 0) {
        const disk = await loadAppointmentsDisk(token);
        if (disk) {
          effectiveUpcoming = disk.upcoming;
          effectivePast = disk.past;
          effectiveLastFetched = disk.at;
          effectiveHasLoaded = true;
          setState({
            upcoming: effectiveUpcoming,
            past: effectivePast,
            loading: false,
            refreshing: false,
            lastFetchedAt: effectiveLastFetched,
            hasLoadedOnce: true,
          });
        }
      }
    }

    if (!isStale(effectiveLastFetched)) {
      return {
        upcoming: effectiveUpcoming,
        past: filterCustomerPastAppointmentsForDisplay(effectivePast),
      };
    }
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }
    const run = (async (): Promise<AppointmentsRefreshResult | null> => {
      const version = ++fetchVersionRef.current;
      if (!options?.silent) {
        setState((s) => ({
          ...s,
          loading: !s.hasLoadedOnce && s.upcoming.length === 0 && s.past.length === 0,
          refreshing: s.hasLoadedOnce || s.upcoming.length > 0 || s.past.length > 0,
        }));
      }
      try {
        const { upcoming, past } = await getMyAppointments(token);
        const pastVisible = filterCustomerPastAppointmentsForDisplay(past);
        if (version !== fetchVersionRef.current) {
          const cur = stateRef.current;
          return { upcoming: cur.upcoming, past: cur.past };
        }
        const next: AppointmentsState = {
          upcoming: dedupeUpcomingById(upcoming),
          past: pastVisible,
          loading: false,
          refreshing: false,
          lastFetchedAt: Date.now(),
          hasLoadedOnce: true,
        };
        setState(next);
        void saveAppointmentsDisk(token, next.upcoming, next.past);
        return { upcoming, past: pastVisible };
      } catch {
        if (version !== fetchVersionRef.current) {
          const cur = stateRef.current;
          return { upcoming: cur.upcoming, past: cur.past };
        }
        const preserved = {
          upcoming: stateRef.current.upcoming,
          past: stateRef.current.past,
        };
        setState((s) => ({
          ...s,
          loading: false,
          refreshing: false,
          hasLoadedOnce: true,
        }));
        return preserved;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = run;
    return run;
  }, []);

  const forceRefresh = useCallback(async (token: string | null): Promise<AppointmentsRefreshResult | null> => {
    if (!token) {
      setState((s) => ({
        ...s,
        upcoming: [],
        past: [],
        loading: false,
        refreshing: false,
        lastFetchedAt: null,
        hasLoadedOnce: false,
      }));
      return null;
    }
    const version = ++fetchVersionRef.current;
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const { upcoming, past } = await getMyAppointments(token);
      const pastVisible = filterCustomerPastAppointmentsForDisplay(past);
      if (version !== fetchVersionRef.current) return null;
      setState({
        upcoming: dedupeUpcomingById(upcoming),
        past: pastVisible,
        loading: false,
        refreshing: false,
        lastFetchedAt: Date.now(),
        hasLoadedOnce: true,
      });
      void saveAppointmentsDisk(token, dedupeUpcomingById(upcoming), pastVisible);
      return { upcoming: dedupeUpcomingById(upcoming), past: pastVisible };
    } catch {
      if (version !== fetchVersionRef.current) return null;
      setState((s) => ({ ...s, refreshing: false }));
      return null;
    }
  }, []);

  const invalidate = useCallback(() => {
    setState((s) => ({ ...s, lastFetchedAt: null }));
  }, []);

  const updateUpcoming = useCallback((updater: (prev: AppointmentDto[]) => AppointmentDto[]) => {
    setState((s) => {
      const nextUpcoming = dedupeUpcomingById(updater(s.upcoming));
      const token = getAuthState().token;
      if (token) {
        void saveAppointmentsDisk(token, nextUpcoming, s.past);
      }
      return { ...s, upcoming: nextUpcoming };
    });
  }, []);

  const bumpLastFetched = useCallback(() => {
    setState((s) => ({ ...s, lastFetchedAt: Date.now(), hasLoadedOnce: true }));
  }, []);

  const clearPastHistory = useCallback(async (token: string | null) => {
    if (!token) return { cleared: 0 };

    const snapshotPast = [...stateRef.current.past];
    if (snapshotPast.length === 0) return { cleared: 0 };

    fetchVersionRef.current += 1;
    setState((s) => ({ ...s, past: [] }));

    try {
      const result = await clearPastHistoryApi(token);
      setState((s) => {
        void saveAppointmentsDisk(token, s.upcoming, []);
        return { ...s, lastFetchedAt: Date.now() };
      });
      return result;
    } catch (e) {
      fetchVersionRef.current += 1;
      setState((s) => ({ ...s, past: snapshotPast }));
      throw e;
    }
  }, []);

  const value: AppointmentsContextValue = {
    ...state,
    refresh,
    forceRefresh,
    invalidate,
    updateUpcoming,
    bumpLastFetched,
    clearPastHistory,
  };

  return (
    <AppointmentsContext.Provider value={value}>
      {children}
    </AppointmentsContext.Provider>
  );
}

export function useAppointments() {
  const ctx = useContext(AppointmentsContext);
  if (!ctx) throw new Error('useAppointments must be used within AppointmentsProvider');
  return ctx;
}
