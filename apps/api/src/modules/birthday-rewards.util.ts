import { addDaysToYmd, israelDateTimeToEpochMs } from '../core/israel-time';

export type BirthdayRewardWindow = {
  /** Calendar year of the birthday OCCURRENCE this window belongs to (see migration 049 comment —
   * not necessarily the year "today" falls in, since a December birthday's window can straddle
   * into January). This is the value stored in `birthday_rewards.birthday_year`. */
  birthdayYear: number;
  /** Observed birthday date for this occurrence (YYYY-MM-DD), after the Feb 29 leap-year adjustment. */
  birthdayYmd: string;
  /** Last calendar day the reward is valid for, inclusive (YYYY-MM-DD), Israel calendar. */
  windowEndYmd: string;
  /** Exclusive expiry boundary as an ISO timestamp — the first instant (Israel midnight) the
   * reward is no longer valid, i.e. the start of the day AFTER `windowEndYmd`. */
  expiresAt: string;
};

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Feb 29 birthdays are observed on Feb 28 in a non-leap year — the one clearly documented rule
 * this system uses (chosen over rolling forward to Mar 1, which would push the reward a day later
 * than every other birthday's equivalent-day timing). Leap-year Feb 29 birthdays are unaffected.
 */
function observedBirthdayForYear(birthMonth: number, birthDay: number, year: number): string {
  const day = birthMonth === 2 && birthDay === 29 && !isLeapYear(year) ? 28 : birthDay;
  return `${year}-${String(birthMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Finds the birthday-reward window (if any) that `todayYmd` (Israel calendar, YYYY-MM-DD) falls
 * inside, for a given `profiles.birth_date` (YYYY-MM-DD or null). A window runs from the birthday
 * itself through 30 days later inclusive (e.g. birthday Oct 30 -> valid through Nov 29 inclusive,
 * `expiresAt` = Nov 30 00:00 Israel time as the exclusive boundary) — this matches the spec's own
 * worked example exactly (Oct 30 -> expires Nov 29). Note the spec's prose elsewhere says "30
 * calendar days" / "no more than 29 days after the birthday", which by direct calendar count is
 * actually a 31-day inclusive span (Oct 30..Nov 29 is 31 distinct days, and Nov 29 is 30 days —
 * not 29 — after Oct 30) — a one-day fencepost slip against the prose's own count. The concrete
 * worked example is treated as authoritative here since it's unambiguous where the prose isn't;
 * the grant-eligibility cutoff (condition 3) uses this same `windowEndYmd`, so a customer who
 * opens the app for the first time on the last valid day (Nov 29) is still correctly granted the
 * reward, not turned away one day early.
 *
 * Checks both this year's and last year's occurrence: a December birthday's window can still be
 * open in January, and using only "this calendar year" would silently miss that case.
 *
 * Returns `null` if there's no birth date on file, it's malformed, or today isn't inside any
 * occurrence's window.
 */
export function findActiveBirthdayWindow(
  birthDate: string | null | undefined,
  todayYmd: string,
): BirthdayRewardWindow | null {
  if (!birthDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate.trim());
  if (!m) return null;
  const birthMonth = Number(m[2]);
  const birthDay = Number(m[3]);
  if (!(birthMonth >= 1 && birthMonth <= 12) || !(birthDay >= 1 && birthDay <= 31)) return null;

  const todayYear = Number(todayYmd.slice(0, 4));
  if (!Number.isFinite(todayYear)) return null;

  for (const candidateYear of [todayYear, todayYear - 1]) {
    const birthdayYmd = observedBirthdayForYear(birthMonth, birthDay, candidateYear);
    const windowEndYmd = addDaysToYmd(birthdayYmd, 30);
    if (todayYmd >= birthdayYmd && todayYmd <= windowEndYmd) {
      const expiresAtYmd = addDaysToYmd(windowEndYmd, 1);
      return {
        birthdayYear: candidateYear,
        birthdayYmd,
        windowEndYmd,
        expiresAt: new Date(israelDateTimeToEpochMs(expiresAtYmd, '00:00')).toISOString(),
      };
    }
  }
  return null;
}
