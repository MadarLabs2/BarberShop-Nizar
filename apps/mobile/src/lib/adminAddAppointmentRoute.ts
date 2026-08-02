/**
 * Pure routing decision for the dashboard's "Add appointment" row — kept dependency-free (no
 * React Native imports) so it's unit-testable without RN rendering infra. Must always resolve to
 * the admin walk-in booking flow (AdminStaffSchedule), never the customer Booking screen: the
 * customer flow books under the *caller's own* profile/phone, which is wrong for an admin
 * scheduling a walk-in client who doesn't use the app.
 *
 * With more than one staff member, deliberately does NOT pre-select one — the screen shows a
 * staff picker and the admin explicitly chooses who the appointment is for. With exactly one
 * staff member there's no real choice to make, so it's selected automatically.
 */
export type AddAppointmentRoute = {
  screen: 'AdminStaffSchedule';
  params: { staffId?: string; date: string; returnTo: 'Dashboard' };
} | null;

/** `null` only when there is truly no staff to book against yet (e.g. brand-new shop, no staff added). */
export function buildAddAppointmentRoute(
  staffList: { id: string; name: string }[],
  todayDateStr: string,
): AddAppointmentRoute {
  if (staffList.length === 0) return null;
  const staffId = staffList.length === 1 ? staffList[0].id : undefined;
  return { screen: 'AdminStaffSchedule', params: { staffId, date: todayDateStr, returnTo: 'Dashboard' } };
}
