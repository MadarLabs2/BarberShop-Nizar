import type { StaffPerformanceReport } from './admin.api';
import { getAdminCatalog, getAdminStaffPerformanceReport, getMyStaffPerformanceReport } from './admin.api';

/** Long enough that switching between staff during a session stays instant without refetch storms. */
const TTL_MS = 300_000;

const MAX_WARM_STAFF = 36;
/** First wave: warm the rows users tap first; rest follow in smaller chunks. */
const PREFETCH_HEAD_PARALLEL = 10;
const PREFETCH_TAIL_CHUNK = 5;

type Entry = { report: StaffPerformanceReport; storedAt: number };
const store = new Map<string, Entry>();

export function staffReportCacheKey(
  isAdminReport: boolean,
  staffId: string | undefined,
  from?: string,
  to?: string,
): string {
  const sid = isAdminReport ? (staffId ?? '').trim() : 'me';
  return `${isAdminReport ? 'a' : 's'}:${sid}|${from ?? ''}|${to ?? ''}`;
}

export function getStaffReportFromCache(key: string): StaffPerformanceReport | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.storedAt > TTL_MS) {
    store.delete(key);
    return null;
  }
  return e.report;
}

export function setStaffReportCache(key: string, report: StaffPerformanceReport): void {
  store.set(key, { report, storedAt: Date.now() });
}

/** Fire-and-forget default-range report so the report screen often opens warm. */
export function prefetchAdminStaffReport(
  token: string,
  staffId: string,
  from?: string,
  to?: string,
): Promise<void> {
  const sid = staffId.trim();
  if (!sid) return Promise.resolve();
  const key = staffReportCacheKey(true, sid, from, to);
  return getAdminStaffPerformanceReport(token, sid, from, to)
    .then((r) => setStaffReportCache(key, r))
    .catch(() => {});
}

export function prefetchMyStaffReport(token: string, from?: string, to?: string): Promise<void> {
  const key = staffReportCacheKey(false, undefined, from, to);
  return getMyStaffPerformanceReport(token, from, to)
    .then((r) => setStaffReportCache(key, r))
    .catch(() => {});
}

/**
 * Warm many staff reports (default server date range). Head staff fetch in parallel first,
 * then the rest in small chunks so the first taps are hot even on first app use.
 */
export async function prefetchAdminStaffReportsBatch(
  token: string,
  staffIds: string[],
  from?: string,
  to?: string,
): Promise<void> {
  const ids = [...new Set(staffIds.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_WARM_STAFF);
  if (ids.length === 0) return;

  const runOne = (id: string) =>
    getAdminStaffPerformanceReport(token, id, from, to)
      .then((r) => setStaffReportCache(staffReportCacheKey(true, id, from, to), r))
      .catch(() => {});

  const head = ids.slice(0, PREFETCH_HEAD_PARALLEL);
  await Promise.allSettled(head.map((id) => runOne(id)));

  const tail = ids.slice(PREFETCH_HEAD_PARALLEL);
  for (let i = 0; i < tail.length; i += PREFETCH_TAIL_CHUNK) {
    const chunk = tail.slice(i, i + PREFETCH_TAIL_CHUNK);
    await Promise.allSettled(chunk.map((id) => runOne(id)));
  }
}

/** Catalog fetch + batch report warm — call from dashboard before opening the reports hub. */
export function warmStaffReportsFromCatalog(token: string): void {
  void (async () => {
    try {
      const cat = await getAdminCatalog(token);
      const ids = cat.staff.filter((s) => s.isActive).map((s) => s.id);
      await prefetchAdminStaffReportsBatch(token, ids);
    } catch {
      /* ignore */
    }
  })();
}
