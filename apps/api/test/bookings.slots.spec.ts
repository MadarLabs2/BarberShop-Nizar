import { overlaps, timeToMins, minsToTime } from '../src/bookings';

describe('timeToMins / minsToTime', () => {
  it('round-trips HH:MM', () => {
    expect(timeToMins('09:00')).toBe(540);
    expect(timeToMins('18:20')).toBe(1100);
    expect(minsToTime(540)).toBe('09:00');
    expect(minsToTime(1100)).toBe('18:20');
  });

  it('pads single-digit hour/minute', () => {
    expect(minsToTime(65)).toBe('01:05');
  });
});

describe('overlaps', () => {
  it('detects exact-slot overlap', () => {
    expect(overlaps(600, 40, 600, 40)).toBe(true);
  });

  it('detects partial overlap with different start times/durations', () => {
    // 10:00-10:40 vs 10:20-11:00 — required scenario #2 (partially overlapping slots)
    expect(overlaps(600, 40, 620, 40)).toBe(true);
  });

  it('treats back-to-back appointments as non-overlapping (half-open interval)', () => {
    // 10:00-10:40 then 10:40-11:20 must be bookable back-to-back
    expect(overlaps(600, 40, 640, 40)).toBe(false);
  });

  it('detects an appointment starting inside another', () => {
    expect(overlaps(600, 60, 630, 20)).toBe(true);
  });
});

/**
 * These reproduce the same grid-generation loop `computeAvailableSlots` uses in bookings.ts
 * (candidate start = shift start, step = requested service's own duration), against the required
 * scenarios. Scenario #4 and #5 pass; scenario #3 is included to document a real, currently
 * UNFIXED gap (out of scope for this pass, flagged in the audit) rather than pretend it's fixed —
 * see the Booking Logic & Timezone audit finding on mixed-duration slot-grid under-reporting.
 */
function generateSlots(startMins: number, endMins: number, duration: number, booked: { start: number; duration: number }[]): number[] {
  const slots: number[] = [];
  let mins = startMins;
  while (mins + duration <= endMins) {
    const blocked = booked.some((b) => overlaps(b.start, b.duration, mins, duration));
    if (!blocked) slots.push(mins);
    mins += duration;
  }
  return slots;
}

describe('computeAvailableSlots grid (required scenarios)', () => {
  it('#4 — offers the last valid slot before closing', () => {
    // Shift 09:00-19:00 (540-1140), 40-min service -> last slot must be 18:20 (1100), fitting exactly to 19:00.
    const slots = generateSlots(540, 1140, 40, []);
    expect(slots[slots.length - 1]).toBe(1100);
    expect(minsToTime(slots[slots.length - 1])).toBe('18:20');
  });

  it('#5 — never offers a slot that would finish after closing', () => {
    const slots = generateSlots(540, 1140, 40, []);
    expect(slots.every((s) => s + 40 <= 1140)).toBe(true);
    expect(slots).not.toContain(1110); // 18:30 + 40 = 19:10, past closing
  });

  it('#3 — KNOWN GAP (not fixed this pass): a free gap after a differently-sized booked service is not offered', () => {
    // Shift 09:00-19:00. A 30-min service is booked at 09:00 (09:00-09:30). A customer now wants
    // the 60-min service. 09:30-10:30 is genuinely free, but the grid steps from the shift start
    // by the REQUESTED service's own duration (60 here), so it never lands on 09:30 and this slot
    // is never offered — a missed booking, not a double-booking risk. Documented and left for a
    // future pass per the audit; asserting the CURRENT (imperfect) behavior here so a future fix
    // shows up as an intentional, reviewed test change rather than a silent behavior shift.
    const bookedThirtyMinAt0900 = [{ start: 540, duration: 30 }];
    const sixtyMinSlots = generateSlots(540, 1140, 60, bookedThirtyMinAt0900);
    expect(sixtyMinSlots).not.toContain(570); // 09:30 — actually free (09:30-10:30), but never a grid candidate today
    expect(sixtyMinSlots[0]).toBe(600); // earliest offered is 10:00 — the 09:30-10:00 half hour is wasted
  });
});

/**
 * Mirrors the exact boolean formula used by `add_blocked_slot_and_cancel_overlaps`'s cancellation
 * predicate (supabase/migrations/042_blocked_slots_no_overlap_and_atomic_insert.sql and
 * 043_atomic_appointment_blocked_slot_lock.sql, the `WITH cancelled AS (UPDATE ... WHERE ...)`
 * clause):
 *
 *   (appt_start_mins) < v_end_mins  AND  (appt_start_mins + appt_duration) > v_start_mins
 *
 * where v_start_mins/v_end_mins are the BLOCK's range. This is a pure-TS reimplementation, not a
 * live-Postgres run — it proves the LOGIC is correct (including for a block that only partially
 * overlaps an appointment, not just full containment), not that the actual SQL executes without
 * error. Only supabase/tests/booking_concurrency.sh (run against a real Postgres) proves that.
 */
function blockOverlapsAppointment(
  apptStartMins: number,
  apptDurationMins: number,
  blockStartMins: number,
  blockDurationMins: number,
): boolean {
  const blockEndMins = blockStartMins + blockDurationMins;
  return apptStartMins < blockEndMins && apptStartMins + apptDurationMins > blockStartMins;
}

describe('add_blocked_slot_and_cancel_overlaps cancellation predicate (required scenario #12)', () => {
  // Fixed reference appointment for every case below: 14:00-14:40 (840-880).
  const APPT_START = 840;
  const APPT_DURATION = 40;

  it('cancels when the block partially overlaps only the END of the appointment (not full containment)', () => {
    // Block 14:20-15:00 — overlaps only 14:20-14:40 (the last 20 minutes), leaves 14:00-14:20 alone.
    expect(blockOverlapsAppointment(APPT_START, APPT_DURATION, 860, 40)).toBe(true);
  });

  it('cancels when the block partially overlaps only the START of the appointment (not full containment)', () => {
    // Block 13:40-14:20 — overlaps only 14:00-14:20 (the first 20 minutes), leaves 14:20-14:40 alone.
    expect(blockOverlapsAppointment(APPT_START, APPT_DURATION, 820, 40)).toBe(true);
  });

  it('cancels when the block fully contains the appointment (regression check for the original case)', () => {
    // Block 13:30-15:00 (90 min) — fully contains 14:00-14:40.
    expect(blockOverlapsAppointment(APPT_START, APPT_DURATION, 810, 90)).toBe(true);
  });

  it('cancels when the appointment fully contains a short block', () => {
    // Block 14:10-14:30 (20 min) — entirely inside the 14:00-14:40 appointment.
    expect(blockOverlapsAppointment(APPT_START, APPT_DURATION, 850, 20)).toBe(true);
  });

  it('does NOT cancel a block that ends exactly when the appointment starts (adjacent, half-open interval)', () => {
    // Block 13:20-14:00 — ends exactly at 14:00, must not count as overlapping.
    expect(blockOverlapsAppointment(APPT_START, APPT_DURATION, 800, 40)).toBe(false);
  });

  it('does NOT cancel a block that starts exactly when the appointment ends (adjacent, half-open interval)', () => {
    // Block 14:40-15:20 — starts exactly at 14:40, must not count as overlapping.
    expect(blockOverlapsAppointment(APPT_START, APPT_DURATION, 880, 40)).toBe(false);
  });

  it('does NOT cancel a completely disjoint block', () => {
    // Block 12:00-12:30 — nowhere near the 14:00-14:40 appointment.
    expect(blockOverlapsAppointment(APPT_START, APPT_DURATION, 720, 30)).toBe(false);
  });
});
