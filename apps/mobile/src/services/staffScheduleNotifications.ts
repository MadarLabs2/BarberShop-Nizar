

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { MyStaffAppointment } from './admin.api';

/** Prefix used to identify and cancel only our scheduled notifications. */
const STAFF_NOTIF_ID_PREFIX = 'staff-apt-';
const MORNING_NOTIF_ID = `${STAFF_NOTIF_ID_PREFIX}morning-`;
const REMINDER_NOTIF_ID = `${STAFF_NOTIF_ID_PREFIX}remind-`;

/** Minutes before appointment to fire the reminder. */
const REMINDER_MINUTES_BEFORE = 15;

/** Android channel for staff appointment notifications. */
const STAFF_CHANNEL_ID = 'staff-appointments';

async function ensureStaffChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(STAFF_CHANNEL_ID, {
    name: 'תורים שלי',
    description: 'תזכורות לתורים של היום',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#C9A227',
    enableVibrate: true,
    showBadge: true,
  });
}

/** Cancel all previously scheduled staff notifications (morning + reminders). */
async function cancelPreviousStaffNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const staffNotifs = scheduled.filter((n) =>
    n.identifier.startsWith(STAFF_NOTIF_ID_PREFIX),
  );
  await Promise.all(
    staffNotifs.map((n) =>
      Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}),
    ),
  );
}

/** "09:30" → Date object for today at 09:30 */
function timeStringToDateToday(timeStr: string): Date | null {
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/** "2025-01-15" → true if that is today */
function isToday(dateStr: string): boolean {
  const today = new Date();
  const y = today.getFullYear();
  const mo = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return dateStr === `${y}-${mo}-${day}`;
}

/** Build a readable summary line for a single appointment. */
function aptSummaryLine(apt: MyStaffAppointment): string {
  return `${apt.time} · ${apt.clientName}`;
}

/**
 * Main entry point. Call this after staff appointments are loaded.
 * Safe to call multiple times — always cancels old and reschedules.
 */
export async function scheduleStaffAppointmentNotifications(
  appointments: MyStaffAppointment[],
): Promise<void> {
  try {
    // Check permission — don't schedule if not granted
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const { status: asked } = await Notifications.requestPermissionsAsync();
      if (asked !== 'granted') return;
    }

    await ensureStaffChannel();
    await cancelPreviousStaffNotifications();

    const now = new Date();

    // ── 1. Group today's appointments ──────────────────────────────────────
    const todayApts = appointments
      .filter((a) => isToday(a.date))
      .sort((a, b) => a.time.localeCompare(b.time));

    // ── 2. Morning briefing notification ──────────────────────────────────
    if (todayApts.length > 0) {
      const morningTime = new Date();
      morningTime.setHours(7, 30, 0, 0);

      // If 07:30 has already passed today, fire it 30 seconds from now
      // (so opening the app mid-day still gives the briefing)
      const fireAt = morningTime > now ? morningTime : new Date(now.getTime() + 30_000);

      const bodyLines = todayApts.map(aptSummaryLine).join('\n');
      const title =
        todayApts.length === 1
          ? `תור אחד היום`
          : `${todayApts.length} תורים היום`;

      await Notifications.scheduleNotificationAsync({
        identifier: `${MORNING_NOTIF_ID}${morningTime.toDateString()}`,
        content: {
          title,
          body: bodyLines,
          data: { screen: 'StaffAppointments' },
          sound: 'default',
          ...(Platform.OS === 'android' ? { channelId: STAFF_CHANNEL_ID } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireAt,
        },
      });
    }

    // ── 3. Per-appointment reminders (15 min before) ───────────────────────
    for (const apt of appointments) {
      const aptDate = timeStringToDateToday(apt.time);
      if (!aptDate) continue;

      // For non-today appointments, build the correct date
      let aptDateTime: Date;
      if (isToday(apt.date)) {
        aptDateTime = aptDate;
      } else {
        const [year, month, day] = apt.date.split('-').map(Number);
        if (!year || !month || !day) continue;
        aptDateTime = new Date(year, month - 1, day, aptDate.getHours(), aptDate.getMinutes(), 0, 0);
      }

      const fireAt = new Date(aptDateTime.getTime() - REMINDER_MINUTES_BEFORE * 60 * 1000);

      // Skip if reminder time has already passed
      if (fireAt <= now) continue;

      const serviceName = typeof apt.serviceName === 'string'
        ? apt.serviceName
        : (apt.serviceName as { he?: string; ar?: string })?.he ?? 'תור';

      await Notifications.scheduleNotificationAsync({
        identifier: `${REMINDER_NOTIF_ID}${apt.id}`,
        content: {
          title: `תור בעוד ${REMINDER_MINUTES_BEFORE} דקות`,
          body: `${apt.time} · ${apt.clientName} · ${serviceName}`,
          data: { screen: 'StaffAppointments' },
          sound: 'default',
          ...(Platform.OS === 'android' ? { channelId: STAFF_CHANNEL_ID } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireAt,
        },
      });
    }
  } catch {
    // Notifications are non-critical — never crash the app
  }
}

/** Call when staff logs out to clear all scheduled notifications. */
export async function clearStaffAppointmentNotifications(): Promise<void> {
  try {
    await cancelPreviousStaffNotifications();
  } catch {
    /* ignore */
  }
}
