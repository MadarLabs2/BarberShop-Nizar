import { DeviceEventEmitter } from 'react-native';

export const ADMIN_APPOINTMENT_CREATED_EVENT = 'adminAppointmentCreated';

export type AdminAppointmentCreatedPayload = { staffId: string; date: string };

/**
 * Fired after an admin successfully books a walk-in appointment (AdminDayTimelineScreen) so the
 * Dashboard and Staff Schedule screens — which cache their data behind a staleness TTL to avoid
 * refetching on every focus — force an immediate refresh instead of waiting out that TTL and
 * showing stale counts/lists right after a real mutation.
 */
export function emitAdminAppointmentCreated(payload: AdminAppointmentCreatedPayload): void {
  DeviceEventEmitter.emit(ADMIN_APPOINTMENT_CREATED_EVENT, payload);
}
