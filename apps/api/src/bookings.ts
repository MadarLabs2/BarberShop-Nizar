import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { cacheKeyBookingsSlots, CacheService } from './core/cache.service';
import { SupabaseService } from './core/supabase';
import { TokenAuthGuard } from './auth/auth.guard';
import { RequestUser } from './auth/auth.decorator';
import type { UserPayload } from './auth';
import { AuthModule } from './auth';
import { NotificationsModule } from './notifications';
import { NotificationsService } from './notifications';
import { WaitlistModule } from './waitlist/waitlist.module';
import { WaitlistService } from './waitlist/waitlist.service';
import {
  israelTodayYmd,
  israelNowMinutesSinceMidnight,
  dayOfWeekForYmd,
  addDaysToYmd,
  formatIsraelDateLabel,
  israelDateTimeToEpochMs,
} from './core/israel-time';

/** Parse appointment Israel-local start time for comparison (date + time HH:MM). */
function appointmentStartMs(date: string, time: string): number {
  return israelDateTimeToEpochMs(date, time);
}

type AppointmentRow = {
  id: string;
  profile_id: string | null;
  client_phone: string | null;
  client_name: string | null;
  branch_id: string;
  staff_id: string;
  service_id: string;
  date: string;
  time: string;
  duration: number;
  status: string;
  service_name: string | null;
  staff_name: string | null;
  branch_name: string | null;
  price: number | null;
  created_at: string;
  /** When set, hidden from customer "past" list only; staff/admin still see the row. */
  client_hidden_at?: string | null;
};

/** Subset of `appointments` columns returned by GET /bookings/my (narrow select). */
type AppointmentMyListRow = {
  id: string;
  profile_id: string | null;
  client_phone: string | null;
  branch_id: string;
  staff_id: string;
  service_id: string;
  date: string;
  time: string;
  duration: number;
  status: string;
  service_name: string | null;
  staff_name: string | null;
  branch_name: string | null;
  service_name_he: string | null;
  service_name_ar: string | null;
  branch_name_he: string | null;
  branch_name_ar: string | null;
  price: number | null;
  created_at: string;
  updated_at?: string | null;
  client_hidden_at?: string | null;
};

const APPOINTMENT_MY_SELECT =
  'id, profile_id, client_phone, date, time, duration, status, service_name, staff_name, branch_name, service_name_he, service_name_ar, branch_name_he, branch_name_ar, price, created_at, updated_at, client_hidden_at, staff_id, branch_id, service_id';

const MY_APPOINTMENTS_CAP_PER_BRANCH = 300;

