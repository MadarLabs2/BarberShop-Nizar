import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { BookingsController } from '../src/bookings';
import { SupabaseService } from '../src/core/supabase';
import { NotificationsService } from '../src/notifications';
import { WaitlistService } from '../src/waitlist/waitlist.service';
import { CacheService } from '../src/core/cache.service';
import { TokenAuthGuard } from '../src/auth/auth.guard';
import { israelTodayYmd, addDaysToYmd, dayOfWeekForYmd } from '../src/core/israel-time';
import type { UserPayload } from '../src/auth';

/** These tests call controller methods directly (bypassing the HTTP/guard pipeline entirely), so
 * the real guards' own dependency chains (AuthService, ThrottlerStorage, ...) are irrelevant here
 * — only that the module compiles. Overriding them is the documented NestJS testing pattern for
 * exactly this. */
const alwaysAllowGuard = { canActivate: () => true };

/**
 * Minimal in-memory fake of the Supabase query builder: supports the chain methods this
 * controller actually uses (.select/.eq/.neq/.gte/.lte/.in/.is/.order/.limit/.maybeSingle/
 * .single, plus a bare await resolving like a list query), applying real filtering against
 * fixture rows so tests exercise the controller's actual query construction, not just its
 * branching. `.rpc()` is a plain jest.fn() configured per test.
 */
