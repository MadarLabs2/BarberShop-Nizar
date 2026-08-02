import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import {
  fetchBookableStaff,
  fetchStaffBookingContext,
  fetchBranches,
  fetchCatalogProductsForUser,
  getMyWaitlist,
  getMyAppointments,
  type CatalogStaffMember,
  type Branch,
  type MyWaitlistEntry,
  type AppointmentDto,
  type StaffBookingContext,
} from './bookings.api';
import { filterCustomerPastAppointmentsForDisplay } from '../utils/customerAppointmentsDisplay';
import { getMyNotifications, type NotificationDto } from './notifications.api';
import { seedCatalogProductsCache } from '../hooks/useCatalogProducts';
import { prefetchImageUrlOnce } from './homeStoriesCache';

/** Fired when customer `/bookings/my` prefetch writes cache — Appointments tab can `refresh` without waiting on the slowest bundle request. */
export const CUSTOMER_APPOINTMENTS_CACHE_WARMED = 'customerAppointmentsCacheWarmed';

/** Fired right after an admin branch create/edit/delete patches the caches below, so an
 * already-mounted screen (e.g. Booking with this branch selected) can update in place instead of
 * waiting for the next fetch. `removedBranchId` covers delete. */
export const CATALOG_BRANCH_UPDATED_EVENT = 'catalogBranchUpdated';
export type CatalogBranchUpdatedPayload = { branch: Branch } | { removedBranchId: string };

/** Same as above for services. Only name fields are carried — price/duration are per-staff
 * (`staff_service`) overrides and must never be clobbered by a base-service edit. */
export const CATALOG_SERVICE_UPDATED_EVENT = 'catalogServiceUpdated';
export type CatalogServiceName = { id: string; name: string; nameHe: string; nameAr: string };
export type CatalogServiceUpdatedPayload = { service: CatalogServiceName } | { removedServiceId: string };

const SECTION_TTL_MS = 60_000;
const BUNDLE_COALESCE_MS = 60_000;
const STAFF_CONTEXT_TTL_MS = 5 * 60_000;
const TEAM_STAFF_PERSIST_MS = 24 * 60 * 60 * 1000;
/** v2: persisted bookable staff may include `bookingSummary` from API for instant booking branch row. */
const TEAM_STAFF_CACHE_KEY = 'customer_team_staff_cache_v2';
const CUSTOMER_APPOINTMENTS_CACHE_KEY_BASE = 'customer_appointments_cache_v1';

let customerCacheOwnerToken: string | null = null;
let bundlePrefetchCompletedAt: number | null = null;
/** Monotonic cache generation. Increment on explicit invalidation to ignore stale in-flight responses. */
let customerCacheEpoch = 0;

let teamStaffCache: { list: CatalogStaffMember[]; at: number } | null = null;

/** One in-flight `/catalog/staff/bookable` — Team, Booking catalog, and prefetch share it (no duplicate parallel fetches). */
let fetchBookableStaffInflight: Promise<CatalogStaffMember[]> | null = null;
/** Single-flight forced refresh (ignores peek TTL) — Team/Booking focus so removed staff disappears immediately. */
let revalidateBookableStaffInflight: Promise<CatalogStaffMember[]> | null = null;

/** Subscribers get the latest team list when cache is patched (e.g. admin avatar upload). */
type TeamStaffListener = (list: CatalogStaffMember[]) => void;
const teamStaffListeners = new Set<TeamStaffListener>();

function prefetchTeamAvatarImages(list: CatalogStaffMember[]): void {
  list.forEach((member) => {
    const url = String(member.avatarUrl || '').trim();
    if (!url) return;
    prefetchImageUrlOnce(url);
  });
}

function emitTeamStaff(list: CatalogStaffMember[]) {
  teamStaffListeners.forEach((fn) => {
    try {
      fn(list);
    } catch {
      /* ignore */
    }
  });
}
let bookingBranchesCache: { list: Branch[]; at: number } | null = null;
let customerWaitlistCache: { entries: MyWaitlistEntry[]; at: number } | null = null;
let customerAppointmentsCache: {
  upcoming: AppointmentDto[];
  past: AppointmentDto[];
  at: number;
} | null = null;

let customerNotificationsCache: { items: NotificationDto[]; at: number } | null = null;
let staffBookingContextCache = new Map<string, { ctx: StaffBookingContext; at: number }>();
let staffBookingContextInflight = new Map<string, Promise<StaffBookingContext>>();

