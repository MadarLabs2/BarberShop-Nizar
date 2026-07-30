import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAdminWaitlist,
  getStaffSchedule,
  getAdminCustomers,
  getStaffWaitlist,
  type StaffScheduleAppointment,
  type WaitlistRow,
  type StaffWaitlistRow,
  type AdminCustomerListItem,
} from './admin.api';
import { fetchStaff } from './bookings.api';
import { fetchAdminHomeStories } from './stories.api';
import { writeManagedHomeStoriesCache } from './homeStoriesCache';
import { prefetchAdminStaffReportsBatch } from './staffReportCache';
import { getDateRangeFromToday } from '../utils/dates';

type SchedKey = string;

function schedKey(staffId: string, from: string, to: string): SchedKey {
  return `${staffId}|${from}|${to}`;
}

/** Max schedule keys to avoid unbounded growth when staff/date ranges vary. */
const MAX_SCHEDULE_CACHE_ENTRIES = 48;
const SCHEDULE_ENTRY_TTL_MS = 120_000;
const WAITLIST_ALL_TTL_MS = 120_000;
const STAFF_WAITLIST_TTL_MS = 90_000;
const CUSTOMERS_TTL_MS = 45_000;
const CUSTOMERS_PERSIST_MS = 24 * 60 * 60 * 1000;
const ADMIN_CUSTOMERS_FIRST_PAGE_KEY = 'admin_customers_first_page_cache_v1';
/** Whole-bundle prefetch skip window (same token). */
const ADMIN_HEAVY_PREFETCH_COALESCE_MS = 60_000;

type ScheduleEntry = { list: StaffScheduleAppointment[]; at: number };

const scheduleCache = new Map<SchedKey, ScheduleEntry>();

function evictScheduleIfNeeded(newKey: SchedKey): void {
  if (scheduleCache.size < MAX_SCHEDULE_CACHE_ENTRIES || scheduleCache.has(newKey)) return;
  const first = scheduleCache.keys().next().value as SchedKey | undefined;
  if (first !== undefined) scheduleCache.delete(first);
}

function isScheduleEntryFresh(at: number): boolean {
  return Date.now() - at <= SCHEDULE_ENTRY_TTL_MS;
}

export function getCachedSchedule(
  staffId: string,
  from: string,
  to: string,
): StaffScheduleAppointment[] | undefined {
  const key = schedKey(staffId, from, to);
  const e = scheduleCache.get(key);
  if (!e) return undefined;
  if (!isScheduleEntryFresh(e.at)) {
    scheduleCache.delete(key);
    return undefined;
  }
  return e.list;
}

export function setCachedSchedule(
  staffId: string,
  from: string,
  to: string,
  list: StaffScheduleAppointment[],
): void {
  const key = schedKey(staffId, from, to);
  evictScheduleIfNeeded(key);
  scheduleCache.set(key, { list, at: Date.now() });
}

let waitlistAllCache: { rows: WaitlistRow[]; at: number } | null = null;

export function getCachedWaitlistAll(): WaitlistRow[] | null {
  if (!waitlistAllCache) return null;
  if (Date.now() - waitlistAllCache.at > WAITLIST_ALL_TTL_MS) {
    waitlistAllCache = null;
    return null;
  }
  return waitlistAllCache.rows;
}

export function setCachedWaitlistAll(rows: WaitlistRow[]): void {
  waitlistAllCache = { rows, at: Date.now() };
}

export function filterWaitlistByStaff<T extends { staffId: string }>(
  rows: T[],
  staffId: string | null,
): T[] {
  if (!staffId) return rows;
  return rows.filter((r) => r.staffId === staffId);
}

let staffWaitlistCache: { rows: StaffWaitlistRow[]; at: number } | null = null;

export function getCachedStaffWaitlistRows(): StaffWaitlistRow[] | null {
  if (!staffWaitlistCache) return null;
  if (Date.now() - staffWaitlistCache.at > STAFF_WAITLIST_TTL_MS) {
    staffWaitlistCache = null;
    return null;
  }
  return staffWaitlistCache.rows;
}

export function setCachedStaffWaitlistRows(rows: StaffWaitlistRow[]): void {
  staffWaitlistCache = { rows, at: Date.now() };
}

