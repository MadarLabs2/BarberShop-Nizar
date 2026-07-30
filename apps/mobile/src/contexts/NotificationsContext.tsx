import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMyNotifications, deleteAllNotifications, type NotificationDto } from '../services/notifications.api';
import {
  clearLocalNotificationPresentation,
  resetAppIconBadge,
  deactivateDevicePushOnServer,
  setUserWantsPushDelivery,
  syncPushRegistration,
} from '../services/push';
import { getAuthState, subscribeAuth } from '../store/auth.store';
import { PUSH_NOTIFICATION_RECEIVED_EVENT } from '../services/push';
import {
  peekCustomerNotificationsBundle,
  setCustomerNotificationsCache,
  invalidateCustomerNotificationsCache,
} from '../services/customerPrefetchCache';
import i18n from '../i18n';

export const NOTIFICATIONS_STALE_MS = 20_000; // reduced from 60s — ensures new notifications appear quickly
const NOTIFICATIONS_ENABLED_KEY_BASE = 'notifications_enabled_v1';
const NOTIFICATIONS_PROMPT_SEEN_KEY_BASE = 'notifications_prompt_seen_v1';

export type NotificationsState = {
  items: NotificationDto[];
  loading: boolean;
  refreshing: boolean;
  /** A permanent delete-all is in flight — server call, not a background/pull refresh. */
  deleting: boolean;
  lastFetchedAt: number | null;
  error: string | null;
  hasLoadedOnce: boolean;
};

export type NotificationsContextValue = NotificationsState & {
  notificationsEnabled: boolean;
  notificationsPrefsReady: boolean;
  refresh: (token: string | null) => Promise<NotificationDto[] | null>;
  forceRefresh: (token: string | null) => Promise<NotificationDto[] | null>;
  invalidate: () => void;
  setNotificationsEnabled: (enabled: boolean, token?: string | null) => Promise<void>;
  addLocalNotification: (input: {
    title: string;
    body?: string | null;
    type?: string;
    token?: string | null;
  }) => string;
  removeNotificationById: (id: string, token?: string | null) => void;
  /**
   * Permanently deletes every notification owned by this user (server hard-deletes personal rows,
   * permanently dismisses broadcasts for this profile only), then clears every client-side copy —
   * in-memory state, the customer prefetch bundle, and disk. Rolls back and rethrows on failure so
   * the caller can show a retry message without ever having shown a false success.
   */
  deleteAll: (token: string) => Promise<void>;
};

const defaultState: NotificationsState = {
  items: [],
  loading: false,
  refreshing: false,
  deleting: false,
  lastFetchedAt: null,
  error: null,
  hasLoadedOnce: false,
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

function isStale(lastFetchedAt: number | null): boolean {
  if (!lastFetchedAt) return true;
  return Date.now() - lastFetchedAt > NOTIFICATIONS_STALE_MS;
}

function quickHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function diskKey(token: string): string {
  // Token-only scope keeps storage deterministic and avoids cross-user bleed
  // during async auth transitions.
  return `notif_v2_t_${quickHash(token)}`;
}

function getPrefsScope(): string | null {
  const auth = getAuthState();
  if (!auth.token) return null;
  if (auth.user?.id) return auth.user.id;
  return auth.token.slice(0, 24);
}

function scopedKey(base: string, scope: string): string {
  return `${base}_${scope}`;
}

async function loadNotifDisk(token: string): Promise<{ items: NotificationDto[]; at: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(diskKey(token));
    if (!raw) return null;
    const o = JSON.parse(raw) as { items: NotificationDto[]; at: number };
    if (!o || !Array.isArray(o.items) || typeof o.at !== 'number') return null;
    return { items: o.items, at: o.at };
  } catch {
    return null;
  }
}