let customerPrefetchInFlight: Promise<void> | null = null;

/** Bulk prefetch coalesce: same staff set + tab revisits should not re-fan-out parallel requests. */
let lastBulkStaffContextPrefetchKey = '';
let lastBulkStaffContextPrefetchAt = 0;
const BULK_STAFF_CONTEXT_PREFETCH_COALESCE_MS = 45_000;
/** First N in list order (gallery / API order); larger shops avoid saturating the client + API. */
const STAFF_BOOKING_CONTEXT_PREFETCH_MAX = 10;
const STAFF_BOOKING_CONTEXT_PREFETCH_CONCURRENCY = 3;

function quickHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function appointmentsDiskKey(token: string): string {
  return `${CUSTOMER_APPOINTMENTS_CACHE_KEY_BASE}_${quickHash(token)}`;
}

async function persistTeamStaffCache(): Promise<void> {
  try {
    if (!teamStaffCache) {
      await AsyncStorage.removeItem(TEAM_STAFF_CACHE_KEY);
      return;
    }
    await AsyncStorage.setItem(TEAM_STAFF_CACHE_KEY, JSON.stringify(teamStaffCache));
  } catch {
    /* ignore cache persistence failures */
  }
}

async function persistCustomerAppointmentsCache(token?: string | null): Promise<void> {
  const scopedToken = String(token || customerCacheOwnerToken || '').trim();
  if (!scopedToken) return;
  try {
    if (!customerAppointmentsCache) {
      await AsyncStorage.removeItem(appointmentsDiskKey(scopedToken));
      return;
    }
    await AsyncStorage.setItem(
      appointmentsDiskKey(scopedToken),
      JSON.stringify(customerAppointmentsCache),
    );
  } catch {
    /* ignore cache persistence failures */
  }
}

async function restoreCustomerAppointmentsCache(token?: string | null): Promise<void> {
  const scopedToken = String(token || '').trim();
  if (!scopedToken) return;
  try {
    const raw = await AsyncStorage.getItem(appointmentsDiskKey(scopedToken));
    if (!raw) return;
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
      return;
    }
    // Keep the real fetch time, not `Date.now()`. Faking freshness here made `isFresh()` (60s TTL)
    // report this restored-from-disk snapshot as "just confirmed with the server" no matter how
    // old it actually was, which then poisoned AppointmentsContext's own staleness check on hydrate
    // and silently blocked Home's one-shot background refresh from ever hitting the network —
    // an already-ended appointment (or a missing new one) could sit displayed for a full session
    // until the user happened to visit the Appointments tab, whose focus-retry eventually forced a
    // real refetch. Preserving the true timestamp lets a genuinely-old cache correctly report
    // itself as stale so the normal refresh path corrects it right away.
    customerAppointmentsCache = {
      upcoming: parsed.upcoming,
      past: filterCustomerPastAppointmentsForDisplay(parsed.past),
      at: parsed.at,
    };
  } catch {
    /* ignore cache restore failures */
  }
}

/** Restore last team list before first screen mount so Team/Booking can paint immediately on cold app start. */
export async function restoreCustomerPrefetchCaches(token?: string | null): Promise<void> {
  await Promise.allSettled([
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(TEAM_STAFF_CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { list?: CatalogStaffMember[]; at?: number } | null;
        if (!parsed || !Array.isArray(parsed.list) || typeof parsed.at !== 'number') return;
        if (Date.now() - parsed.at > TEAM_STAFF_PERSIST_MS) {
          await AsyncStorage.removeItem(TEAM_STAFF_CACHE_KEY);
          return;
        }
        // Treat persisted staff as fresh on cold start so Team/Booking can paint instantly,
        // then let normal background prefetch replace it with the latest server result.
        teamStaffCache = { list: parsed.list, at: Date.now() };
        prefetchTeamAvatarImages(parsed.list);
      } catch {
        /* ignore cache restore failures */
      }
    })(),
    restoreCustomerAppointmentsCache(token),
  ]);
}

function isFresh(at: number): boolean {
  return Date.now() - at <= SECTION_TTL_MS;
}

function logPrefetchErr(context: string, err: unknown): void {
  if (__DEV__) {
    console.log(`[customerPrefetchCache] ${context}`, err);
  }
}

