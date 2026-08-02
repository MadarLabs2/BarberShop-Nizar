import { apiFetch } from './api';

export type Branch = {
  id: string;
  name: string;
  nameHe: string;
  nameAr: string;
  address: string | null;
  wazeLink: string | null;
  phone: string | null;
  instagramUrl: string | null;
};
export type Service = { id: string; name: string; nameHe: string; nameAr: string; price: number; duration: number };
export type WorkingDayHours = { dayOfWeek: number; startTime: string; endTime: string };
export type StaffService = { id: string; name: string; nameHe: string; nameAr: string; price: number; duration: number };
export type StaffForBranch = {
  id: string;
  name: string;
  avatarUrl: string | null;
  workingDays?: WorkingDayHours[];
  services?: StaffService[];
};

export async function fetchBranches(): Promise<Branch[]> {
  return apiFetch<Branch[]>('/catalog/branches');
}

export async function fetchServices(): Promise<Service[]> {
  return apiFetch<Service[]>('/catalog/services');
}

/** Staff row from catalog; admin list uses full `/catalog/staff`, booking UI uses `/catalog/staff/bookable`. */
export type CatalogStaffMember = {
  id: string;
  name: string;
  avatarUrl: string | null;
  phone: string | null;
  /** From GET /catalog/staff/bookable — when present, booking UI can show סניף/טיפול before booking-context loads. */
  bookingSummary?: {
    branches: Branch[];
    services: Service[];
  };
};

export async function fetchStaff(): Promise<CatalogStaffMember[]> {
  return apiFetch<CatalogStaffMember[]>('/catalog/staff');
}

/** Customer team + booking: only staff with booking enabled, branch, services, and working days. */
export async function fetchBookableStaff(): Promise<CatalogStaffMember[]> {
  return apiFetch<CatalogStaffMember[]>('/catalog/staff/bookable');
}

export async function fetchStaffForBranch(branchId: string): Promise<StaffForBranch[]> {
  return apiFetch<StaffForBranch[]>(`/catalog/branches/${branchId}/staff`);
}

/** Staff-first booking: branches + working hours + services for one staff (after choosing the barber). */
export type StaffBookingContext = {
  staff: { id: string; name: string; avatarUrl: string | null };
  branches: Branch[];
  workingDays: WorkingDayHours[];
  services: StaffService[];
};

export async function fetchStaffBookingContext(staffId: string): Promise<StaffBookingContext> {
  return apiFetch<StaffBookingContext>(`/catalog/staff/${encodeURIComponent(staffId)}/booking-context`);
}

export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  /** When set and below `price`, product is on sale (API-validated). */
  salePrice?: number | null;
  imageUrl: string | null;
  category: string | null;
  stockQuantity: number;
  /** Set when row is a barber listing; omitted/null = public shop product (admin). */
  staffId?: string | null;
  staffName?: string | null;
};

export async function fetchCatalogProducts(): Promise<CatalogProduct[]> {
  return apiFetch<CatalogProduct[]>('/catalog/products');
}

export async function fetchCatalogProductsForUser(token: string): Promise<CatalogProduct[]> {
  return apiFetch<CatalogProduct[]>('/catalog/products/my', { token });
}

export async function getAvailableSlots(params: {
  staffId: string;
  date: string;
  serviceId: string;
  branchId: string;
  /** When editing an existing booking, exclude it from overlap so the current slot stays available. */
  excludeAppointmentId?: string;
}): Promise<{ slots: string[]; isNotWorkDay?: boolean }> {
  const q = new URLSearchParams({
    staffId: params.staffId,
    date: params.date,
    serviceId: params.serviceId,
    branchId: params.branchId,
  });
  if (params.excludeAppointmentId) {
    q.set('excludeAppointmentId', params.excludeAppointmentId);
  }
  return apiFetch<{ slots: string[]; isNotWorkDay?: boolean }>(`/bookings/slots?${q}`);
}

export type CreatedAppointment = {
  id: string;
  date: string;
  time: string;
  serviceName: string;
  staffName: string;
  branchName: string;
  serviceNameHe: string;
  serviceNameAr: string;
  branchNameHe: string;
  branchNameAr: string;
  price: number;
  createdAt: string;
};

export async function createBooking(
  data: { branchId: string; staffId: string; serviceId: string; date: string; time: string },
  token: string
): Promise<CreatedAppointment> {
  return apiFetch<CreatedAppointment>('/bookings', {
    method: 'POST',
    body: JSON.stringify(data),
    token,
  });
}