function makeFakeSupabaseClient(tables: Record<string, Record<string, unknown>[]>) {
  function builder(tableName: string) {
    let rows = [...(tables[tableName] ?? [])];
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      select: () => chain,
      order: () => chain,
      range: () => chain,
      or: () => chain,
      eq: (col: unknown, val: unknown) => {
        rows = rows.filter((r) => r[col as string] === val);
        return chain;
      },
      neq: (col: unknown, val: unknown) => {
        rows = rows.filter((r) => r[col as string] !== val);
        return chain;
      },
      gte: (col: unknown, val: unknown) => {
        rows = rows.filter((r) => (r[col as string] as string) >= (val as string));
        return chain;
      },
      lte: (col: unknown, val: unknown) => {
        rows = rows.filter((r) => (r[col as string] as string) <= (val as string));
        return chain;
      },
      in: (col: unknown, vals: unknown) => {
        rows = rows.filter((r) => (vals as unknown[]).includes(r[col as string]));
        return chain;
      },
      is: (col: unknown, val: unknown) => {
        rows = rows.filter((r) => (val === null ? r[col as string] == null : r[col as string] === val));
        return chain;
      },
      limit: (n: unknown) => {
        rows = rows.slice(0, n as number);
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () =>
        rows[0]
          ? Promise.resolve({ data: rows[0], error: null })
          : Promise.resolve({ data: null, error: { message: 'no rows' } }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return chain;
  }
  return {
    from: (tableName: string) => builder(tableName),
    rpc: jest.fn(),
  };
}

const BRANCH_ID = 'branch-1';
const STAFF_ID = 'staff-1';
const SERVICE_ID = 'service-1';
const CUSTOMER_ID = 'customer-1';

const user: UserPayload = {
  id: CUSTOMER_ID,
  phone: '0501234567',
  firstName: 'דני',
  lastName: 'כהן',
} as UserPayload;

function baseTables(dateStr: string, dow: number, overrides: Partial<Record<string, Record<string, unknown>[]>> = {}) {
  return {
    services: [{ id: SERVICE_ID, name: 'תספורת', is_active: true }],
    staff_service: [{ staff_id: STAFF_ID, service_id: SERVICE_ID, price: 100, duration: 40 }],
    branch_staff: [{ staff_id: STAFF_ID, branch_id: BRANCH_ID }],
    staff: [{ id: STAFF_ID, name: 'יוסי', is_active: true }],
    branches: [{ id: BRANCH_ID, name: 'סניף מרכזי', is_active: true }],
    staff_working_days: [{ staff_id: STAFF_ID, day_of_week: dow, start_time: '09:00', end_time: '19:00' }],
    appointments: [],
    blocked_slots: [],
    ...overrides,
  };
}

async function buildController(tables: Record<string, Record<string, unknown>[]>) {
  const fakeClient = makeFakeSupabaseClient(tables);
  const fakeSupabase = { getClient: () => fakeClient };
  const fakeNotifications = { create: jest.fn().mockResolvedValue(true) };
  const fakeWaitlist = {
    fulfillIfMatched: jest.fn().mockResolvedValue(undefined),
    afterBookingCreatedForSlot: jest.fn().mockResolvedValue(undefined),
    notifyFreedSlot: jest.fn().mockResolvedValue(undefined),
    getPendingOfferForUser: jest.fn(),
    explainNonPendingOffer: jest.fn(),
  };
  const fakeCache = {
    getOrSet: (_key: string, _ttl: number, loader: () => unknown) => loader(),
    invalidateAdminSummary: jest.fn().mockResolvedValue(undefined),
    invalidateBookingsSlotsForStaffDate: jest.fn().mockResolvedValue(undefined),
    invalidateBookingsSlotsForStaff: jest.fn().mockResolvedValue(undefined),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [BookingsController],
    providers: [
      { provide: SupabaseService, useValue: fakeSupabase },
      { provide: NotificationsService, useValue: fakeNotifications },
      { provide: WaitlistService, useValue: fakeWaitlist },
      { provide: CacheService, useValue: fakeCache },
    ],
  })
    .overrideGuard(TokenAuthGuard)
    .useValue(alwaysAllowGuard)
    .overrideGuard(ThrottlerGuard)
    .useValue(alwaysAllowGuard)
    .compile();

  const controller = moduleRef.get(BookingsController);
  return { controller, fakeClient, fakeWaitlist };
}

describe('BookingsController — required booking scenarios', () => {
  const tomorrow = addDaysToYmd(israelTodayYmd(), 1);
  const dow = dayOfWeekForYmd(tomorrow);

  it('#14 — GET /bookings/slots returns no slots for a closed branch, even though staff schedule says available', async () => {
    const { controller } = await buildController(
      baseTables(tomorrow, dow, { branches: [{ id: BRANCH_ID, name: 'סניף מרכזי', is_active: false }] }),
    );
    await expect(controller.getAvailableSlots(STAFF_ID, tomorrow, SERVICE_ID, BRANCH_ID)).rejects.toThrow(
      'Branch not available',
    );
  });

  it('#13 — GET /bookings/slots rejects an unavailable staff member while the branch stays open', async () => {
    const { controller } = await buildController(
      baseTables(tomorrow, dow, { staff: [{ id: STAFF_ID, name: 'יוסי', is_active: false }] }),
    );
    await expect(controller.getAvailableSlots(STAFF_ID, tomorrow, SERVICE_ID, BRANCH_ID)).rejects.toThrow(
      'Staff not available',
    );
  });

  it('#14 — POST /bookings (create) is rejected for a closed branch', async () => {
    const { controller } = await buildController(
      baseTables(tomorrow, dow, { branches: [{ id: BRANCH_ID, name: 'סניף מרכזי', is_active: false }] }),
    );
    await expect(
      controller.create(user, { branchId: BRANCH_ID, staffId: STAFF_ID, serviceId: SERVICE_ID, date: tomorrow, time: '10:00' }),
    ).rejects.toThrow('Branch not available');
  });

  describe('closing time is the last valid start, not the last valid finish (shift 09:00-19:00)', () => {
    it('offers 19:00 as the final slot for a 40-minute service', async () => {
      const { controller } = await buildController(baseTables(tomorrow, dow));
      const { slots } = await controller.getAvailableSlots(STAFF_ID, tomorrow, SERVICE_ID, BRANCH_ID);
      expect(slots[slots.length - 1]).toBe('19:00');
      expect(slots).not.toContain('19:10'); // no start past closing, even though the grid steps by 40
    });

    it('offers 19:00 as the final slot for a 50-minute service', async () => {
      const { controller } = await buildController(
        baseTables(tomorrow, dow, {
          staff_service: [{ staff_id: STAFF_ID, service_id: SERVICE_ID, price: 100, duration: 50 }],
        }),
      );
      const { slots } = await controller.getAvailableSlots(STAFF_ID, tomorrow, SERVICE_ID, BRANCH_ID);
      expect(slots[slots.length - 1]).toBe('19:00');
      expect(slots).not.toContain('19:10');
    });

    it('allows creating a 40-minute booking starting exactly at closing time, even though it finishes after close', async () => {
      const { controller, fakeClient } = await buildController(baseTables(tomorrow, dow));
      (fakeClient.rpc as jest.Mock).mockResolvedValueOnce({
        data: [
          {
            id: 'new-apt-at-close',
            date: tomorrow,
            time: '19:00',
            service_name: 'תספורת',
            staff_name: 'יוסי',
            branch_name: 'סניף מרכזי',
            price: 100,
            created_at: new Date().toISOString(),
          },
        ],
        error: null,
      });
      const result = await controller.create(user, {
        branchId: BRANCH_ID,
        staffId: STAFF_ID,
        serviceId: SERVICE_ID,
        date: tomorrow,
        time: '19:00',
      });
      expect((result as { id: string }).id).toBe('new-apt-at-close');
    });

    it('allows creating a 50-minute booking starting exactly at closing time, even though it finishes after close', async () => {
      const { controller, fakeClient } = await buildController(
        baseTables(tomorrow, dow, {
          staff_service: [{ staff_id: STAFF_ID, service_id: SERVICE_ID, price: 100, duration: 50 }],
        }),
      );
      (fakeClient.rpc as jest.Mock).mockResolvedValueOnce({
        data: [
          {
            id: 'new-apt-50-at-close',
            date: tomorrow,
            time: '19:00',
            service_name: 'תספורת',
            staff_name: 'יוסי',
            branch_name: 'סניף מרכזי',
            price: 100,
            created_at: new Date().toISOString(),
          },
        ],
        error: null,
      });
      const result = await controller.create(user, {
        branchId: BRANCH_ID,
        staffId: STAFF_ID,
        serviceId: SERVICE_ID,
        date: tomorrow,
        time: '19:00',
      });
      expect((result as { id: string }).id).toBe('new-apt-50-at-close');
    });

    it('still rejects a booking that starts after closing time', async () => {
      const { controller } = await buildController(baseTables(tomorrow, dow));
      await expect(
        controller.create(user, { branchId: BRANCH_ID, staffId: STAFF_ID, serviceId: SERVICE_ID, date: tomorrow, time: '19:10' }),
      ).rejects.toThrow('השעה שבחרת חורגת משעות העבודה של איש הצוות');
    });
  });

  it('#6 — rescheduling into an occupied slot maps the DB exclusion-constraint error to the friendly message', async () => {
    const existingAppointmentId = 'apt-being-rescheduled';
    const { controller, fakeClient } = await buildController(
      baseTables(tomorrow, dow, {
        appointments: [
          { id: existingAppointmentId, staff_id: STAFF_ID, date: tomorrow, time: '09:00:00', status: 'confirmed', profile_id: CUSTOMER_ID, client_phone: null },
        ],
      }),
    );
    (fakeClient.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { code: '23P01', message: 'exclusion violation' },
    });

    await expect(
      controller.updateMyAppointment(user, existingAppointmentId, {
        branchId: BRANCH_ID,
        staffId: STAFF_ID,
        serviceId: SERVICE_ID,
        date: tomorrow,
        time: '10:00',
      }),
    ).rejects.toThrow('השעה נתפסה על ידי לקוח אחר');

    expect(fakeClient.rpc).toHaveBeenCalledWith(
      'create_or_reschedule_appointment',
      expect.objectContaining({ p_id: existingAppointmentId }),
    );
  });

  it('#6b — rescheduling that would exceed the 2-upcoming-appointments cap maps to the limit message (not a generic failure)', async () => {
    const existingAppointmentId = 'apt-being-rescheduled';
    const { controller, fakeClient } = await buildController(
      baseTables(tomorrow, dow, {
        appointments: [
          { id: existingAppointmentId, staff_id: STAFF_ID, date: tomorrow, time: '09:00:00', status: 'confirmed', profile_id: CUSTOMER_ID, client_phone: null },
        ],
      }),
    );
    (fakeClient.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'MAX_UPCOMING_APPOINTMENTS' },
    });

    await expect(
      controller.updateMyAppointment(user, existingAppointmentId, {
        branchId: BRANCH_ID,
        staffId: STAFF_ID,
        serviceId: SERVICE_ID,
        date: tomorrow,
        time: '10:00',
      }),
    ).rejects.toThrow('ניתן להחזיק עד שני תורים עתידיים בלבד');
  });

  it('SECURITY — updateMyAppointment checks ownership before ever calling create_or_reschedule_appointment', async () => {
    // migration 043's create_or_reschedule_appointment RPC has no ownership logic of its own —
    // it will rewrite whatever p_id it's given. The only thing preventing a customer from
    // rescheduling someone else's appointment is updateMyAppointment's ownsByPhone/ownsByProfile
    // check running BEFORE createBookingCore (and therefore the RPC) is ever reached. This pins
    // that invariant so a future refactor can't silently drop the check.
    const foreignAppointmentId = 'apt-owned-by-someone-else';
    const { controller, fakeClient } = await buildController(
      baseTables(tomorrow, dow, {
        appointments: [
          {
            id: foreignAppointmentId,
            staff_id: STAFF_ID,
            date: tomorrow,
            time: '09:00:00',
            status: 'confirmed',
            profile_id: 'someone-else-profile',
            client_phone: '0509999999',
          },
        ],
      }),
    );

    await expect(
      controller.updateMyAppointment(user, foreignAppointmentId, {
        branchId: BRANCH_ID,
        staffId: STAFF_ID,
        serviceId: SERVICE_ID,
        date: tomorrow,
        time: '10:00',
      }),
    ).rejects.toThrow('Not your appointment');

    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it('#12 — a blocked-slot conflict (SLOT_BLOCKED from migration 043) maps to the friendly "slot taken" message on create', async () => {
    const { controller, fakeClient } = await buildController(baseTables(tomorrow, dow));
    (fakeClient.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'SLOT_BLOCKED' },
    });

    await expect(
      controller.create(user, { branchId: BRANCH_ID, staffId: STAFF_ID, serviceId: SERVICE_ID, date: tomorrow, time: '10:00' }),
    ).rejects.toThrow('השעה נתפסה על ידי לקוח אחר');

    expect(fakeClient.rpc).toHaveBeenCalledWith(
      'create_or_reschedule_appointment',
      expect.objectContaining({ p_id: null }),
    );
  });

  it('#8 — a cancelled appointment at the same time does not block a fresh booking', async () => {
    const { controller, fakeClient } = await buildController(
      baseTables(tomorrow, dow, {
        appointments: [{ id: 'old-cancelled', staff_id: STAFF_ID, date: tomorrow, time: '10:00:00', status: 'cancelled' }],
      }),
    );
    (fakeClient.rpc as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 'new-apt',
          date: tomorrow,
          time: '10:00',
          service_name: 'תספורת',
          staff_name: 'יוסי',
          branch_name: 'סניף מרכזי',
          price: 100,
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    const result = await controller.create(user, {
      branchId: BRANCH_ID,
      staffId: STAFF_ID,
      serviceId: SERVICE_ID,
      date: tomorrow,
      time: '10:00',
    });
    expect((result as { id: string }).id).toBe('new-apt');
  });

  it('#15 — accepting a waitlist offer after the slot was taken surfaces the distinct waitlist message', async () => {
    const { controller, fakeClient, fakeWaitlist } = await buildController(baseTables(tomorrow, dow));
    (fakeWaitlist.getPendingOfferForUser as jest.Mock).mockResolvedValueOnce({
      id: 'offer-1',
      branch_id: BRANCH_ID,
      staff_id: STAFF_ID,
      service_id: SERVICE_ID,
      date: tomorrow,
      time: '10:00',
    });
    (fakeClient.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate' },
    });

    await expect(controller.acceptWaitlistOffer(user, 'offer-1')).rejects.toThrow(
      'מישהו אחר הספיק לאשר את השעה לפניך',
    );
  });
});