function syncCustomerToken(token: string): void {
  if (customerCacheOwnerToken !== null && customerCacheOwnerToken !== token) {
    clearCustomerPrefetchCachesInternal({ clearSalonCatalog: false });
  }
  customerCacheOwnerToken = token;
}

/** Call from TeamScreen focus so list cache owner matches the current session before reads/writes. */
export function syncCustomerPrefetchToken(token: string): void {
  syncCustomerToken(token);
}

export type ClearCustomerPrefetchOptions = {
  /** Full wipe including bookable staff / branches / contexts. Default: keep salon catalog for fast Team+Booking after login. */
  clearSalonCatalog?: boolean;
};

function clearCustomerPrefetchCachesInternal(opts?: ClearCustomerPrefetchOptions): void {
  const clearSalon = opts?.clearSalonCatalog === true;
  const previousToken = customerCacheOwnerToken;
  customerCacheEpoch += 1;

  if (clearSalon) {
    teamStaffCache = null;
    bookingBranchesCache = null;
    staffBookingContextCache.clear();
    staffBookingContextInflight.clear();
    lastBulkStaffContextPrefetchKey = '';
    lastBulkStaffContextPrefetchAt = 0;
    fetchBookableStaffInflight = null;
    revalidateBookableStaffInflight = null;
    void persistTeamStaffCache();
    emitTeamStaff([]);
  }

  customerWaitlistCache = null;
  customerAppointmentsCache = null;
  customerNotificationsCache = null;
  bundlePrefetchCompletedAt = null;
  customerCacheOwnerToken = null;
  customerPrefetchInFlight = null;
  void persistCustomerAppointmentsCache(previousToken);
}

/** Clears user-scoped tab caches. Salon catalog is kept unless `clearSalonCatalog: true`. */
export function clearCustomerPrefetchCaches(opts?: ClearCustomerPrefetchOptions): void {
  clearCustomerPrefetchCachesInternal(opts);
}

function isStaffContextFresh(at: number): boolean {
  return Date.now() - at <= STAFF_CONTEXT_TTL_MS;
}

export function peekStaffBookingContext(staffId: string): StaffBookingContext | null {
  const hit = staffBookingContextCache.get(staffId);
  if (!hit) return null;
  if (!isStaffContextFresh(hit.at)) {
    staffBookingContextCache.delete(staffId);
    return null;
  }
  return hit.ctx;
}

export function setStaffBookingContext(staffId: string, ctx: StaffBookingContext): void {
  staffBookingContextCache.set(staffId, { ctx, at: Date.now() });
}

/** Sync cached booking-context rows when the shared team list name/avatar changes (admin / cache patch). */
export function patchStaffBookingContextsFromTeamList(list: CatalogStaffMember[]): void {
  for (const [staffId, hit] of staffBookingContextCache.entries()) {
    if (!isStaffContextFresh(hit.at)) continue;
    const m = list.find((x) => x.id === staffId);
    if (!m) continue;
    const ctx = hit.ctx;
    if (ctx.staff.name === m.name && (ctx.staff.avatarUrl ?? null) === (m.avatarUrl ?? null)) continue;
    setStaffBookingContext(staffId, {
      ...ctx,
      staff: { ...ctx.staff, name: m.name, avatarUrl: m.avatarUrl },
    });
  }
}

/**
 * Loads staff booking context once, sharing the in-flight promise with `prefetchStaffBookingContexts`
 * so Booking never doubles the same network request while prefetch is warming.
 */
export function ensureStaffBookingContext(staffId: string): Promise<StaffBookingContext> {
  const peeked = peekStaffBookingContext(staffId);
  if (peeked) return Promise.resolve(peeked);
  const pending = staffBookingContextInflight.get(staffId);
  if (pending) return pending;
  const req = fetchStaffBookingContext(staffId)
    .then((ctx) => {
      setStaffBookingContext(staffId, ctx);
      return ctx;
    })
    .finally(() => {
      staffBookingContextInflight.delete(staffId);
    });
  staffBookingContextInflight.set(staffId, req);
  return req;
}

async function prefetchStaffBookingContextsChunked(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += STAFF_BOOKING_CONTEXT_PREFETCH_CONCURRENCY) {
    const chunk = ids.slice(i, i + STAFF_BOOKING_CONTEXT_PREFETCH_CONCURRENCY);
    await Promise.allSettled(chunk.map((staffId) => ensureStaffBookingContext(staffId)));
  }
}

