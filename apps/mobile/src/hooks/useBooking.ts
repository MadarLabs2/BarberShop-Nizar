import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Alert } from 'react-native';
import { useAppointments } from '../contexts/AppointmentsContext';
import { useNotifications } from '../contexts/NotificationsContext';
import type { AppointmentDto } from '../services/bookings.api';
import {
  getAvailableSlots,
  createBooking,
  updateAppointment,
  joinWaitlist,
  acceptWaitlistOffer,
  getPendingWaitlistOffers,
  type Branch,
  type Service,
  type StaffForBranch,
  type CatalogStaffMember,
  type MyWaitlistEntry,
  type StaffBookingContext,
  type WaitlistSlotOffer,
} from '../services/bookings.api';
import { notifyWaitlistJoined } from '../lib/waitlistJoinQueue';
import {
  peekTeamStaff,
  subscribeTeamStaffList,
  peekStaffBookingContext,
  prefetchStaffBookingContexts,
  ensureStaffBookingContext,
  ensureBookableStaffList,
  syncCustomerPrefetchToken,
  setStaffBookingContext,
  patchStaffBookingContextsFromTeamList,
} from '../services/customerPrefetchCache';
import i18n from '../i18n';
import {
  toDateString,
  getNextDays,
  getTodayDateString,
  isAppointmentUpcoming,
  israelNowMinutesSinceMidnight,
} from '../utils/dates';
import { timeToMins } from '../utils/waitlistPrefs';

/** Lightweight context from embedded bookable-staff summary (working hours filled in by full booking-context later). */
function buildStaffBookingContextFromSummary(member: CatalogStaffMember): StaffBookingContext | null {
  const s = member.bookingSummary;
  if (!s?.branches?.length || !s.services?.length) return null;
  return {
    staff: { id: member.id, name: member.name, avatarUrl: member.avatarUrl },
    branches: s.branches.map((b) => ({
      id: b.id,
      name: b.name,
      address: b.address ?? null,
      wazeLink: b.wazeLink ?? null,
    })),
    workingDays: [],
    services: s.services.map((svc) => ({
      id: svc.id,
      name: svc.name,
      price: svc.price,
      duration: svc.duration,
    })),
  };
}

/** Rolling window of upcoming days for the date picker (today .. today+N-1, local dates). */
const BOOKING_DAY_HORIZON = 14;

export type BookingDayOption = {
  date: Date;
  /** True when the selected staff works on this weekday (per staff_working_days). */
  available: boolean;
};

export interface UseBookingState {
  /** All active staff (picker). */
  staffList: CatalogStaffMember[];
  /** Branches where the selected staff works (from booking-context). */
  branches: Branch[];
  services: Service[];
  /** Initial load of staff list for the screen. */
  catalogLoading: boolean;
  /** Loading booking-context after choosing a staff member. */
  staffContextLoading: boolean;
  /** Last error loading booking context (Hebrew-friendly). */
  contextError: string | null;
  slotsLoading: boolean;
  submitting: boolean;
  branch: Branch | null;
  staffMember: StaffForBranch | null;
  service: Service | null;
  selectedDate: Date | null;
  selectedTime: string | null;
  slots: string[];
  bookingDayOptions: BookingDayOption[];
  staffHasWorkingDays: boolean;
  canSelectDate: boolean;
  canProceedToTime: boolean;
  slotsNotWorkDay: boolean;
  canJoinWaitlist: boolean;
  waitlistStaffDayEnded: boolean;
  waitlistSubmitting: boolean;
  /** True when the selected staff is assigned to more than one branch (user must pick). */
  requiresBranchChoice: boolean;
  /** When set, confirming PATCHes this appointment instead of creating a new one. */
  editingAppointmentId: string | null;
  /** Customer already has max allowed future confirmed appointments (new booking blocked). */
  atFutureAppointmentLimit: boolean;
  /** False until the real appointment count has been confirmed from the server at least once —
   * while false, the screen must treat the customer as blocked (fail closed) so the limit can
   * never be judged against a stale/empty local cache. */
  appointmentLimitChecked: boolean;
  /** Set when opening Booking from a waitlist slot push — confirm uses accept-offer API. */
  pendingWaitlistOfferId: string | null;
}

