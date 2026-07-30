import type { AppointmentDto } from '../services/bookings.api';
import type { NotificationDto } from '../services/notifications.api';
import { useAppointments } from '../contexts/AppointmentsContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { useBadgeSeen } from '../contexts/BadgeSeenContext';

/**
 * Latest lists + badge timestamps mirrored from contexts here. `DrawerContent` reads this only when
 * computing badges on open — avoids the drawer re-rendering on every appointments/notifications refresh.
 */
export const drawerMenuSnapshotRef = {
  upcoming: [] as AppointmentDto[],
  past: [] as AppointmentDto[],
  notifications: [] as NotificationDto[],
  appointmentsLastSeenMs: 0,
  notificationsLastSeenMs: 0,
  hydrated: false,
};

/**
 * Subscribes to appointment/notification/badge contexts and mirrors into `drawerMenuSnapshotRef`.
 * Renders nothing.
 */
export function DrawerMenuSnapshotBridge() {
  const { upcoming, past } = useAppointments();
  const { items } = useNotifications();
  const { hydrated, appointmentsLastSeenMs, notificationsLastSeenMs } = useBadgeSeen();

  drawerMenuSnapshotRef.upcoming = upcoming;
  drawerMenuSnapshotRef.past = past;
  drawerMenuSnapshotRef.notifications = items;
  drawerMenuSnapshotRef.appointmentsLastSeenMs = appointmentsLastSeenMs;
  drawerMenuSnapshotRef.notificationsLastSeenMs = notificationsLastSeenMs;
  drawerMenuSnapshotRef.hydrated = hydrated;

  return null;
}