/**
 * Warms `GET /catalog/staff/:id/booking-context` into the shared TTL cache.
 * - Single id: always runs (deduped with in-flight + tap); no bulk coalesce.
 * - Many ids: low-concurrency chunks from the first id (no serial "first barber only" gate — avoids slow branch row when user picks another avatar first).
 * - Bulk: coalesced if the same set was prefetched recently; capped list length.
 */
export async function prefetchStaffBookingContexts(staffIds: string[]): Promise<void> {
  const unique = [...new Set(staffIds.filter(Boolean))];
  if (unique.length === 0) return;
  if (unique.length === 1) {
    await ensureStaffBookingContext(unique[0]!).catch(() => undefined);
    return;
  }
  const sortedKey = [...unique].sort().join('|');
  const now = Date.now();
  if (
    sortedKey === lastBulkStaffContextPrefetchKey &&
    now - lastBulkStaffContextPrefetchAt < BULK_STAFF_CONTEXT_PREFETCH_COALESCE_MS
  ) {
    return;
  }
  lastBulkStaffContextPrefetchKey = sortedKey;
  lastBulkStaffContextPrefetchAt = now;
  const capped =
    unique.length <= STAFF_BOOKING_CONTEXT_PREFETCH_MAX
      ? unique
      : unique.slice(0, STAFF_BOOKING_CONTEXT_PREFETCH_MAX);
  await prefetchStaffBookingContextsChunked(capped);
}

function shouldSkipBundlePrefetch(token: string): boolean {
  if (customerCacheOwnerToken !== token || bundlePrefetchCompletedAt === null) return false;
  if (Date.now() - bundlePrefetchCompletedAt >= BUNDLE_COALESCE_MS) return false;
  /** If the team list never landed, do not skip — otherwise Team stays empty until the coalesce window ends. */
  if (peekTeamStaff() === null) return false;
  return true;
}

export function peekTeamStaff(): CatalogStaffMember[] | null {
  if (!teamStaffCache) return null;
  if (!isFresh(teamStaffCache.at)) {
    teamStaffCache = null;
    return null;
  }
  return teamStaffCache.list;
}

/**
 * Always hits `GET /catalog/staff/bookable` and replaces the shared team cache (then emits subscribers).
 * Use when opening Team / Booking so staff removed in admin or DB is not stuck behind in-memory or Redis TTL.
 */
export function revalidateBookableStaffList(): Promise<CatalogStaffMember[]> {
  if (revalidateBookableStaffInflight) return revalidateBookableStaffInflight;
  const ownerAtStart = customerCacheOwnerToken;
  const epochAtStart = customerCacheEpoch;
  const p = fetchBookableStaff()
    .then((list) => {
      if (customerCacheOwnerToken !== ownerAtStart || customerCacheEpoch !== epochAtStart) return list;
      setTeamStaffCache(list);
      return list;
    })
    .finally(() => {
      if (revalidateBookableStaffInflight === p) revalidateBookableStaffInflight = null;
    });
  revalidateBookableStaffInflight = p;
  return p;
}

/**
 * Single-flight bookable staff catalog — `prefetchCustomerTabData`, Team, and Booking all await the same request.
 * Writes `teamStaffCache` + emits subscribers when the session owner at fetch-start still matches.
 */
export function ensureBookableStaffList(): Promise<CatalogStaffMember[]> {
  const peeked = peekTeamStaff();
  if (peeked) return Promise.resolve(peeked);
  if (fetchBookableStaffInflight) return fetchBookableStaffInflight;
  const ownerAtStart = customerCacheOwnerToken;
  const epochAtStart = customerCacheEpoch;
  fetchBookableStaffInflight = fetchBookableStaff()
    .then((list) => {
      if (customerCacheOwnerToken !== ownerAtStart || customerCacheEpoch !== epochAtStart) return list;
      setTeamStaffCache(list);
      void prefetchStaffBookingContexts(list.map((s) => s.id));
      return list;
    })
    .finally(() => {
      fetchBookableStaffInflight = null;
    });
  return fetchBookableStaffInflight;
}

export function setTeamStaffCache(list: CatalogStaffMember[]): void {
  teamStaffCache = { list, at: Date.now() };
  prefetchTeamAvatarImages(list);
  void persistTeamStaffCache();
  emitTeamStaff(list);
}

/**
 * Merge one staff row into the customer-facing team list so Team + Booking update instantly
 * after admin changes (photo, name) without waiting for a full refetch.
 */
