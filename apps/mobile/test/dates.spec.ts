import { israelDateTimeToEpochMs, getTodayDateString, israelNowMinutesSinceMidnight } from '../src/utils/dates';

/**
 * Mirrors apps/api/test/israel-time.spec.ts for the mobile copy of this logic. Also specifically
 * proves the fix for the audit's flagged Hermes risk: the old implementation round-tripped an
 * instant through `toLocaleString(...)` + `new Date(string)`, a shape `Date.parse` isn't
 * guaranteed to understand on every engine. The current implementation never parses a date
 * string at all (formatToParts + Date.UTC only), so it can't have that failure mode on any
 * spec-compliant engine, Hermes included — this suite runs under whatever engine executes `jest`
 * (V8/Node here), which exercises the same code path Hermes would run on-device.
 */
describe('israelDateTimeToEpochMs (mobile)', () => {
  it('converts a winter (IST, UTC+2) local time correctly', () => {
    expect(israelDateTimeToEpochMs('2026-01-15', '12:00')).toBe(Date.UTC(2026, 0, 15, 10, 0, 0));
  });

  it('converts a summer (IDT, UTC+3) local time correctly', () => {
    expect(israelDateTimeToEpochMs('2026-07-15', '12:00')).toBe(Date.UTC(2026, 6, 15, 9, 0, 0));
  });

  it('handles the spring-forward DST boundary (2026-03-27)', () => {
    const dayBefore = israelDateTimeToEpochMs('2026-03-26', '12:00');
    const dayOf = israelDateTimeToEpochMs('2026-03-27', '12:00');
    expect(dayBefore).toBe(Date.UTC(2026, 2, 26, 10, 0, 0));
    expect(dayOf).toBe(Date.UTC(2026, 2, 27, 9, 0, 0));
    expect(dayOf - dayBefore).toBe(23 * 60 * 60 * 1000);
  });

  it('handles the fall-back DST boundary (2026-10-25)', () => {
    const dayBefore = israelDateTimeToEpochMs('2026-10-24', '12:00');
    const dayOf = israelDateTimeToEpochMs('2026-10-25', '12:00');
    expect(dayBefore).toBe(Date.UTC(2026, 9, 24, 9, 0, 0));
    expect(dayOf).toBe(Date.UTC(2026, 9, 25, 10, 0, 0));
    expect(dayOf - dayBefore).toBe(25 * 60 * 60 * 1000);
  });

  it('handles the midnight calendar-date boundary without shifting the selected date', () => {
    const justBeforeMidnight = israelDateTimeToEpochMs('2026-07-22', '23:59');
    const justAfterMidnight = israelDateTimeToEpochMs('2026-07-23', '00:00');
    expect(justAfterMidnight - justBeforeMidnight).toBe(60 * 1000);
  });

  it('is independent of the device timezone — required scenario #9', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Jerusalem';
      const israelHost = israelDateTimeToEpochMs('2026-07-23', '09:00');
      process.env.TZ = 'Pacific/Kiritimati';
      expect(israelDateTimeToEpochMs('2026-07-23', '09:00')).toBe(israelHost);
      process.env.TZ = 'America/Los_Angeles';
      expect(israelDateTimeToEpochMs('2026-07-23', '09:00')).toBe(israelHost);
    } finally {
      process.env.TZ = original;
    }
  });

  it('never returns NaN for a well-formed date/time (the exact failure mode the old implementation risked on Hermes)', () => {
    const cases: [string, string][] = [
      ['2026-01-01', '00:00'],
      ['2026-03-27', '10:00'],
      ['2026-10-25', '10:00'],
      ['2026-12-31', '23:59'],
    ];
    for (const [d, t] of cases) {
      expect(Number.isNaN(israelDateTimeToEpochMs(d, t))).toBe(false);
    }
  });
});

describe('getTodayDateString / israelNowMinutesSinceMidnight (mobile)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rolls over to the next Israel calendar date before UTC midnight (winter, UTC+2)', () => {
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 15, 22, 30, 0)));
    expect(getTodayDateString()).toBe('2026-01-16');
    expect(israelNowMinutesSinceMidnight()).toBe(30);
  });
});
