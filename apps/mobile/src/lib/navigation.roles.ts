/**
 * Role-based navigation and menu configuration.
 * Single source of truth for which screens belong to which role.
 */

import type { Role } from './roles';

export type ScreenName =
  | 'Home'
  | 'Team'
  | 'Directions'
  | 'Booking'
  | 'Appointments'
  | 'Profile'
  | 'Settings'
  | 'Notifications'
  | 'Dashboard'
  | 'StaffDashboard'
  | 'StaffWorkingHours'
  | 'StaffBlockedTimes'
  | 'StaffAppointments'
  | 'StaffWaitlist'
  | 'StaffStories'
  | 'Admin'
  | 'AdminStaffSchedule'
  | 'AdminProducts'
  | 'AdminCustomers'
  | 'AdminCustomerDetails'
  | 'AdminBlockedTimes'
  | 'AdminWaitlist'
  | 'AdminStaffReport'
  | 'AdminStaffReportHub'
  | 'StaffReport'
  | 'AdminStories'
  | 'Login'
  | 'Register'
  | 'VerifyOtp';

/** Screens that require admin role. Guarded in screen; redirect if not admin. */
export const ADMIN_ONLY_SCREENS: ScreenName[] = [
  'Admin',
  'AdminProducts',
  'AdminCustomers',
  'AdminCustomerDetails',
  'AdminWaitlist',
  'AdminStaffReport',
  'AdminStaffReportHub',
  'AdminStories',
];

/** Screens that require admin OR staff. Guarded in screen; redirect if neither. */
export const DASHBOARD_ACCESS_SCREENS: ScreenName[] = ['Dashboard'];

/** Screens that require any logged-in user. Redirect to Login if not. */
export const AUTH_REQUIRED_SCREENS: ScreenName[] = ['Booking', 'Appointments', 'Notifications'];

/** Screens that are shared (auth flow). No role restriction. */
export const AUTH_FLOW_SCREENS: ScreenName[] = ['Login', 'Register', 'VerifyOtp'];

/** Customer-facing screens. Available to all authenticated customers. */
export const CUSTOMER_SCREENS: ScreenName[] = [
  'Home',
  'Team',
  'Directions',
  'Booking',
  'Appointments',
  'Profile',
  'Settings',
  'Notifications',
];

export type MenuItemTarget = {
  name?: ScreenName;
  isDashboard?: boolean;
  /** When isDashboard: which dashboard to open (admin vs staff are separate). */
  dashboardTarget?: 'admin' | 'staff';
  isLogout?: boolean;
  /** Navigation params when name is set (e.g. { focusWorkingHours: true }) */
  params?: Record<string, unknown>;
};

export interface DrawerMenuItem {
  id: string;
  /** i18n key under `nav.*` */
  titleKey: string;
  icon: string;
  target: MenuItemTarget;
  badge?: number | null;
  /** Role required to see this item. Empty = all. */
  roles?: Role[];
}

/** Base menu items for all roles. Role-specific items are appended. */
const BASE_MENU_ITEMS: DrawerMenuItem[] = [
  { id: '1', titleKey: 'nav.home', icon: 'home', target: { name: 'Home' } },
  { id: '2', titleKey: 'nav.team', icon: 'people', target: { name: 'Team' } },
  { id: '3', titleKey: 'nav.booking', icon: 'calendar', target: { name: 'Booking' } },
  { id: '4', titleKey: 'nav.appointments', icon: 'list', target: { name: 'Appointments' } },
  { id: '6', titleKey: 'nav.notifications', icon: 'notifications', target: { name: 'Notifications' } },
  { id: '5', titleKey: 'nav.directions', icon: 'location', target: { name: 'Directions' } },
  { id: '7', titleKey: 'nav.settings', icon: 'settings', target: { name: 'Settings' } },
];

/** Admin: management dashboard (separate from staff operational dashboard). */
const ADMIN_FIRST_ITEMS: DrawerMenuItem[] = [
  {
    id: '0',
    titleKey: 'nav.adminDashboard',
    icon: 'grid-outline',
    target: { isDashboard: true, dashboardTarget: 'admin' },
  },
];

/** Staff: operational dashboard (requires linked staff profile, not merely admin). */
const STAFF_FIRST_ITEMS: DrawerMenuItem[] = [
  {
    id: '0b',
    titleKey: 'nav.staffDashboard',
    icon: 'calendar-outline',
    target: { isDashboard: true, dashboardTarget: 'staff' },
  },
];

export type DrawerMenuCapabilities = {
  isAdmin: boolean;
  hasStaffProfile: boolean;
  isLoggedIn: boolean;
  badges: { upcomingCount: number; unreadCount: number };
};

function applyMenuBadges(
  items: DrawerMenuItem[],
  badges: { upcomingCount: number; unreadCount: number }
): DrawerMenuItem[] {
  return items.map((item) => {
    if (item.id === '4') return { ...item, badge: badges.upcomingCount > 0 ? badges.upcomingCount : null };
    if (item.id === '6') return { ...item, badge: badges.unreadCount > 0 ? badges.unreadCount : null };
    return item;
  });
}

/** Drawer menu: admin and staff entries can both appear when the account has both capabilities. */
export function getDrawerMenuItems(caps: DrawerMenuCapabilities): DrawerMenuItem[] {
  const items: DrawerMenuItem[] = [];
  const showOps = caps.isAdmin || caps.hasStaffProfile;
  if (showOps && caps.isAdmin) items.push(...ADMIN_FIRST_ITEMS);
  if (showOps && caps.hasStaffProfile) items.push(...STAFF_FIRST_ITEMS);
  items.push(...BASE_MENU_ITEMS);
  if (caps.isLoggedIn) {
    items.push({ id: '8', titleKey: 'nav.logout', icon: 'log-out', target: { isLogout: true } });
  }
  return applyMenuBadges(items, caps.badges);
}

/** @deprecated Prefer getDrawerMenuItems (supports admin + staff on one account). */
export function getMenuItemsForRole(
  role: Role,
  isLoggedIn: boolean,
  badges: { upcomingCount: number; unreadCount: number }
): DrawerMenuItem[] {
  return getDrawerMenuItems({
    isAdmin: role === 'admin',
    hasStaffProfile: role === 'staff',
    isLoggedIn,
    badges,
  });
}

/** Operational dashboards (admin management or staff profile). */
export function canAccessDashboardCaps(isAdmin: boolean, hasStaffProfile: boolean): boolean {
  return isAdmin || hasStaffProfile;
}

/** Can this role access Dashboard? (Legacy: single primary role.) */
export function canAccessDashboard(role: Role): boolean {
  return role === 'admin' || role === 'staff';
}

/** Can this role access Admin screen? */
export function canAccessAdmin(role: Role): boolean {
  return role === 'admin';
}

/** Does this screen require auth (any logged-in user)? */
export function isAuthRequiredScreen(name: ScreenName): boolean {
  return AUTH_REQUIRED_SCREENS.includes(name);
}
