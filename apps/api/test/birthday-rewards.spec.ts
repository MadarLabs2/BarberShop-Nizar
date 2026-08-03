import { findActiveBirthdayWindow } from '../src/modules/birthday-rewards.util';
import { BirthdayRewardsService } from '../src/modules/birthday-rewards.service';
import { israelTodayYmd } from '../src/core/israel-time';
import type { UserPayload } from '../src/auth/auth.service';

/** `reconcileAndGetStatus` computes "today" internally via the real `israelTodayYmd()` — these
 * tests need a birth date that's genuinely inside today's window regardless of when the suite
 * runs, so derive it from the real current date rather than a hardcoded one. */
const REAL_TODAY = israelTodayYmd();
const BIRTHDATE_TODAY = `1990-${REAL_TODAY.slice(5)}`; // same month/day as today, arbitrary birth year

describe('findActiveBirthdayWindow', () => {
  it('returns null when there is no birth date on file', () => {
    expect(findActiveBirthdayWindow(null, '2026-10-30')).toBeNull();
    expect(findActiveBirthdayWindow(undefined, '2026-10-30')).toBeNull();
  });

  it('returns null for a malformed birth date', () => {
    expect(findActiveBirthdayWindow('not-a-date', '2026-10-30')).toBeNull();
  });

  it('returns null the day before the birthday window opens', () => {
    // Birthday Oct 30 -- Oct 29 is still outside the window (last year's window, if any, is long over).
    expect(findActiveBirthdayWindow('1990-10-30', '2026-10-29')).toBeNull();
  });

  it('matches on the birthday itself (day 0 of the window)', () => {
    const w = findActiveBirthdayWindow('1990-10-30', '2026-10-30');
    expect(w).not.toBeNull();
    expect(w!.birthdayYear).toBe(2026);
    expect(w!.birthdayYmd).toBe('2026-10-30');
    expect(w!.windowEndYmd).toBe('2026-11-29');
  });

  it('still matches on the last valid day (day 29, e.g. Nov 29 for an Oct 30 birthday)', () => {
    const w = findActiveBirthdayWindow('1990-10-30', '2026-11-29');
    expect(w).not.toBeNull();
    expect(w!.birthdayYear).toBe(2026);
  });

  it('no longer matches the day after the window closes (day 30)', () => {
    expect(findActiveBirthdayWindow('1990-10-30', '2026-11-30')).toBeNull();
  });

  it('computes expiresAt as Israel midnight of the day after the last valid day (worked example: Oct 30 -> expires Nov 30 00:00)', () => {
    const w = findActiveBirthdayWindow('1990-10-30', '2026-10-30');
    expect(w).not.toBeNull();
    // Nov 30 00:00 Asia/Jerusalem == Nov 29 21:00 or 22:00 UTC depending on DST -- assert via the
    // Israel wall-clock formatting instead of a hardcoded UTC offset, so this can't rot with DST.
    const formatted = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(w!.expiresAt));
    expect(formatted).toBe('2026-11-30 00:00');
  });

  it('a December birthday is found when checked in December (this year occurrence)', () => {
    const w = findActiveBirthdayWindow('1990-12-15', '2026-12-20');
    expect(w).not.toBeNull();
    expect(w!.birthdayYear).toBe(2026);
    expect(w!.birthdayYmd).toBe('2026-12-15');
  });

  it('a December birthday window straddling the new year is still found when checked in January, tagged with the ORIGINAL birthday year', () => {
    // Birthday Dec 15, 2026 -> window Dec 15, 2026 .. Jan 14, 2027. Checked on Jan 5, 2027.
    const w = findActiveBirthdayWindow('1990-12-15', '2027-01-05');
    expect(w).not.toBeNull();
    expect(w!.birthdayYear).toBe(2026); // NOT 2027 -- same occurrence as if checked in December
    expect(w!.birthdayYmd).toBe('2026-12-15');
    expect(w!.windowEndYmd).toBe('2027-01-14');
  });

  it('is no longer found once that straddling window has fully closed', () => {
    expect(findActiveBirthdayWindow('1990-12-15', '2027-01-15')).toBeNull();
  });

  it('Feb 29 birthday is observed as Feb 28 in a non-leap year', () => {
    // 2026 is not a leap year.
    const w = findActiveBirthdayWindow('1996-02-29', '2026-02-28');
    expect(w).not.toBeNull();
    expect(w!.birthdayYmd).toBe('2026-02-28');
  });

  it('Feb 29 birthday is unaffected (observed on the real Feb 29) in a leap year', () => {
    // 2028 is a leap year.
    const w = findActiveBirthdayWindow('1996-02-29', '2028-02-29');
    expect(w).not.toBeNull();
    expect(w!.birthdayYmd).toBe('2028-02-29');
  });

  it('does not match a date entirely unrelated to the birthday', () => {
    expect(findActiveBirthdayWindow('1990-03-15', '2026-10-30')).toBeNull();
  });
});