export interface UseBookingActions {
  setBranch: (b: Branch | null) => void;
  setService: (s: Service | null) => void;
  setSelectedDate: (d: Date | null) => void;
  setSelectedTime: (t: string | null) => void;
  /** Load branches + services + hours for this staff (staff-first flow). */
  applyStaffById: (staffId: string) => Promise<void>;
  /** Start loading booking-context for a barber before tap completes (deduped with prefetch). */
  warmStaffBookingContext: (staffId: string) => void;
  fetchSlots: (options?: { skipCache?: boolean }) => Promise<void>;
  primeSlotsForDate: (date: Date) => void;
  handleConfirm: (token: string) => Promise<{ success: boolean; error?: string }>;
  joinWaitlist: (
    token: string,
    prefs: { preferMorning: boolean; preferAfternoon: boolean; preferEvening: boolean }
  ) => Promise<{ success: boolean; error?: string; entry?: MyWaitlistEntry }>;
  reset: () => void;
  /** Load booking screen in “edit appointment” mode (from התורים שלך). */
  beginReschedule: (p: {
    appointmentId: string;
    staffId: string;
    branchId: string;
    serviceId: string;
    date: string;
    time: string;
  }) => Promise<void>;
  /** Pre-fill booking from a pending waitlist offer (after push / deep link). */
  beginWaitlistOfferFromId: (offerId: string, authToken: string) => Promise<void>;
  /** Re-verify the 2-future-appointments limit against the server (bypasses any local cache) and
   * fail closed (`appointmentLimitChecked` false) until it resolves. Call on every screen focus. */
  checkAppointmentLimit: (token: string | null) => void;
}

export interface UseBookingModalState {
  showBranchModal: boolean;
  showServiceModal: boolean;
  showDateModal: boolean;
  showTimeModal: boolean;
  showConfirmModal: boolean;
}

export interface UseBookingModalActions {
  setShowBranchModal: (v: boolean) => void;
  setShowServiceModal: (v: boolean) => void;
  setShowDateModal: (v: boolean) => void;
  setShowTimeModal: (v: boolean) => void;
  setShowConfirmModal: (v: boolean) => void;
}

