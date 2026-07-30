import { useState, useEffect, useCallback } from 'react';
import {
  getAuthState,
  subscribeAuth,
  setAuth,
  setAuthLoading,
  restoreAuth,
} from '../store/auth.store';
import {
  checkRegistered as apiCheckRegistered,
  register as apiRegister,
  requestOtp as apiRequestOtp,
  verifyOtp as apiVerifyOtp,
  getMe,
  logoutSession,
  deleteAccountSession,
} from '../services/auth.api';
import { normalizePhone } from '../utils/phone';
import { getRole, getRoles, isAdmin, isStaff, isCustomer, hasStaffProfile, isPureCustomer } from '../lib/roles';

export function useAuth() {
  const [state, setState] = useState(getAuthState);

  useEffect(() => {
    const unsub = subscribeAuth(() => setState(getAuthState()));
    return unsub;
  }, []);

  const loadStoredUser = useCallback(async () => {
    await restoreAuth();
  }, []);

  /** Clears session immediately so UI updates without waiting for the network; server revoke runs in the background. */
  const logout = useCallback(() => {
    const { token } = getAuthState();
    setAuth(null, null);
    if (token) {
      void logoutSession(token).catch(() => {});
    }
  }, []);

  const deleteAccount = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const { token } = getAuthState();
    if (!token) return { success: false, error: 'לא מחובר' };
    try {
      await deleteAccountSession(token);
      setAuth(null, null);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'מחיקת החשבון נכשלה' };
    }
  }, []);

  const checkRegistered = useCallback(async (phone: string): Promise<boolean> => {
    const p = normalizePhone(phone);
    if (!p || p.length < 9) return false;
    return apiCheckRegistered(p);
  }, []);

  const register = useCallback(
    async (params: { phone: string; firstName: string; lastName: string; birthDate?: string }) => {
      setAuthLoading(true);
      try {
        const p = normalizePhone(params.phone);
        const { phone: confirmed } = await apiRegister({
          phone: p,
          firstName: params.firstName.trim(),
          lastName: params.lastName.trim(),
          birthDate: params.birthDate,
        });
        return { phone: confirmed };
      } finally {
        setAuthLoading(false);
      }
    },
    []
  );

  const requestOtp = useCallback(async (phone: string) => {
    setAuthLoading(true);
    try {
      const p = normalizePhone(phone);
      return await apiRequestOtp(p || phone);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const verifyOtp = useCallback(
    async (
      phone: string,
      code: string,
      registration?: { firstName?: string; lastName?: string; birthDate?: string },
    ): Promise<{ success: boolean; error?: string }> => {
      setAuthLoading(true);
      try {
        const p = normalizePhone(phone);
        const { user, token } = await apiVerifyOtp(p || phone, code.trim(), registration);
        setAuth(user, token);
        return { success: true };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'אימות נכשל' };
      } finally {
        setAuthLoading(false);
      }
    },
    []
  );

  const fetchCurrentUser = useCallback(async (options?: { silent?: boolean }): Promise<boolean> => {
    const { token } = getAuthState();
    if (!token) return false;
    const silent = options?.silent === true;
    if (!silent) setAuthLoading(true);
    try {
      const user = await getMe(token);
      setAuth(user, token);
      return true;
    } catch (e) {
      const status =
        e && typeof e === 'object' && 'httpStatus' in e && typeof (e as { httpStatus: unknown }).httpStatus === 'number'
          ? (e as { httpStatus: number }).httpStatus
          : undefined;
      if (status === 401 || status === 403) {
        setAuth(null, null);
      }
      return false;
    } finally {
      if (!silent) setAuthLoading(false);
    }
  }, []);

  return {
    user: state.user,
    token: state.token,
    isLoggedIn: !!state.user && !!state.token,
    isLoading: state.isLoading,
    isRestored: state.isRestored,
    role: getRole(state.user),
    roles: getRoles(state.user),
    isAdmin: isAdmin(state.user),
    isStaff: isStaff(state.user),
    hasStaffProfile: hasStaffProfile(state.user),
    isPureCustomer: isPureCustomer(state.user),
    isCustomer: isCustomer(state.user),
    canBlockOwnTime: !!state.user?.canBlockOwnTime,
    canSetOwnWorkingHours: !!state.user?.canSetOwnWorkingHours,
    loadStoredUser,
    logout,
    deleteAccount,
    checkRegistered,
    register,
    requestOtp,
    verifyOtp,
    fetchCurrentUser,
  };
}