function parsePositiveInt(v: string | undefined, fallback: number): number {
  if (v == null || v === '') return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function clampMyAppointmentsLimit(n: number): number {
  return Math.min(100, Math.max(1, n));
}

function normalizePhone(s: string): string {
  return String(s || '').replace(/\D/g, '').slice(-9) || '';
}

/** Exported for unit testing (see test/bookings.slots.spec.ts) — pure functions, no behavior change. */
export function timeToMins(t: string): number {
  const s = String(t || '').slice(0, 5);
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function overlaps(
  start1: number,
  dur1: number,
  start2: number,
  dur2: number
): boolean {
  const end1 = start1 + dur1;
  const end2 = start2 + dur2;
  return Math.max(start1, start2) < Math.min(end1, end2);
}

const TTL_BOOKINGS_SLOTS = 15;

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
    private readonly waitlist: WaitlistService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Computes available slots (DB is source of truth). Used by GET /bookings/slots; optional Redis cache when safe.
   */
  private async computeAvailableSlots(
    staffId: string,
    dateStr: string,
    serviceId: string,
    branchId: string,
    excludeAppointmentId?: string,
  ): Promise<{ slots: string[]; isNotWorkDay?: boolean }> {
    /** Rolling horizon: today .. today+13 (14 calendar days), Israel calendar — same window
     * POST /bookings enforces, so this endpoint never advertises slots that can't actually be booked. */
    const todayCal = israelTodayYmd();
    const maxBookDate = addDaysToYmd(todayCal, 13);
    if (dateStr < todayCal || dateStr > maxBookDate) {
      return { slots: [] };
    }

    const [serviceRes, staffServiceRes, branchStaffRes, staffRes, branchRes] = await Promise.all([
      this.supabase.getClient().from('services').select('id, is_active').eq('id', serviceId).maybeSingle(),
      this.supabase
        .getClient()
        .from('staff_service')
        .select('price, duration')
        .eq('staff_id', staffId)
        .eq('service_id', serviceId)
        .maybeSingle(),
      this.supabase
        .getClient()
        .from('branch_staff')
        .select('staff_id')
        .eq('staff_id', staffId)
        .eq('branch_id', branchId)
        .limit(1)
        .maybeSingle(),
      this.supabase.getClient().from('staff').select('is_active').eq('id', staffId).maybeSingle(),
      this.supabase.getClient().from('branches').select('id, is_active').eq('id', branchId).maybeSingle(),
    ]);

    const service = serviceRes.data;
    if (!service) throw new BadRequestException('Service not found');
    if ((service as { is_active?: boolean }).is_active === false) throw new BadRequestException('Service not available');

    /** Closed/inactive branch must never advertise availability, even if the staff's own
     * schedule says they'd otherwise be working — matches the same check POST /bookings makes. */
    const br = branchRes.data as { is_active?: boolean } | null;
    if (!br) throw new BadRequestException('Branch not found');
    if (br.is_active === false) throw new BadRequestException('Branch not available');

    const staffServiceRow = staffServiceRes.data;
    if (!staffServiceRow) throw new BadRequestException('איש הצוות אינו מספק את הטיפול הזה');

    const duration = Math.max(5, Math.min(180, (staffServiceRow as { duration: number }).duration || 40));

    if (!branchStaffRes.data) throw new BadRequestException('Staff not assigned to branch');

    const s = staffRes.data as { is_active?: boolean } | null;
    if (s?.is_active === false) throw new BadRequestException('Staff not available');

    const dayOfWeek = dayOfWeekForYmd(dateStr);
    const { data: workingDays } = await this.supabase
      .getClient()
      .from('staff_working_days')
      .select('day_of_week, start_time, end_time')
      .eq('staff_id', staffId);
    const dayRow = (workingDays || []).find(
      (r: { day_of_week: number }) => r.day_of_week === dayOfWeek,
    ) as { day_of_week: number; start_time: string | null; end_time: string | null } | undefined;
    if (!dayRow) {
      return { slots: [], isNotWorkDay: true };
    }
    const startTime = dayRow.start_time ? String(dayRow.start_time).slice(0, 5) : '09:00';
    const endTime = dayRow.end_time ? String(dayRow.end_time).slice(0, 5) : '19:00';
    const startMins = timeToMins(startTime);
    const endMins = timeToMins(endTime);
    if (startMins >= endMins || duration > endMins - startMins) {
      return { slots: [], isNotWorkDay: false };
    }

    let aptsQuery = this.supabase
      .getClient()
      .from('appointments')
      .select('time, duration')
      .eq('staff_id', staffId)
      .eq('date', dateStr)
      .eq('status', 'confirmed');
    if (excludeAppointmentId) {
      aptsQuery = aptsQuery.neq('id', excludeAppointmentId);
    }
    const [apts, blocked] = await Promise.all([
      aptsQuery,
      this.supabase
        .getClient()
        .from('blocked_slots')
        .select('time, duration')
        .eq('staff_id', staffId)
        .eq('date', dateStr),
    ]);

    const booked = [
      ...(apts.data || []).map((r: { time: string; duration: number }) => ({
        start: timeToMins(r.time),
        duration: r.duration || 40,
      })),
      ...(blocked.data || []).map((r: { time: string; duration: number }) => ({
        start: timeToMins(r.time),
        duration: r.duration || 40,
      })),
    ];

    const today = israelTodayYmd();
    const isToday = dateStr === today;
    const nowMins = isToday ? israelNowMinutesSinceMidnight() : -1;

    const slots: string[] = [];
    let mins = startMins;

    while (mins + duration <= endMins) {
      if (isToday && mins <= nowMins) {
        mins += duration;
        continue;
      }
      const blocked = booked.some((b) =>
        overlaps(b.start, b.duration, mins, duration)
      );
      if (!blocked) slots.push(minsToTime(mins));
      mins += duration;
    }

    return { slots };
  }

  @Get('slots')
  async getAvailableSlots(
    @Query('staffId') staffId?: string,
    @Query('date') dateStr?: string,
    @Query('serviceId') serviceId?: string,
    @Query('branchId') branchId?: string,
    /** When rescheduling, exclude this appointment from conflict checks so the current slot stays selectable. */
    @Query('excludeAppointmentId') excludeAppointmentId?: string,
  ) {
    if (!staffId || !dateStr || !serviceId || !branchId) {
      throw new BadRequestException('staffId, date, serviceId, and branchId required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestException('Invalid date format (YYYY-MM-DD)');
    }

    const ex = excludeAppointmentId?.trim();
    if (ex) {
      return this.computeAvailableSlots(staffId, dateStr, serviceId, branchId, ex);
    }

    const key = cacheKeyBookingsSlots(staffId, serviceId, dateStr, branchId);
    return this.cache.getOrSet(key, TTL_BOOKINGS_SLOTS, () =>
      this.computeAvailableSlots(staffId, dateStr, serviceId, branchId, undefined),
    );
  }

  @Post()
  @UseGuards(ThrottlerGuard, TokenAuthGuard)
  @Throttle({ writes: { limit: 48, ttl: 60_000 } })
  async create(
    @RequestUser() user: UserPayload,
    @Body()
    dto: {
      branchId?: string;
      staffId?: string;
      serviceId?: string;
      date?: string;
      time?: string;
    },
  ) {
    return this.createBookingCore(user, dto);
  }

  /** First customer to confirm a freed waitlist slot gets the appointment; others’ offers are superseded. */
  @Post('waitlist/offers/:offerId/accept')
  @UseGuards(ThrottlerGuard, TokenAuthGuard)
  @Throttle({ writes: { limit: 36, ttl: 60_000 } })
  async acceptWaitlistOffer(@RequestUser() user: UserPayload, @Param('offerId') offerId: string) {
    const offer = await this.waitlist.getPendingOfferForUser(user.id, offerId);
    if (!offer) {
      const why = await this.waitlist.explainNonPendingOffer(user.id, offerId);
      if (why === 'superseded') {
        throw new BadRequestException(
          'מישהו אחר הספיק לאשר את השעה לפניך. השעה נתפסה — נשארת ברשימת ההמתנה לשעות נוספות.',
        );
      }
      if (why === 'expired') {
        throw new BadRequestException('ההצעה פגה — עבר זמן השעה.');
      }
      throw new BadRequestException('ההצעה אינה זמינה.');
    }
    let branchId = offer.branch_id;
    if (!branchId) {
      const { data: link } = await this.supabase
        .getClient()
        .from('branch_staff')
        .select('branch_id')
        .eq('staff_id', offer.staff_id)
        .limit(1)
        .maybeSingle();
      branchId = (link as { branch_id?: string } | null)?.branch_id ?? null;
    }
    if (!branchId) {
      throw new BadRequestException('לא נמצא סניף לתור זה');
    }
    return this.createBookingCore(
      user,
      {
        branchId,
        staffId: offer.staff_id,
        serviceId: offer.service_id,
        date: offer.date,
        time: String(offer.time).slice(0, 5),
      },
      { winningOfferId: offerId, waitlistAccept: true },
    );
  }

  private async invalidateSlotCachesAfterBookingWrite(
    staffId: string,
    date: string,
    prev?: { staffId: string; date: string } | null,
  ) {
    await this.cache.invalidateAdminSummary();
    await this.cache.invalidateBookingsSlotsForStaffDate(staffId, date);
    if (prev) {
      await this.cache.invalidateBookingsSlotsForStaffDate(prev.staffId, prev.date);
    }
  }

  private async createBookingCore(
    user: UserPayload,
    dto: {
      branchId?: string;
      staffId?: string;
      serviceId?: string;
      date?: string;
      time?: string;
    },
    opts?: { winningOfferId?: string; waitlistAccept?: boolean; replaceAppointmentId?: string },
  ) {
    const { branchId, staffId, serviceId, date, time } = dto;
    if (!branchId || !staffId || !serviceId || !date || !time) {
      throw new BadRequestException('branchId, staffId, serviceId, date, time required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Invalid date format');
    }
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      throw new BadRequestException('Invalid time format (HH:MM)');
    }

    let prevSlotForCache: { staffId: string; date: string } | null = null;
    if (opts?.replaceAppointmentId) {
      const { data: prevRow } = await this.supabase
        .getClient()
        .from('appointments')
        .select('staff_id, date')
        .eq('id', opts.replaceAppointmentId)
        .maybeSingle();
      if (prevRow) {
        prevSlotForCache = {
          staffId: (prevRow as { staff_id: string }).staff_id,
          date: (prevRow as { date: string }).date,
        };
      }
    }

    const clientPhone = normalizePhone(user.phone);
    if (!clientPhone) throw new UnauthorizedException('Invalid user phone');

    const clientName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'לקוח';

    const { data: branch } = await this.supabase
      .getClient()
      .from('branches')
      .select('id, name, name_he, name_ar, is_active')
      .eq('id', branchId)
      .maybeSingle();

    if (!branch) throw new BadRequestException('Branch not found');
    const br = branch as { name: string; name_he: string; name_ar: string; is_active?: boolean };
    if (br.is_active === false) {
      throw new BadRequestException('Branch not available');
    }

    const { data: service } = await this.supabase
      .getClient()
      .from('services')
      .select('id, name, name_he, name_ar, is_active')
      .eq('id', serviceId)
      .maybeSingle();

    if (!service) throw new BadRequestException('Service not found');
    const svcBase = service as { name: string; name_he: string; name_ar: string; is_active?: boolean };
    if (svcBase.is_active === false) throw new BadRequestException('Service not available');

    const { data: staffServiceRow } = await this.supabase
      .getClient()
      .from('staff_service')
      .select('price, duration')
      .eq('staff_id', staffId)
      .eq('service_id', serviceId)
      .maybeSingle();

    if (!staffServiceRow) throw new BadRequestException('איש הצוות אינו מספק את הטיפול הזה');
    const ss = staffServiceRow as { price: number; duration: number };
    const svc = { name: svcBase.name, nameHe: svcBase.name_he, nameAr: svcBase.name_ar, price: ss.price, duration: ss.duration };

    const { data: staff } = await this.supabase
      .getClient()
      .from('staff')
      .select('id, name, is_active')
      .eq('id', staffId)
      .maybeSingle();

    if (!staff) throw new BadRequestException('Staff not found');
    const st = staff as { name: string; is_active?: boolean };
    if (st.is_active === false) throw new BadRequestException('Staff not available');

    const { data: link } = await this.supabase
      .getClient()
      .from('branch_staff')
      .select('branch_id')
      .eq('branch_id', branchId)
      .eq('staff_id', staffId)
      .maybeSingle();

    if (!link) throw new BadRequestException('Staff not assigned to branch');

    const { data: staffServiceLink } = await this.supabase
      .getClient()
      .from('staff_service')
      .select('id')
      .eq('staff_id', staffId)
      .eq('service_id', serviceId)
      .maybeSingle();

    if (!staffServiceLink) throw new BadRequestException('איש הצוות אינו מספק את הטיפול הזה');

    const dayOfWeek = dayOfWeekForYmd(date);
    const { data: workingDays } = await this.supabase
      .getClient()
      .from('staff_working_days')
      .select('day_of_week, start_time, end_time')
      .eq('staff_id', staffId);
    const dayRow = (workingDays || []).find(
      (r: { day_of_week: number }) => r.day_of_week === dayOfWeek,
    ) as { day_of_week: number; start_time: string | null; end_time: string | null } | undefined;
    if (!dayRow) {
      throw new BadRequestException('יום זה אינו יום עבודה של איש הצוות');
    }
    const startTime = dayRow.start_time ? String(dayRow.start_time).slice(0, 5) : '09:00';
    const endTime = dayRow.end_time ? String(dayRow.end_time).slice(0, 5) : '19:00';
    const startMins = timeToMins(startTime);
    const endMins = timeToMins(endTime);
    const slotMins = timeToMins(time);
    if (slotMins < startMins) {
      throw new BadRequestException('השעה שבחרת מוקדמת משעות העבודה של איש הצוות');
    }
    if (slotMins + svc.duration > endMins) {
      throw new BadRequestException('השעה שבחרת חורגת משעות העבודה של איש הצוות');
    }

    const today = israelTodayYmd();
    const nowMins = date === today ? israelNowMinutesSinceMidnight() : -1;

    if (date === today && slotMins <= nowMins) {
      throw new BadRequestException('Selected time has passed');
    }

    /** Rolling horizon: today .. today+13 (14 calendar days), Israel calendar. */
    const todayCal = israelTodayYmd();
    const maxBookDate = addDaysToYmd(todayCal, 13);
    if (date < todayCal || date > maxBookDate) {
      throw new BadRequestException('ניתן לקבוע תור עד שבועיים קדימה בלבד');
    }

    let aptsQuery = this.supabase
      .getClient()
      .from('appointments')
      .select('time, duration')
      .eq('staff_id', staffId)
      .eq('date', date)
      .eq('status', 'confirmed');
    if (opts?.replaceAppointmentId) {
      aptsQuery = aptsQuery.neq('id', opts.replaceAppointmentId);
    }
    const [apts, blocked] = await Promise.all([
      aptsQuery,
      this.supabase
        .getClient()
        .from('blocked_slots')
        .select('time, duration')
        .eq('staff_id', staffId)
        .eq('date', date),
    ]);

    const booked = [
      ...(apts.data || []).map((r: { time: string; duration: number }) => ({
        start: timeToMins(r.time),
        duration: r.duration || 40,
      })),
      ...(blocked.data || []).map((r: { time: string; duration: number }) => ({
        start: timeToMins(r.time),
        duration: r.duration || 40,
      })),
    ];

    const overlapsExisting = booked.some((b) =>
      overlaps(b.start, b.duration, slotMins, svc.duration)
    );

    if (overlapsExisting) {
      throw new BadRequestException(
        opts?.waitlistAccept
          ? 'מישהו אחר הספיק לאשר את השעה לפניך. השעה נתפסה — נשארת ברשימת ההמתנה לשעות נוספות.'
          : 'Slot no longer available',
      );
    }

    const timeNormalized = time.length === 5 ? time : `${time}:00`;
    const dateStrHe = formatIsraelDateLabel(date);
    const timeShort = time.length === 5 ? time : time.slice(0, 5);

    if (opts?.replaceAppointmentId) {
      /** Atomic in the DB (migration 043): re-checks blocked_slots and writes the row under a
       * per-staff advisory lock, so this can't race with a concurrent admin block the same way a
       * plain UPDATE could. The appointments_no_overlap exclusion constraint (040) and the
       * max-upcoming trigger (041) still fire on the UPDATE inside that function. */
      const { data: updatedRows, error: upErr } = await this.supabase.getClient().rpc('create_or_reschedule_appointment', {
        p_id: opts.replaceAppointmentId,
        p_profile_id: user.id,
        p_client_phone: clientPhone,
        p_client_name: clientName,
        p_branch_id: branchId,
        p_staff_id: staffId,
        p_service_id: serviceId,
        p_date: date,
        p_time: timeNormalized,
        p_duration: svc.duration,
        p_service_name: svc.name,
        p_staff_name: st.name,
        p_branch_name: br.name,
        p_price: svc.price,
        p_service_name_he: svc.nameHe,
        p_service_name_ar: svc.nameAr,
        p_branch_name_he: br.name_he,
        p_branch_name_ar: br.name_ar,
      });

      if (upErr) {
        const code = (upErr as { code?: string }).code;
        const message = (upErr as { message?: string }).message || '';
        /** 23505/23P01 = another confirmed appointment now overlaps (DB exclusion constraint);
         * SLOT_BLOCKED = the slot fell inside a blocked range created concurrently with this
         * reschedule (migration 043's re-check). Both mean "someone/something took it first". */
        if (code === '23505' || code === '23P01' || message.includes('SLOT_BLOCKED')) {
          throw new BadRequestException(
            opts?.waitlistAccept
              ? 'מישהו אחר הספיק לאשר את השעה לפניך. השעה נתפסה — נשארת ברשימת ההמתנה לשעות נוספות.'
              : 'השעה נתפסה על ידי לקוח אחר — נסו שוב או בחרו שעה אחרת.',
          );
        }
        if (message.includes('MAX_UPCOMING_APPOINTMENTS')) {
          throw new BadRequestException(
            'ניתן להחזיק עד שני תורים עתידיים בלבד. בטלו או השלימו תור לפני קביעת תור נוסף.',
          );
        }
        throw new BadRequestException('Failed to update appointment');
      }

      const updated = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;
      if (!updated) {
        throw new BadRequestException('Appointment not found');
      }

      this.notifications
        .create({
          userPhone: clientPhone,
          type: 'personal',
          title: 'עודכן תור',
          body: `תור ל${svc.name} אצל ${st.name} בתאריך ${dateStrHe} בשעה ${timeShort}`,
          pushScreen: 'Appointments',
        })
        .catch(() => {});

      await this.waitlist.afterBookingCreatedForSlot({
        staffId,
        date,
        time: timeShort,
        serviceId,
        winningOfferId: opts?.winningOfferId,
      });

      const row = updated as Record<string, unknown>;
      await this.invalidateSlotCachesAfterBookingWrite(staffId, date, prevSlotForCache);
      return {
        id: row.id,
        date: row.date,
        time: typeof row.time === 'string' ? row.time.slice(0, 5) : row.time,
        serviceName: row.service_name,
        staffName: row.staff_name,
        branchName: row.branch_name,
        serviceNameHe: row.service_name_he ?? row.service_name,
        serviceNameAr: row.service_name_ar ?? row.service_name,
        branchNameHe: row.branch_name_he ?? row.branch_name,
        branchNameAr: row.branch_name_ar ?? row.branch_name,
        price: row.price,
        createdAt: row.created_at,
      };
    }

    const { data: existingMine } = await this.supabase
      .getClient()
      .from('appointments')
      .select('id, date, time')
      .eq('client_phone', clientPhone)
      .eq('status', 'confirmed');
    const nowMs = Date.now();
    const upcomingCount = (existingMine || []).filter((r: { date: string; time: string }) => {
      return appointmentStartMs(r.date, r.time) > nowMs;
    }).length;
    if (upcomingCount >= 2) {
      throw new BadRequestException(
        'ניתן להחזיק עד שני תורים עתידיים בלבד. בטלו או השלימו תור לפני קביעת תור נוסף.',
      );
    }

    /** Atomic in the DB (migration 043): re-checks blocked_slots and inserts the row under a
     * per-staff advisory lock — the same function/lock reschedule uses above, so a concurrent
     * admin block on this staff member can't slip in between this app-level check and the write. */
    const { data: insertedRows, error } = await this.supabase.getClient().rpc('create_or_reschedule_appointment', {
      p_id: null,
      p_profile_id: user.id,
      p_client_phone: clientPhone,
      p_client_name: clientName,
      p_branch_id: branchId,
      p_staff_id: staffId,
      p_service_id: serviceId,
      p_date: date,
      p_time: timeNormalized,
      p_duration: svc.duration,
      p_service_name: svc.name,
      p_staff_name: st.name,
      p_branch_name: br.name,
      p_price: svc.price,
      p_service_name_he: svc.nameHe,
      p_service_name_ar: svc.nameAr,
      p_branch_name_he: br.name_he,
      p_branch_name_ar: br.name_ar,
    });

    if (error) {
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message || '';
      /** 23505 = exact-time unique index; 23P01 = the overlap exclusion constraint (different
       * start times that still overlap in duration); SLOT_BLOCKED = a concurrent admin block —
       * all three mean the DB rejected a real conflict that slipped past the application-level
       * check above under concurrent requests. */
      if (code === '23505' || code === '23P01' || message.includes('SLOT_BLOCKED')) {
        throw new BadRequestException(
          opts?.waitlistAccept
            ? 'מישהו אחר הספיק לאשר את השעה לפניך. השעה נתפסה — נשארת ברשימת ההמתנה לשעות נוספות.'
            : 'השעה נתפסה על ידי לקוח אחר — נסו שוב או בחרו שעה אחרת.',
        );
      }
      if (message.includes('MAX_UPCOMING_APPOINTMENTS')) {
        throw new BadRequestException(
          'ניתן להחזיק עד שני תורים עתידיים בלבד. בטלו או השלימו תור לפני קביעת תור נוסף.',
        );
      }
      throw new BadRequestException('Failed to create appointment');
    }

    const inserted = Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;
    if (!inserted) {
      throw new BadRequestException('Failed to create appointment');
    }

    this.notifications
      .create({
        userPhone: clientPhone,
        type: 'personal',
        title: 'קבעת תור',
        body: `תור ל${svc.name} אצל ${st.name} בתאריך ${dateStrHe} בשעה ${timeShort}`,
        pushScreen: 'Appointments',
      })
      .catch(() => {});

    await this.waitlist.fulfillIfMatched(user.id, staffId, serviceId, date);
    await this.waitlist.afterBookingCreatedForSlot({
      staffId,
      date,
      time: timeShort,
      serviceId,
      winningOfferId: opts?.winningOfferId,
    });

    const row = inserted as Record<string, unknown>;
    await this.invalidateSlotCachesAfterBookingWrite(staffId, date, prevSlotForCache);
    return {
      id: row.id,
      date: row.date,
      time: typeof row.time === 'string' ? row.time.slice(0, 5) : row.time,
      serviceName: row.service_name,
      staffName: row.staff_name,
      branchName: row.branch_name,
      serviceNameHe: row.service_name_he ?? row.service_name,
      serviceNameAr: row.service_name_ar ?? row.service_name,
      branchNameHe: row.branch_name_he ?? row.branch_name,
      branchNameAr: row.branch_name_ar ?? row.branch_name,
      price: row.price,
      createdAt: row.created_at,
    };
  }

  @Patch('my/:id')
  @UseGuards(TokenAuthGuard)
  async updateMyAppointment(
    @RequestUser() user: UserPayload,
    @Param('id') id: string,
    @Body()
    dto: { branchId?: string; staffId?: string; serviceId?: string; date?: string; time?: string },
  ) {
    const phone = normalizePhone(user.phone);
    if (!phone) throw new UnauthorizedException('Invalid user phone');

    const { data: existing, error: exErr } = await this.supabase
      .getClient()
      .from('appointments')
      .select('*')
      .eq('id', id)
      .single();

    if (exErr || !existing) throw new BadRequestException('Appointment not found');

    const row = existing as AppointmentRow;
    if (row.status === 'cancelled') {
      throw new BadRequestException('Appointment already cancelled');
    }

    const aptPhone = row.client_phone ? normalizePhone(row.client_phone) : '';
    const ownsByPhone = phone && aptPhone && aptPhone === phone;
    const ownsByProfile = row.profile_id === user.id;
    if (!ownsByPhone && !ownsByProfile) {
      throw new UnauthorizedException('Not your appointment');
    }

    const oldTime = typeof row.time === 'string' ? row.time.slice(0, 5) : String(row.time);

    /** Only tell the waitlist the old slot is free once the reschedule has actually succeeded —
     * notifying beforehand would offer a slot that's still occupied if this update fails. */
    const result = await this.createBookingCore(user, dto, { replaceAppointmentId: id });

    void this.waitlist
      .notifyFreedSlot({
        staffId: row.staff_id,
        date: row.date,
        time: oldTime,
        serviceId: row.service_id,
      })
      .catch(() => {});

    return result;
  }

  @Get('my')
  @UseGuards(TokenAuthGuard)
  async getMyAppointments(
    @RequestUser() user: UserPayload,
    @Query('scope') scopeRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('page') pageRaw?: string,
  ) {
    const phone = normalizePhone(user.phone);
    if (!phone) return { upcoming: [], past: [] };

    const scopeLower = scopeRaw != null && String(scopeRaw).trim() !== '' ? String(scopeRaw).trim().toLowerCase() : '';
    if (scopeLower && !['upcoming', 'past', 'all'].includes(scopeLower)) {
      throw new BadRequestException('scope must be upcoming, past, or all');
    }
    const effectiveScope = (scopeLower || 'all') as 'upcoming' | 'past' | 'all';
    const hasPagination = (limitRaw != null && String(limitRaw).trim() !== '') || (pageRaw != null && String(pageRaw).trim() !== '');
    const useScopedFetch =
      hasPagination || effectiveScope === 'upcoming' || effectiveScope === 'past';

    const client = this.supabase.getClient();
    const orFilter = `client_phone.eq.${phone},profile_id.eq.${user.id}`;

    const toDto = (r: AppointmentMyListRow) => ({
      id: r.id,
      date: r.date,
      time: typeof r.time === 'string' ? r.time.slice(0, 5) : r.time,
      serviceName: r.service_name || 'טיפול',
      staffName: r.staff_name || '',
      branchName: r.branch_name || '',
      serviceNameHe: r.service_name_he || r.service_name || 'טיפול',
      serviceNameAr: r.service_name_ar || r.service_name || 'علاج',
      branchNameHe: r.branch_name_he || r.branch_name || '',
      branchNameAr: r.branch_name_ar || r.branch_name || '',
      price: r.price ?? 0,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at ?? r.created_at,
      staffId: r.staff_id,
      branchId: r.branch_id,
      serviceId: r.service_id,
    });

    const nowMs = Date.now();

    if (!useScopedFetch && effectiveScope === 'all') {
      const { data: rows, error } = await client
        .from('appointments')
        .select(APPOINTMENT_MY_SELECT)
        .or(orFilter)
        .neq('status', 'cancelled')
        .order('date', { ascending: true })
        .order('time', { ascending: true });

      if (error) return { upcoming: [], past: [] };

      const list = (rows || []) as AppointmentMyListRow[];
      const upcoming = list.filter((r) => appointmentStartMs(r.date, r.time) > nowMs).map(toDto);
      const past = list
        .filter((r) => appointmentStartMs(r.date, r.time) <= nowMs)
        .filter((r) => !r.client_hidden_at)
        .sort((a, b) => appointmentStartMs(b.date, b.time) - appointmentStartMs(a.date, a.time))
        .map(toDto);
      return { upcoming, past };
    }

    const limit = clampMyAppointmentsLimit(parsePositiveInt(limitRaw, 20));
    const page = Math.max(1, parsePositiveInt(pageRaw, 1));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const today = israelTodayYmd();

    if (effectiveScope === 'upcoming') {
      const { data: rows, error } = await client
        .from('appointments')
        .select(APPOINTMENT_MY_SELECT)
        .or(orFilter)
        .neq('status', 'cancelled')
        .gte('date', today)
        .order('date', { ascending: true })
        .order('time', { ascending: true })
        .range(from, to);
      if (error) return { upcoming: [], past: [] };
      const upcoming = (rows || [])
        .filter((r) => appointmentStartMs((r as AppointmentMyListRow).date, (r as AppointmentMyListRow).time) > nowMs)
        .map((r) => toDto(r as AppointmentMyListRow));
      return { upcoming, past: [] };
    }

    if (effectiveScope === 'past') {
      const { data: rows, error } = await client
        .from('appointments')
        .select(APPOINTMENT_MY_SELECT)
        .or(orFilter)
        .neq('status', 'cancelled')
        .lte('date', today)
        .is('client_hidden_at', null)
        .order('date', { ascending: false })
        .order('time', { ascending: false })
        .range(from, to);
      if (error) return { upcoming: [], past: [] };
      const past = (rows || [])
        .filter((r) => appointmentStartMs((r as AppointmentMyListRow).date, (r as AppointmentMyListRow).time) <= nowMs)
        .map((r) => toDto(r as AppointmentMyListRow));
      return { upcoming: [], past };
    }

    const [upRes, pastRes] = await Promise.all([
      client
        .from('appointments')
        .select(APPOINTMENT_MY_SELECT)
        .or(orFilter)
        .neq('status', 'cancelled')
        .gte('date', today)
        .order('date', { ascending: true })
        .order('time', { ascending: true })
        .limit(MY_APPOINTMENTS_CAP_PER_BRANCH),
      client
        .from('appointments')
        .select(APPOINTMENT_MY_SELECT)
        .or(orFilter)
        .neq('status', 'cancelled')
        .lte('date', today)
        .is('client_hidden_at', null)
        .order('date', { ascending: false })
        .order('time', { ascending: false })
        .limit(MY_APPOINTMENTS_CAP_PER_BRANCH),
    ]);

    if (upRes.error || pastRes.error) return { upcoming: [], past: [] };

    const upcomingFull = (upRes.data || [])
      .filter((r) => appointmentStartMs((r as AppointmentMyListRow).date, (r as AppointmentMyListRow).time) > nowMs)
      .map((r) => toDto(r as AppointmentMyListRow));
    const pastFull = (pastRes.data || [])
      .filter((r) => appointmentStartMs((r as AppointmentMyListRow).date, (r as AppointmentMyListRow).time) <= nowMs)
      .map((r) => toDto(r as AppointmentMyListRow));

    const upcoming = upcomingFull.slice(from, to + 1);
    const past = pastFull.slice(from, to + 1);
    return { upcoming, past };
  }

  @Post('my/clear-past-history')
  @UseGuards(TokenAuthGuard)
  async clearPastHistory(@RequestUser() user: UserPayload) {
    const phone = normalizePhone(user.phone);
    if (!phone) return { cleared: 0 };

    const { data: rows, error } = await this.supabase
      .getClient()
      .from('appointments')
      .select('id, date, time, client_hidden_at')
      .or(`client_phone.eq.${phone},profile_id.eq.${user.id}`)
      .neq('status', 'cancelled');

    if (error) throw new BadRequestException('Failed to load appointments');

    const nowMs = Date.now();
    const pastIds = (rows || [])
      .filter((r) => {
        const row = r as AppointmentRow;
        if (row.client_hidden_at) return false;
        return appointmentStartMs(row.date, row.time) <= nowMs;
      })
      .map((r) => (r as { id: string }).id);

    if (pastIds.length === 0) return { cleared: 0 };

    const hiddenAt = new Date().toISOString();
    const { error: upErr } = await this.supabase
      .getClient()
      .from('appointments')
      .update({ client_hidden_at: hiddenAt, updated_at: hiddenAt })
      .in('id', pastIds);

    if (upErr) throw new BadRequestException('Failed to hide past appointments');
    return { cleared: pastIds.length };
  }

  @Post(':id/cancel')
  @UseGuards(TokenAuthGuard)
  async cancel(@RequestUser() user: UserPayload, @Param('id') id: string) {
    const phone = normalizePhone(user.phone);

    const { data: apt, error: fetchErr } = await this.supabase
      .getClient()
      .from('appointments')
      .select('id, client_phone, profile_id, status, service_name, date, time, staff_id, service_id')
      .eq('id', id)
      .single();

    if (fetchErr || !apt) throw new BadRequestException('Appointment not found');

    const row = apt as {
      client_phone: string | null;
      profile_id: string | null;
      status: string;
      service_name: string | null;
      date: string;
      time: string;
      staff_id: string;
      service_id: string;
    };
    if (row.status === 'cancelled') {
      throw new BadRequestException('Appointment already cancelled');
    }

    const aptPhone = row.client_phone ? normalizePhone(row.client_phone) : '';
    const ownsByPhone = phone && aptPhone && aptPhone === phone;
    const ownsByProfile = row.profile_id === user.id;
    const isAssignedStaff = !!(user.staffId && row.staff_id === user.staffId);

    if (!ownsByPhone && !ownsByProfile && !isAssignedStaff) {
      throw new UnauthorizedException('Not your appointment');
    }

    const { error: updateErr } = await this.supabase
      .getClient()
      .from('appointments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateErr) throw new BadRequestException('Failed to cancel');

    const timeShort = typeof row.time === 'string' ? row.time.slice(0, 5) : String(row.time);

    await this.cache.invalidateAdminSummary();
    await this.cache.invalidateBookingsSlotsForStaffDate(row.staff_id, row.date);

    if (aptPhone) {
      const dateStr = formatIsraelDateLabel(row.date);
      const svcName = row.service_name || 'טיפול';
      const customerSelfCancel = ownsByPhone || ownsByProfile;
      this.notifications
        .create({
          userPhone: aptPhone,
          type: 'personal',
          title: customerSelfCancel ? 'ביטלת תור' : 'התור בוטל',
          body: customerSelfCancel
            ? `התור ל${svcName} בתאריך ${dateStr} בוטל`
            : `התור ל${svcName} בתאריך ${dateStr} בשעה ${timeShort} בוטל. אנו מתנצלים על אי הנוחות ונשמח לעזור לקבוע מועד חדש.`,
          pushScreen: 'Appointments',
        })
        .catch(() => {});
    }

    void this.waitlist
      .notifyFreedSlot({
        staffId: row.staff_id,
        date: row.date,
        time: timeShort,
        serviceId: row.service_id,
      })
      .catch(() => {});

    return { ok: true };
  }
}

@Module({
  imports: [AuthModule, NotificationsModule, WaitlistModule],
  controllers: [BookingsController],
})
export class BookingsModule {}