export function clearStaffWaitlistCache(): void {
  staffWaitlistCache = null;
}

let customersFirstPageCache: { items: AdminCustomerListItem[]; total: number; at: number } | null = null;

export function peekAdminCustomersFirstPage(): {
  items: AdminCustomerListItem[];
  total: number;
  at: number;
} | null {
  if (!customersFirstPageCache) return null;
  if (Date.now() - customersFirstPageCache.at > CUSTOMERS_TTL_MS) {
    customersFirstPageCache = null;
    return null;
  }
  return customersFirstPageCache;
}

export function setAdminCustomersFirstPageCache(items: AdminCustomerListItem[], total: number): void {
  customersFirstPageCache = { items, total, at: Date.now() };
  void persistAdminCustomersFirstPageCache();
}

async function persistAdminCustomersFirstPageCache(): Promise<void> {
  try {
    if (!customersFirstPageCache) {
      await AsyncStorage.removeItem(ADMIN_CUSTOMERS_FIRST_PAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(
      ADMIN_CUSTOMERS_FIRST_PAGE_KEY,
      JSON.stringify(customersFirstPageCache),
    );
  } catch {
    /* ignore cache persistence failures */
  }
}

export async function restoreAdminPrefetchCaches(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(ADMIN_CUSTOMERS_FIRST_PAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      items?: AdminCustomerListItem[];
      total?: number;
      at?: number;
    } | null;
    if (
      !parsed ||
      !Array.isArray(parsed.items) ||
      typeof parsed.total !== 'number' ||
      typeof parsed.at !== 'number'
    ) {
      return;
    }
    if (Date.now() - parsed.at > CUSTOMERS_PERSIST_MS) {
      await AsyncStorage.removeItem(ADMIN_CUSTOMERS_FIRST_PAGE_KEY);
      return;
    }
    customersFirstPageCache = {
      items: parsed.items,
      total: parsed.total,
      at: Date.now(),
    };
  } catch {
    /* ignore cache restore failures */
  }
}

/** Last token that wrote to this module; cleared on logout / explicit clear. */
let cacheOwnerToken: string | null = null;
let adminHeavyPrefetchCompletedAt: number | null = null;
let adminPrefetchInFlight: Promise<void> | null = null;
let staffWaitlistPrefetchInFlight: Promise<void> | null = null;

function logPrefetchErr(context: string, err: unknown): void {
  if (__DEV__) {
    console.log(`[adminPrefetchCache] ${context}`, err);
  }
}

function syncCacheToken(token: string): void {
  if (cacheOwnerToken !== null && cacheOwnerToken !== token) {
    clearAdminPrefetchCachesInternal();
  }
  cacheOwnerToken = token;
}

/** Internal: reset all module state without touching staffPrefetchCache (that module clears itself on logout). */
function clearAdminPrefetchCachesInternal(): void {
  scheduleCache.clear();
  waitlistAllCache = null;
  staffWaitlistCache = null;
  customersFirstPageCache = null;
  adminHeavyPrefetchCompletedAt = null;
  cacheOwnerToken = null;
  adminPrefetchInFlight = null;
  staffWaitlistPrefetchInFlight = null;
  void persistAdminCustomersFirstPageCache();
}

/** Clears admin prefetch caches (schedules, waitlists, customers page). Call on logout / token change. */
export function clearAdminPrefetchCaches(): void {
  clearAdminPrefetchCachesInternal();
}

function shouldSkipAdminHeavyPrefetch(token: string): boolean {
  if (cacheOwnerToken !== token || adminHeavyPrefetchCompletedAt === null) return false;
  return Date.now() - adminHeavyPrefetchCompletedAt < ADMIN_HEAVY_PREFETCH_COALESCE_MS;
}

/**
 * Warm admin waitlist, all staff schedules (14d), and first customers page.
 * Call from Home (admin), Dashboard (any tab), or press-in on heavy rows.
 */
export function prefetchAdminHeavyData(token: string): Promise<void> {
  syncCacheToken(token);
  if (shouldSkipAdminHeavyPrefetch(token)) {
    return Promise.resolve();
  }
  if (adminPrefetchInFlight) return adminPrefetchInFlight;
  let p: Promise<void>;
  p = (async () => {
    const requestToken = token;
    const { from, to } = getDateRangeFromToday(14);
    try {
      const bundle = await Promise.allSettled([getAdminWaitlist(token), fetchStaff()]);
      if (bundle[0].status === 'rejected') logPrefetchErr('getAdminWaitlist', bundle[0].reason);
      if (bundle[1].status === 'rejected') logPrefetchErr('fetchStaff', bundle[1].reason);
      if (cacheOwnerToken !== requestToken) return;
      if (bundle[0].status === 'fulfilled') {
        setCachedWaitlistAll(bundle[0].value);
      }
      const staff = bundle[1].status === 'fulfilled' ? bundle[1].value : [];
      if (cacheOwnerToken !== requestToken) return;
      const scheduleOutcomes = await Promise.allSettled(
        staff.map((s) => getStaffSchedule(token, s.id, from, to)),
      );
      if (cacheOwnerToken !== requestToken) return;
      for (let i = 0; i < scheduleOutcomes.length; i++) {
        const o = scheduleOutcomes[i];
        if (o.status === 'rejected') {
          logPrefetchErr(`schedule staffIndex=${i}`, o.reason);
        } else if (cacheOwnerToken === requestToken) {
          setCachedSchedule(staff[i].id, from, to, o.value);
        }
      }
      let customersOk = false;
      let storiesOk = false;
      let reportsOk = false;
      try {
        if (cacheOwnerToken !== requestToken) return;
        const res = await getAdminCustomers(token, { page: 1, limit: 20 });
        if (cacheOwnerToken !== requestToken) return;
        setAdminCustomersFirstPageCache(res.items, res.total);
        customersOk = true;
      } catch (e) {
        logPrefetchErr('getAdminCustomers page 1', e);
      }
      try {
        if (cacheOwnerToken !== requestToken) return;
        const stories = await fetchAdminHomeStories(token);
        if (cacheOwnerToken !== requestToken) return;
        await writeManagedHomeStoriesCache(token, 'admin', stories);
        storiesOk = true;
      } catch (e) {
        logPrefetchErr('fetchAdminHomeStories', e);
      }
      try {
        if (cacheOwnerToken !== requestToken) return;
        const ids = staff.map((s) => s.id);
        await prefetchAdminStaffReportsBatch(token, ids);
        reportsOk = true;
      } catch (e) {
        logPrefetchErr('prefetchAdminStaffReportsBatch', e);
      }
      if (cacheOwnerToken !== requestToken) return;
      const anyScheduleOk = scheduleOutcomes.some((o) => o.status === 'fulfilled');
      const waitlistOk = bundle[0].status === 'fulfilled';
      const staffListOk = bundle[1].status === 'fulfilled';
      if (
        cacheOwnerToken === requestToken &&
        (waitlistOk || staffListOk || anyScheduleOk || customersOk || storiesOk || reportsOk)
      ) {
        adminHeavyPrefetchCompletedAt = Date.now();
      }
    } catch (e) {
      logPrefetchErr('prefetchAdminHeavyData', e);
    }
  })().finally(() => {
    if (adminPrefetchInFlight === p) {
      adminPrefetchInFlight = null;
    }
  });
  adminPrefetchInFlight = p;
  return p;
}

export function prefetchStaffWaitlist(token: string, opts?: { force?: boolean }): Promise<void> {
  syncCacheToken(token);
  const requestToken = token;
  if (!opts?.force && getCachedStaffWaitlistRows() !== null) {
    return Promise.resolve();
  }
  if (staffWaitlistPrefetchInFlight && !opts?.force) return staffWaitlistPrefetchInFlight;
  let p: Promise<void>;
  p = getStaffWaitlist(token)
    .then((rows) => {
      if (cacheOwnerToken !== requestToken) return;
      setCachedStaffWaitlistRows(rows);
    })
    .catch((e) => {
      logPrefetchErr('prefetchStaffWaitlist', e);
    })
    .finally(() => {
      if (staffWaitlistPrefetchInFlight === p) {
        staffWaitlistPrefetchInFlight = null;
      }
    });
  staffWaitlistPrefetchInFlight = p;
  return p;
}
