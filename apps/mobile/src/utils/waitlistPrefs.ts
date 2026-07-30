/** Mirrors API waitlist day-part bands (minutes from midnight). */
const MORNING_START = 8 * 60;
const MORNING_END = 12 * 60;
const AFTERNOON_START = 12 * 60;
const AFTERNOON_END = 17 * 60;
const EVENING_START = 17 * 60;
const EVENING_END = 22 * 60;

export function timeToMins(t: string): number {
  const s = String(t || '').slice(0, 5);
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** At least one chosen day-part overlaps the staff shift [start,end) in minutes. */
export function prefsOverlapStaffWindow(
  preferMorning: boolean,
  preferAfternoon: boolean,
  preferEvening: boolean,
  staffStartMins: number,
  staffEndMins: number,
): boolean {
  if (staffStartMins >= staffEndMins) return false;
  if (preferMorning && Math.max(MORNING_START, staffStartMins) < Math.min(MORNING_END, staffEndMins)) return true;
  if (preferAfternoon && Math.max(AFTERNOON_START, staffStartMins) < Math.min(AFTERNOON_END, staffEndMins)) return true;
  if (preferEvening && Math.max(EVENING_START, staffStartMins) < Math.min(EVENING_END, staffEndMins)) return true;
  return false;
}
