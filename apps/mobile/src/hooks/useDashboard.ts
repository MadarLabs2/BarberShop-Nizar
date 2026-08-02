import { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { InteractionManager, DeviceEventEmitter } from 'react-native';
import {
  ADMIN_APPOINTMENT_CREATED_EVENT,
  type AdminAppointmentCreatedPayload,
} from '../lib/adminScheduleInvalidation';
import i18n from '../i18n';
import { useFocusEffect } from '@react-navigation/native';
import { getAuthState } from '../store/auth.store';
import { hasStaffProfile } from '../lib/roles';
import {
  getDashboardSummary,
  getUpdatesFeed,
  getAppointmentsByStaffAndDate,
  getMyStaffAppointments,
  createBroadcast,
  createBroadcastWaitlistForStaff,
} from '../services/admin.api';
import type { DashboardSummary, StaffDateAppointment } from '../services/admin.api';
import { fetchBranches, fetchServices, fetchStaff } from '../services/bookings.api';
import { useAppointments } from '../contexts/AppointmentsContext';
import { getTodayDateString } from '../utils/dates';
import { isValidDateString, isValidTimeString, validateBroadcast } from '../utils/validators';
import { peekAdminDashboard, setAdminDashboardCache } from '../services/adminDashboardCache';

export type DashboardTab = 'updates' | 'appointments' | 'management';

export type { DashboardSummary };

export interface UpcomingAppointment {
  id: string;
  serviceName: string;
  staffName: string;
  branchName: string;
  date: string;
  time: string;
}

export function useDashboard(
  token: string | null,
  fetchCurrentUser: (options?: { silent?: boolean }) => Promise<void | boolean>,
) {
  const { upcoming: sharedUpcoming, refresh: refreshAppointments, forceRefresh: forceRefreshAppointments } = useAppointments();
  const [activeTab, setActiveTab] = useState<DashboardTab>('appointments');
  const [summary, setSummary] = useState<DashboardSummary | null>(() =>
    token && getAuthState().user?.isAdmin ? peekAdminDashboard(token)?.summary ?? null : null,
  );
  const [staffUpcoming, setStaffUpcoming] = useState<UpcomingAppointment[]>([]);
  const [updatesFeed, setUpdatesFeed] = useState<
    { id: string; clientName: string; serviceName: string; staffName: string; date: string; time: string }[]
  >(() => (token && getAuthState().user?.isAdmin ? peekAdminDashboard(token)?.updatesFeed ?? [] : []));
  const [loading, setLoading] = useState(() => {
    if (!token) return false;
    if (getAuthState().user?.isAdmin) {
      return peekAdminDashboard(token) === null;
    }
    return true;
  });
  const [refreshing, setRefreshing] = useState(false);

  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>(() =>
    token && getAuthState().user?.isAdmin ? peekAdminDashboard(token)?.staffList ?? [] : [],
  );
  const [opStaffId, setOpStaffId] = useState<string>('');
  const [opDate, setOpDate] = useState(() => getTodayDateString());
  const [opList, setOpList] = useState<StaffDateAppointment[]>([]);
  const [opLoading, setOpLoading] = useState(false);

  const [broadcastModalVisible, setBroadcastModalVisible] = useState(false);
  /** 'all' = everyone sees broadcast (user_phone null); 'waitlist' = one notification per waitlist customer phone. */
  const [broadcastScope, setBroadcastScope] = useState<'all' | 'waitlist'>('all');
  const [broadcastForm, setBroadcastForm] = useState({ title: '', body: '' });
  const [broadcastStaffId, setBroadcastStaffId] = useState<string>('');
  const [broadcastSaving, setBroadcastSaving] = useState(false);

  const loadAdmin = useCallback(async () => {
    if (!token) return;
    try {
      const [data, updates, staff] = await Promise.all([
        getDashboardSummary(token),
        getUpdatesFeed(token, 24),
        fetchStaff(),
      ]);
      setSummary(data);
      setUpdatesFeed(updates);
      const slimStaff = staff.map((s) => ({ id: s.id, name: s.name }));
      setStaffList(slimStaff);
      setAdminDashboardCache(token, { summary: data, updatesFeed: updates, staffList: slimStaff });
    } catch {
      setSummary(null);
      setUpdatesFeed([]);
      setStaffList([]);
    }
  }, [token]);

  const loadOpList = useCallback(
    async (keepPrevious?: boolean) => {
      if (!token || !opStaffId || !opDate) return;
      if (!keepPrevious) {
        setOpList([]);
        setOpLoading(true);
      }
      try {
        const list = await getAppointmentsByStaffAndDate(token, opStaffId, opDate);
        setOpList(list);
      } catch {
        if (!keepPrevious) setOpList([]);
      } finally {
        setOpLoading(false);
      }
    },
    [token, opStaffId, opDate]
  );

  const loadSimple = useCallback(async () => {
    try {
      const [branches, services, staff] = await Promise.all([
        fetchBranches(),
        fetchServices(),
        fetchStaff(),
      ]);
      let upcomingCount = 0;
      let appointments: UpcomingAppointment[] = [];
      const user = getAuthState().user;
      if (token && user && hasStaffProfile(user)) {
        try {
          const u = await getMyStaffAppointments(token);
          upcomingCount = u.length;
          appointments = u;
        } catch {
          /* skip */
        }
      }
      setSummary({
        branches: branches.length,
        services: services.length,
        staff: staff.length,
        upcomingAppointments: upcomingCount,
      });
      setStaffUpcoming(appointments);
    } catch {
      setSummary(null);
    }
  }, [token]);

  useEffect(() => {
    const user = getAuthState().user;
    if (user?.isAdmin && token && opStaffId && opDate && /^\d{4}-\d{2}-\d{2}$/.test(opDate)) {
      loadOpList();
    } else {
      setOpList([]);
    }
  }, [token, opStaffId, opDate, loadOpList]);

  const hasDataRef = useRef(false);
  const lastLoadAtRef = useRef<number>(0);
  const prevTokenRef = useRef<string | null>(token);
  useEffect(() => {
    hasDataRef.current = summary !== null;
  }, [summary]);

  /** Same idea as TeamScreen: apply last dashboard snapshot before paint; clear when the session token changes. */
  useLayoutEffect(() => {
    const tokenChanged = prevTokenRef.current !== token;
    if (tokenChanged) {
      prevTokenRef.current = token;
      lastLoadAtRef.current = 0;
    }
    if (!token) {
      setSummary(null);
      setUpdatesFeed([]);
      setStaffList([]);
      setLoading(false);
      hasDataRef.current = false;
      return;
    }
    const user = getAuthState().user;
    if (!user?.isAdmin) return;
    const p = peekAdminDashboard(token);
    if (p) {
      hasDataRef.current = true;
      setSummary(p.summary);
      setUpdatesFeed(p.updatesFeed);
      setStaffList(p.staffList);
      setLoading(false);
    } else if (tokenChanged) {
      hasDataRef.current = false;
      setSummary(null);
      setUpdatesFeed([]);
      setStaffList([]);
      setLoading(true);
    }
  }, [token]);

  /** Admin books a walk-in from the day-timeline screen — summary counts and the updates feed
   * cache behind a 45s staleness window (see the focus effect below) that would otherwise show
   * stale numbers right after a real mutation. Force a real reload immediately instead. */
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      ADMIN_APPOINTMENT_CREATED_EVENT,
      (payload: AdminAppointmentCreatedPayload) => {
        void loadAdmin();
        lastLoadAtRef.current = Date.now();
        if (payload.staffId === opStaffId && payload.date === opDate) {
          void loadOpList(true);
        }
      }
    );
    return () => sub.remove();
  }, [loadAdmin, loadOpList, opStaffId, opDate]);

  useFocusEffect(
    useCallback(() => {
      const user = getAuthState().user;
      const hasData = hasDataRef.current;
      const staleMs = 45_000;
      const shouldRefetch = !hasData || Date.now() - lastLoadAtRef.current > staleMs;
      if (!hasData) setLoading(true);
      let cancelled = false;

      const startWork = () => {
        if (cancelled) return;
        void (async () => {
          if (cancelled) return;
          if (token && user?.isAdmin) {
            if (shouldRefetch) {
              await Promise.all([fetchCurrentUser({ silent: true }), loadAdmin()]);
              lastLoadAtRef.current = Date.now();
            }
            if (!cancelled) await refreshAppointments(token, { silent: true });
          } else if (shouldRefetch && token) {
            await Promise.all([fetchCurrentUser({ silent: true }), loadSimple()]);
            lastLoadAtRef.current = Date.now();
          }
        })().finally(() => {
          if (cancelled) return;
          setLoading(false);
          setRefreshing(false);
        });
      };

      let handle: { cancel: () => void } | undefined;
      if (hasData) {
        handle = InteractionManager.runAfterInteractions(startWork);
      } else {
        startWork();
      }

      return () => {
        cancelled = true;
        handle?.cancel();
      };
    }, [token, fetchCurrentUser, loadAdmin, loadSimple, refreshAppointments])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    (async () => {
      if (token) await fetchCurrentUser({ silent: true });
      const user = getAuthState().user;
      if (token && user?.isAdmin) {
        await loadAdmin();
        await forceRefreshAppointments(token);
        if (activeTab === 'appointments' && opStaffId && opDate && /^\d{4}-\d{2}-\d{2}$/.test(opDate)) {
          await loadOpList(true);
        }
      } else {
        await loadSimple();
      }
    })().finally(() => setRefreshing(false));
  }, [token, fetchCurrentUser, loadAdmin, loadSimple, forceRefreshAppointments, activeTab, opStaffId, opDate, loadOpList]);

  const handleBroadcastSend = useCallback(
    async () => {
      if (!token) return { error: i18n.t('admin.notLoggedIn') };
      const bcResult = validateBroadcast(broadcastForm.title, broadcastForm.body);
      if (!bcResult.valid) return { error: bcResult.error };
      if (broadcastScope === 'waitlist' && !broadcastStaffId) {
        return { error: i18n.t('admin.broadcastPickStaff') };
      }
      setBroadcastSaving(true);
      try {
        if (broadcastScope === 'waitlist') {
          const result = await createBroadcastWaitlistForStaff(
            token,
            broadcastStaffId,
            broadcastForm.title.trim(),
            broadcastForm.body.trim() || undefined
          );
          setBroadcastModalVisible(false);
          setBroadcastForm({ title: '', body: '' });
          return { success: true as const, queued: result.queued };
        }
        await createBroadcast(token, broadcastForm.title.trim(), broadcastForm.body.trim() || undefined);
        setBroadcastModalVisible(false);
        setBroadcastForm({ title: '', body: '' });
        return { success: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : i18n.t('admin.sendBroadcastFailed') };
      } finally {
        setBroadcastSaving(false);
      }
    },
    [token, broadcastForm, broadcastScope, broadcastStaffId]
  );

  const upcoming = getAuthState().user?.isAdmin ? sharedUpcoming : staffUpcoming;

  return {
    activeTab,
    setActiveTab,
    summary,
    upcoming,
    updatesFeed,
    loading,
    refreshing,
    onRefresh,
    staffList,
    opStaffId,
    setOpStaffId,
    opDate,
    setOpDate,
    opList,
    opLoading,
    loadOpList,
    broadcastModalVisible,
    setBroadcastModalVisible,
    broadcastScope,
    setBroadcastScope,
    broadcastStaffId,
    setBroadcastStaffId,
    broadcastForm,
    setBroadcastForm,
    broadcastSaving,
    handleBroadcastSend,
  };
}
