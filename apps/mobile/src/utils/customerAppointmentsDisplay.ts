import type { AppointmentDto } from '../services/bookings.api';
import { appointmentStartMs } from './dates';

/** Past appointments older than this (by scheduled start) are omitted from the customer Appointments UI. */
export const CUSTOMER_PAST_APPOINTMENT_RETENTION_DAYS = 7;

const RETENTION_MS = CUSTOMER_PAST_APPOINTMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Keeps only past appointments whose scheduled start is within the retention window.
 * Completed and still-`confirmed` past rows are treated the same — both are "done" from the customer's perspective once the slot has passed.
 */
export function filterCustomerPastAppointmentsForDisplay(
  past: AppointmentDto[],
  nowMs: number = Date.now()
): AppointmentDto[] {
  const cutoff = nowMs - RETENTION_MS;
  return past.filter((a) => {
    const start = appointmentStartMs(a.date, a.time);
    return start === start && start >= cutoff;
  });
}