export function upsertStaffInTeamCache(member: CatalogStaffMember): void {
  if (!teamStaffCache) {
    void ensureBookableStaffList().catch(() => {
      setTeamStaffCache([member]);
    });
    return;
  }
  const idx = teamStaffCache.list.findIndex((s) => s.id === member.id);
  const next =
    idx >= 0
      ? teamStaffCache.list.map((s) => (s.id === member.id ? member : s))
      : [...teamStaffCache.list, member];
  teamStaffCache = { list: next, at: Date.now() };
  prefetchTeamAvatarImages(next);
  void persistTeamStaffCache();
  emitTeamStaff(next);
}

/**
 * Remove one staff member from every customer-facing booking cache immediately.
 * Bumps epoch so stale in-flight catalog/prefetch responses cannot re-add the deleted staff.
 */
export function removeStaffFromTeamCache(staffId: string): void {
  customerCacheEpoch += 1;
  fetchBookableStaffInflight = null;
  revalidateBookableStaffInflight = null;
  customerPrefetchInFlight = null;
  staffBookingContextCache.delete(staffId);
  staffBookingContextInflight.delete(staffId);
  const next = (teamStaffCache?.list ?? []).filter((s) => s.id !== staffId);
  teamStaffCache = { list: next, at: Date.now() };
  void persistTeamStaffCache();
  emitTeamStaff(next);
}

/** Subscribe to team list updates (cache patches + setTeamStaffCache). */
export function subscribeTeamStaffList(listener: TeamStaffListener): () => void {
  teamStaffListeners.add(listener);
  const peek = peekTeamStaff();
  if (peek !== null) {
    queueMicrotask(() => listener(peek));
  }
  return () => teamStaffListeners.delete(listener);
}

export function peekBookingBranches(): Branch[] | null {
  if (!bookingBranchesCache) return null;
  if (!isFresh(bookingBranchesCache.at)) {
    bookingBranchesCache = null;
    return null;
  }
  return bookingBranchesCache.list;
}

function setBookingBranchesCache(list: Branch[]): void {
  bookingBranchesCache = { list, at: Date.now() };
}

/** Patch one staff member's `bookingSummary` (branches or services) in the team cache, if present. */
function patchTeamBookingSummaries(
  patch: (m: CatalogStaffMember) => CatalogStaffMember | null,
): void {
  if (!teamStaffCache) return;
  let changed = false;
  const next = teamStaffCache.list.map((m) => {
    const patched = patch(m);
    if (patched === null) return m;
    changed = true;
    return patched;
  });
  if (!changed) return;
  teamStaffCache = { list: next, at: teamStaffCache.at };
  void persistTeamStaffCache();
  emitTeamStaff(next);
}

/**
 * Merge one branch into every customer-facing cache — the shop-info list, every cached staff
 * booking context, and team `bookingSummary` rows — so an admin edit (name, address, phone, …)
 * shows up immediately everywhere instead of waiting out the 60s/5min TTLs. Also used for create
 * (appends if not already cached).
 */
export function upsertBranchInCaches(branch: Branch): void {
  if (bookingBranchesCache) {
    const idx = bookingBranchesCache.list.findIndex((b) => b.id === branch.id);
    const next =
      idx >= 0
        ? bookingBranchesCache.list.map((b) => (b.id === branch.id ? branch : b))
        : [...bookingBranchesCache.list, branch];
    bookingBranchesCache = { list: next, at: Date.now() };
  }

  for (const [staffId, hit] of staffBookingContextCache.entries()) {
    if (!isStaffContextFresh(hit.at)) continue;
    if (!hit.ctx.branches.some((b) => b.id === branch.id)) continue;
    setStaffBookingContext(staffId, {
      ...hit.ctx,
      branches: hit.ctx.branches.map((b) => (b.id === branch.id ? branch : b)),
    });
  }

  patchTeamBookingSummaries((m) => {
    if (!m.bookingSummary?.branches.some((b) => b.id === branch.id)) return null;
    return {
      ...m,
      bookingSummary: {
        ...m.bookingSummary,
        branches: m.bookingSummary.branches.map((b) => (b.id === branch.id ? branch : b)),
      },
    };
  });

  DeviceEventEmitter.emit(CATALOG_BRANCH_UPDATED_EVENT, { branch } satisfies CatalogBranchUpdatedPayload);
}

