import {
  getMyWorkingHours,
  getMyStaffAppointments,
  type MyWorkingHoursEntry,
  type MyStaffAppointment,
} from './admin.api';
import { prefetchStaffWaitlist, clearStaffWaitlistCache } from './adminPrefetchCache';
import { fetchMyHomeStories } from './stories.api';
import { writeManagedHomeStoriesCache } from './homeStoriesCache';
import { prefetchMyStaffReport } from './staffReportCache';

const STAFF_SECTION_TTL_MS = 90_000;
/** Skip full staff-dashboard prefetch if last successful run was recent (same token). */
const STAFF_BUNDLE_PREFETCH_COALESCE_MS = 60_000;

type Timestamped<T> = { v: T; at: number };

let myWorkingHoursCache: Timestamped<MyWorkingHoursEntry[]> | null = null;
let myStaffAppointmentsCache: Timestamped<MyStaffAppointment[]> | null = null;

let staffCacheOwnerToken: string | null = null;
let staffBundlePrefetchCompletedAt: number | null = null;
let staffDashboardPrefetchInFlight: Promise<void> | null = null;

function logPrefetchErr(context: string, err: unknown): void {
  if (__DEV__) {
    console.log(`[staffPrefetchCache] ${context}`, err);
  }
}

function isSectionFresh(at: number): boolean {
  return Date.now() - at <= STAFF_SECTION_TTL_MS;
}

function syncStaffToken(token: string): void {
  if (staffCacheOwnerToken !== null && staffCacheOwnerToken !== token) {
    clearStaffPayloadCachesOnly();
    clearStaffWaitlistCache();
  }
  staffCacheOwnerToken = token;
}

function clearStaffPayloadCachesOnly(): void {
  myWorkingHoursCache = null;
  myStaffAppointmentsCache = null;
  staffBundlePrefetchCompletedAt = null;
  staffDashboardPrefetchInFlight = null;
}

function shouldSkipStaffBundlePrefetch(token: string): boolean {
  if (staffCacheOwnerToken !== token || staffBundlePrefetchCompletedAt === null) return false;
  return Date.now() - staffBundlePrefetchCompletedAt < STAFF_BUNDLE_PREFETCH_COALESCE_MS;
}

export function peekStaffWorkingHours(): MyWorkingHoursEntry[] | null {
  if (!myWorkingHoursCache) return null;
  if (!isSectionFresh(myWorkingHoursCache.at)) {
    myWorkingHoursCache = null;
    return null;
  }
  return myWorkingHoursCache.v;
}

export function setStaffWorkingHoursCache(entries: MyWorkingHoursEntry[]): void {
  myWorkingHoursCache = { v: entries, at: Date.now() };
}

export function peekStaffAppointments(): MyStaffAppointment[] | null {
  if (!myStaffAppointmentsCache) return null;
  if (!isSectionFresh(myStaffAppointmentsCache.at)) {
    myStaffAppointmentsCache = null;
    return null;
  }
  return myStaffAppointmentsCache.v;
}

export function setStaffAppointmentsCache(list: MyStaffAppointment[]): void {
  myStaffAppointmentsCache = { v: list, at: Date.now() };
}

/** After linking staff or switching profile — empty cache must not block refetch. */
export function invalidateStaffAppointmentsCache(): void {
  myStaffAppointmentsCache = null;
}

/**
 * Warm waitlist, working hours, and staff appointments — call from Home (staff), StaffDashboard, or press-in.
 */
export function prefetchStaffDashboardData(token: string): Promise<void> {
  syncStaffToken(token);
  if (shouldSkipStaffBundlePrefetch(token)) {
    return Promise.resolve();
  }
  if (staffDashboardPrefetchInFlight) return staffDashboardPrefetchInFlight;
  const requestToken = token;
  let p: Promise<void>;
  p = (async () => {
    try {
      const outcomes = await Promise.allSettled([
        prefetchStaffWaitlist(token),
        getMyWorkingHours(token),
        getMyStaffAppointments(token),
        fetchMyHomeStories(token),
      ]);
      for (let i = 0; i < outcomes.length; i++) {
        const o = outcomes[i];
        if (o.status === 'rejected') {
          logPrefetchErr(`prefetchStaffDashboardData taskIndex=${i}`, o.reason);
        }
      }
      if (staffCacheOwnerToken !== requestToken) return;
      if (outcomes[1].status === 'fulfilled') {
        setStaffWorkingHoursCache(outcomes[1].value);
      }
      if (staffCacheOwnerToken !== requestToken) return;
      if (outcomes[2].status === 'fulfilled') {
        setStaffAppointmentsCache(outcomes[2].value);
      }
      if (staffCacheOwnerToken !== requestToken) return;
      if (outcomes[3].status === 'fulfilled') {
        await writeManagedHomeStoriesCache(token, 'staff', outcomes[3].value);
      }
      if (staffCacheOwnerToken !== requestToken) return;
      await prefetchMyStaffReport(token);
      if (staffCacheOwnerToken !== requestToken) return;
      const dataTasks = outcomes.slice(1);
      if (dataTasks.some((o) => o.status === 'fulfilled')) {
        staffBundlePrefetchCompletedAt = Date.now();
      }
    } catch (e) {
      logPrefetchErr('prefetchStaffDashboardData', e);
    }
  })().finally(() => {
    if (staffDashboardPrefetchInFlight === p) {
      staffDashboardPrefetchInFlight = null;
    }
  });
  staffDashboardPrefetchInFlight = p;
  return p;
}

/** Call on logout so the next user never sees previous staff’s cached rows. */
export function clearStaffSessionCaches(): void {
  clearStaffPayloadCachesOnly();
  staffCacheOwnerToken = null;
  clearStaffWaitlistCache();
}
