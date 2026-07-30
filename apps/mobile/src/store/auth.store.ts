import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AuthUser } from '../services/auth.api';
import { getMe } from '../services/auth.api';
import { clearAdminPrefetchCaches, restoreAdminPrefetchCaches } from '../services/adminPrefetchCache';
import { clearAdminDashboardCache, restoreAdminDashboardCache } from '../services/adminDashboardCache';
import {
  clearCustomerPrefetchCaches,
  prefetchCustomerTabData,
  restoreCustomerPrefetchCaches,
} from '../services/customerPrefetchCache';
import { isPureCustomer } from '../lib/roles';
import { clearStaffSessionCaches } from '../services/staffPrefetchCache';
import { clearAdminCatalogWarm, restoreAdminCatalogWarm } from '../hooks/useAdminCatalog';
import { clearCatalogProductsCache, restoreCatalogProductsCache } from '../hooks/useCatalogProducts';
import { clearSessionImagePrefetchDedupe, prefetchImageUrlOnce } from '../services/homeStoriesCache';

const AUTH_KEY = 'barbershop_auth';
const LEGACY_AUTH_KEY = '@barbershop_auth';

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  /** True after cold-start storage bootstrap finishes; server validation may continue in background. */
  isRestored: boolean;
};

type Listener = () => void;
const listeners: Listener[] = [];
let restoreAuthRun = 0;

let state: AuthState = {
  user: null,
  token: null,
  isLoading: false,
  isRestored: false,
};

function rolesKey(user: AuthUser | null): string {
  if (!user) return '';
  const roles = Array.isArray(user.roles) ? [...user.roles].sort().join('|') : '';
  return `${user.id}|${user.isAdmin ? 1 : 0}|${user.staffId ?? ''}|${user.role ?? ''}|${roles}`;
}

function notify() {
  listeners.forEach((l) => l());
}

function prefetchUserAvatar(user: AuthUser | null): void {
  const url = String(user?.avatarUrl || '').trim();
  if (!url) return;
  prefetchImageUrlOnce(url);
}

/**
 * Secure storage for auth: SecureStore on iOS/Android, AsyncStorage on web
 * (SecureStore is not available on web; browsers have no equivalent).
 */
async function getStoredAuth(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(AUTH_KEY);
  }
  return SecureStore.getItemAsync(AUTH_KEY);
}

async function setStoredAuth(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(AUTH_KEY, value);
  } else {
    await SecureStore.setItemAsync(AUTH_KEY, value);
  }
}

async function removeStoredAuth(): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(AUTH_KEY);
  } else {
    await SecureStore.deleteItemAsync(AUTH_KEY);
  }
}

/**
 * Migrate from legacy AsyncStorage key to current secure storage.
 * Run once on first load after upgrade.
 */
async function migrateFromLegacyStorage(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_AUTH_KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(LEGACY_AUTH_KEY);
    return raw;
  } catch {
    return null;
  }
}

export function setAuth(user: AuthUser | null, token: string | null): void {
  const prevToken = state.token;
  const prevUser = state.user;
  const roleShapeChanged = rolesKey(prevUser) !== rolesKey(user);
  if (!user || !token) {
    clearAdminDashboardCache(prevToken);
    clearStaffSessionCaches();
    clearAdminPrefetchCaches();
    clearAdminCatalogWarm();
    clearCatalogProductsCache();
    clearCustomerPrefetchCaches();
    clearSessionImagePrefetchDedupe();
  } else if (prevToken !== token || roleShapeChanged) {
    clearAdminDashboardCache(prevToken);
    clearStaffSessionCaches();
    clearAdminPrefetchCaches();
    clearAdminCatalogWarm();
    clearCatalogProductsCache();
    clearCustomerPrefetchCaches();
    clearSessionImagePrefetchDedupe();
  }
  state = { ...state, user, token };
  prefetchUserAvatar(user);
  notify();
  if (user && token) {
    const payload = JSON.stringify({ user, token });
    setStoredAuth(payload).catch(() => {});
    if (isPureCustomer(user)) {
      void prefetchCustomerTabData(token);
    }
  } else {
    removeStoredAuth().catch(() => {});
  }
}

