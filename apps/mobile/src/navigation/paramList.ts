import type { AdminCustomerListItem } from '../services/admin.api';

/** Param list for the Drawer navigator — shared by screens and navigator definition. */
export type RootDrawerParamList = {
  Home: undefined;
  Team: undefined;
  Directions: undefined;
  Booking: {
    /** Pre-select barber when opening from Team (or deep link). Cleared after apply. */
    initialStaffId?: string;
    /** Open from waitlist slot push — pre-fills staff/service/date/time after verifying offer is still pending. */
    waitlistOfferId?: string;
    editAppointment?: {
      appointmentId: string;
      staffId: string;
      branchId: string;
      serviceId: string;
      date: string;
      time: string;
    };
  };
  Appointments: undefined;
  Profile: undefined;
  Settings: undefined;
  Notifications: undefined;
  Dashboard: undefined;
  StaffDashboard: undefined;
  StaffWorkingHours: { focusWorkingHours?: boolean };
  StaffBlockedTimes: undefined;
  AdminBlockedTimes: { staffId?: string } | undefined;
  StaffAppointments: undefined;
  StaffWaitlist: undefined;
  Admin: { tab?: 'staff' | 'services' | 'branches' | 'workdays' };
  AdminStaffSchedule:
    | { staffId?: string; date?: string; returnTo?: keyof RootDrawerParamList; mode?: 'add' }
    | undefined;
  AdminProducts: undefined;
  AdminCustomers: undefined;
  AdminCustomerDetails: {
    customerId: string;
    initialSummary?: AdminCustomerListItem;
  };
  AdminWaitlist: undefined;
  AdminStaffReport: { staffId: string; staffName?: string; returnTo?: 'hub' | 'adminStaff' };
  AdminStaffReportHub: undefined;
  StaffReport: undefined;
  StaffStories: { variant?: 'staff' } | undefined;
  AdminStories: { variant?: 'admin' } | undefined;
  Login: undefined;
  Register: undefined;
  VerifyOtp: {
    phoneNumber?: string;
    firstName?: string;
    lastName?: string;
    birthDate?: string;
    otpCodeLength?: number;
    resendAvailableAt?: string;
  };
  LegalDocument: { document: 'terms' | 'privacy' | 'accessibility'; returnTo: 'Profile' | 'Settings' };
  AboutApp: { returnTo: 'Profile' | 'Settings' };
};
