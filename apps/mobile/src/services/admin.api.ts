import { apiFetch, API_BASE_URL } from './api';
import { callOn401 } from './api.on401';

export type Branch = {
  id: string;
  name: string;
  nameHe: string;
  nameAr: string;
  address: string | null;
  wazeLink: string | null;
  phone: string | null;
  instagramUrl: string | null;
  googleMapsUrl: string | null;
  isActive: boolean;
};
export type Service = {
  id: string;
  name: string;
  nameHe: string;
  nameAr: string;
  price: number;
  duration: number;
  isActive: boolean;
};
export type Staff = {
  id: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  /** Linked app account (profiles.id); same account can be admin + staff. */
  profileId?: string | null;
  /** Admin-granted: staff member may manage their own blocked time slots. */
  canBlockOwnTime: boolean;
  /** Admin-granted: staff member may manage their own working days/hours. */
  canSetOwnWorkingHours: boolean;
};

export type LinkMyStaffProfileResult = Staff & { alreadyLinked: boolean };
export type UnlinkMyStaffProfileResult = { ok: boolean; unlinked: number };

export type DashboardSummary = {
  branches: number;
  services: number;
  staff: number;
  upcomingAppointments: number;
};

export type AdminCatalog = {
  branches: Branch[];
  services: Service[];
  staff: Staff[];
};

export async function getDashboardSummary(token: string): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/admin/summary', { token });
}

export async function getAdminCatalog(token: string): Promise<AdminCatalog> {
  return apiFetch<AdminCatalog>('/admin/catalog', { token });
}

