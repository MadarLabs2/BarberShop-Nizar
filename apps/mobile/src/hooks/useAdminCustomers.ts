import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  getAdminCustomers,
  getAdminCustomerDetails,
  type AdminCustomerListItem,
  type AdminCustomerDetails,
} from '../services/admin.api';
import { peekAdminCustomersFirstPage, setAdminCustomersFirstPageCache } from '../services/adminPrefetchCache';

/** Warm cache for admin customer details (incl. recent appointments). Not a global store — keyed by customerId only. */
const WARM_STALE_MS = 45_000;
const warmByCustomerId: Record<string, { detail: AdminCustomerDetails; loadedAt: number }> = {};
const warmListeners = new Set<() => void>();
let warmEpoch = 0;

function bumpWarmCache() {
  warmEpoch++;
  warmListeners.forEach((l) => l());
}

export function subscribeAdminCustomerWarmCache(onStoreChange: () => void) {
  warmListeners.add(onStoreChange);
  return () => warmListeners.delete(onStoreChange);
}

export function getAdminCustomerWarmCacheEpoch(): number {
  return warmEpoch;
}

export function peekWarmAdminCustomerDetails(customerId: string): AdminCustomerDetails | null {
  const w = warmByCustomerId[customerId];
  if (!w || w.detail.id !== customerId) return null;
  if (Date.now() - w.loadedAt > WARM_STALE_MS) return null;
  return w.detail;
}

/** Full details from prefetch / last visit — use for instant UI even if beyond the fresh peek window (45s). */
export function getWarmAdminCustomerDetailsCached(customerId: string): AdminCustomerDetails | null {
  const w = warmByCustomerId[customerId];
  if (!w || w.detail.id !== customerId) return null;
  return w.detail;
}

export function setWarmAdminCustomerDetails(customerId: string, detail: AdminCustomerDetails) {
  if (detail.id !== customerId) return;
  warmByCustomerId[customerId] = { detail, loadedAt: Date.now() };
  bumpWarmCache();
}

export function invalidateWarmAdminCustomerDetails(customerId: string) {
  delete warmByCustomerId[customerId];
  bumpWarmCache();
}

const prefetchInFlight = new Map<string, Promise<void>>();

/** Fire-and-forget prefetch when the user touches a row; deduped per customerId. */
export function prefetchAdminCustomerDetails(token: string | null, customerId: string) {
  if (!token || !customerId) return;
  if (peekWarmAdminCustomerDetails(customerId)) return;
  if (prefetchInFlight.has(customerId)) return;
  const p = (async () => {
    try {
      const d = await getAdminCustomerDetails(token, customerId);
      if (d.id !== customerId) return;
      setWarmAdminCustomerDetails(customerId, d);
    } catch {
      /* silent */
    } finally {
      prefetchInFlight.delete(customerId);
    }
  })();
  prefetchInFlight.set(customerId, p);
}

const PAGE_SIZE = 20;

export type CustomersListQueued =
  | { type: 'update'; item: AdminCustomerListItem }
  | { type: 'delete'; id: string };

let queuedCustomersListMutation: CustomersListQueued | null = null;

/** Called from customer details after edit/delete so the list can apply changes when focused. */
export function queueAdminCustomersListMutation(m: CustomersListQueued) {
  queuedCustomersListMutation = m;
}

export function useAdminCustomers(token: string | null) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const peek0 = peekAdminCustomersFirstPage();
  const [items, setItems] = useState<AdminCustomerListItem[]>(() => peek0?.items ?? []);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(() => peek0?.total ?? 0);
  const [loading, setLoading] = useState(() => !peek0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirstPage = useCallback(async (opts?: { isRefresh?: boolean }) => {
    if (!token) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const cached =
      !opts?.isRefresh && !debouncedSearch ? peekAdminCustomersFirstPage() : null;
    if (cached) {
      setItems(cached.items);
      setTotal(cached.total);
      setPage(1);
      setError(null);
      if (!opts?.isRefresh) setLoading(false);
    } else if (!opts?.isRefresh) {
      setLoading(true);
    }
    try {
      if (opts?.isRefresh) setRefreshing(true);
      setError(null);
      const res = await getAdminCustomers(token, {
        search: debouncedSearch || undefined,
        page: 1,
        limit: PAGE_SIZE,
      });
      setTotal(res.total);
      setPage(1);
      setItems(res.items);
      if (!debouncedSearch) setAdminCustomersFirstPageCache(res.items, res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'טעינה נכשלה');
      if (!cached) setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, debouncedSearch]);

  /** Refetch whenever this screen regains focus (e.g. after a new customer registers elsewhere)
   * — not just on mount / search change — so the list doesn't go stale while kept alive in the background. */
  useFocusEffect(
    useCallback(() => {
      void loadFirstPage();
    }, [loadFirstPage]),
  );

  const refresh = useCallback(() => loadFirstPage({ isRefresh: true }), [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!token || loadingMore || loading) return;
    if (items.length >= total) return;
    const nextPage = page + 1;
    try {
      setLoadingMore(true);
      setError(null);
      const res = await getAdminCustomers(token, {
        search: debouncedSearch || undefined,
        page: nextPage,
        limit: PAGE_SIZE,
      });
      setTotal(res.total);
      setPage(nextPage);
      setItems((prev) => [...prev, ...res.items]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'טעינה נכשלה');
    } finally {
      setLoadingMore(false);
    }
  }, [token, loadingMore, loading, items.length, total, page, debouncedSearch]);

  useFocusEffect(
    useCallback(() => {
      const q = queuedCustomersListMutation;
      if (!q) return;
      queuedCustomersListMutation = null;
      if (q.type === 'delete') {
        setItems((prev) => prev.filter((x) => x.id !== q.id));
        setTotal((t) => Math.max(0, t - 1));
      } else {
        setItems((prev) => {
          const idx = prev.findIndex((x) => x.id === q.item.id);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], ...q.item };
          return next;
        });
      }
    }, []),
  );

  const hasMore = items.length < total;

  return {
    search,
    setSearch,
    items,
    total,
    loading,
    refreshing,
    loadingMore,
    error,
    refresh,
    loadMore,
    hasMore,
  };
}
