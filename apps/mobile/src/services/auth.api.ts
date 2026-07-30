import { apiFetch } from './api';

export type Role = 'customer' | 'staff' | 'admin';

export type AuthUser = {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  isAdmin: boolean;
  avatarUrl?: string | null;
  /** Present when profile is linked to staff (staff.profile_id). Booking uses staff rows, not admin flag. */
  staffId?: string;
  /** Admin-granted: this staff member may manage their own blocked time slots. */
  canBlockOwnTime?: boolean;
  /** Admin-granted: this staff member may manage their own working days/hours. */
  canSetOwnWorkingHours?: boolean;
  /** All roles (admin and staff may both appear). Omitted in legacy stored users. */
  roles?: Role[];
  /** Primary shell from API: admin > staff > customer. Omitted in legacy stored users. */
  role?: Role;
};

export async function checkRegistered(phone: string): Promise<boolean> {
  const { registered } = await apiFetch<{ registered: boolean }>('/auth/check-registered', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
  return registered;
}

export async function register(params: {
  phone: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
}): Promise<{ ok: true; phone: string }> {
  return apiFetch<{ ok: true; phone: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      phone: params.phone,
      firstName: params.firstName,
      lastName: params.lastName,
      birthDate: params.birthDate,
    }),
  });
}

export type RequestOtpResponse = {
  ok: true;
  resendAvailableAt: string;
  otpCodeLength: number;
  devCode?: string;
};

export async function requestOtp(phone: string): Promise<RequestOtpResponse> {
  return apiFetch<RequestOtpResponse>('/auth/request-otp', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
}

export async function verifyOtp(
  phone: string,
  code: string,
  registration?: { firstName?: string; lastName?: string; birthDate?: string },
): Promise<{ user: AuthUser; token: string }> {
  return apiFetch<{ user: AuthUser; token: string }>('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({
      phone,
      code,
      ...(registration?.firstName != null ? { firstName: registration.firstName } : {}),
      ...(registration?.lastName != null ? { lastName: registration.lastName } : {}),
      ...(registration?.birthDate != null ? { birthDate: registration.birthDate } : {}),
    }),
  });
}

export async function getMe(token: string): Promise<AuthUser> {
  const { user } = await apiFetch<{ user: AuthUser }>('/auth/me', {
    token,
  });
  return user;
}

/** Server invalidates the stored api_token; safe to call even if network fails (client still clears local). */
export async function logoutSession(token: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/auth/logout', {
    method: 'POST',
    token,
  });
}

export async function deleteAccountSession(token: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/auth/me', {
    method: 'DELETE',
    token,
  });
}