/** Remove a deleted branch from every customer-facing cache immediately. */
export function removeBranchFromCaches(branchId: string): void {
  if (bookingBranchesCache) {
    bookingBranchesCache = {
      list: bookingBranchesCache.list.filter((b) => b.id !== branchId),
      at: Date.now(),
    };
  }

  for (const [staffId, hit] of staffBookingContextCache.entries()) {
    if (!hit.ctx.branches.some((b) => b.id === branchId)) continue;
    setStaffBookingContext(staffId, {
      ...hit.ctx,
      branches: hit.ctx.branches.filter((b) => b.id !== branchId),
    });
  }

  patchTeamBookingSummaries((m) => {
    if (!m.bookingSummary?.branches.some((b) => b.id === branchId)) return null;
    return {
      ...m,
      bookingSummary: { ...m.bookingSummary, branches: m.bookingSummary.branches.filter((b) => b.id !== branchId) },
    };
  });

  DeviceEventEmitter.emit(CATALOG_BRANCH_UPDATED_EVENT, { removedBranchId: branchId } satisfies CatalogBranchUpdatedPayload);
}

/**
 * Sync only the name fields for a service into cached staff booking contexts + team
 * `bookingSummary` rows. Price/duration intentionally excluded — those come from the per-staff
 * `staff_service` link, not the base service row, and must not be overwritten by this.
 */
export function patchServiceNameInCaches(service: CatalogServiceName): void {
  for (const [staffId, hit] of staffBookingContextCache.entries()) {
    if (!isStaffContextFresh(hit.at)) continue;
    if (!hit.ctx.services.some((s) => s.id === service.id)) continue;
    setStaffBookingContext(staffId, {
      ...hit.ctx,
      services: hit.ctx.services.map((s) =>
        s.id === service.id ? { ...s, name: service.name, nameHe: service.nameHe, nameAr: service.nameAr } : s,
      ),
    });
  }

  patchTeamBookingSummaries((m) => {
    if (!m.bookingSummary?.services.some((s) => s.id === service.id)) return null;
    return {
      ...m,
      bookingSummary: {
        ...m.bookingSummary,
        services: m.bookingSummary.services.map((s) =>
          s.id === service.id ? { ...s, name: service.name, nameHe: service.nameHe, nameAr: service.nameAr } : s,
        ),
      },
    };
  });

  DeviceEventEmitter.emit(CATALOG_SERVICE_UPDATED_EVENT, { service } satisfies CatalogServiceUpdatedPayload);
}

/** Remove a deleted service from every cached staff booking context + team `bookingSummary` row. */
export function removeServiceFromCaches(serviceId: string): void {
  for (const [staffId, hit] of staffBookingContextCache.entries()) {
    if (!hit.ctx.services.some((s) => s.id === serviceId)) continue;
    setStaffBookingContext(staffId, {
      ...hit.ctx,
      services: hit.ctx.services.filter((s) => s.id !== serviceId),
    });
  }

  patchTeamBookingSummaries((m) => {
    if (!m.bookingSummary?.services.some((s) => s.id === serviceId)) return null;
    return {
      ...m,
      bookingSummary: { ...m.bookingSummary, services: m.bookingSummary.services.filter((s) => s.id !== serviceId) },
    };
  });

  DeviceEventEmitter.emit(CATALOG_SERVICE_UPDATED_EVENT, { removedServiceId: serviceId } satisfies CatalogServiceUpdatedPayload);
}

export function peekCustomerWaitlist(): MyWaitlistEntry[] | null {
  if (!customerWaitlistCache) return null;
  if (!isFresh(customerWaitlistCache.at)) {
    customerWaitlistCache = null;
    return null;
  }
  return customerWaitlistCache.entries;
}

function setCustomerWaitlistCache(entries: MyWaitlistEntry[]): void {
  customerWaitlistCache = { entries, at: Date.now() };
}

function setCustomerAppointmentsCache(
  upcoming: AppointmentDto[],
  past: AppointmentDto[],
  token?: string | null,
): void {
  customerAppointmentsCache = {
    upcoming,
    past: filterCustomerPastAppointmentsForDisplay(past),
    at: Date.now(),
  };
  void persistCustomerAppointmentsCache(token);
  DeviceEventEmitter.emit(CUSTOMER_APPOINTMENTS_CACHE_WARMED);
}

