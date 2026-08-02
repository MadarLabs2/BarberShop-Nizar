import {
  israelDateTimeToEpochMs,
  israelTodayYmd,
  israelNowMinutesSinceMidnight,
  dayOfWeekForYmd,
  addDaysToYmd,
} from '../src/core/israel-time';

/**
 * Israel DST for 2026 (Friday-before-last-Sunday-of-March start, last-Sunday-of-October end):
 *   - Spring forward: 2026-03-27 02:00 IST (+02:00) -> 03:00 IDT (+03:00)
 *   - Fall back:       2026-10-25 02:00 IDT (+03:00) -> 01:00 IST (+02:00)
 * These fixtures were computed independently via plain Date.UTC arithmetic (no dependency on the
 * function under test), so they catch a real regression rather than just re-asserting the code.
 */
describe('israelDateTimeToEpochMs', () => {
  it('converts a winter (IST, UTC+2) local time correctly', () => {
    expect(israelDateTimeToEpochMs('2026-01-15', '12:00')).toBe(Date.UTC(2026, 0, 15, 10, 0, 0));
  });

  it('converts a summer (IDT, UTC+3) local time correctly', () => {
    expect(israelDateTimeToEpochMs('2026-07-15', '12:00')).toBe(Date.UTC(2026, 6, 15, 9, 0, 0));
  });

  it('handles the spring-forward DST boundary (2026-03-27)', () => {
    const dayBefore = israelDateTimeToEpochMs('2026-03-26', '12:00'); // still IST (+2)
    const dayOf = israelDateTimeToEpochMs('2026-03-27', '12:00'); // already IDT (+3) by noon
    expect(dayBefore).toBe(Date.UTC(2026, 2, 26, 10, 0, 0));
    expect(dayOf).toBe(Date.UTC(2026, 2, 27, 9, 0, 0));
    // Clocks skip an hour overnight, so 24h of wall-clock time is only 23h of real elapsed time.
    expect(dayOf - dayBefore).toBe(23 * 60 * 60 * 1000);
  });

  it('handles the fall-back DST boundary (2026-10-25)', () => {
    const dayBefore = israelDateTimeToEpochMs('2026-10-24', '12:00'); // still IDT (+3)
    const dayOf = israelDateTimeToEpochMs('2026-10-25', '12:00'); // already IST (+2) by noon
    expect(dayBefore).toBe(Date.UTC(2026, 9, 24, 9, 0, 0));
    expect(dayOf).toBe(Date.UTC(2026, 9, 25, 10, 0, 0));
    // Clocks repeat an hour overnight, so 24h of wall-clock time is 25h of real elapsed time.
    expect(dayOf - dayBefore).toBe(25 * 60 * 60 * 1000);
  });

  it('handles the midnight calendar-date boundary without shifting the selected date', () => {
    const justBeforeMidnight = israelDateTimeToEpochMs('2026-07-22', '23:59');
    const justAfterMidnight = israelDateTimeToEpochMs('2026-07-23', '00:00');
    expect(justAfterMidnight).toBeGreaterThan(justBeforeMidnight);
    expect(justAfterMidnight - justBeforeMidnight).toBe(60 * 1000);
    expect(israelDateTimeToEpochMs('2026-07-23', '00:00')).toBe(Date.UTC(2026, 6, 22, 21, 0, 0));
  });

  it('is independent of the host process timezone (phone/server timezone must not matter)', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Jerusalem';
      const israelHost = israelDateTimeToEpochMs('2026-07-23', '09:00');
      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14, about as far from Israel as a clock gets
      const farHost = israelDateTimeToEpochMs('2026-07-23', '09:00');
      process.env.TZ = 'America/Los_Angeles'; // UTC-7/8
      const westHost = israelDateTimeToEpochMs('2026-07-23', '09:00');
      expect(farHost).toBe(israelHost);
      expect(westHost).toBe(israelHost);
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('israelTodayYmd / israelNowMinutesSinceMidnight', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rolls over to the next Israel calendar date before UTC midnight (winter, UTC+2)', () => {
    // 2026-01-15T22:30:00Z is already 2026-01-16 00:30 in Israel (winter, +2).
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 15, 22, 30, 0)));
    expect(israelTodayYmd()).toBe('2026-01-16');
    expect(israelNowMinutesSinceMidnight()).toBe(30);
  });

  it('is independent of host process timezone', () => {
    const original = process.env.TZ;
    try {
      jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 6, 23, 6, 0, 0)));
      process.env.TZ = 'Asia/Jerusalem';
      const israelHostDate = israelTodayYmd();
      const israelHostMins = israelNowMinutesSinceMidnight();
      process.env.TZ = 'America/Los_Angeles';
      expect(israelTodayYmd()).toBe(israelHostDate);
      expect(israelNowMinutesSinceMidnight()).toBe(israelHostMins);
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('dayOfWeekForYmd / addDaysToYmd (pure calendar arithmetic)', () => {
  it('matches JS Date#getDay() for a known date', () => {
    // 2026-03-01 is a Sunday (verified independently).
    expect(dayOfWeekForYmd('2026-03-01')).toBe(0);
  });

  it('rolls month/year boundaries correctly', () => {
    expect(addDaysToYmd('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDaysToYmd('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('rolls across the DST transition without skipping/duplicating a calendar day', () => {
    expect(addDaysToYmd('2026-03-26', 1)).toBe('2026-03-27');
    expect(addDaysToYmd('2026-10-24', 1)).toBe('2026-10-25');
  });
});