async function saveNotifDisk(token: string, items: NotificationDto[]): Promise<void> {
  try {
    await AsyncStorage.setItem(diskKey(token), JSON.stringify({ items, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

/** Removes the persisted disk cache entirely (used by permanent delete-all — nothing to restore). */
async function clearNotifDisk(token: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(diskKey(token));
  } catch {
    /* ignore */
  }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<NotificationsState>(defaultState);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  const [notificationsPrefsReady, setNotificationsPrefsReady] = useState(false);
  const [prefsScope, setPrefsScope] = useState<string | null>(() => getPrefsScope());
  const fetchVersionRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const refreshInFlightRef = useRef<Promise<NotificationDto[] | null> | null>(null);
  const promptedScopeRef = useRef<string | null>(null);
  const authTokenRef = useRef<string | null>(getAuthState().token);

  useEffect(() => {
    // When a push notification arrives (foreground), invalidate cache so new notifications
    // appear automatically without requiring manual pull-to-refresh.
    const pushSub = DeviceEventEmitter.addListener(PUSH_NOTIFICATION_RECEIVED_EVENT, () => {
      setState((s) => ({ ...s, lastFetchedAt: null }));
    });
    return () => pushSub.remove();
  }, []);

  useEffect(() => {
    return subscribeAuth(() => {
      const prevToken = authTokenRef.current;
      const nextToken = getAuthState().token;
      const tokenChanged = prevToken !== nextToken;
      if (prevToken && prevToken !== nextToken) {
        void deactivateDevicePushOnServer(prevToken);
      }
      authTokenRef.current = nextToken;
      setPrefsScope((prev) => {
        const next = getPrefsScope();
        return prev === next ? prev : next;
      });
      if (tokenChanged) {
        refreshInFlightRef.current = null;
        fetchVersionRef.current += 1;
        setCustomerNotificationsCache([]);
        setNotificationsEnabledState(true);
        setUserWantsPushDelivery(true);
        setNotificationsPrefsReady(false);
        setState({
          items: [],
          loading: false,
          refreshing: false,
          deleting: false,
          lastFetchedAt: null,
          error: null,
          hasLoadedOnce: false,
        });
      }
    });
  }, []);

  useEffect(() => {
    const token = getAuthState().token;
    if (!notificationsPrefsReady || !token) return;
    if (!notificationsEnabled) {
      void deactivateDevicePushOnServer(token);
      return;
    }
    void syncPushRegistration({ authToken: token, enabled: true });
  }, [notificationsPrefsReady, notificationsEnabled, prefsScope]);

  const setNotificationsEnabled = useCallback(async (enabled: boolean, token?: string | null) => {
    setUserWantsPushDelivery(enabled);
    setNotificationsEnabledState(enabled);
    if (!enabled) {
      void clearLocalNotificationPresentation();
      const t = token ?? getAuthState().token;
      if (t) void deactivateDevicePushOnServer(t);
    }
    const scope = getPrefsScope();
    try {
      if (scope) {
        await AsyncStorage.setItem(scopedKey(NOTIFICATIONS_ENABLED_KEY_BASE, scope), enabled ? '1' : '0');
        await AsyncStorage.setItem(scopedKey(NOTIFICATIONS_PROMPT_SEEN_KEY_BASE, scope), '1');
      }
    } catch {
      /* ignore */
    }
    if (!enabled) {
      refreshInFlightRef.current = null;
      setCustomerNotificationsCache([]);
      if (token) {
        void saveNotifDisk(token, []);
      }
      setState((s) => ({
        ...s,
        items: [],
        loading: false,
        refreshing: false,
        error: null,
        lastFetchedAt: Date.now(),
        hasLoadedOnce: true,
      }));
    } else {
      setState((s) => ({ ...s, lastFetchedAt: null }));
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    setNotificationsPrefsReady(false);
    void (async () => {
      if (!prefsScope) {
        if (!mounted) return;
        setNotificationsEnabledState(true);
        setUserWantsPushDelivery(true);
        setNotificationsPrefsReady(true);
        return;
      }
      let enabled = true;
      let seenPrompt = false;
      try {
        const enabledKey = scopedKey(NOTIFICATIONS_ENABLED_KEY_BASE, prefsScope);
        const seenKey = scopedKey(NOTIFICATIONS_PROMPT_SEEN_KEY_BASE, prefsScope);
        const [enabledRaw, seenRaw] = await Promise.all([
          AsyncStorage.getItem(enabledKey),
          AsyncStorage.getItem(seenKey),
        ]);
        enabled = enabledRaw == null ? true : enabledRaw === '1';
        seenPrompt = seenRaw === '1';
      } catch {
        /* ignore */
      }
      if (!mounted) return;
      setNotificationsEnabledState(enabled);
      setUserWantsPushDelivery(enabled);
      setNotificationsPrefsReady(true);
      if (seenPrompt || promptedScopeRef.current === prefsScope) return;
      promptedScopeRef.current = prefsScope;
      Alert.alert(
        i18n.t('settings.notificationsPromptTitle'),
        i18n.t('settings.notificationsPromptMsg'),
        [
          {
            text: i18n.t('settings.notificationsPromptSkip'),
            style: 'cancel',
            onPress: () => {
              void setNotificationsEnabled(false, getAuthState().token);
            },
          },
          {
            text: i18n.t('settings.notificationsPromptAllow'),
            onPress: () => {
              void setNotificationsEnabled(true, getAuthState().token);
            },
          },
        ],
      );
    })();
    return () => {
      mounted = false;
    };
  }, [prefsScope, setNotificationsEnabled]);

  useEffect(() => {
    const token = getAuthState().token;
    if (!notificationsPrefsReady || !notificationsEnabled || !token) return;
    let cancelled = false;
    void (async () => {
      const pref = peekCustomerNotificationsBundle();
      if (pref && pref.items.length > 0) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          items: pref.items,
          lastFetchedAt: pref.at,
          hasLoadedOnce: true,
          loading: false,
          refreshing: false,
          error: null,
        }));
        return;
      }
      const disk = await loadNotifDisk(token);
      if (cancelled || !disk) return;
      setCustomerNotificationsCache(disk.items);
      setState((s) => ({
        ...s,
        items: disk.items,
        lastFetchedAt: disk.at,
        hasLoadedOnce: true,
        loading: false,
        refreshing: false,
        error: null,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [notificationsPrefsReady, notificationsEnabled, prefsScope]);

  const refresh = useCallback(async (token: string | null): Promise<NotificationDto[] | null> => {
    if (!notificationsEnabled) {
      refreshInFlightRef.current = null;
      setState((s) => ({
        ...s,
        items: [],
        loading: false,
        refreshing: false,
        error: null,
        hasLoadedOnce: true,
      }));
      return [];
    }
    if (!token) {
      setState((s) => ({
        ...s,
        items: [],
        loading: false,
        refreshing: false,
        lastFetchedAt: null,
        error: null,
        hasLoadedOnce: false,
      }));
      refreshInFlightRef.current = null;
      return null;
    }
    if (!isStale(stateRef.current.lastFetchedAt)) {
      return stateRef.current.items;
    }
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }
    const run = (async (): Promise<NotificationDto[] | null> => {
      const version = ++fetchVersionRef.current;

      let items = stateRef.current.items;
      let lastFetchedAt = stateRef.current.lastFetchedAt;
      let hasLoadedOnce = stateRef.current.hasLoadedOnce;

      const pref = peekCustomerNotificationsBundle();
      if (items.length === 0 && pref) {
        items = pref.items;
        lastFetchedAt = pref.at;
        hasLoadedOnce = true;
        setState((s) => ({
          ...s,
          items: pref.items,
          lastFetchedAt: pref.at,
          hasLoadedOnce: true,
          loading: false,
          error: null,
        }));
      }

      if (items.length === 0) {
        const disk = await loadNotifDisk(token);
        if (disk) {
          items = disk.items;
          lastFetchedAt = disk.at;
          hasLoadedOnce = true;
          setState((s) => ({
            ...s,
            items: disk.items,
            lastFetchedAt: disk.at,
            hasLoadedOnce: true,
            loading: false,
            error: null,
          }));
        }
      }

      if (!isStale(lastFetchedAt)) {
        refreshInFlightRef.current = null;
        return items;
      }

      setState((s) => ({
        ...s,
        loading: items.length === 0 && !hasLoadedOnce,
        refreshing: items.length > 0 || hasLoadedOnce,
        error: null,
      }));

      try {
        const fresh = await getMyNotifications(token);
        if (version !== fetchVersionRef.current) {
          return stateRef.current.items;
        }
        setCustomerNotificationsCache(fresh);
        void saveNotifDisk(token, fresh);
        setState((s) => ({
          ...s,
          items: fresh,
          loading: false,
          refreshing: false,
          lastFetchedAt: Date.now(),
          error: null,
          hasLoadedOnce: true,
        }));
        return fresh;
      } catch (e) {
        if (version !== fetchVersionRef.current) {
          return stateRef.current.items;
        }
        const preserved = [...stateRef.current.items];
        setState((s) => ({
          ...s,
          loading: false,
          refreshing: false,
          error: e instanceof Error ? e.message : 'שגיאה בטעינת ההתראות',
          hasLoadedOnce: true,
        }));
        return preserved;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = run;
    return run;
  }, [notificationsEnabled]);

  const forceRefresh = useCallback(async (token: string | null): Promise<NotificationDto[] | null> => {
    if (!notificationsEnabled) {
      setState((s) => ({
        ...s,
        items: [],
        loading: false,
        refreshing: false,
        error: null,
        hasLoadedOnce: true,
      }));
      return [];
    }
    if (!token) {
      setState((s) => ({
        ...s,
        items: [],
        loading: false,
        refreshing: false,
        lastFetchedAt: null,
        error: null,
        hasLoadedOnce: false,
      }));
      return null;
    }
    const version = ++fetchVersionRef.current;
    /** Match `refresh`: only show initial full-screen loading when we have never loaded; after clear (empty + hasLoadedOnce) use `refreshing` only — avoids stuck `loading` and extra app-wide re-render churn on other tabs. */
    setState((s) => ({
      ...s,
      loading: s.items.length === 0 && !s.hasLoadedOnce,
      refreshing: s.items.length > 0 || s.hasLoadedOnce,
      error: null,
    }));
    try {
      const items = await getMyNotifications(token);
      if (version !== fetchVersionRef.current) return null;
      setCustomerNotificationsCache(items);
      void saveNotifDisk(token, items);
      setState((s) => ({
        ...s,
        items,
        loading: false,
        refreshing: false,
        lastFetchedAt: Date.now(),
        error: null,
        hasLoadedOnce: true,
      }));
      return items;
    } catch (e) {
      if (version !== fetchVersionRef.current) return null;
      setState((s) => ({
        ...s,
        loading: false,
        refreshing: false,
        error: e instanceof Error ? e.message : 'שגיאה בטעינת ההתראות',
      }));
      return null;
    }
  }, [notificationsEnabled]);

  const invalidate = useCallback(() => {
    setState((s) => ({ ...s, lastFetchedAt: null }));
  }, []);

  const deleteAll = useCallback(async (token: string) => {
    if (stateRef.current.deleting) return;
    const snapshot = stateRef.current.items;

    // Bump first: any `refresh`/`forceRefresh` already in flight (e.g. from the focus effect that
    // fired a split second ago) captured the OLD version and will discard its response instead of
    // reviving deleted items once it resolves after us.
    const version = ++fetchVersionRef.current;
    refreshInFlightRef.current = null;

    setState((s) => ({ ...s, deleting: true, error: null }));

    let result: { deletedPersonal: number; dismissedBroadcasts: number };
    try {
      result = await deleteAllNotifications(token);
    } catch (e) {
      if (version === fetchVersionRef.current) {
        setState((s) => ({ ...s, deleting: false, items: snapshot }));
      }
      throw e;
    }

    if (version !== fetchVersionRef.current) {
      // Something newer (another delete, a token change) already superseded this call —
      // its own state transition wins, do not touch state.
      return;
    }

    invalidateCustomerNotificationsCache();
    await clearNotifDisk(token);
    setState((s) => ({
      ...s,
      items: [],
      loading: false,
      refreshing: false,
      deleting: false,
      error: null,
      lastFetchedAt: Date.now(),
      hasLoadedOnce: true,
    }));

    void clearLocalNotificationPresentation();
    void resetAppIconBadge();

    if (result.deletedPersonal === 0 && result.dismissedBroadcasts === 0) return;

    // Silent server round-trip to confirm empty — never touches `loading`/`refreshing`, so no
    // spinner or screen swap can appear from it; only applies if something has actually changed
    // (e.g. a genuinely new notification arrived in the split second after the delete completed).
    try {
      const verified = await getMyNotifications(token);
      if (version !== fetchVersionRef.current) return;
      if (verified.length === 0) return;
      setCustomerNotificationsCache(verified);
      void saveNotifDisk(token, verified);
      setState((s) => ({ ...s, items: verified, lastFetchedAt: Date.now() }));
    } catch {
      /* best-effort verification only — the delete itself already succeeded */
    }
  }, []);

  const addLocalNotification = useCallback(
    (input: { title: string; body?: string | null; type?: string; token?: string | null }): string => {
      if (!notificationsEnabled) return '';
      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const item: NotificationDto = {
        id,
        user_phone: null,
        type: input.type ?? 'appointment',
        title: input.title,
        body: input.body ?? null,
        created_at: new Date().toISOString(),
      };
      setState((s) => {
        const nextItems = [item, ...s.items];
        setCustomerNotificationsCache(nextItems);
        if (input.token) {
          void saveNotifDisk(input.token, nextItems);
        }
        return {
          ...s,
          items: nextItems,
          hasLoadedOnce: true,
          // Keep feed "fresh" briefly so immediate re-focus won't wipe local item.
          lastFetchedAt: Date.now(),
          loading: false,
          refreshing: false,
          error: null,
        };
      });
      return id;
    },
    [notificationsEnabled]
  );

  const removeNotificationById = useCallback((id: string, token?: string | null) => {
    if (!id) return;
    setState((s) => {
      const nextItems = s.items.filter((n) => n.id !== id);
      setCustomerNotificationsCache(nextItems);
      if (token) {
        void saveNotifDisk(token, nextItems);
      }
      return { ...s, items: nextItems };
    });
  }, []);

  const value: NotificationsContextValue = {
    ...state,
    notificationsEnabled,
    notificationsPrefsReady,
    refresh,
    forceRefresh,
    invalidate,
    setNotificationsEnabled,
    addLocalNotification,
    removeNotificationById,
    deleteAll,
  };

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