/** Warmed by prefetch bundle; AppointmentsContext can hydrate before the network round-trip. */
export function peekCustomerAppointments(): { upcoming: AppointmentDto[]; past: AppointmentDto[] } | null {
  if (!customerAppointmentsCache) return null;
  if (!isFresh(customerAppointmentsCache.at)) {
    customerAppointmentsCache = null;
    return null;
  }
  return {
    upcoming: customerAppointmentsCache.upcoming,
    past: filterCustomerPastAppointmentsForDisplay(customerAppointmentsCache.past),
  };
}

/** In-session notifications (same TTL as other customer slices). */
export function peekCustomerNotificationsBundle(): { items: NotificationDto[]; at: number } | null {
  if (!customerNotificationsCache) return null;
  if (!isFresh(customerNotificationsCache.at)) {
    customerNotificationsCache = null;
    return null;
  }
  return { items: customerNotificationsCache.items, at: customerNotificationsCache.at };
}

export function setCustomerNotificationsCache(items: NotificationDto[]): void {
  customerNotificationsCache = { items, at: Date.now() };
}

/**
 * Bumped whenever notifications are permanently deleted so a `prefetchCustomerTabData` call that
 * was already in flight (e.g. from a Team-tab focus) at that moment cannot land afterwards and
 * silently repopulate the shared cache with the pre-delete list — its write is checked against the
 * epoch it started with and dropped if this has moved on since.
 */
let notificationsCacheEpoch = 0;

/** Wipes the notifications slice and invalidates any earlier in-flight write to it (see above). */
export function invalidateCustomerNotificationsCache(): void {
  notificationsCacheEpoch += 1;
  customerNotificationsCache = null;
}

/**
 * Warm team list, catalog products, booking branches, waitlist, appointments, and notifications (logged-in) for customer tabs.
 * Each slice writes its cache as soon as its request finishes (so Appointments / Booking are not blocked by the slowest call).
 * Safe across token changes; coalesced per session.
 */
export function prefetchCustomerTabData(token: string): Promise<void> {
  syncCustomerToken(token);
  if (shouldSkipBundlePrefetch(token)) {
    return Promise.resolve();
  }
  if (customerPrefetchInFlight) return customerPrefetchInFlight;
  const requestToken = token;
  const epochAtStart = customerCacheEpoch;
  const notifEpochAtStart = notificationsCacheEpoch;
  let p: Promise<void>;
  p = (async () => {
    try {
      const guard = () => customerCacheOwnerToken === requestToken && customerCacheEpoch === epochAtStart;
      let anyOk = false;
      const markOk = () => {
        anyOk = true;
      };

      const slice = (label: string, work: Promise<void>) =>
        work.catch((reason: unknown) => {
          logPrefetchErr(label, reason);
        });

      await Promise.all([
        slice('fetchBookableStaff', (async () => {
          await ensureBookableStaffList();
          if (!guard()) return;
          markOk();
        })()),
        slice('fetchCatalogProductsForUser', (async () => {
          const prods = await fetchCatalogProductsForUser(token);
          if (!guard()) return;
          markOk();
          seedCatalogProductsCache(prods, requestToken);
        })()),
        slice('fetchBranches', (async () => {
          const list = await fetchBranches();
          if (!guard()) return;
          markOk();
          setBookingBranchesCache(list);
        })()),
        slice('getMyWaitlist', (async () => {
          const entries = await getMyWaitlist(token);
          if (!guard()) return;
          markOk();
          setCustomerWaitlistCache(entries);
        })()),
        slice('getMyAppointments', (async () => {
          const res = await getMyAppointments(token);
          if (!guard()) return;
          markOk();
          setCustomerAppointmentsCache(res.upcoming, res.past, token);
        })()),
        slice('getMyNotifications', (async () => {
          const items = await getMyNotifications(token);
          if (!guard()) return;
          // A permanent delete-all that started after this request began must win — never let a
          // slow, now-stale response resurrect notifications the user just deleted.
          if (notificationsCacheEpoch !== notifEpochAtStart) return;
          markOk();
          setCustomerNotificationsCache(items);
        })()),
      ]);

      if (guard() && anyOk) {
        bundlePrefetchCompletedAt = Date.now();
      }
    } catch (e) {
      logPrefetchErr('prefetchCustomerTabData', e);
    }
  })().finally(() => {
    if (customerPrefetchInFlight === p) {
      customerPrefetchInFlight = null;
    }
  });
  customerPrefetchInFlight = p;
  return p;
}
