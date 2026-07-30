import type { AuthUser } from '../services/auth.api';

export type Role = 'customer' | 'staff' | 'admin';

/** Use role from backend when present; fallback to derived for legacy responses. */
export function getRole(user: AuthUser | null): Role {
  if (!user) return 'customer';
  if (user.role) return user.role;
  if (user.isAdmin) return 'admin';
  if (user.staffId) return 'staff';
  return 'customer';
}

/** All roles on the account (admin + staff can coexist). */
export function getRoles(user: AuthUser | null): Role[] {
  if (!user) return ['customer'];
  if (user.roles?.length) return user.roles;
  return [getRole(user)];
}

export function isAdmin(user: AuthUser | null): boolean {
  return !!user?.isAdmin;
}

/** Linked active staff profile — operational staff features and staff dashboard; independent of admin. */
export function hasStaffProfile(user: AuthUser | null): boolean {
  return !!user?.staffId;
}

/** Same as hasStaffProfile: can use staff app surfaces (not “role === staff” only). */
export function isStaff(user: AuthUser | null): boolean {
  return hasStaffProfile(user);
}

/** Account is only a customer (no admin and no staff profile). */
export function isPureCustomer(user: AuthUser | null): boolean {
  return !!user && !user.isAdmin && !user.staffId;
}

/** @deprecated Prefer isPureCustomer; kept for gradual migration. */
export function isCustomer(user: AuthUser | null): boolean {
  return isPureCustomer(user);
}
