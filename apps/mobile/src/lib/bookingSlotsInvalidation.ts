import { DeviceEventEmitter } from 'react-native';

export const BOOKING_SLOTS_INVALIDATED_EVENT = 'bookingSlotsInvalidated';

/** `null` means "invalidate everything" (staffId/date unknown at the call site). */
export type BookingSlotsInvalidatedPayload = { staffId: string; date: string } | null;

/**
 * Fired after an appointment mutation that happens outside the Booking screen (e.g. cancelling
 * from Appointments) so a currently-mounted Booking screen drops any now-stale cached slots for
 * that staff/date instead of relying solely on the cache TTL.
 */
export function emitBookingSlotsInvalidated(payload: BookingSlotsInvalidatedPayload): void {
  DeviceEventEmitter.emit(BOOKING_SLOTS_INVALIDATED_EVENT, payload);
}
