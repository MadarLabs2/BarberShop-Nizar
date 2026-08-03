import { useEffect, useState } from 'react';
import { getBirthdayRewardStatus, type BirthdayRewardStatus } from '../services/bookings.api';

const EMPTY_STATUS: BirthdayRewardStatus = { active: false, expiresAt: null };

/**
 * Lazy check for the booking screen: fetches (and, server-side, grants if newly eligible) the
 * customer's birthday reward status on mount. The backend is the source of truth for eligibility —
 * this is purely UI convenience for showing/hiding the "use my free birthday appointment" toggle.
 */
export function useBirthdayReward(token: string | null) {
  const [status, setStatus] = useState<BirthdayRewardStatus>(EMPTY_STATUS);
  const [useReward, setUseReward] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus(EMPTY_STATUS);
      setUseReward(false);
      return;
    }
    let cancelled = false;
    void getBirthdayRewardStatus(token)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus(EMPTY_STATUS);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Never leave the toggle silently "on" once the reward is no longer active (e.g. reward
  // disappeared after a refetch, or the customer logged out and back in as someone else).
  useEffect(() => {
    if (!status.active) setUseReward(false);
  }, [status.active]);

  return { rewardStatus: status, useReward, setUseReward };
}