export function useBooking(_token: string | null) {
  const [staffList, setStaffList] = useState<CatalogStaffMember[]>(() => peekTeamStaff() ?? []);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(() => peekTeamStaff() === null);
  const [staffContextLoading, setStaffContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [branch, setBranch] = useState<Branch | null>(null);
  const [staffMember, setStaffMember] = useState<StaffForBranch | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);

  const [showBranchModal, setShowBranchModal] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [bookingDayOptions, setBookingDayOptions] = useState<BookingDayOption[]>([]);
  const [slotsNotWorkDay, setSlotsNotWorkDay] = useState(false);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [editingAppointmentId, setEditingAppointmentId] = useState<string | null>(null);
  const [pendingWaitlistOfferId, setPendingWaitlistOfferId] = useState<string | null>(null);
  const [appointmentLimitChecked, setAppointmentLimitChecked] = useState(false);

  const slotsFetchGenRef = useRef(0);
  const slotsCacheRef = useRef(new Map<string, { slots: string[]; isNotWorkDay: boolean }>());
  const slotsInflightRef = useRef(new Map<string, Promise<{ slots: string[]; isNotWorkDay: boolean }>>());
  const bookingInFlightRef = useRef(false);
  const staffFetchGenRef = useRef(0);

  const requiresBranchChoice = branches.length > 1;

  const prefetchBookingContexts = useCallback((list: CatalogStaffMember[]) => {
    // Share warmed contexts across screens/sessions in-memory.
    void prefetchStaffBookingContexts(list.map((s) => s.id));
  }, []);

  /** Fire-and-forget — shares in-flight network with prefetch / `applyStaffById` via `ensureStaffBookingContext`. */
  const warmStaffBookingContext = useCallback((staffId: string) => {
    void ensureStaffBookingContext(staffId).catch(() => undefined);
  }, []);

  /** When branch changes: clear day/time/slots (same staff, different סניף). */
  useEffect(() => {
    setSelectedDate(null);
    setSelectedTime(null);
    slotsCacheRef.current.clear();
    slotsInflightRef.current.clear();
  }, [branch?.id]);

  /** When service changes: clear selected time. */
  useEffect(() => {
    setSelectedTime(null);
  }, [service?.id]);

  const catalogFetchedRef = useRef(false);
  /** Which session the in-flight catalog init belongs to — avoids ref / token desync from split effects. */
  const catalogInitTokenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const tokenKey = _token ?? '';
    if (catalogInitTokenKeyRef.current !== tokenKey) {
      catalogInitTokenKeyRef.current = tokenKey;
      catalogFetchedRef.current = false;
    }
    if (catalogFetchedRef.current) return;
    catalogFetchedRef.current = true;

    if (_token) syncCustomerPrefetchToken(_token);
    const cached = peekTeamStaff();
    if (cached !== null && cached.length > 0) {
      setStaffList(cached);
      setCatalogLoading(false);
      return;
    }
    setCatalogLoading(true);
    ensureBookableStaffList()
      .then((list) => {
        setStaffList(list);
      })
      .catch(() => {
        setStaffList([]);
      })
      .finally(() => setCatalogLoading(false));
  }, [_token, prefetchBookingContexts]);

  /** Admin (or prefetch) updates team cache — keep gallery + selected barber avatars in sync without refetch. */
  useEffect(() => {
    return subscribeTeamStaffList((list) => {
      setStaffList(list);
      setCatalogLoading(false);
      patchStaffBookingContextsFromTeamList(list);
      setStaffMember((prev) => {
        if (!prev) return prev;
        const m = list.find((x) => x.id === prev.id);
        if (!m) {
          // Selected barber was removed/deactivated (e.g. admin unlinked self from staff):
          // clear dependent booking state immediately so stale choices cannot remain visible.
          setBranches([]);
          setBranch(null);
          setService(null);
          setSelectedDate(null);
          setSelectedTime(null);
          setSlots([]);
          setSlotsNotWorkDay(false);
          setContextError(i18n.t('booking.pickStaffFirst'));
          return null;
        }
        if (prev.name === m.name && prev.avatarUrl === m.avatarUrl) return prev;
        return { ...prev, name: m.name, avatarUrl: m.avatarUrl };
      });
    });
  }, [prefetchBookingContexts]);

  /** Prefetch full booking-context for gallery staff in parallel chunks (shares in-flight with taps). */
  useEffect(() => {
    if (staffList.length === 0) return;
    prefetchBookingContexts(staffList);
  }, [staffList, prefetchBookingContexts]);

  const staffMemberRef = useRef<StaffForBranch | null>(null);
  staffMemberRef.current = staffMember;

  const applyStaffById = useCallback(async (staffId: string) => {
    const gen = ++staffFetchGenRef.current;
    // Do not clear editingAppointmentId here — user may switch barber while rescheduling;
    // clearing would route confirm through createBooking and duplicate "התורים שלך".
    // DO clear pendingWaitlistOfferId: this is a manual gallery pick, so any pending offer flow
    // (auto-filled staff/service/date/time from a waitlist push) is being actively abandoned.
    // Without this, handleConfirm would still call acceptWaitlistOffer with the *old* offer's
    // details while the UI shows whatever the user just picked here — a real mismatch.
    setPendingWaitlistOfferId(null);
    setContextError(null);
    setService(null);
    setSelectedDate(null);
    setSelectedTime(null);
    slotsCacheRef.current.clear();
    slotsInflightRef.current.clear();

    const applyCtx = (ctx: StaffBookingContext) => {
      setContextError(null);
      const member: StaffForBranch = {
        id: ctx.staff.id,
        name: ctx.staff.name,
        avatarUrl: ctx.staff.avatarUrl,
        workingDays: ctx.workingDays,
        services: ctx.services,
      };
      setStaffMember(member);
      setBranches(ctx.branches);
      setBranch((prev) => {
        if (ctx.branches.length === 0) return null;
        if (ctx.branches.length === 1) return ctx.branches[0];
        if (!prev) return null;
        const matched = ctx.branches.find((b) => b.id === prev.id);
        return matched ?? null;
      });
      if (ctx.branches.length === 0) {
        setContextError('לא נמצא סניף משויך לאיש הצוות. פנה למנהל.');
      }
    };

    const fromCatalog = staffList.find((s) => s.id === staffId);
    const lightCtx = fromCatalog != null ? buildStaffBookingContextFromSummary(fromCatalog) : null;

    const cached = peekStaffBookingContext(staffId);
    if (cached) {
      setStaffContextLoading(false);
      applyCtx(cached);
      void ensureStaffBookingContext(staffId)
        .then((ctx) => {
          if (gen !== staffFetchGenRef.current) return;
          setStaffBookingContext(staffId, ctx);
          applyCtx(ctx);
        })
        .catch(() => undefined);
      return;
    }

    if (lightCtx) {
      setStaffContextLoading(false);
      applyCtx(lightCtx);
      try {
        const ctx = await ensureStaffBookingContext(staffId);
        if (gen !== staffFetchGenRef.current) return;
        setStaffBookingContext(staffId, ctx);
        applyCtx(ctx);
      } catch (e) {
        if (gen !== staffFetchGenRef.current) return;
        setContextError(e instanceof Error ? e.message : 'לא הצלחנו לטעון פרטים');
      }
      return;
    }

    setBranch(null);
    const prevStaff = staffMemberRef.current;
    const switchingBarber = prevStaff != null && prevStaff.id !== staffId;
    if (switchingBarber) {
      setBranches([]);
    }
    setStaffContextLoading(true);
    if (fromCatalog) {
      setStaffMember({
        id: fromCatalog.id,
        name: fromCatalog.name,
        avatarUrl: fromCatalog.avatarUrl,
        workingDays: [],
        services: [],
      });
    } else {
      setStaffMember(null);
    }

    try {
      const ctx = await ensureStaffBookingContext(staffId);
      if (gen !== staffFetchGenRef.current) return;
      setStaffBookingContext(staffId, ctx);
      applyCtx(ctx);
    } catch (e) {
      if (gen !== staffFetchGenRef.current) return;
      setContextError(e instanceof Error ? e.message : 'לא הצלחנו לטעון פרטים');
      setStaffMember(null);
      setBranches([]);
      setBranch(null);
    } finally {
      if (gen === staffFetchGenRef.current) {
        setStaffContextLoading(false);
      }
    }
  }, [staffList]);

  const beginReschedule = useCallback(
    async (p: {
      appointmentId: string;
      staffId: string;
      branchId: string;
      serviceId: string;
      date: string;
      time: string;
    }) => {
      const gen = ++staffFetchGenRef.current;
      setEditingAppointmentId(p.appointmentId);
      // A leftover pending waitlist-offer flag would make handleConfirm silently accept the old
      // offer instead of saving this reschedule (mirrors the same guard beginWaitlistOfferFromId
      // already applies to editingAppointmentId, in the other direction).
      setPendingWaitlistOfferId(null);
      setStaffContextLoading(true);
      setContextError(null);
      setService(null);
      setSelectedDate(null);
      setSelectedTime(null);
      setBranch(null);
      setBranches([]);
      setStaffMember(null);
      slotsCacheRef.current.clear();
      slotsInflightRef.current.clear();
      const applyEditContext = (ctx: StaffBookingContext) => {
        if (gen !== staffFetchGenRef.current) return;
        const member: StaffForBranch = {
          id: ctx.staff.id,
          name: ctx.staff.name,
          avatarUrl: ctx.staff.avatarUrl,
          workingDays: ctx.workingDays,
          services: ctx.services,
        };
        setStaffMember(member);
        setBranches(ctx.branches);
        const br = ctx.branches.find((b) => b.id === p.branchId) ?? ctx.branches[0] ?? null;
        setBranch(br);
        const svcRow = ctx.services.find((s) => s.id === p.serviceId);
        if (!svcRow) {
          setContextError('לא ניתן לטעון את פרטי הטיפול לעריכה');
          setEditingAppointmentId(null);
          return;
        }
        setService({
          id: svcRow.id,
          name: svcRow.name,
          price: svcRow.price,
          duration: svcRow.duration,
        });
        const [yy, mm, dd] = p.date.split('-').map(Number);
        setSelectedDate(new Date(yy, mm - 1, dd));
        setSelectedTime(p.time.slice(0, 5));
      };

      const cachedCtx = peekStaffBookingContext(p.staffId);
      if (cachedCtx) {
        applyEditContext(cachedCtx);
        setStaffContextLoading(false);
        // Refresh cache silently without blocking UI.
        void ensureStaffBookingContext(p.staffId)
          .then((freshCtx) => {
            if (gen !== staffFetchGenRef.current) return;
            setStaffBookingContext(p.staffId, freshCtx);
          })
          .catch(() => undefined);
        return;
      }

      try {
        const ctx = await ensureStaffBookingContext(p.staffId);
        if (gen !== staffFetchGenRef.current) return;
        setStaffBookingContext(p.staffId, ctx);
        applyEditContext(ctx);
      } catch (e) {
        if (gen !== staffFetchGenRef.current) return;
        setContextError(e instanceof Error ? e.message : 'לא הצלחנו לטעון פרטים');
        setEditingAppointmentId(null);
      } finally {
        if (gen === staffFetchGenRef.current) {
          setStaffContextLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!staffMember) {
      setBookingDayOptions([]);
      return;
    }
    if (staffContextLoading) {
      setBookingDayOptions([]);
      return;
    }
    const days = getNextDays(BOOKING_DAY_HORIZON);
    const wd = staffMember.workingDays?.map((w) => w.dayOfWeek) ?? [];
    const hasWd = wd.length > 0;
    setBookingDayOptions(
      days.map((date) => ({
        date,
        available: hasWd && wd.includes(date.getDay()),
      }))
    );
  }, [staffMember?.id, staffMember?.workingDays, staffContextLoading]);

  useEffect(() => {
    if (!staffMember) return;
    const wd = staffMember.workingDays?.map((w) => w.dayOfWeek) ?? [];
    setSelectedDate((current) => {
      if (!current) return current;
      if (!wd.length || !wd.includes(current.getDay())) return null;
      return current;
    });
  }, [staffMember?.id, staffMember?.workingDays]);

  useEffect(() => {
    if (!selectedDate) setSelectedTime(null);
  }, [selectedDate]);

  const SLOT_CACHE_MAX = 32;

  const loadSlotsPayload = useCallback(
    (
      req: { staffId: string; date: string; serviceId: string },
      options?: { skipCache?: boolean }
    ): Promise<{ slots: string[]; isNotWorkDay: boolean }> => {
      const cacheKey = `${req.staffId}|${req.date}|${req.serviceId}|${editingAppointmentId ?? ''}`;
      const cache = slotsCacheRef.current;
      const inflight = slotsInflightRef.current;

      if (!options?.skipCache) {
        const hit = cache.get(cacheKey);
        if (hit) return Promise.resolve(hit);
      } else {
        inflight.delete(cacheKey);
        cache.delete(cacheKey);
      }

      if (!options?.skipCache) {
        const pending = inflight.get(cacheKey);
        if (pending) return pending;
      }

      const p = getAvailableSlots({
        ...req,
        excludeAppointmentId: editingAppointmentId ?? undefined,
      })
        .then(({ slots: s, isNotWorkDay }) => {
          const payload = { slots: s, isNotWorkDay: !!isNotWorkDay };
          cache.set(cacheKey, payload);
          if (cache.size > SLOT_CACHE_MAX) {
            const first = cache.keys().next().value as string | undefined;
            if (first) cache.delete(first);
          }
          return payload;
        })
        .finally(() => {
          inflight.delete(cacheKey);
        });

      inflight.set(cacheKey, p);
      return p;
    },
    [editingAppointmentId]
  );

  const primeSlotsForDate = useCallback(
    (date: Date) => {
      if (!staffMember?.id || !service?.id) return;
      const wd = staffMember.workingDays?.map((w) => w.dayOfWeek) ?? [];
      if (!wd.length || !wd.includes(date.getDay())) return;
      const dateStr = toDateString(date);
      void loadSlotsPayload({
        staffId: staffMember.id,
        date: dateStr,
        serviceId: service.id,
      }).catch(() => undefined);
    },
    [staffMember?.id, service?.id, staffMember?.workingDays, loadSlotsPayload]
  );

  useEffect(() => {
    if (!staffMember || !service || selectedDate) return;
    const first = bookingDayOptions.find((o) => o.available)?.date;
    if (first) primeSlotsForDate(first);
  }, [staffMember?.id, service?.id, selectedDate, bookingDayOptions, primeSlotsForDate]);

  const fetchSlots = useCallback(
    async (options?: { skipCache?: boolean }) => {
      if (!staffMember?.id || !service?.id || !selectedDate) return;
      const req = {
        staffId: staffMember.id,
        date: toDateString(selectedDate),
        serviceId: service.id,
      };
      const cacheKey = `${req.staffId}|${req.date}|${req.serviceId}`;
      const cache = slotsCacheRef.current;

      const gen = ++slotsFetchGenRef.current;

      if (!options?.skipCache) {
        const hit = cache.get(cacheKey);
        if (hit) {
          setSlots(hit.slots);
          setSlotsNotWorkDay(hit.isNotWorkDay);
          setSlotsLoading(false);
          setSelectedTime((prev) => (prev && hit.slots.includes(prev) ? prev : null));
          return;
        }
      }

      setSlotsLoading(true);
      setSlots([]);
      setSlotsNotWorkDay(false);
      try {
        const { slots: s, isNotWorkDay } = await loadSlotsPayload(req, options);
        if (gen !== slotsFetchGenRef.current) return;
        setSlots(s);
        setSlotsNotWorkDay(isNotWorkDay);
        setSelectedTime((prev) => (prev && s.includes(prev) ? prev : null));
      } catch {
        if (gen !== slotsFetchGenRef.current) return;
      } finally {
        if (gen === slotsFetchGenRef.current) {
          setSlotsLoading(false);
        }
      }
    },
    [staffMember?.id, service?.id, selectedDate, loadSlotsPayload]
  );

  useEffect(() => {
    if (!staffMember || !service || !selectedDate) {
      setSlots([]);
      setSlotsNotWorkDay(false);
      setSlotsLoading(false);
      return;
    }
    const wd = staffMember.workingDays?.map((w) => w.dayOfWeek) ?? [];
    if (!wd.length || !wd.includes(selectedDate.getDay())) {
      setSlots([]);
      setSlotsNotWorkDay(true);
      setSlotsLoading(false);
      return;
    }
    void fetchSlots();
  }, [staffMember?.id, service?.id, selectedDate, fetchSlots]);

  const canSelectDate = !!branch && !!staffMember && !!service;
  const canProceedToTime = canSelectDate && !!selectedDate;

  const waitlistStaffDayEnded = useMemo(() => {
    if (!selectedDate || !staffMember?.workingDays?.length) return false;
    if (toDateString(selectedDate) !== getTodayDateString()) return false;
    const dow = selectedDate.getDay();
    const wd = staffMember.workingDays.find((w) => w.dayOfWeek === dow);
    if (!wd) return true;
    const endMins = timeToMins(String(wd.endTime).slice(0, 5));
    return israelNowMinutesSinceMidnight() >= endMins;
  }, [selectedDate, staffMember]);

  const { upcoming, updateUpcoming, bumpLastFetched, forceRefresh: refreshAppointments } = useAppointments();
  const { addLocalNotification, removeNotificationById } = useNotifications();

  /**
   * Fail closed: the 2-future-appointments limit must never be judged against a stale/empty
   * local cache. Forces a real server round-trip and only marks the check "done" once that
   * resolves — until then `appointmentLimitChecked` is false, which the screen treats as
   * blocked (fields inert) exactly like being over the limit. Callable again on every screen
   * focus (not just once per login) so a revisit always re-verifies against the server.
   */
  const checkAppointmentLimitRunIdRef = useRef(0);
  const checkAppointmentLimit = useCallback(
    (authToken: string | null) => {
      const runId = ++checkAppointmentLimitRunIdRef.current;
      if (!authToken) {
        setAppointmentLimitChecked(true);
        return;
      }
      setAppointmentLimitChecked(false);
      void refreshAppointments(authToken).finally(() => {
        if (runId === checkAppointmentLimitRunIdRef.current) setAppointmentLimitChecked(true);
      });
    },
    [refreshAppointments],
  );

  useEffect(() => {
    checkAppointmentLimit(_token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_token]);

  const futureUpcomingCount = useMemo(
    () => upcoming.filter((a) => isAppointmentUpcoming(a.date, a.time)).length,
    [upcoming],
  );
  const atFutureAppointmentLimit = !editingAppointmentId && futureUpcomingCount >= 2;

  const canJoinWaitlist = useMemo(() => {
    if (pendingWaitlistOfferId) return false;
    if (editingAppointmentId) return false;
    if (futureUpcomingCount >= 2) return false;
    return (
      !!branch &&
      !!staffMember &&
      !!service &&
      !!selectedDate &&
      !slotsNotWorkDay &&
      !slotsLoading &&
      slots.length === 0 &&
      !waitlistStaffDayEnded
    );
  }, [
    editingAppointmentId,
    futureUpcomingCount,
    branch,
    staffMember,
    service,
    selectedDate,
    slotsNotWorkDay,
    slotsLoading,
    slots.length,
    waitlistStaffDayEnded,
    pendingWaitlistOfferId,
  ]);

  const beginWaitlistOfferFromId = useCallback(
    async (offerId: string, authToken: string) => {
      const gen = ++staffFetchGenRef.current;
      setPendingWaitlistOfferId(offerId);
      setEditingAppointmentId(null);
      setContextError(null);
      setService(null);
      setSelectedDate(null);
      setSelectedTime(null);
      setBranch(null);
      setBranches([]);
      setStaffMember(null);
      slotsCacheRef.current.clear();
      slotsInflightRef.current.clear();

      let offer: WaitlistSlotOffer;
      try {
        const offers = await getPendingWaitlistOffers(authToken);
        const o = offers.find((x) => x.id === offerId);
        if (!o) {
          setPendingWaitlistOfferId(null);
          setContextError('ההצעה כבר לא זמינה.');
          return;
        }
        offer = o;
      } catch {
        setPendingWaitlistOfferId(null);
        setContextError('לא הצלחנו לטעון את ההצעה.');
        return;
      }

      const applyOfferContext = (ctx: StaffBookingContext) => {
        if (gen !== staffFetchGenRef.current) return;
        const member: StaffForBranch = {
          id: ctx.staff.id,
          name: ctx.staff.name,
          avatarUrl: ctx.staff.avatarUrl,
          workingDays: ctx.workingDays,
          services: ctx.services,
        };
        setStaffMember(member);
        setBranches(ctx.branches);
        let br: Branch | null = null;
        if (offer.branchId) {
          br = ctx.branches.find((b) => b.id === offer.branchId) ?? null;
        }
        if (!br) br = ctx.branches[0] ?? null;
        if (!br) {
          setContextError('לא נמצא סניף משויך לאיש הצוות. פנה למנהל.');
          setPendingWaitlistOfferId(null);
          return;
        }
        setBranch(br);
        const svcRow = ctx.services.find((s) => s.id === offer.serviceId);
        if (!svcRow) {
          setContextError('לא ניתן לטעון את פרטי הטיפול');
          setPendingWaitlistOfferId(null);
          return;
        }
        setService({
          id: svcRow.id,
          name: svcRow.name,
          price: svcRow.price,
          duration: svcRow.duration,
        });
        const [yy, mm, dd] = offer.date.split('-').map(Number);
        setSelectedDate(new Date(yy, mm - 1, dd));
        setSelectedTime(offer.time.slice(0, 5));
      };

      const cachedCtx = peekStaffBookingContext(offer.staffId);
      if (cachedCtx) {
        applyOfferContext(cachedCtx);
        setStaffContextLoading(false);
        void ensureStaffBookingContext(offer.staffId)
          .then((freshCtx) => {
            if (gen !== staffFetchGenRef.current) return;
            setStaffBookingContext(offer.staffId, freshCtx);
            applyOfferContext(freshCtx);
          })
          .catch(() => undefined);
        return;
      }

      setStaffContextLoading(true);
      try {
        const ctx = await ensureStaffBookingContext(offer.staffId);
        if (gen !== staffFetchGenRef.current) return;
        setStaffBookingContext(offer.staffId, ctx);
        applyOfferContext(ctx);
      } catch (e) {
        setPendingWaitlistOfferId(null);
        setContextError(e instanceof Error ? e.message : 'לא הצלחנו לטעון פרטים');
      } finally {
        if (gen === staffFetchGenRef.current) {
          setStaffContextLoading(false);
        }
      }
    },
    [],
  );

  const handleConfirm = useCallback(
    async (authToken: string) => {
      if (pendingWaitlistOfferId && !editingAppointmentId) {
        if (!branch || !staffMember || !service || !selectedDate || !selectedTime) {
          return { success: false, error: 'חסרים פרטים' };
        }
        if (!slots.includes(selectedTime)) {
          return { success: false, error: 'השעה שבחרת כבר לא פנויה. נא לבחור שנית.' };
        }
        if (bookingInFlightRef.current) return { success: false, error: 'מבצע הזמנה...' };
        if (futureUpcomingCount >= 2) {
          return { success: false, error: i18n.t('booking.maxFutureAppointments') };
        }

        const offerId = pendingWaitlistOfferId;
        const dateStr = toDateString(selectedDate);

        bookingInFlightRef.current = true;
        setSubmitting(true);
        try {
          const created = await acceptWaitlistOffer(offerId, authToken);
          const dto: AppointmentDto = {
            id: created.id,
            date: created.date,
            time: created.time,
            serviceName: created.serviceName,
            staffName: created.staffName,
            branchName: created.branchName,
            price: created.price,
            status: 'confirmed',
            createdAt: created.createdAt,
            staffId: staffMember.id,
            branchId: branch.id,
            serviceId: service.id,
          };
          updateUpcoming((prev) => [dto, ...prev]);
          addLocalNotification({
            title: i18n.t('booking.successBooked'),
            body: `${service.name} - ${dateStr} ${selectedTime}`,
            type: 'appointment',
            token: authToken,
          });
          bumpLastFetched();
          slotsCacheRef.current.clear();
          slotsInflightRef.current.clear();
          slotsFetchGenRef.current += 1;
          setShowConfirmModal(false);
          setPendingWaitlistOfferId(null);
          setSelectedDate(null);
          setSelectedTime(null);
          return { success: true };
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'לא הצלחנו לקבוע את התור';
          return { success: false, error: msg };
        } finally {
          bookingInFlightRef.current = false;
          setSubmitting(false);
        }
      }

      if (!branch || !staffMember || !service || !selectedDate || !selectedTime)
        return { success: false, error: 'חסרים פרטים' };
      if (!slots.includes(selectedTime))
        return { success: false, error: 'השעה שבחרת כבר לא פנויה. נא לבחור שנית.' };
      if (bookingInFlightRef.current) return { success: false, error: 'מבצע הזמנה...' };

      const dateStr = toDateString(selectedDate);

      if (!editingAppointmentId && futureUpcomingCount >= 2) {
        return { success: false, error: i18n.t('booking.maxFutureAppointments') };
      }

      if (editingAppointmentId) {
        const aptId = editingAppointmentId;
        const localEditNotifId = addLocalNotification({
          title: i18n.t('booking.successUpdated'),
          body: `${service.name} - ${dateStr} ${selectedTime}`,
          type: 'appointment',
          token: authToken,
        });
        bookingInFlightRef.current = true;
        setShowConfirmModal(false);
        void updateAppointment(
          aptId,
          {
            branchId: branch.id,
            staffId: staffMember.id,
            serviceId: service.id,
            date: dateStr,
            time: selectedTime,
          },
          authToken
        )
          .then((updated) => {
            const dto: AppointmentDto = {
              id: updated.id,
              date: updated.date,
              time: updated.time,
              serviceName: updated.serviceName,
              staffName: updated.staffName,
              branchName: updated.branchName,
              price: updated.price,
              status: 'confirmed',
              createdAt: updated.createdAt,
              staffId: staffMember.id,
              branchId: branch.id,
              serviceId: service.id,
            };
            updateUpcoming((prev) => prev.map((a) => (a.id === aptId ? dto : a)));
            bumpLastFetched();
            setEditingAppointmentId(null);
            setSelectedDate(null);
            setSelectedTime(null);
            slotsCacheRef.current.clear();
            slotsInflightRef.current.clear();
            slotsFetchGenRef.current += 1;
          })
          .catch((e) => {
            removeNotificationById(localEditNotifId, authToken);
            const msg = e instanceof Error ? e.message : 'לא הצלחנו לעדכן את התור';
            queueMicrotask(() => {
              Alert.alert('שגיאה', msg);
            });
          })
          .finally(() => {
            bookingInFlightRef.current = false;
          });
        return { success: true };
      }

      bookingInFlightRef.current = true;
      setSubmitting(true);
      try {
        const created = await createBooking(
          {
            branchId: branch.id,
            staffId: staffMember.id,
            serviceId: service.id,
            date: dateStr,
            time: selectedTime,
          },
          authToken
        );
        const dto: AppointmentDto = {
          id: created.id,
          date: created.date,
          time: created.time,
          serviceName: created.serviceName,
          staffName: created.staffName,
          branchName: created.branchName,
          price: created.price,
          status: 'confirmed',
          createdAt: created.createdAt,
          staffId: staffMember.id,
          branchId: branch.id,
          serviceId: service.id,
        };
        updateUpcoming((prev) => [dto, ...prev]);
        addLocalNotification({
          title: i18n.t('booking.successBooked'),
          body: `${service.name} - ${dateStr} ${selectedTime}`,
          type: 'appointment',
          token: authToken,
        });
        bumpLastFetched();
        slotsCacheRef.current.clear();
        slotsInflightRef.current.clear();
        slotsFetchGenRef.current += 1;
        setShowConfirmModal(false);
        setSelectedDate(null);
        setSelectedTime(null);
        return { success: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'לא הצלחנו לקבוע את התור';
        return { success: false, error: msg };
      } finally {
        bookingInFlightRef.current = false;
        setSubmitting(false);
      }
    },
    [
      branch,
      staffMember,
      service,
      selectedDate,
      selectedTime,
      slots,
      updateUpcoming,
      bumpLastFetched,
      addLocalNotification,
      removeNotificationById,
      editingAppointmentId,
      futureUpcomingCount,
      pendingWaitlistOfferId,
    ]
  );

  const reset = useCallback(() => {
    slotsFetchGenRef.current += 1;
    staffFetchGenRef.current += 1;
    slotsCacheRef.current.clear();
    slotsInflightRef.current.clear();
    setShowBranchModal(false);
    setShowServiceModal(false);
    setShowDateModal(false);
    setShowTimeModal(false);
    setShowConfirmModal(false);
    setSubmitting(false);
    bookingInFlightRef.current = false;
    setWaitlistSubmitting(false);
    setSlotsLoading(false);
    setStaffContextLoading(false);
    setContextError(null);
    setBranch(null);
    setStaffMember(null);
    setBranches([]);
    setService(null);
    setSelectedDate(null);
    setSelectedTime(null);
    setSlots([]);
    setSlotsNotWorkDay(false);
    setEditingAppointmentId(null);
    setPendingWaitlistOfferId(null);
  }, []);

  const joinWaitlistAction = useCallback(
    async (
      authToken: string,
      prefs: { preferMorning: boolean; preferAfternoon: boolean; preferEvening: boolean }
    ) => {
      if (!branch || !staffMember || !service || !selectedDate) {
        return { success: false, error: 'חסרים פרטים' };
      }
      if (!prefs.preferMorning && !prefs.preferAfternoon && !prefs.preferEvening) {
        return { success: false, error: 'בחר לפחות חלון אחד (בוקר / צהריים / ערב)' };
      }
      if (!editingAppointmentId && futureUpcomingCount >= 2) {
        return { success: false, error: i18n.t('booking.maxFutureAppointments') };
      }
      setWaitlistSubmitting(true);
      try {
        const dateStr = toDateString(selectedDate);
        const res = await joinWaitlist(authToken, {
          branchId: branch.id,
          staffId: staffMember.id,
          serviceId: service.id,
          date: dateStr,
          preferMorning: prefs.preferMorning,
          preferAfternoon: prefs.preferAfternoon,
          preferEvening: prefs.preferEvening,
        });
        const cacheKey = `${staffMember.id}|${dateStr}|${service.id}`;
        slotsCacheRef.current.delete(cacheKey);
        slotsInflightRef.current.delete(cacheKey);
        const entry: MyWaitlistEntry = {
          id: res.id,
          date: res.date,
          status: 'active',
          preferMorning: res.preferMorning,
          preferAfternoon: res.preferAfternoon,
          preferEvening: res.preferEvening,
          createdAt: res.createdAt,
          staffName: staffMember.name,
          serviceName: service.name,
          branchName: branch.name ?? '',
        };
        notifyWaitlistJoined(entry);
        return { success: true, entry };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'לא הצלחנו להצטרף לרשימה' };
      } finally {
        setWaitlistSubmitting(false);
      }
    },
    [branch, staffMember, service, selectedDate, editingAppointmentId, futureUpcomingCount]
  );

  const servicesForStaff: Service[] = staffMember?.services ?? [];
  const staffHasWorkingDays = !!(staffMember?.workingDays && staffMember.workingDays.length > 0);

  return {
    state: {
      staffList,
      branches,
      services: staffMember ? servicesForStaff : [],
      catalogLoading,
      staffContextLoading,
      contextError,
      slotsLoading,
      submitting,
      branch,
      staffMember,
      service,
      selectedDate,
      selectedTime,
      slots,
      bookingDayOptions,
      staffHasWorkingDays,
      canSelectDate,
      canProceedToTime,
      slotsNotWorkDay,
      canJoinWaitlist,
      waitlistStaffDayEnded,
      waitlistSubmitting,
      requiresBranchChoice,
      editingAppointmentId,
      atFutureAppointmentLimit,
      appointmentLimitChecked,
      pendingWaitlistOfferId,
    },
    actions: {
      setBranch,
      setService,
      setSelectedDate,
      setSelectedTime,
      applyStaffById,
      warmStaffBookingContext,
      fetchSlots,
      primeSlotsForDate,
      handleConfirm,
      joinWaitlist: joinWaitlistAction,
      reset,
      beginReschedule,
      beginWaitlistOfferFromId,
      checkAppointmentLimit,
    },
    modals: {
      showBranchModal,
      showServiceModal,
      showDateModal,
      showTimeModal,
      showConfirmModal,
      setShowBranchModal,
      setShowServiceModal,
      setShowDateModal,
      setShowTimeModal,
      setShowConfirmModal,
    },
  };
}