/** Minimal fake Supabase client covering exactly the two call chains
 * BirthdayRewardsService.reconcileAndGetStatus uses: `.from(...).upsert(...).select(...)` and
 * `.from(...).select(...).eq(...).is(...).gt(...).order(...).limit(...).maybeSingle()`. */
function makeFakeSupabase(opts: {
  upsertSelectResult: { data: { id: string }[] | null; error: unknown };
  statusResult: { data: { expires_at: string } | null };
}) {
  const statusChain = {
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(opts.statusResult),
  };
  const upsertChain = {
    select: jest.fn().mockResolvedValue(opts.upsertSelectResult),
  };
  const from = jest.fn(() => ({
    upsert: jest.fn().mockReturnValue(upsertChain),
    select: jest.fn().mockReturnValue(statusChain),
  }));
  return { getClient: () => ({ from }) };
}

function makeUser(overrides: Partial<UserPayload> = {}): UserPayload {
  return {
    id: 'profile-1',
    phone: '0500000001',
    firstName: 'Test',
    lastName: 'User',
    birthDate: '1990-10-30',
    isAdmin: false,
    roles: ['customer'],
    role: 'customer',
    ...overrides,
  };
}

describe('BirthdayRewardsService.reconcileAndGetStatus', () => {
  it('is a safe no-op when the customer has no birth date on file', async () => {
    const fakeSupabase = makeFakeSupabase({
      upsertSelectResult: { data: [], error: null },
      statusResult: { data: null },
    });
    const fakeNotifications = { create: jest.fn().mockResolvedValue(true) };
    const service = new BirthdayRewardsService(fakeSupabase as never, fakeNotifications as never);

    const status = await service.reconcileAndGetStatus(makeUser({ birthDate: null }));

    expect(status).toEqual({ active: false, expiresAt: null });
    expect(fakeNotifications.create).not.toHaveBeenCalled();
  });

  it('sends exactly one notification when a new reward is genuinely granted', async () => {
    const fakeSupabase = makeFakeSupabase({
      // Non-empty result == a brand-new row was actually inserted (ON CONFLICT DO NOTHING RETURNING).
      upsertSelectResult: { data: [{ id: 'reward-1' }], error: null },
      statusResult: { data: { expires_at: '2026-11-30T00:00:00.000Z' } },
    });
    const fakeNotifications = { create: jest.fn().mockResolvedValue(true) };
    const service = new BirthdayRewardsService(fakeSupabase as never, fakeNotifications as never);

    const status = await service.reconcileAndGetStatus(makeUser({ birthDate: BIRTHDATE_TODAY }));

    expect(status).toEqual({ active: true, expiresAt: '2026-11-30T00:00:00.000Z' });
    expect(fakeNotifications.create).toHaveBeenCalledTimes(1);
    expect(fakeNotifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userPhone: '0500000001', type: 'personal' }),
    );
  });

  it('does not send a duplicate notification on a repeat check within the same window', async () => {
    const fakeSupabase = makeFakeSupabase({
      // Empty result == the row already existed (ON CONFLICT DO NOTHING matched, inserted nothing).
      upsertSelectResult: { data: [], error: null },
      statusResult: { data: { expires_at: '2026-11-30T00:00:00.000Z' } },
    });
    const fakeNotifications = { create: jest.fn().mockResolvedValue(true) };
    const service = new BirthdayRewardsService(fakeSupabase as never, fakeNotifications as never);

    const status = await service.reconcileAndGetStatus(makeUser({ birthDate: BIRTHDATE_TODAY }));

    // Still reports the reward as active (it exists, just wasn't newly granted this call) --
    // idempotency must not hide an already-granted, still-valid reward from the customer.
    expect(status).toEqual({ active: true, expiresAt: '2026-11-30T00:00:00.000Z' });
    expect(fakeNotifications.create).not.toHaveBeenCalled();
  });
});
