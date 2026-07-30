import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subscribeAuth, getAuth } from '../store/auth.store';
import type { NotificationDto } from '../services/notifications.api';
import type { AppointmentDto } from '../services/bookings.api';

const PREFIX = 'barbershop_badge_seen_v1';

function keyNotifications(userId: string) {
  return `${PREFIX}:notifications:${userId}`;
}
function keyAppointments(userId: string) {
  return `${PREFIX}:appointments:${userId}`;
}

/** Notifications with created_at strictly after lastSeenMs count as unseen. */
export function countUnseenNotifications(items: NotificationDto[], lastSeenMs: number): number {
  return items.filter((n) => new Date(n.created_at).getTime() > lastSeenMs).length;
}

/** Appointments with updatedAt (or createdAt) strictly after lastSeenMs count as unseen. */
export function countUnseenAppointments(
  upcoming: AppointmentDto[],
  past: AppointmentDto[],
  lastSeenMs: number
): number {
  const ts = (a: AppointmentDto) => new Date(a.updatedAt ?? a.createdAt).getTime();
  return [...upcoming, ...past].filter((a) => ts(a) > lastSeenMs).length;
}

type BadgeSeenValue = {
  hydrated: boolean;
  notificationsLastSeenMs: number;
  appointmentsLastSeenMs: number;
  markNotificationsSeenFromItems: (items: NotificationDto[]) => Promise<void>;
  markAppointmentsSeenFromLists: (upcoming: AppointmentDto[], past: AppointmentDto[]) => Promise<void>;
};

const BadgeSeenContext = createContext<BadgeSeenValue | null>(null);

export function BadgeSeenProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(() => getAuth().user?.id ?? null);
  const [hydrated, setHydrated] = useState(false);
  const [notificationsLastSeenMs, setNotificationsLastSeenMs] = useState(0);
  const [appointmentsLastSeenMs, setAppointmentsLastSeenMs] = useState(0);

  useEffect(() => {
    return subscribeAuth(() => {
      setUserId(getAuth().user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!userId) {
      setNotificationsLastSeenMs(0);
      setAppointmentsLastSeenMs(0);
      setHydrated(true);
      return;
    }
    let cancelled = false;
    setHydrated(false);
    (async () => {
      try {
        const [n, a] = await Promise.all([
          AsyncStorage.getItem(keyNotifications(userId)),
          AsyncStorage.getItem(keyAppointments(userId)),
        ]);
        if (cancelled) return;
        setNotificationsLastSeenMs(n ? parseInt(n, 10) : 0);
        setAppointmentsLastSeenMs(a ? parseInt(a, 10) : 0);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const markNotificationsSeenFromItems = useCallback(
    async (items: NotificationDto[]) => {
      const ms =
        items.length === 0
          ? Date.now()
          : Math.max(Date.now(), ...items.map((n) => new Date(n.created_at).getTime()));
      setNotificationsLastSeenMs(ms);
      if (userId) await AsyncStorage.setItem(keyNotifications(userId), String(ms));
    },
    [userId]
  );

  const markAppointmentsSeenFromLists = useCallback(
    async (upcoming: AppointmentDto[], past: AppointmentDto[]) => {
      const all = [...upcoming, ...past];
      const ms =
        all.length === 0
          ? Date.now()
          : Math.max(Date.now(), ...all.map((a) => new Date(a.updatedAt ?? a.createdAt).getTime()));
      setAppointmentsLastSeenMs(ms);
      if (userId) await AsyncStorage.setItem(keyAppointments(userId), String(ms));
    },
    [userId]
  );

  const value = useMemo(
    () => ({
      hydrated,
      notificationsLastSeenMs,
      appointmentsLastSeenMs,
      markNotificationsSeenFromItems,
      markAppointmentsSeenFromLists,
    }),
    [
      hydrated,
      notificationsLastSeenMs,
      appointmentsLastSeenMs,
      markNotificationsSeenFromItems,
      markAppointmentsSeenFromLists,
    ]
  );

  return <BadgeSeenContext.Provider value={value}>{children}</BadgeSeenContext.Provider>;
}

export function useBadgeSeen() {
  const ctx = useContext(BadgeSeenContext);
  if (!ctx) throw new Error('useBadgeSeen must be used within BadgeSeenProvider');
  return ctx;
}
