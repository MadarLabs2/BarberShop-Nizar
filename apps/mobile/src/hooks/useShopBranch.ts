import { useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { fetchBranches, type Branch } from '../services/bookings.api';
import {
  peekBookingBranches,
  CATALOG_BRANCH_UPDATED_EVENT,
  type CatalogBranchUpdatedPayload,
} from '../services/customerPrefetchCache';

/**
 * The single shop branch shown as contact info on Home/Directions/Profile/Drawer. Loads once
 * (from cache, else network) and then patches in place immediately when an admin edits or
 * removes that branch elsewhere — these screens otherwise only fetch once per app session.
 */
export function useShopBranch(): Branch | null {
  const [shopBranch, setShopBranch] = useState<Branch | null>(() => peekBookingBranches()?.[0] ?? null);

  useEffect(() => {
    if (shopBranch) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = peekBookingBranches() ?? (await fetchBranches());
        if (!cancelled && list.length > 0) setShopBranch(list[0]);
      } catch {
        // Keep hardcoded fallback contact info if the branches fetch fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopBranch]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      CATALOG_BRANCH_UPDATED_EVENT,
      (payload: CatalogBranchUpdatedPayload) => {
        if ('branch' in payload) {
          setShopBranch((prev) => (prev && prev.id === payload.branch.id ? payload.branch : prev));
        } else {
          setShopBranch((prev) => (prev && prev.id === payload.removedBranchId ? null : prev));
        }
      }
    );
    return () => sub.remove();
  }, []);

  return shopBranch;
}
