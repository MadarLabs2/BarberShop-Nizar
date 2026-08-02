/**
 * Single source of truth for "what day/time is it right now" across the whole API.
 *
 * The business (and every customer) is physically in Israel, so every booking/availability/
 * blocking/waitlist decision must be judged against Israel's calendar day and clock time —
 * never the host machine's local timezone (which is only Israel by coincidence on a dev laptop,
 * and can silently become UTC or anything else once deployed) and never raw UTC.
 *
 * `israelTodayYmd` / `israelNowMinutesSinceMidnight` are the only two functions here that read
 * the actual current instant — both anchor it explicitly to Asia/Jerusalem via `Intl.DateTimeFormat`
 * so they're correct regardless of host timezone. `dayOfWeekForYmd` / `addDaysToYmd` operate purely
 * on a calendar-date string (no "now" involved), so they need no timezone anchoring — they're
 * self-consistent local-Date arithmetic and are exported from here only to keep every date
 * computation in one place.
 */

const ISRAEL_TZ = 'Asia/Jerusalem';

/** Today's calendar date (YYYY-MM-DD) in Israel, right now. */
export function israelTodayYmd(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: ISRAEL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Current time-of-day in Israel, right now, as minutes since midnight (0-1439). */
export function israelNowMinutesSinceMidnight(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ISRAEL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/** Day of week (0=Sunday..6=Saturday, matches JS `Date#getDay()`) for a YYYY-MM-DD calendar date. */
export function dayOfWeekForYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getDay();
}

/** Localized display label (e.g. "23.7.2026") for a YYYY-MM-DD calendar date — pure date math, no timezone dependency. */
export function formatIsraelDateLabel(ymd: string, locale = 'he-IL'): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(locale);
}

/** Shifts a YYYY-MM-DD calendar date by N days (pure calendar arithmetic). */
export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * Israel's UTC offset (minutes) at the given absolute instant — handles DST automatically.
 * Reads Israel's wall-clock date/time for this instant via `formatToParts` (no string→Date
 * re-parsing, unlike an earlier version of this function that round-tripped through
 * `toLocaleString` + `new Date(string)` — a shape `Date.parse` isn't guaranteed to understand on
 * every JS engine), then compares that wall-clock reading — treated as if it were itself a UTC
 * timestamp — against the real instant. Deterministic on any spec-compliant engine.
 */
function israelOffsetMinutesAt(instantMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ISRAEL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asIsraelWallClockUtcMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asIsraelWallClockUtcMs - instantMs) / 60000);
}

/**
 * Converts a wall-clock date+time (as read on an Israeli clock, e.g. "2026-07-23" + "09:00") to the
 * correct absolute epoch milliseconds — regardless of what timezone the host machine/process is in.
 * Needed anywhere an appointment's date+time is compared against "now" (upcoming vs past), since a
 * naive `new Date(\`${date}T${time}\`)` parse is interpreted in the HOST's local timezone, which is
 * only Israel by coincidence on a dev machine and silently wrong on a server in any other timezone.
 */
export function israelDateTimeToEpochMs(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = String(timeStr || '').slice(0, 5).split(':').map(Number);
  const guessUtcMs = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  const offsetMin = israelOffsetMinutesAt(guessUtcMs);
  return guessUtcMs - offsetMin * 60000;
}
