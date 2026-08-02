import { buildAddAppointmentRoute } from '../src/lib/adminAddAppointmentRoute';

/**
 * Regression coverage for the dashboard's "Add appointment" row. It used to navigate straight to
 * the customer `Booking` screen, which books under the *caller's own* profile/phone — wrong for
 * an admin scheduling a walk-in client who has no app account. The row now routes through this
 * pure function; these tests pin its result to the admin walk-in flow (`AdminStaffSchedule`) so a
 * future edit can't silently point it back at `Booking`.
 */
describe('buildAddAppointmentRoute', () => {
  const staffList = [
    { id: 'staff-1', name: 'Alice' },
    { id: 'staff-2', name: 'Bob' },
  ];

  it('routes to the admin walk-in flow, not the customer Booking screen', () => {
    const route = buildAddAppointmentRoute(staffList, '2026-08-02');
    expect(route?.screen).toBe('AdminStaffSchedule');
    expect(route?.screen).not.toBe('Booking');
  });

  it('does not pre-select a staff member when there is a real choice to make', () => {
    const route = buildAddAppointmentRoute(staffList, '2026-08-02');
    expect(route).toEqual({
      screen: 'AdminStaffSchedule',
      params: { staffId: undefined, date: '2026-08-02', returnTo: 'Dashboard', mode: 'add' },
    });
  });

  it('auto-selects the only staff member when there is no real choice to make', () => {
    const route = buildAddAppointmentRoute([{ id: 'staff-1', name: 'Alice' }], '2026-08-02');
    expect(route).toEqual({
      screen: 'AdminStaffSchedule',
      params: { staffId: 'staff-1', date: '2026-08-02', returnTo: 'Dashboard', mode: 'add' },
    });
  });

  it('returns null when there is no staff to book against at all', () => {
    expect(buildAddAppointmentRoute([], '2026-08-02')).toBeNull();
  });

  it('always sets returnTo to Dashboard and mode to add, and carries the given date through unchanged', () => {
    const route = buildAddAppointmentRoute(staffList, '2026-12-25');
    expect(route?.params.returnTo).toBe('Dashboard');
    expect(route?.params.mode).toBe('add');
    expect(route?.params.date).toBe('2026-12-25');
  });
});