export async function createBranch(
  token: string,
  dto: { nameHe: string; nameAr: string; address?: string; wazeLink?: string; phone?: string; instagramUrl?: string; googleMapsUrl?: string }
): Promise<Branch> {
  return apiFetch<Branch>('/admin/branches', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export async function updateBranch(
  token: string,
  id: string,
  dto: { nameHe?: string; nameAr?: string; address?: string; wazeLink?: string; phone?: string; instagramUrl?: string; googleMapsUrl?: string; isActive?: boolean }
): Promise<Branch> {
  return apiFetch<Branch>(`/admin/branches/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

export async function deleteBranch(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/branches/${id}`, { method: 'DELETE', token });
}

export async function createService(
  token: string,
  dto: { nameHe: string; nameAr: string; price: number; duration: number }
): Promise<Service> {
  return apiFetch<Service>('/admin/services', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export async function updateService(
  token: string,
  id: string,
  dto: { nameHe?: string; nameAr?: string; price?: number; duration?: number; isActive?: boolean }
): Promise<Service> {
  return apiFetch<Service>(`/admin/services/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

export async function deleteService(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/services/${id}`, { method: 'DELETE', token });
}

export async function createStaff(
  token: string,
  dto: { name: string; phone?: string }
): Promise<Staff> {
  return apiFetch<Staff>('/admin/staff', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

/** Link current admin account to a staff row (no second user). Refresh session with getMe after success. */
export async function linkMyStaffProfile(token: string): Promise<LinkMyStaffProfileResult> {
  return apiFetch<LinkMyStaffProfileResult>('/admin/staff/link-my-profile', {
    method: 'POST',
    body: JSON.stringify({}),
    token,
  });
}

/** Remove staff linkage from current admin account while keeping admin role. */
export async function unlinkMyStaffProfile(token: string): Promise<UnlinkMyStaffProfileResult> {
  return apiFetch<UnlinkMyStaffProfileResult>('/admin/staff/unlink-my-profile', {
    method: 'DELETE',
    token,
  });
}

/** Map API error messages from link-my-profile to i18n. */
export function formatLinkMyStaffProfileError(message: string, tr: (key: string) => string): string {
  const m = typeof message === 'string' ? message : String(message ?? '');
  if (m.includes('PROFILE_PHONE_REQUIRED_FOR_STAFF')) return tr('admin.linkStaffProfileErrPhone');
  if (m.includes('STAFF_PHONE_ALREADY_LINKED')) return tr('admin.linkStaffProfileErrLinked');
  return m;
}

export function formatUnlinkMyStaffProfileError(message: string, tr: (key: string) => string): string {
  const m = typeof message === 'string' ? message : String(message ?? '');
  if (m.includes('STAFF_PROFILE_NOT_LINKED')) return tr('settings.staffProfileUnlinkErrNotLinked');
  return m;
}

export async function updateStaff(
  token: string,
  id: string,
  dto: {
    name?: string;
    phone?: string;
    isActive?: boolean;
    profileId?: string | null;
    avatarUrl?: string | null;
    canBlockOwnTime?: boolean;
    canSetOwnWorkingHours?: boolean;
  }
): Promise<Staff> {
  return apiFetch<Staff>(`/admin/staff/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

/** Upload staff profile photo; updates `staff.avatar_url` on the server. */
export async function uploadStaffAvatar(
  token: string,
  staffId: string,
  localUri: string,
  mimeType?: string | null
): Promise<Staff> {
  const nameFromUri = localUri.split('/').pop() || 'avatar.jpg';
  const ext = nameFromUri.includes('.') ? nameFromUri.split('.').pop()?.toLowerCase() : undefined;
  const mime =
    mimeType ||
    (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg');
  const form = new FormData();
  form.append('file', {
    uri: localUri,
    name: nameFromUri.includes('.') ? nameFromUri : `upload.${ext === 'png' || ext === 'webp' || ext === 'gif' ? ext : 'jpg'}`,
    type: mime,
  } as unknown as Blob);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    // RN fetch typings and TS DOM typings disagree on FormData/AbortSignal here.
    const uploadBody = form as unknown as any;
    const uploadSignal = controller.signal as unknown as any;
    const res = await fetch(`${API_BASE_URL}/admin/staff/${encodeURIComponent(staffId)}/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: uploadBody,
      signal: uploadSignal,
    });
    if (res.status === 401 && token) callOn401();
    if (!res.ok) {
      const raw = await res.text();
      let msg = raw || `Upload failed: ${res.status}`;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.message) msg = Array.isArray(parsed.message) ? parsed.message.join(', ') : String(parsed.message);
      } catch {
        /* use raw */
      }
      throw new Error(msg);
    }
    return (await res.json()) as Staff;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function deleteStaff(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/staff/${id}`, { method: 'DELETE', token });
}

export type UpdateFeedItem = { id: string; clientName: string; serviceName: string; staffName: string; date: string; time: string };
export async function getUpdatesFeed(token: string, limit?: number): Promise<UpdateFeedItem[]> {
  const q = limit != null ? `?limit=${limit}` : '';
  return apiFetch<UpdateFeedItem[]>(`/admin/updates${q}`, { token });
}

export type StaffDateAppointment = {
  id: string;
  clientName: string;
  clientPhone: string | null;
  serviceName: string;
  time: string;
  duration: number;
  date: string;
  _isBlocked?: boolean;
};
export async function getAppointmentsByStaffAndDate(token: string, staffId: string, dateStr: string): Promise<StaffDateAppointment[]> {
  const q = new URLSearchParams({ staffId, date: dateStr });
  return apiFetch<StaffDateAppointment[]>(`/admin/appointments/by-staff-date?${q}`, { token });
}

/** Admin deletes one appointment outright (not a cancel — the row is removed from the database). */
export async function deleteAppointment(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/appointments/${id}`, { method: 'DELETE', token });
}

export type CreatedAdminAppointment = { id: string; date: string; time: string; serviceName: string; price: number };
/** Admin books a walk-in/phone-in appointment for a client who doesn't use the app — no profile_id, just a name (+ optional phone). */
export async function createAppointmentForStaff(
  token: string,
  dto: { staffId: string; branchId: string; serviceId: string; date: string; time: string; clientName: string; clientPhone?: string },
): Promise<CreatedAdminAppointment> {
  return apiFetch<CreatedAdminAppointment>('/admin/appointments', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export type StaffScheduleAppointment = {
  id: string;
  date: string;
  time: string;
  clientName: string;
  clientPhone: string | null;
  serviceName: string;
  duration: number;
  branchName: string;
  status: string;
  _isBlocked?: boolean;
};
export async function getStaffSchedule(
  token: string,
  staffId: string,
  from: string,
  to: string,
): Promise<StaffScheduleAppointment[]> {
  const q = new URLSearchParams({ staffId, from, to });
  return apiFetch<StaffScheduleAppointment[]>(`/admin/staff-schedule?${q}`, { token });
}

export type MyStaffAppointment = {
  id: string;
  serviceName: string;
  staffName: string;
  branchName: string;
  date: string;
  time: string;
  clientName: string;
  clientPhone: string | null;
  duration: number;
  status: string;
};
export async function getMyStaffAppointments(token: string): Promise<MyStaffAppointment[]> {
  return apiFetch<MyStaffAppointment[]>('/admin/my-staff-appointments', { token });
}

export type MyBlockedSlot = { id: string; date: string; time: string; duration: number };

/** Admin-only: manage blocked time slots for any staff member (staffId explicit — not inferred from token). */
export async function getBlockedSlots(
  token: string,
  staffId: string,
  from?: string,
  to?: string,
): Promise<MyBlockedSlot[]> {
  const params = new URLSearchParams({ staffId });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return apiFetch<MyBlockedSlot[]>(`/admin/blocked-slots?${params}`, { token });
}
export async function addBlockedSlot(
  token: string,
  dto: { staffId: string; date: string; startTime: string; endTime: string },
) {
  return apiFetch<{ id: string; cancelledAppointments?: number }>('/admin/blocked-slots', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}
export async function removeBlockedSlot(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/blocked-slots/${id}`, { method: 'DELETE', token });
}

/** Staff self-service — only reachable if the admin has granted staff.can_block_own_time (server enforces it too). */
export async function getMyBlockedSlots(token: string, from?: string, to?: string): Promise<MyBlockedSlot[]> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const q = params.toString() ? `?${params}` : '';
  return apiFetch<MyBlockedSlot[]>(`/admin/my-blocked-slots${q}`, { token });
}
export async function addMyBlockedSlot(
  token: string,
  dto: { date: string; startTime: string; endTime: string },
) {
  return apiFetch<{ id: string; cancelledAppointments?: number }>('/admin/my-blocked-slots', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}
export async function removeMyBlockedSlot(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/my-blocked-slots/${id}`, { method: 'DELETE', token });
}

export async function addBranchStaff(token: string, branchId: string, staffId: string) {
  return apiFetch<{ id: string }>('/admin/branch-staff', {
    method: 'POST',
    body: JSON.stringify({ branchId, staffId }),
    token,
  });
}
export async function removeBranchStaff(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/branch-staff/${id}`, { method: 'DELETE', token });
}

export type BranchStaffLink = { id: string; branchId: string; staffId: string };
export async function getBranchStaff(token: string): Promise<BranchStaffLink[]> {
  return apiFetch<BranchStaffLink[]>('/admin/branch-staff', { token });
}

export type StaffServiceLink = { id: string; staffId: string; serviceId: string; price: number; duration: number };
export async function getStaffServices(token: string): Promise<StaffServiceLink[]> {
  return apiFetch<StaffServiceLink[]>('/admin/staff-services', { token });
}
export async function addStaffService(token: string, staffId: string, serviceId: string, price: number, duration: number) {
  return apiFetch<{ id: string }>('/admin/staff-services', {
    method: 'POST',
    body: JSON.stringify({ staffId, serviceId, price, duration }),
    token,
  });
}
export async function updateStaffService(token: string, id: string, dto: { price?: number; duration?: number }) {
  return apiFetch<{ ok: boolean }>(`/admin/staff-services/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}
export async function removeStaffService(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/staff-services/${id}`, { method: 'DELETE', token });
}

export type StaffWorkingDayEntry = {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};
export type StaffWorkingDaysMap = Record<string, StaffWorkingDayEntry[]>;
export async function getAllStaffWorkingDays(token: string): Promise<StaffWorkingDaysMap> {
  return apiFetch<StaffWorkingDaysMap>('/admin/staff-working-days', { token });
}

export async function addStaffWorkingDay(
  token: string,
  staffId: string,
  dayOfWeek: number,
  startTime?: string,
  endTime?: string,
) {
  return apiFetch<{ ok: boolean }>('/admin/staff-working-days', {
    method: 'POST',
    body: JSON.stringify({ staffId, dayOfWeek, startTime, endTime }),
    token,
  });
}

export async function updateStaffWorkingDay(
  token: string,
  staffId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
) {
  return apiFetch<{ ok: boolean }>('/admin/staff-working-days', {
    method: 'PATCH',
    body: JSON.stringify({ staffId, dayOfWeek, startTime, endTime }),
    token,
  });
}

export type MyWorkingHoursEntry = { id: string; dayOfWeek: number; startTime: string; endTime: string };
export async function getMyWorkingHours(token: string): Promise<MyWorkingHoursEntry[]> {
  return apiFetch<MyWorkingHoursEntry[]>('/admin/my-working-hours', { token });
}

export async function upsertMyWorkingDay(
  token: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
) {
  return apiFetch<{ ok: boolean; cancelledAppointments?: number }>('/admin/my-working-hours', {
    method: 'PUT',
    body: JSON.stringify({ dayOfWeek, startTime, endTime }),
    token,
  });
}

export async function removeMyWorkingDay(token: string, dayOfWeek: number) {
  return apiFetch<{ ok: boolean; cancelledAppointments?: number }>(`/admin/my-working-hours/${dayOfWeek}`, {
    method: 'DELETE',
    token,
  });
}

/** Remove by staffId+dayOfWeek - use this for toggles (works with optimistic temp ids). */
export async function removeStaffWorkingDayByDay(token: string, staffId: string, dayOfWeek: number) {
  return apiFetch<{ ok: boolean }>('/admin/staff-working-days', {
    method: 'DELETE',
    body: JSON.stringify({ staffId, dayOfWeek }),
    token,
  });
}

export async function createBroadcast(token: string, title: string, body?: string) {
  return apiFetch<{ ok: boolean }>('/admin/broadcast', { method: 'POST', body: JSON.stringify({ title, body }), token });
}

/** In-app notifications only for phones that have an active waitlist row. */
export async function createBroadcastWaitlist(token: string, title: string, body?: string) {
  return apiFetch<{ ok: boolean; sent: number }>('/admin/broadcast/waitlist', {
    method: 'POST',
    body: JSON.stringify({ title, body }),
    token,
  });
}

/** Waitlist notification for one staff member's active waitlist customers. */
export async function createBroadcastWaitlistForStaff(
  token: string,
  staffId: string,
  title: string,
  body?: string,
) {
  return apiFetch<{ ok: boolean; queued: number }>('/admin/broadcast/waitlist/staff', {
    method: 'POST',
    body: JSON.stringify({ staffId, title, body }),
    token,
  });
}

/** Waitlist notification for the signed-in staff member's active waitlist customers. */
export async function createBroadcastWaitlistForMyStaff(token: string, title: string, body?: string) {
  return apiFetch<{ ok: boolean; queued: number }>('/admin/broadcast/waitlist/my-staff', {
    method: 'POST',
    body: JSON.stringify({ title, body }),
    token,
  });
}

export type WaitlistRow = {
  id: string;
  date: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  branchName: string;
  staffId: string;
  staffName: string;
  preferMorning: boolean;
  preferAfternoon: boolean;
  preferEvening: boolean;
  createdAt: string;
};

export type StaffWaitlistRow = Omit<WaitlistRow, 'staffId' | 'staffName'>;

export async function getAdminWaitlist(token: string, staffId?: string): Promise<WaitlistRow[]> {
  const q = staffId ? `?staffId=${encodeURIComponent(staffId)}` : '';
  return apiFetch<WaitlistRow[]>(`/admin/waitlist${q}`, { token });
}

export async function getStaffWaitlist(token: string): Promise<StaffWaitlistRow[]> {
  return apiFetch<StaffWaitlistRow[]>('/admin/waitlist/my-staff', { token });
}

export async function cancelAdminWaitlistEntry(token: string, id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/admin/waitlist/${encodeURIComponent(id)}`, { method: 'DELETE', token });
}

export async function cancelStaffWaitlistEntry(token: string, id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/admin/waitlist/staff/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token,
  });
}

export type AdminProduct = {
  id: string;
  name: string;
  nameHe: string;
  nameAr: string;
  description: string | null;
  descriptionHe: string | null;
  descriptionAr: string | null;
  price: number;
  salePrice: number | null;
  imageUrl: string | null;
  category: string | null;
  stockQuantity: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export async function getAdminProducts(token: string): Promise<AdminProduct[]> {
  return apiFetch<AdminProduct[]>('/admin/products', { token });
}

export async function createProduct(
  token: string,
  dto: {
    nameHe: string;
    nameAr: string;
    descriptionHe?: string;
    descriptionAr?: string;
    price: number;
    salePrice?: number | null;
    imageUrl?: string;
    category?: string;
    stockQuantity?: number;
  },
): Promise<AdminProduct> {
  return apiFetch<AdminProduct>('/admin/products', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export async function updateProduct(
  token: string,
  id: string,
  dto: {
    nameHe?: string;
    nameAr?: string;
    descriptionHe?: string;
    descriptionAr?: string;
    price?: number;
    salePrice?: number | null;
    imageUrl?: string | null;
    category?: string;
    stockQuantity?: number;
    isActive?: boolean;
  },
): Promise<AdminProduct> {
  return apiFetch<AdminProduct>(`/admin/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

export async function deleteProduct(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/products/${id}`, { method: 'DELETE', token });
}

/** Uploads a gallery image to Supabase Storage via API; returns public `imageUrl` for the product row. */
export async function uploadProductImage(token: string, localUri: string, mimeType?: string | null): Promise<string> {
  const nameFromUri = localUri.split('/').pop() || 'photo.jpg';
  const ext = nameFromUri.includes('.') ? nameFromUri.split('.').pop()?.toLowerCase() : undefined;
  const mime =
    mimeType ||
    (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg');
  const form = new FormData();
  form.append('file', {
    uri: localUri,
    name: nameFromUri.includes('.') ? nameFromUri : `upload.${ext === 'png' || ext === 'webp' || ext === 'gif' ? ext : 'jpg'}`,
    type: mime,
  } as unknown as Blob);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    // RN fetch typings and TS DOM typings disagree on FormData/AbortSignal here.
    const uploadBody = form as unknown as any;
    const uploadSignal = controller.signal as unknown as any;
    const res = await fetch(`${API_BASE_URL}/admin/products/upload-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: uploadBody,
      signal: uploadSignal,
    });
    if (res.status === 401 && token) callOn401();
    if (!res.ok) {
      const raw = await res.text();
      let msg = raw || `Upload failed: ${res.status}`;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.message) msg = Array.isArray(parsed.message) ? parsed.message.join(', ') : String(parsed.message);
      } catch {
        /* use raw */
      }
      throw new Error(msg);
    }
    const data = (await res.json()) as { imageUrl: string };
    if (!data?.imageUrl) throw new Error('השרת לא החזיר כתובת תמונה');
    return data.imageUrl;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Registered customers (admin): list item from GET /admin/customers */
export type AdminCustomerListItem = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  birthDate: string | null;
  createdAt: string | null;
  totalAppointments: number;
  upcomingAppointments: number;
  lastAppointmentAt: string | null;
};

export type AdminCustomersPage = {
  items: AdminCustomerListItem[];
  page: number;
  limit: number;
  total: number;
};

export async function getAdminCustomers(
  token: string,
  params?: { search?: string; page?: number; limit?: number },
): Promise<AdminCustomersPage> {
  const q = new URLSearchParams();
  if (params?.search?.trim()) q.set('search', params.search.trim());
  if (params?.page != null) q.set('page', String(params.page));
  if (params?.limit != null) q.set('limit', String(params.limit));
  const qs = q.toString();
  return apiFetch<AdminCustomersPage>(`/admin/customers${qs ? `?${qs}` : ''}`, { token });
}

export type AdminCustomerRecentAppointment = {
  id: string;
  date: string;
  time: string;
  status: string;
  serviceName: string;
  staffName: string;
  branchName: string;
};

export type AdminCustomerDetails = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  birthDate: string | null;
  createdAt: string | null;
  totalAppointments: number;
  upcomingAppointments: number;
  cancelledAppointments: number;
  lastAppointmentAt: string | null;
  recentAppointments: AdminCustomerRecentAppointment[];
};

export async function getAdminCustomerDetails(token: string, customerId: string): Promise<AdminCustomerDetails> {
  return apiFetch<AdminCustomerDetails>(`/admin/customers/${customerId}`, { token });
}

/** Map full details to list row shape (for list sync after edit). */
export function adminCustomerDetailsToListItem(d: AdminCustomerDetails): AdminCustomerListItem {
  return {
    id: d.id,
    firstName: d.firstName,
    lastName: d.lastName,
    fullName: d.fullName,
    phone: d.phone || null,
    birthDate: d.birthDate,
    createdAt: d.createdAt,
    totalAppointments: d.totalAppointments,
    upcomingAppointments: d.upcomingAppointments,
    lastAppointmentAt: d.lastAppointmentAt,
  };
}

export async function patchAdminCustomer(
  token: string,
  customerId: string,
  dto: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    birthDate?: string | null;
  },
): Promise<AdminCustomerDetails> {
  return apiFetch<AdminCustomerDetails>(`/admin/customers/${customerId}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

export async function deleteAdminCustomer(
  token: string,
  customerId: string,
): Promise<{ ok: boolean; id: string }> {
  return apiFetch<{ ok: boolean; id: string }>(`/admin/customers/${customerId}`, {
    method: 'DELETE',
    token,
  });
}

export async function deleteAdminCustomerAppointments(
  token: string,
  customerId: string,
): Promise<{ ok: boolean; deleted: number }> {
  return apiFetch<{ ok: boolean; deleted: number }>(
    `/admin/customers/${customerId}/appointments`,
    {
      method: 'DELETE',
      token,
    }
  );
}

export type StaffPerformanceReport = {
  staffId: string;
  staffName: string;
  from: string;
  to: string;
  generatedAt: string;
  counts: { total: number; confirmed: number; completed: number };
  revenueAgendaShekels: number;
  appointments: {
    id: string;
    date: string;
    time: string;
    clientName: string;
    status: string;
    price: number | null;
  }[];
};

function staffReportQuery(from?: string, to?: string, lang?: 'he' | 'ar'): string {
  const p = new URLSearchParams();
  if (from?.trim()) p.set('from', from.trim());
  if (to?.trim()) p.set('to', to.trim());
  if (lang === 'ar' || lang === 'he') p.set('lang', lang);
  const q = p.toString();
  return q ? `?${q}` : '';
}

export async function getAdminStaffPerformanceReport(
  token: string,
  staffId: string,
  from?: string,
  to?: string,
): Promise<StaffPerformanceReport> {
  return apiFetch<StaffPerformanceReport>(`/admin/staff/${staffId}/report${staffReportQuery(from, to)}`, { token });
}

export async function getMyStaffPerformanceReport(
  token: string,
  from?: string,
  to?: string,
): Promise<StaffPerformanceReport> {
  return apiFetch<StaffPerformanceReport>(`/admin/my-staff-report${staffReportQuery(from, to)}`, { token });
}

export function adminStaffReportPdfPath(staffId: string, from?: string, to?: string, lang?: 'he' | 'ar'): string {
  const q = staffReportQuery(from, to, lang);
  const sep = q ? '&' : '?';
  return `/admin/staff/${staffId}/report.pdf${q}${sep}cb=${Date.now()}`;
}

export function myStaffReportPdfPath(from?: string, to?: string, lang?: 'he' | 'ar'): string {
  const q = staffReportQuery(from, to, lang);
  const sep = q ? '&' : '?';
  return `/admin/my-staff-report.pdf${q}${sep}cb=${Date.now()}`;
}
