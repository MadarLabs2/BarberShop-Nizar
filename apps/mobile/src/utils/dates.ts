/**
 * Format a Date to YYYY-MM-DD using LOCAL calendar date.
 * IMPORTANT: Do NOT use toISOString().split('T')[0] — it uses UTC and can shift
 * the day (e.g. 00:30 local March 20 → UTC March 19 → wrong date for booking API).
 */
function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

/**
 * The barbershop is physically in Israel, so "today"/"now" for booking, blocking, and waitlist
 * purposes must be Israel's calendar day and clock — not the device's own timezone. A customer
 * travelling abroad (or with the wrong timezone/date set on their phone) must still see the shop's
 * real day, not their own — the server enforces this too, but the client should agree with it
 * instead of showing something different first and only correcting after a server round-trip.
 */
const ISRAEL_TZ = 'Asia/Jerusalem';

/** Today's calendar date (YYYY-MM-DD) in Israel, right now — regardless of device timezone. */
export function getTodayDateString(): string {
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

/**
 * Israel's UTC offset (minutes) at the given absolute instant — handles DST automatically.
 * Reads Israel's wall-clock date/time for this instant via `formatToParts` (no string→Date
 * re-parsing, unlike an earlier version of this function that round-tripped through
 * `toLocaleString` + `new Date(string)` — a shape `Date.parse` isn't guaranteed to understand on
 * every JS engine, notably Hermes, the engine this app actually runs on), then compares that
 * wall-clock reading — treated as if it were itself a UTC timestamp — against the real instant.
 * Deterministic on any spec-compliant engine, so the device's own timezone can't affect it.
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
 * Converts a wall-clock date+time as read on an Israeli clock (e.g. "2026-07-23" + "09:00") to the
 * correct absolute epoch milliseconds — regardless of the device's own timezone. Use this (not a
 * bare `new Date(\`${date}T${time}\`)`) whenever comparing an appointment's date+time against "now".
 */
export function israelDateTimeToEpochMs(dateStr: string, timeStr: string): number {
  const [y, m, day] = dateStr.split('-').map(Number);
  const [hh, mm] = String(timeStr || '').slice(0, 5).split(':').map(Number);
  const guessUtcMs = Date.UTC(y, (m || 1) - 1, day || 1, hh || 0, mm || 0);
  const offsetMin = israelOffsetMinutesAt(guessUtcMs);
  return guessUtcMs - offsetMin * 60000;
}

/**
 * Many `ar-*` locales default civil dates to the Islamic (Hijri) calendar.
 * Force Gregorian so day/month/year match the API and Israeli shop practice; weekday/month names stay Arabic.
 */
export function localeDateFormatOptions(
  localeTag: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions {
  if (localeTag.startsWith('ar')) {
    return { ...options, calendar: 'gregory', numberingSystem: 'latn' };
  }
  return options;
}

/**
 * Next N calendar days starting today in Israel (regardless of device timezone).
 * Used for booking day pickers: always forward-looking; past days are never included.
 */
export function getNextDays(n: number): Date[] {
  const [y, m, day] = getTodayDateString().split('-').map(Number);
  const days: Date[] = [];
  for (let i = 0; i < n; i++) {
    days.push(new Date(y, m - 1, day + i));
  }
  return days;
}

/** Start instant for API `date` (YYYY-MM-DD) + `time` (HH:MM…), as read on an Israeli clock. */
export function appointmentStartMs(dateStr: string, timeStr: string): number {
  const t = israelDateTimeToEpochMs(dateStr, timeStr);
  return t !== t ? NaN : t;
}

/** True if appointment start (local `date` + `time`) is still in the future. */
export function isAppointmentUpcoming(dateStr: string, timeStr: string): boolean {
  const t = appointmentStartMs(dateStr, timeStr);
  if (t !== t) return false;
  return t > Date.now();
}

/** Calendar date + weekday for pickers and summaries, e.g. «רביעי, 22/4/2026». */
export function formatDateWithWeekday(date: Date, localeTag = 'he-IL'): string {
  const dateStr = toDateString(date);
  const weekday = getWeekdayNameForYyyyMmDd(dateStr, localeTag);
  const dmy = formatDateDmy(date);
  return `${weekday}, ${dmy}`;
}

/** Appointment card / details: weekday + calendar date from API `date` + `time` (local). */
export function formatAppointmentDate(dateStr: string, timeStr: string, localeTag = 'he-IL'): string {
  const timeShort = String(timeStr || '').slice(0, 5);
  const combined = `${dateStr}T${timeShort}`;
  const d = new Date(combined);
  const t = d.getTime();
  if (t !== t) return dateStr; // NaN check
  return formatDateWithWeekday(d, localeTag);
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('he-IL');
}

/** Date-only display in fixed D/M/YYYY order (e.g. 19/4/2026), independent from locale ordering. */
export function formatDateDmy(date: Date): string {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

/** Date-only from ISO-like string (YYYY-MM-DD or full ISO). Returns original when invalid. */
export function formatIsoDateDmy(isoLike: string): string {
  if (!isoLike) return isoLike;
  const datePart = String(isoLike).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return isoLike;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return isoLike;
  return `${d}/${mo}/${y}`;
}

/** Date+time from ISO string in fixed D/M/YYYY HH:MM format. */
export function formatIsoDateTimeDmyHm(iso: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const datePart = formatDateDmy(dt);
  const hh = dt.getHours();
  const mm = pad2(dt.getMinutes());
  return `${datePart} ${hh}:${mm}`;
}

/** Hebrew weekday names (Sun=0 .. Sat=6). Single source of truth for working-days UI. */
export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** Standard order for iterating weekdays. */
export const WEEK_DAYS_ORDER = [0, 1, 2, 3, 4, 5, 6];

/** Format YYYY-MM-DD to short display (DD.MM). Local-date-safe: no string parsing. */
export function formatDayShort(dateStr: string, localeTag = 'he-IL'): string {
  const [y, m, day] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, day);
  void localeTag;
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/** Parse YYYY-MM-DD to local Date at noon (avoids DST edge cases for display). */
export function parseYyyyMmDdToDate(dateStr: string): Date {
  const [y, m, day] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, day, 12, 0, 0, 0);
}

/** Weekday name for a calendar date string (YYYY-MM-DD). Hebrew uses fixed list; other locales use Intl. */
export function getWeekdayNameForYyyyMmDd(dateStr: string, localeTag = 'he-IL'): string {
  const d = parseYyyyMmDdToDate(dateStr);
  if (localeTag === 'he-IL' || localeTag.startsWith('he')) {
    return DAY_NAMES[d.getDay()];
  }
  return d.toLocaleDateString(localeTag, localeDateFormatOptions(localeTag, { weekday: 'long' }));
}

/** Format time from Date for API / forms (HH:MM). */
export function formatTimeHHMM(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Reference Date (today) with clock from "HH:MM" for time pickers.
 * Invalid or empty input defaults to 09:00.
 */
export function timeHHMMToReferenceDate(hhmm: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  const d = new Date();
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      d.setHours(h, min, 0, 0);
      return d;
    }
  }
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Next N days from today as YYYY-MM-DD. Returns { from, to } for API date range. */
export function getDateRangeFromToday(days: number): { from: string; to: string } {
  const [y, m, day] = getTodayDateString().split('-').map(Number);
  const from = `${y}-${pad2(m)}-${pad2(day)}`;
  const end = new Date(y, m - 1, day + days - 1);
  const to = toDateString(end);
  return { from, to };
}

/**
 * Current calendar week (Sun–Sat) that contains today.
 * Matches Hebrew `DAY_NAMES` (Sunday first) and the staff screen label «השבוע».
 * Local-date-safe; month/year roll correctly when Sunday falls in adjacent month.
 */
export function getCurrentWeekDates(localeTag = 'he-IL'): { dateStr: string; dayOfWeek: number; weekdayName: string }[] {
  const [y, mo1, dayNum] = getTodayDateString().split('-').map(Number);
  const mo = mo1 - 1;
  const dow = new Date(y, mo, dayNum).getDay(); // 0=Sun .. 6=Sat
  const sundayOfThisWeek = dayNum - dow;
  const result: { dateStr: string; dayOfWeek: number; weekdayName: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(y, mo, sundayOfThisWeek + i);
    const dateStr = toDateString(d);
    result.push({
      dateStr,
      dayOfWeek: i,
      weekdayName: getWeekdayNameForYyyyMmDd(dateStr, localeTag),
    });
  }
  return result;
}