export async function updateAppointment(
  appointmentId: string,
  data: { branchId: string; staffId: string; serviceId: string; date: string; time: string },
  token: string
): Promise<CreatedAppointment> {
  return apiFetch<CreatedAppointment>(`/bookings/my/${encodeURIComponent(appointmentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    token,
  });
}

export type AppointmentDto = {
  id: string;
  date: string;
  time: string;
  serviceName: string;
  staffName: string;
  branchName: string;
  serviceNameHe: string;
  serviceNameAr: string;
  branchNameHe: string;
  branchNameAr: string;
  price: number;
  status: string;
  createdAt: string;
  /** Server updated_at; used for unseen badge (cancellations, etc.). */
  updatedAt?: string;
  /** Present when returned from GET /bookings/my — needed for reschedule. */
  staffId?: string;
  branchId?: string;
  serviceId?: string;
};

export type MyAppointmentsResponse = {
  upcoming: AppointmentDto[];
  past: AppointmentDto[];
};

/** Matches backend paged reads: smaller payloads than unscoped GET /bookings/my. */
const MY_APPOINTMENTS_UPCOMING_QUERY = 'scope=upcoming&limit=20&page=1';
const MY_APPOINTMENTS_PAST_QUERY = 'scope=past&limit=20&page=1';

export async function getMyAppointments(token: string): Promise<MyAppointmentsResponse> {
  const [upRes, pastRes] = await Promise.allSettled([
    apiFetch<MyAppointmentsResponse>(`/bookings/my?${MY_APPOINTMENTS_UPCOMING_QUERY}`, { token }),
    apiFetch<MyAppointmentsResponse>(`/bookings/my?${MY_APPOINTMENTS_PAST_QUERY}`, { token }),
  ]);

  // Either sub-request failing must throw, not silently resolve to an empty list for that half —
  // the caller (AppointmentsContext) treats a successful return as ground truth: it overwrites
  // state AND persists it to disk. A transient failure on just one of these two calls must never
  // be allowed to look like "you have no past appointments" / "you have no upcoming appointments."
  if (upRes.status === 'rejected') {
    const r = upRes.reason;
    throw r instanceof Error ? r : new Error(String(r));
  }
  if (pastRes.status === 'rejected') {
    const r = pastRes.reason;
    throw r instanceof Error ? r : new Error(String(r));
  }

  return {
    upcoming: Array.isArray(upRes.value.upcoming) ? upRes.value.upcoming : [],
    past: Array.isArray(pastRes.value.past) ? pastRes.value.past : [],
  };
}

export async function cancelAppointment(id: string, token: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/bookings/${id}/cancel`, {
    method: 'POST',
    token,
  });
}

/** Hide all past appointments from the customer's list (does not delete rows; staff/admin unaffected). */
export async function clearPastHistory(token: string): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/bookings/my/clear-past-history', {
    method: 'POST',
    token,
  });
}

export type MyWaitlistEntry = {
  id: string;
  date: string;
  status: string;
  preferMorning: boolean;
  preferAfternoon: boolean;
  preferEvening: boolean;
  createdAt: string;
  staffName: string;
  serviceName: string;
  branchName: string;
  serviceNameHe: string;
  serviceNameAr: string;
  branchNameHe: string;
  branchNameAr: string;
};

export async function joinWaitlist(
  token: string,
  body: {
    branchId: string;
    staffId: string;
    serviceId: string;
    date: string;
    preferMorning: boolean;
    preferAfternoon: boolean;
    preferEvening: boolean;
  }
): Promise<{ id: string; date: string; preferMorning: boolean; preferAfternoon: boolean; preferEvening: boolean; createdAt: string }> {
  return apiFetch('/bookings/waitlist', {
    method: 'POST',
    body: JSON.stringify(body),
    token,
  });
}

export async function leaveWaitlist(id: string, token: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/bookings/waitlist/${id}`, { method: 'DELETE', token });
}

export async function getMyWaitlist(token: string): Promise<MyWaitlistEntry[]> {
  return apiFetch<MyWaitlistEntry[]>('/bookings/waitlist/my', { token });
}

export type WaitlistSlotOffer = {
  id: string;
  date: string;
  time: string;
  staffId: string;
  staffName: string;
  serviceId: string;
  serviceName: string;
  branchId: string | null;
  branchName: string;
  serviceNameHe: string;
  serviceNameAr: string;
  branchNameHe: string;
  branchNameAr: string;
  createdAt: string;
};

export async function getPendingWaitlistOffers(token: string): Promise<WaitlistSlotOffer[]> {
  return apiFetch<WaitlistSlotOffer[]>('/bookings/waitlist/offers/pending', { token });
}

export async function acceptWaitlistOffer(offerId: string, token: string): Promise<CreatedAppointment> {
  return apiFetch<CreatedAppointment>(`/bookings/waitlist/offers/${encodeURIComponent(offerId)}/accept`, {
    method: 'POST',
    token,
  });
}