/**
 * Re-fetches the current user from the server and applies it immediately — used when a silent
 * push signals a server-side change to this account (e.g. admin granted/revoked a permission) so
 * it takes effect right away instead of waiting for the next natural session refresh. Plain
 * function (not a hook) so it's callable from push.ts's notification handler, outside React.
 */
export async function refreshAuthUser(): Promise<void> {
  const { user, token } = state;
  if (!user || !token) return;
  try {
    const fresh = await getMe(token);
    if (state.token !== token) return;
    setAuth(fresh, token);
  } catch {
    /* best-effort — next natural fetchCurrentUser call will retry */
  }
}

export function patchAuthUser(updater: (user: AuthUser) => AuthUser): void {
  if (!state.user || !state.token) return;
  const nextUser = updater(state.user);
  state = { ...state, user: nextUser };
  prefetchUserAvatar(nextUser);
  notify();
  const payload = JSON.stringify({ user: nextUser, token: state.token });
  setStoredAuth(payload).catch(() => {});
}

export function setAuthLoading(loading: boolean): void {
  state = { ...state, isLoading: loading };
  notify();
}

export function setAuthRestored(restored: boolean): void {
  state = { ...state, isRestored: restored };
  notify();
}

export function subscribeAuth(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    const i = listeners.indexOf(listener);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function getAuth(): { user: AuthUser | null; token: string | null } {
  return { user: state.user, token: state.token };
}

export function getAuthState(): AuthState {
  return { ...state };
}

function hydrateRestoredAuth(user: AuthUser | null, token: string | null): void {
  state = { ...state, user, token, isRestored: true };
  prefetchUserAvatar(user);
  notify();
}

function httpStatusOf(e: unknown): number | undefined {
  if (e && typeof e === 'object' && 'httpStatus' in e && typeof (e as { httpStatus: unknown }).httpStatus === 'number') {
    return (e as { httpStatus: number }).httpStatus;
  }
  return undefined;
}

/**
 * Hydrate immediately from local storage, then revalidate with GET /auth/me in the background.
 * - Invalid/revoked token → clear local session (no OTP).
 * - Network/server errors → keep last stored session so the app works offline; next online request re-validates.
 * OTP is never sent from this path.
 */
export async function restoreAuth(): Promise<void> {
  const runId = ++restoreAuthRun;
  state = { ...state, isRestored: false };
  notify();
  try {
    let raw = await getStoredAuth();
    if (!raw) {
      raw = await migrateFromLegacyStorage();
      if (raw) {
        await setStoredAuth(raw).catch(() => {});
      }
    }
    if (!raw) {
      if (restoreAuthRun !== runId) return;
      hydrateRestoredAuth(null, null);
      return;
    }

    let parsed: { user: AuthUser; token: string };
    try {
      parsed = JSON.parse(raw) as { user: AuthUser; token: string };
    } catch {
      await removeStoredAuth();
      if (restoreAuthRun !== runId) return;
      hydrateRestoredAuth(null, null);
      return;
    }

    if (!parsed?.user?.id || !parsed?.token?.trim()) {
      await removeStoredAuth();
      if (restoreAuthRun !== runId) return;
      hydrateRestoredAuth(null, null);
      return;
    }

    const token = parsed.token.trim();
    await Promise.allSettled([
      restoreCustomerPrefetchCaches(token),
      restoreAdminPrefetchCaches(),
      restoreAdminCatalogWarm(),
      restoreCatalogProductsCache(token),
      restoreAdminDashboardCache(token),
    ]);
    if (restoreAuthRun !== runId) return;
    hydrateRestoredAuth(parsed.user, token);

    void getMe(token)
      .then((user) => {
        if (restoreAuthRun !== runId || state.token !== token) return;
        setAuth(user, token);
      })
      .catch(async (e) => {
        if (restoreAuthRun !== runId || state.token !== token) return;
        const status = httpStatusOf(e);
        if (status === 401 || status === 403) {
          await removeStoredAuth();
          if (restoreAuthRun !== runId || state.token !== token) return;
          setAuth(null, null);
        }
      });
  } catch {
    await removeStoredAuth();
    if (restoreAuthRun !== runId) return;
    hydrateRestoredAuth(null, null);
  }
}
