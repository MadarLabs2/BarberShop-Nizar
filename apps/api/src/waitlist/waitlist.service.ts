import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../core/supabase';
import { NotificationsService } from '../notifications';
import type { UserPayload } from '../auth/auth.service';
import {
  israelTodayYmd,
  israelNowMinutesSinceMidnight,
  dayOfWeekForYmd,
  addDaysToYmd,
  formatIsraelDateLabel,
} from '../core/israel-time';

/** Local day-part windows (minutes from midnight, [start, end)). */
const MORNING_START = 8 * 60;
const MORNING_END = 12 * 60;
const AFTERNOON_START = 12 * 60;
const AFTERNOON_END = 17 * 60;
const EVENING_START = 17 * 60;
const EVENING_END = 22 * 60;

function normalizePhone(s: string): string {
  return String(s || '').replace(/\D/g, '').slice(-9) || '';
}

function timeToMins(t: string): number {
  const s = String(t || '').slice(0, 5);
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function overlaps(start1: number, dur1: number, start2: number, dur2: number): boolean {
  const end1 = start1 + dur1;
  const end2 = start2 + dur2;
  return Math.max(start1, start2) < Math.min(end1, end2);
}

/** Freed slot start time matches at least one preferred day-part. */
export function freedTimeMatchesPreferences(
  timeStr: string,
  preferMorning: boolean,
  preferAfternoon: boolean,
  preferEvening: boolean,
): boolean {
  const mins = timeToMins(timeStr);
  if (preferMorning && mins >= MORNING_START && mins < MORNING_END) return true;
  if (preferAfternoon && mins >= AFTERNOON_START && mins < AFTERNOON_END) return true;
  if (preferEvening && mins >= EVENING_START && mins < EVENING_END) return true;
  return false;
}

/** True if at least one chosen day-part (בוקר/צהריים/ערב) overlaps the staff shift [start,end) in minutes. */
export function prefsOverlapStaffWindow(
  preferMorning: boolean,
  preferAfternoon: boolean,
  preferEvening: boolean,
  staffStartMins: number,
  staffEndMins: number,
): boolean {
  if (staffStartMins >= staffEndMins) return false;
  if (preferMorning && Math.max(MORNING_START, staffStartMins) < Math.min(MORNING_END, staffEndMins)) return true;
  if (preferAfternoon && Math.max(AFTERNOON_START, staffStartMins) < Math.min(AFTERNOON_END, staffEndMins)) return true;
  if (preferEvening && Math.max(EVENING_START, staffStartMins) < Math.min(EVENING_END, staffEndMins)) return true;
  return false;
}

const WAITLIST_SCHEDULE_NOTIFY_HORIZON_DAYS = 42;

function scheduleWindowExpanded(
  prev: { startMins: number; endMins: number } | null,
  next: { startMins: number; endMins: number },
): boolean {
  if (next.startMins >= next.endMins) return false;
  if (!prev) return true;
  if (prev.startMins >= prev.endMins) return true;
  return next.startMins < prev.startMins || next.endMins > prev.endMins;
}

function slotStartInExpandedRegion(
  slotStartMins: number,
  prev: { startMins: number; endMins: number } | null,
  next: { startMins: number; endMins: number },
): boolean {
  if (slotStartMins < next.startMins || slotStartMins >= next.endMins) return false;
  if (!prev) return true;
  if (prev.startMins >= prev.endMins) return true;
  return slotStartMins < prev.startMins || slotStartMins >= prev.endMins;
}

@Injectable()
export class WaitlistService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Same availability logic as GET /bookings/slots — returns count of bookable slots. */
  private async countAvailableSlots(staffId: string, dateStr: string, serviceId: string): Promise<{ count: number; isNotWorkDay: boolean }> {
    const client = this.supabase.getClient();
    const [serviceRes, staffServiceRes, branchStaffRes, staffRes] = await Promise.all([
      client.from('services').select('id, is_active').eq('id', serviceId).maybeSingle(),
      client
        .from('staff_service')
        .select('price, duration')
        .eq('staff_id', staffId)
        .eq('service_id', serviceId)
        .maybeSingle(),
      client.from('branch_staff').select('staff_id').eq('staff_id', staffId).limit(1).maybeSingle(),
      client.from('staff').select('is_active').eq('id', staffId).maybeSingle(),
    ]);

    if (!serviceRes.data || (serviceRes.data as { is_active?: boolean }).is_active === false) {
      return { count: 0, isNotWorkDay: true };
    }
    if (!staffServiceRes.data || !branchStaffRes.data) return { count: 0, isNotWorkDay: true };
    const s = staffRes.data as { is_active?: boolean } | null;
    if (s?.is_active === false) return { count: 0, isNotWorkDay: true };

    const duration = Math.max(5, Math.min(180, (staffServiceRes.data as { duration: number }).duration || 40));

    const dayOfWeek = dayOfWeekForYmd(dateStr);
    const { data: workingDays } = await client
      .from('staff_working_days')
      .select('day_of_week, start_time, end_time')
      .eq('staff_id', staffId);
    const dayRow = (workingDays || []).find((r: { day_of_week: number }) => r.day_of_week === dayOfWeek) as
      | { day_of_week: number; start_time: string | null; end_time: string | null }
      | undefined;
    if (!dayRow) return { count: 0, isNotWorkDay: true };

    const startTime = dayRow.start_time ? String(dayRow.start_time).slice(0, 5) : '09:00';
    const endTime = dayRow.end_time ? String(dayRow.end_time).slice(0, 5) : '19:00';
    const startMins = timeToMins(startTime);
    const endMins = timeToMins(endTime);
    if (startMins >= endMins || duration > endMins - startMins) {
      return { count: 0, isNotWorkDay: false };
    }

    const [apts, blocked] = await Promise.all([
      client
        .from('appointments')
        .select('time, duration')
        .eq('staff_id', staffId)
        .eq('date', dateStr)
        .eq('status', 'confirmed'),
      client
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

    let count = 0;
    let mins = startMins;
    while (mins + duration <= endMins) {
      if (isToday && mins <= nowMins) {
        mins += duration;
        continue;
      }
      const blockedSlot = booked.some((b) => overlaps(b.start, b.duration, mins, duration));
      if (!blockedSlot) count += 1;
      mins += duration;
    }

    return { count, isNotWorkDay: false };
  }

  private minsToHHMM(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Bookable slot start times (HH:MM) — same grid as `countAvailableSlots`. */
  private async listBookableSlotStarts(staffId: string, dateStr: string, serviceId: string): Promise<string[]> {
    const client = this.supabase.getClient();
    const [serviceRes, staffServiceRes, branchStaffRes, staffRes] = await Promise.all([
      client.from('services').select('id, is_active').eq('id', serviceId).maybeSingle(),
      client
        .from('staff_service')
        .select('price, duration')
        .eq('staff_id', staffId)
        .eq('service_id', serviceId)
        .maybeSingle(),
      client.from('branch_staff').select('staff_id').eq('staff_id', staffId).limit(1).maybeSingle(),
      client.from('staff').select('is_active').eq('id', staffId).maybeSingle(),
    ]);

    if (!serviceRes.data || (serviceRes.data as { is_active?: boolean }).is_active === false) {
      return [];
    }
    if (!staffServiceRes.data || !branchStaffRes.data) return [];
    const s = staffRes.data as { is_active?: boolean } | null;
    if (s?.is_active === false) return [];

    const duration = Math.max(5, Math.min(180, (staffServiceRes.data as { duration: number }).duration || 40));

    const dayOfWeek = dayOfWeekForYmd(dateStr);
    const { data: workingDays } = await client
      .from('staff_working_days')
      .select('day_of_week, start_time, end_time')
      .eq('staff_id', staffId);
    const dayRow = (workingDays || []).find((r: { day_of_week: number }) => r.day_of_week === dayOfWeek) as
      | { day_of_week: number; start_time: string | null; end_time: string | null }
      | undefined;
    if (!dayRow) return [];

    const startTime = dayRow.start_time ? String(dayRow.start_time).slice(0, 5) : '09:00';
    const endTime = dayRow.end_time ? String(dayRow.end_time).slice(0, 5) : '19:00';
    const startMins = timeToMins(startTime);
    const endMins = timeToMins(endTime);
    if (startMins >= endMins || duration > endMins - startMins) {
      return [];
    }

    const [apts, blocked] = await Promise.all([
      client
        .from('appointments')
        .select('time, duration')
        .eq('staff_id', staffId)
        .eq('date', dateStr)
        .eq('status', 'confirmed'),
      client
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

    const times: string[] = [];
    let mins = startMins;
    while (mins + duration <= endMins) {
      if (isToday && mins <= nowMins) {
        mins += duration;
        continue;
      }
      const blockedSlot = booked.some((b) => overlaps(b.start, b.duration, mins, duration));
      if (!blockedSlot) times.push(this.minsToHHMM(mins));
      mins += duration;
    }

    return times;
  }

  private async hasPendingSlotOfferForWaitlistDate(waitlistId: string, dateStr: string): Promise<boolean> {
    const { data } = await this.supabase
      .getClient()
      .from('waitlist_slot_offers')
      .select('id')
      .eq('waitlist_id', waitlistId)
      .eq('date', dateStr)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();
    return !!data;
  }

  /**
   * After staff extends working hours or adds a weekday: offer the earliest newly-available slot per waitlist row
   * (matches day-part prefs only; skips rows that already have a pending offer that day).
   */
  async notifyWorkingHoursExpanded(
    staffId: string,
    dayOfWeek: number,
    prev: { startMins: number; endMins: number } | null,
    next: { startMins: number; endMins: number },
  ): Promise<void> {
    if (!scheduleWindowExpanded(prev, next)) return;

    const client = this.supabase.getClient();
    const { data: staffRow } = await client.from('staff').select('name').eq('id', staffId).maybeSingle();
    const staffName = (staffRow as { name?: string } | null)?.name ?? 'איש הצוות';

    const todayStr = israelTodayYmd();
    for (let i = 0; i < WAITLIST_SCHEDULE_NOTIFY_HORIZON_DAYS; i++) {
      const dateStr = addDaysToYmd(todayStr, i);
      const dow = dayOfWeekForYmd(dateStr);
      if (dow !== dayOfWeek) continue;

      const { data: wlRows, error } = await client
        .from('waitlist')
        .select('id, profile_id, branch_id, client_phone, prefer_morning, prefer_afternoon, prefer_evening, service_id')
        .eq('staff_id', staffId)
        .eq('date', dateStr)
        .eq('status', 'active');
      if (error || !wlRows?.length) continue;

      const serviceIds = [...new Set((wlRows as { service_id: string }[]).map((r) => r.service_id))];
      const { data: svcRows } = await client.from('services').select('id, name').in('id', serviceIds);
      const svcMap = Object.fromEntries((svcRows || []).map((s: { id: string; name: string }) => [s.id, s.name]));

      const dateLabel = formatIsraelDateLabel(dateStr);

      for (const r of wlRows as Record<string, unknown>[]) {
        const waitlistId = r.id as string;
        if (await this.hasPendingSlotOfferForWaitlistDate(waitlistId, dateStr)) continue;

        const phone = normalizePhone(String(r.client_phone || ''));
        if (!phone) continue;
        const serviceId = r.service_id as string;
        const slots = await this.listBookableSlotStarts(staffId, dateStr, serviceId);
        if (!slots.length) continue;

        const pm = !!r.prefer_morning;
        const pa = !!r.prefer_afternoon;
        const pe = !!r.prefer_evening;

        let best: string | null = null;
        for (const t of slots) {
          const sm = timeToMins(t);
          if (!slotStartInExpandedRegion(sm, prev, next)) continue;
          if (!freedTimeMatchesPreferences(t, pm, pa, pe)) continue;
          if (!best || t.localeCompare(best) < 0) best = t;
        }
        if (!best) continue;

        await this.createWaitlistSlotOfferAndNotify({
          staffId,
          date: dateStr,
          timeShort: best,
          profileId: r.profile_id as string,
          waitlistId,
          branchId: (r.branch_id as string | null) ?? null,
          serviceId,
          phone,
          staffName,
          svcName: svcMap[serviceId] ?? 'טיפול',
          dateLabel,
        });
      }
    }
  }

  private async createWaitlistSlotOfferAndNotify(params: {
    staffId: string;
    date: string;
    timeShort: string;
    profileId: string;
    waitlistId: string;
    branchId: string | null;
    serviceId: string;
    phone: string;
    staffName: string;
    svcName: string;
    dateLabel: string;
  }): Promise<void> {
    const client = this.supabase.getClient();
    const nowIso = new Date().toISOString();

    await client
      .from('waitlist_slot_offers')
      .delete()
      .eq('profile_id', params.profileId)
      .eq('staff_id', params.staffId)
      .eq('date', params.date)
      .eq('time', params.timeShort)
      .eq('service_id', params.serviceId)
      .eq('status', 'pending');

    const { data: inserted, error: insErr } = await client
      .from('waitlist_slot_offers')
      .insert({
        profile_id: params.profileId,
        waitlist_id: params.waitlistId,
        branch_id: params.branchId,
        staff_id: params.staffId,
        service_id: params.serviceId,
        date: params.date,
        time: params.timeShort,
        status: 'pending',
        updated_at: nowIso,
      })
      .select('id')
      .single();

    if (insErr || !inserted) return;

    const offerId = (inserted as { id: string }).id;
    await this.notifications
      .create({
        userPhone: params.phone,
        type: 'personal',
        title: 'נפתחה שעה פנויה',
        body: `נפתחה שעה ב${params.timeShort} בתאריך ${params.dateLabel} ל${params.svcName} אצל ${params.staffName}. פתחו את מסך ההזמנה ואשרו את השעה — הראשון שמאשר מקבל את התור.`,
        pushScreen: 'Booking',
        pushData: { waitlistOfferId: offerId },
      })
      .catch(() => {});
  }

  private async getStaffWorkingWindowForDate(
    staffId: string,
    dateStr: string,
  ): Promise<{ startMins: number; endMins: number } | null> {
    const dayOfWeek = dayOfWeekForYmd(dateStr);
    const { data: workingDays } = await this.supabase
      .getClient()
      .from('staff_working_days')
      .select('day_of_week, start_time, end_time')
      .eq('staff_id', staffId);
    const dayRow = (workingDays || []).find((r: { day_of_week: number }) => r.day_of_week === dayOfWeek) as
      | { day_of_week: number; start_time: string | null; end_time: string | null }
      | undefined;
    if (!dayRow) return null;
    const startTime = dayRow.start_time ? String(dayRow.start_time).slice(0, 5) : '09:00';
    const endTime = dayRow.end_time ? String(dayRow.end_time).slice(0, 5) : '19:00';
    const startMins = timeToMins(startTime);
    const endMins = timeToMins(endTime);
    if (startMins >= endMins) return null;
    return { startMins, endMins };
  }

  async join(
    user: UserPayload,
    dto: {
      branchId: string;
      staffId: string;
      serviceId: string;
      date: string;
      preferMorning: boolean;
      preferAfternoon: boolean;
      preferEvening: boolean;
    },
  ) {
    if (!dto.preferMorning && !dto.preferAfternoon && !dto.preferEvening) {
      throw new BadRequestException('יש לבחור לפחות חלון זמן אחד (בוקר / צהריים / ערב)');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.date)) throw new BadRequestException('Invalid date');

    const todayStr = israelTodayYmd();
    if (dto.date < todayStr) {
      throw new BadRequestException('לא ניתן להצטרף לרשימת המתנה ליום שכבר עבר');
    }

    const { count, isNotWorkDay } = await this.countAvailableSlots(dto.staffId, dto.date, dto.serviceId);
    if (isNotWorkDay) {
      throw new BadRequestException('לא ניתן להצטרף לרשימת המתנה ליום שאינו יום עבודה');
    }
    if (count > 0) {
      throw new BadRequestException('עדיין יש שעות פנויות — ניתן לקבוע תור ישירות');
    }

    const window = await this.getStaffWorkingWindowForDate(dto.staffId, dto.date);
    if (!window) {
      throw new BadRequestException('לא ניתן להצטרף לרשימת המתנה ליום שאינו יום עבודה');
    }
    const { startMins: staffStartMins, endMins: staffEndMins } = window;
    const nowMins = israelNowMinutesSinceMidnight();

    if (dto.date === todayStr && nowMins >= staffEndMins) {
      throw new BadRequestException('איש הצוות סיים את יום העבודה — לא ניתן להצטרף לרשימת המתנה ליום זה.');
    }

    if (!prefsOverlapStaffWindow(dto.preferMorning, dto.preferAfternoon, dto.preferEvening, staffStartMins, staffEndMins)) {
      throw new BadRequestException(
        'בחר בוקר / צהריים / ערב בהתאם לשעות העבודה של איש הצוות. אין חפיפה בין מה שסימנת לשעות שהוא נמצא בספר.',
      );
    }

    const phone = normalizePhone(user.phone);
    const clientName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'לקוח';

    const { data: existing } = await this.supabase
      .getClient()
      .from('waitlist')
      .select('id')
      .eq('profile_id', user.id)
      .eq('staff_id', dto.staffId)
      .eq('service_id', dto.serviceId)
      .eq('date', dto.date)
      .eq('status', 'active')
      .maybeSingle();
    if (existing) {
      throw new BadRequestException('כבר רשום לרשימת המתנה ליום זה');
    }

    const { data: inserted, error } = await this.supabase
      .getClient()
      .from('waitlist')
      .insert({
        profile_id: user.id,
        client_phone: phone,
        client_name: clientName,
        branch_id: dto.branchId,
        staff_id: dto.staffId,
        service_id: dto.serviceId,
        date: dto.date,
        prefer_morning: dto.preferMorning,
        prefer_afternoon: dto.preferAfternoon,
        prefer_evening: dto.preferEvening,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .select('id, date, prefer_morning, prefer_afternoon, prefer_evening, created_at')
      .single();

    if (error) throw new BadRequestException(error.message || 'Failed to join waitlist');

    const row = inserted as Record<string, unknown>;
    return {
      id: row.id as string,
      date: row.date as string,
      preferMorning: !!row.prefer_morning,
      preferAfternoon: !!row.prefer_afternoon,
      preferEvening: !!row.prefer_evening,
      createdAt: row.created_at as string,
    };
  }

  async leave(user: UserPayload, id: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('waitlist')
      .delete()
      .eq('id', id)
      .eq('profile_id', user.id)
      .eq('status', 'active')
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new BadRequestException('לא נמצא או שכבר בוטל');
    return { ok: true };
  }

  /** Admin: remove any active waitlist row (cascades slot offers). */
  async removeEntryAsAdmin(entryId: string): Promise<{ ok: boolean }> {
    const { data, error } = await this.supabase
      .getClient()
      .from('waitlist')
      .delete()
      .eq('id', entryId)
      .eq('status', 'active')
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new BadRequestException('לא נמצא או שכבר בוטל');
    return { ok: true };
  }

  /** Staff: remove an active waitlist row only for their own staff_id. */
  async removeEntryAsStaff(entryId: string, staffId: string): Promise<{ ok: boolean }> {
    const { data, error } = await this.supabase
      .getClient()
      .from('waitlist')
      .delete()
      .eq('id', entryId)
      .eq('staff_id', staffId)
      .eq('status', 'active')
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new BadRequestException('לא נמצא או שאין הרשאה');
    return { ok: true };
  }

  async listMine(user: UserPayload) {
    await this.cleanupExpiredSlotOffersAndWaitlist();
    const client = this.supabase.getClient();
    const { data: rows, error } = await client
      .from('waitlist')
      .select('id, date, status, prefer_morning, prefer_afternoon, prefer_evening, created_at, staff_id, service_id, branch_id')
      .eq('profile_id', user.id)
      .eq('status', 'active')
      .order('date', { ascending: true });

    if (error || !rows?.length) return [];

    const staffIds = [...new Set(rows.map((r: { staff_id: string }) => r.staff_id))];
    const serviceIds = [...new Set(rows.map((r: { service_id: string }) => r.service_id))];
    const branchIds = [...new Set(rows.map((r: { branch_id: string | null }) => r.branch_id).filter(Boolean))] as string[];

    const [staffRes, svcRes, brRes] = await Promise.all([
      staffIds.length
        ? client.from('staff').select('id, name').in('id', staffIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      serviceIds.length
        ? client.from('services').select('id, name').in('id', serviceIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      branchIds.length ? client.from('branches').select('id, name').in('id', branchIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

    const staffMap = Object.fromEntries((staffRes.data || []).map((s: { id: string; name: string }) => [s.id, s.name]));
    const svcMap = Object.fromEntries((svcRes.data || []).map((s: { id: string; name: string }) => [s.id, s.name]));
    const brMap = Object.fromEntries((brRes.data || []).map((b: { id: string; name: string }) => [b.id, b.name]));

    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      date: r.date as string,
      status: r.status as string,
      preferMorning: !!r.prefer_morning,
      preferAfternoon: !!r.prefer_afternoon,
      preferEvening: !!r.prefer_evening,
      createdAt: r.created_at as string,
      staffName: staffMap[r.staff_id as string] ?? '',
      serviceName: svcMap[r.service_id as string] ?? '',
      branchName: r.branch_id ? brMap[r.branch_id as string] ?? '' : '',
    }));
  }

  /** After booking, remove active waitlist row for same day/service/staff (no longer shown to staff/admin). */
  async fulfillIfMatched(profileId: string, staffId: string, serviceId: string, date: string) {
    await this.supabase
      .getClient()
      .from('waitlist')
      .update({ status: 'fulfilled', updated_at: new Date().toISOString() })
      .eq('profile_id', profileId)
      .eq('staff_id', staffId)
      .eq('service_id', serviceId)
      .eq('date', date)
      .eq('status', 'active');
  }

  /**
   * Past calendar days, or today after staff end_time: cancel active waitlist and expire pending slot offers.
   */
  async cleanupWaitlistAfterStaffDayEndOrPastDate() {
    const client = this.supabase.getClient();
    const todayStr = israelTodayYmd();
    const nowMins = israelNowMinutesSinceMidnight();
    const nowIso = new Date().toISOString();

    const { data: wlRows } = await client.from('waitlist').select('id, date, staff_id').eq('status', 'active').lte('date', todayStr);
    if (wlRows?.length) {
      const staffIds = [...new Set(wlRows.map((r: { staff_id: string }) => r.staff_id))];
      const { data: wds } = await client
        .from('staff_working_days')
        .select('staff_id, day_of_week, end_time')
        .in('staff_id', staffIds);
      const endByStaffDow = new Map<string, number>();
      for (const w of wds || []) {
        const sid = (w as { staff_id: string }).staff_id;
        const dow = (w as { day_of_week: number }).day_of_week;
        const endMins = timeToMins(String((w as { end_time: string | null }).end_time || '19:00').slice(0, 5));
        endByStaffDow.set(`${sid}|${dow}`, endMins);
      }
      const toCancelWl: string[] = [];
      for (const r of wlRows as { id: string; date: string; staff_id: string }[]) {
        if (r.date < todayStr) {
          toCancelWl.push(r.id);
          continue;
        }
        const dow = dayOfWeekForYmd(r.date);
        const endM = endByStaffDow.get(`${r.staff_id}|${dow}`);
        if (endM === undefined) {
          toCancelWl.push(r.id);
          continue;
        }
        if (nowMins >= endM) toCancelWl.push(r.id);
      }
      if (toCancelWl.length) {
        await client.from('waitlist').update({ status: 'cancelled', updated_at: nowIso }).in('id', toCancelWl);
      }
    }

    const { data: offerRows } = await client
      .from('waitlist_slot_offers')
      .select('id, waitlist_id, staff_id, date')
      .eq('status', 'pending')
      .lte('date', todayStr);
    if (offerRows?.length) {
      const staffIds = [...new Set(offerRows.map((o: { staff_id: string }) => o.staff_id))];
      const { data: wds } = await client
        .from('staff_working_days')
        .select('staff_id, day_of_week, end_time')
        .in('staff_id', staffIds);
      const endByStaffDow = new Map<string, number>();
      for (const w of wds || []) {
        const sid = (w as { staff_id: string }).staff_id;
        const dow = (w as { day_of_week: number }).day_of_week;
        const endMins = timeToMins(String((w as { end_time: string | null }).end_time || '19:00').slice(0, 5));
        endByStaffDow.set(`${sid}|${dow}`, endMins);
      }
      for (const o of offerRows as { id: string; waitlist_id: string; staff_id: string; date: string }[]) {
        let shouldExpire = false;
        if (o.date < todayStr) shouldExpire = true;
        else if (o.date === todayStr) {
          const dow = dayOfWeekForYmd(o.date);
          const endM = endByStaffDow.get(`${o.staff_id}|${dow}`);
          if (endM === undefined) shouldExpire = true;
          else if (nowMins >= endM) shouldExpire = true;
        }
        if (!shouldExpire) continue;
        await client.from('waitlist_slot_offers').update({ status: 'expired', updated_at: nowIso }).eq('id', o.id);
        await client
          .from('waitlist')
          .update({ status: 'cancelled', updated_at: nowIso })
          .eq('id', o.waitlist_id)
          .eq('status', 'active');
      }
    }
  }

  /**
   * Pending slot-offers whose start time is in the past and the slot was never booked:
   * mark offer expired and set waitlist row to cancelled so staff/admin lists drop the name.
   * If the slot was booked but an offer was left pending (inconsistency), supersede the offer only.
   */
  async cleanupExpiredSlotOffersAndWaitlist() {
    await this.cleanupWaitlistAfterStaffDayEndOrPastDate();
    const client = this.supabase.getClient();
    const { data: pending, error } = await client
      .from('waitlist_slot_offers')
      .select('id, waitlist_id, staff_id, date, time, service_id')
      .eq('status', 'pending');

    if (error || !pending?.length) return;

    const now = Date.now();
    const stale: typeof pending = [];
    for (const o of pending) {
      const timeStr = String(o.time).slice(0, 5);
      const slotStart = new Date(`${o.date}T${timeStr}:00`).getTime();
      if (Number.isNaN(slotStart) || slotStart >= now) continue;
      stale.push(o);
    }
    if (!stale.length) return;

    const keys = [...new Set(stale.map((o) => `${o.staff_id}|${o.date}`))];
    const aptTimesByKey = new Map<string, Set<string>>();
    for (const key of keys) {
      const [staffId, date] = key.split('|');
      const { data: apts } = await client
        .from('appointments')
        .select('time')
        .eq('staff_id', staffId)
        .eq('date', date)
        .eq('status', 'confirmed');
      const set = new Set((apts || []).map((r: { time: string }) => String(r.time).slice(0, 5)));
      aptTimesByKey.set(key, set);
    }

    const nowIso = new Date().toISOString();
    for (const o of stale) {
      const key = `${o.staff_id}|${o.date}`;
      const timeStr = String(o.time).slice(0, 5);
      const bookedTimes = aptTimesByKey.get(key) || new Set<string>();
      if (bookedTimes.has(timeStr)) {
        await client
          .from('waitlist_slot_offers')
          .update({ status: 'superseded', updated_at: nowIso })
          .eq('id', o.id);
        continue;
      }
      await client.from('waitlist_slot_offers').update({ status: 'expired', updated_at: nowIso }).eq('id', o.id);
      await client
        .from('waitlist')
        .update({ status: 'cancelled', updated_at: nowIso })
        .eq('id', o.waitlist_id)
        .eq('status', 'active');
    }
  }

  /** When a slot frees, notify everyone on the waitlist for that staff+date+service whose prefs include this time. */
  /**
   * When a slot frees (cancelled appointment). `serviceId` scopes to that treatment’s waitlist.
   * When a blocked slot is removed, pass `serviceId: undefined` to notify all active waitlist rows for that staff+date whose time prefs match.
   */
  async notifyFreedSlot(params: { staffId: string; date: string; time: string; serviceId?: string }) {
    const timeShort = String(params.time).slice(0, 5);
    const client = this.supabase.getClient();
    let q = client
      .from('waitlist')
      .select('id, profile_id, branch_id, client_phone, prefer_morning, prefer_afternoon, prefer_evening, service_id')
      .eq('staff_id', params.staffId)
      .eq('date', params.date)
      .eq('status', 'active');
    if (params.serviceId) q = q.eq('service_id', params.serviceId);
    const { data: rows, error } = await q;

    if (error || !rows?.length) return;

    const { data: staffRow } = await client.from('staff').select('name').eq('id', params.staffId).maybeSingle();
    const staffName = (staffRow as { name?: string } | null)?.name ?? 'איש הצוות';

    const serviceIds = [...new Set((rows as { service_id: string }[]).map((r) => r.service_id))];
    const { data: svcRows } = await client.from('services').select('id, name').in('id', serviceIds);
    const svcMap = Object.fromEntries((svcRows || []).map((s: { id: string; name: string }) => [s.id, s.name]));

    const dateLabel = formatIsraelDateLabel(params.date);

    for (const r of rows as Record<string, unknown>[]) {
      const phone = normalizePhone(String(r.client_phone || ''));
      if (!phone) continue;
      const pm = !!r.prefer_morning;
      const pa = !!r.prefer_afternoon;
      const pe = !!r.prefer_evening;
      if (!freedTimeMatchesPreferences(timeShort, pm, pa, pe)) continue;

      const svcName = svcMap[r.service_id as string] ?? 'טיפול';
      const profileId = r.profile_id as string;
      const waitlistId = r.id as string;
      const branchId = (r.branch_id as string | null) ?? null;
      const serviceId = r.service_id as string;

      await this.createWaitlistSlotOfferAndNotify({
        staffId: params.staffId,
        date: params.date,
        timeShort,
        profileId,
        waitlistId,
        branchId,
        serviceId,
        phone,
        staffName,
        svcName,
        dateLabel,
      });
    }
  }

  /** Pending claimable slot offers for the customer dashboard (first tap books; DB unique index enforces one winner). */
  async listPendingOffers(user: UserPayload) {
    await this.cleanupExpiredSlotOffersAndWaitlist();
    const client = this.supabase.getClient();
    const { data: rows, error } = await client
      .from('waitlist_slot_offers')
      .select('id, date, time, staff_id, service_id, branch_id, created_at')
      .eq('profile_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error || !rows?.length) return [];

    const staffIds = [...new Set(rows.map((r: { staff_id: string }) => r.staff_id))];
    const serviceIds = [...new Set(rows.map((r: { service_id: string }) => r.service_id))];
    const branchIds = [...new Set(rows.map((r: { branch_id: string | null }) => r.branch_id).filter(Boolean))] as string[];

    const [staffRes, svcRes, brRes] = await Promise.all([
      staffIds.length ? client.from('staff').select('id, name').in('id', staffIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      serviceIds.length ? client.from('services').select('id, name').in('id', serviceIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      branchIds.length ? client.from('branches').select('id, name').in('id', branchIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

    const staffMap = Object.fromEntries((staffRes.data || []).map((s: { id: string; name: string }) => [s.id, s.name]));
    const svcMap = Object.fromEntries((svcRes.data || []).map((s: { id: string; name: string }) => [s.id, s.name]));
    const brMap = Object.fromEntries((brRes.data || []).map((b: { id: string; name: string }) => [b.id, b.name]));

    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      date: r.date as string,
      time: typeof r.time === 'string' ? r.time.slice(0, 5) : String(r.time).slice(0, 5),
      staffId: r.staff_id as string,
      staffName: staffMap[r.staff_id as string] ?? '',
      serviceId: r.service_id as string,
      serviceName: svcMap[r.service_id as string] ?? '',
      branchId: r.branch_id as string | null,
      branchName: r.branch_id ? brMap[r.branch_id as string] ?? '' : '',
      createdAt: r.created_at as string,
    }));
  }

  async getPendingOfferForUser(profileId: string, offerId: string) {
    await this.cleanupExpiredSlotOffersAndWaitlist();
    const { data, error } = await this.supabase
      .getClient()
      .from('waitlist_slot_offers')
      .select('id, branch_id, staff_id, service_id, date, time')
      .eq('id', offerId)
      .eq('profile_id', profileId)
      .eq('status', 'pending')
      .maybeSingle();

    if (error || !data) return null;
    return data as {
      id: string;
      branch_id: string | null;
      staff_id: string;
      service_id: string;
      date: string;
      time: string;
    };
  }

  /** When accept finds no pending row — another user may have taken the slot first (superseded). */
  async explainNonPendingOffer(profileId: string, offerId: string): Promise<'superseded' | 'expired' | 'missing'> {
    const { data, error } = await this.supabase
      .getClient()
      .from('waitlist_slot_offers')
      .select('status')
      .eq('id', offerId)
      .eq('profile_id', profileId)
      .maybeSingle();

    if (error || !data) return 'missing';
    const s = (data as { status: string }).status;
    if (s === 'superseded') return 'superseded';
    if (s === 'expired') return 'expired';
    return 'missing';
  }

  /** After any booking at this slot, resolve competing waitlist offers (first book wins via appointments unique index). */
  async afterBookingCreatedForSlot(params: {
    staffId: string;
    date: string;
    time: string;
    serviceId: string;
    winningOfferId?: string;
  }) {
    const timeShort = String(params.time).slice(0, 5);
    const now = new Date().toISOString();
    const client = this.supabase.getClient();

    if (params.winningOfferId) {
      await client
        .from('waitlist_slot_offers')
        .update({ status: 'superseded', updated_at: now })
        .eq('staff_id', params.staffId)
        .eq('date', params.date)
        .eq('time', timeShort)
        .eq('service_id', params.serviceId)
        .eq('status', 'pending')
        .neq('id', params.winningOfferId);

      await client
        .from('waitlist_slot_offers')
        .update({ status: 'accepted', updated_at: now })
        .eq('id', params.winningOfferId);
    } else {
      await client
        .from('waitlist_slot_offers')
        .update({ status: 'superseded', updated_at: now })
        .eq('staff_id', params.staffId)
        .eq('date', params.date)
        .eq('time', timeShort)
        .eq('service_id', params.serviceId)
        .eq('status', 'pending');
    }
  }

  async listForStaff(staffId: string) {
    await this.cleanupExpiredSlotOffersAndWaitlist();
    const today = israelTodayYmd();
    const client = this.supabase.getClient();
    const { data: rows, error } = await client
      .from('waitlist')
      .select(
        'id, date, client_name, client_phone, profile_id, prefer_morning, prefer_afternoon, prefer_evening, created_at, service_id, branch_id',
      )
      .eq('staff_id', staffId)
      .eq('status', 'active')
      .gte('date', today)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error || !rows?.length) return [];

    const serviceIds = [...new Set(rows.map((r: { service_id: string }) => r.service_id))];
    const branchIds = [...new Set(rows.map((r: { branch_id: string | null }) => r.branch_id).filter(Boolean))] as string[];
    const profileIds = [...new Set(rows.map((r: { profile_id: string }) => r.profile_id))];

    const [svcRes, brRes, profRes] = await Promise.all([
      serviceIds.length
        ? client.from('services').select('id, name').in('id', serviceIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      branchIds.length ? client.from('branches').select('id, name').in('id', branchIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      profileIds.length
        ? client.from('profiles').select('id, first_name, last_name').in('id', profileIds)
        : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null }[] }),
    ]);

    const svcMap = Object.fromEntries((svcRes.data || []).map((s: { id: string; name: string }) => [s.id, s.name]));
    const brMap = Object.fromEntries((brRes.data || []).map((b: { id: string; name: string }) => [b.id, b.name]));
    const profMap = Object.fromEntries(
      (profRes.data || []).map((p: { id: string; first_name: string | null; last_name: string | null }) => [
        p.id,
        [p.first_name, p.last_name].filter(Boolean).join(' ').trim(),
      ]),
    );

    return rows.map((r: Record<string, unknown>) => {
      const fallbackName = profMap[r.profile_id as string] || '';
      return {
        id: r.id as string,
        date: r.date as string,
        clientName: (r.client_name as string) || fallbackName || 'לקוח',
        clientPhone: r.client_phone as string,
        serviceName: svcMap[r.service_id as string] ?? '',
        branchName: r.branch_id ? brMap[r.branch_id as string] ?? '' : '',
        preferMorning: !!r.prefer_morning,
        preferAfternoon: !!r.prefer_afternoon,
        preferEvening: !!r.prefer_evening,
        createdAt: r.created_at as string,
      };
    });
  }

  async listForAdmin(staffIdFilter?: string) {
    await this.cleanupExpiredSlotOffersAndWaitlist();
    const today = israelTodayYmd();
    const client = this.supabase.getClient();
    let q = client
      .from('waitlist')
      .select(
        'id, date, client_name, client_phone, profile_id, prefer_morning, prefer_afternoon, prefer_evening, created_at, staff_id, service_id, branch_id',
      )
      .eq('status', 'active')
      .gte('date', today)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true });

    if (staffIdFilter) q = q.eq('staff_id', staffIdFilter);

    const { data: rows, error } = await q;
    if (error || !rows?.length) return [];

    const staffIds = [...new Set(rows.map((r: { staff_id: string }) => r.staff_id))];
    const serviceIds = [...new Set(rows.map((r: { service_id: string }) => r.service_id))];
    const branchIds = [...new Set(rows.map((r: { branch_id: string | null }) => r.branch_id).filter(Boolean))] as string[];
    const profileIds = [...new Set(rows.map((r: { profile_id: string }) => r.profile_id))];

    const [stRes, svcRes, brRes, profRes] = await Promise.all([
      staffIds.length
        ? client.from('staff').select('id, name').in('id', staffIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      serviceIds.length
        ? client.from('services').select('id, name').in('id', serviceIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      branchIds.length ? client.from('branches').select('id, name').in('id', branchIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      profileIds.length
        ? client.from('profiles').select('id, first_name, last_name').in('id', profileIds)
        : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null }[] }),
    ]);

    const stMap = Object.fromEntries((stRes.data || []).map((s: { id: string; name: string }) => [s.id, s.name]));
    const svcMap = Object.fromEntries((svcRes.data || []).map((s: { id: string; name: string }) => [s.id, s.name]));
    const brMap = Object.fromEntries((brRes.data || []).map((b: { id: string; name: string }) => [b.id, b.name]));
    const profMap = Object.fromEntries(
      (profRes.data || []).map((p: { id: string; first_name: string | null; last_name: string | null }) => [
        p.id,
        [p.first_name, p.last_name].filter(Boolean).join(' ').trim(),
      ]),
    );

    return rows.map((r: Record<string, unknown>) => {
      const fallbackName = profMap[r.profile_id as string] || '';
      return {
        id: r.id as string,
        date: r.date as string,
        clientName: (r.client_name as string) || fallbackName || 'לקוח',
        clientPhone: r.client_phone as string,
        serviceName: svcMap[r.service_id as string] ?? '',
        branchName: r.branch_id ? brMap[r.branch_id as string] ?? '' : '',
        staffId: r.staff_id as string,
        staffName: stMap[r.staff_id as string] ?? '',
        preferMorning: !!r.prefer_morning,
        preferAfternoon: !!r.prefer_afternoon,
        preferEvening: !!r.prefer_evening,
        createdAt: r.created_at as string,
      };
    });
  }
}
