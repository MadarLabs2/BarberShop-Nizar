import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CacheService } from '../core/cache.service';
import { SupabaseService } from '../core/supabase';
import { TokenAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { StaffGuard } from '../auth/staff.guard';
import { RequestUser } from '../auth/auth.decorator';
import { AuthModule } from '../auth';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { WaitlistService } from '../waitlist/waitlist.service';
import { israelTodayYmd, israelNowMinutesSinceMidnight, dayOfWeekForYmd, formatIsraelDateLabel } from '../core/israel-time';
import { NotificationsModule, NotificationsService } from '../notifications';

const ADMIN_GUARDS = [TokenAuthGuard, AdminGuard];

@Injectable()
export class AdminScheduleService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly waitlist: WaitlistService,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService,
  ) {}

  private timeToMins(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }

  private timeToHHMM(t: string | null): string {
    if (!t) return '09:00';
    const s = String(t).slice(0, 8);
    const [h, m] = s.split(':').map(Number);
    return `${String(h ?? 9).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
  }

  async getMyStaffAppointments(staffId: string): Promise<
    { id: string; serviceName: string; staffName: string; branchName: string; date: string; time: string; clientName: string; clientPhone: string | null; duration: number; status: string }[]
  > {
    if (!staffId) return [];
    const today = israelTodayYmd();
    const { data } = await this.supabase
      .getClient()
      .from('appointments')
      .select('id, service_name, staff_name, branch_name, date, time, client_name, client_phone, duration, status')
      .eq('staff_id', staffId)
      .eq('status', 'confirmed')
      .gte('date', today)
      .order('date', { ascending: true })
      .order('time', { ascending: true })
      .limit(80);
    return (data || []).map(
      (r: {
        id: string;
        service_name: string | null;
        staff_name: string | null;
        branch_name: string | null;
        date: string;
        time: string;
        client_name: string | null;
        client_phone: string | null;
        duration: number;
        status: string | null;
      }) => ({
        id: r.id,
        serviceName: r.service_name || 'טיפול',
        staffName: r.staff_name || '',
        branchName: r.branch_name || '',
        date: r.date,
        time: typeof r.time === 'string' ? r.time.slice(0, 5) : r.time,
        clientName: r.client_name || 'לקוח',
        clientPhone: r.client_phone ?? null,
        duration: r.duration || 40,
        status: r.status || 'confirmed',
      }),
    );
  }

  async getAppointmentsByStaffAndDate(staffId: string, dateStr: string): Promise<
    { id: string; clientName: string; clientPhone: string | null; serviceName: string; time: string; duration: number; date: string; _isBlocked?: boolean }[]
  > {
    if (!staffId || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return [];
    const client = this.supabase.getClient();
    const [apts, blocked] = await Promise.all([
      client
        .from('appointments')
        .select('id, client_name, client_phone, service_name, time, duration, date')
        .eq('staff_id', staffId)
        .eq('date', dateStr)
        .eq('status', 'confirmed')
        .order('time', { ascending: true }),
      client
        .from('blocked_slots')
        .select('id, time, duration')
        .eq('staff_id', staffId)
        .eq('date', dateStr)
        .order('time', { ascending: true }),
    ]);
    const aptList = (apts.data || []).map((r: { id: string; client_name: string | null; client_phone: string | null; service_name: string | null; time: string; duration: number; date: string }) => ({
      id: r.id,
      clientName: r.client_name || 'לקוח',
      clientPhone: r.client_phone ?? null,
      serviceName: r.service_name || 'טיפול',
      time: typeof r.time === 'string' ? r.time.slice(0, 5) : r.time,
      duration: r.duration || 40,
      date: r.date,
    }));
    const blockedList = (blocked.data || []).map((r: { id: string; time: string; duration: number }) => ({
      id: r.id,
      clientName: '[חסום]',
      clientPhone: null,
      serviceName: '-',
      time: typeof r.time === 'string' ? r.time.slice(0, 5) : r.time,
      duration: r.duration || 40,
      date: dateStr,
      _isBlocked: true,
    }));
    return [...aptList, ...blockedList].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }

  async getStaffSchedule(
    staffId: string,
    from: string,
    to: string,
  ): Promise<
    { id: string; date: string; time: string; clientName: string; clientPhone: string | null; serviceName: string; duration: number; branchName: string; status: string; _isBlocked?: boolean }[]
  > {
    if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
      return [];
    const client = this.supabase.getClient();
    const [apts, blocked] = await Promise.all([
      client
        .from('appointments')
        .select('id, client_name, client_phone, service_name, time, duration, date, branch_name, status')
        .eq('staff_id', staffId)
        .gte('date', from)
        .lte('date', to)
        .eq('status', 'confirmed')
        .order('date', { ascending: true })
        .order('time', { ascending: true }),
      client
        .from('blocked_slots')
        .select('id, date, time, duration')
        .eq('staff_id', staffId)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
        .order('time', { ascending: true }),
    ]);
    const aptList = (apts.data || []).map(
      (r: {
        id: string;
        client_name: string | null;
        client_phone: string | null;
        service_name: string | null;
        time: string;
        duration: number;
        date: string;
        branch_name: string | null;
        status: string | null;
      }) => ({
        id: r.id,
        date: r.date,
        time: typeof r.time === 'string' ? r.time.slice(0, 5) : r.time,
        clientName: r.client_name || 'לקוח',
        clientPhone: r.client_phone ?? null,
        serviceName: r.service_name || 'טיפול',
        duration: r.duration || 40,
        branchName: r.branch_name || '',
        status: r.status || 'confirmed',
      }),
    );
    const blockedList = (blocked.data || []).map(
      (r: { id: string; date: string; time: string; duration: number }) => ({
        id: r.id,
        date: r.date,
        time: typeof r.time === 'string' ? r.time.slice(0, 5) : r.time,
        clientName: '[חסום]',
        clientPhone: null,
        serviceName: '-',
        duration: r.duration || 40,
        branchName: '',
        status: '-',
        _isBlocked: true,
      }),
    );
    return [...aptList, ...blockedList].sort((a, b) =>
      a.date !== b.date ? a.date.localeCompare(b.date) : String(a.time).localeCompare(String(b.time)),
    );
  }

  async addBlockedSlot(staffId: string, dateStr: string, startTime: string, endTime: string) {
    if (!staffId || !dateStr || !startTime || !endTime)
      throw new BadRequestException('staffId, date, startTime, endTime required');
    const timeShort = startTime.slice(0, 5);
    const startMins = this.timeToMins(timeShort);
    const endMins = this.timeToMins(endTime.slice(0, 5));
    if (startMins >= endMins) throw new BadRequestException('startTime must be before endTime');

    const client = this.supabase.getClient();

    /** Reject a new block that overlaps one already covering this staff+date — prevents duplicate/overlapping blocks. */
    const { data: existing } = await client
      .from('blocked_slots')
      .select('time, duration')
      .eq('staff_id', staffId)
      .eq('date', dateStr);
    const overlapsExisting = (existing || []).some((row: { time: string; duration: number }) => {
      const rowStart = this.timeToMins(String(row.time).slice(0, 5));
      const rowEnd = rowStart + (row.duration || 40);
      return startMins < rowEnd && endMins > rowStart;
    });
    if (overlapsExisting) {
      throw new BadRequestException('טווח השעות חופף לחסימה קיימת עבור איש הצוות בתאריך זה');
    }

    const duration = endMins - startMins;
    const { data, error } = await client
      .from('blocked_slots')
      .insert({ staff_id: staffId, date: dateStr, time: timeShort, duration })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    const cancelledAppointments = await this.cancelOverlappingConfirmedAppointments(
      staffId,
      dateStr,
      startMins,
      endMins,
    );
    await this.cache.invalidateBookingsSlotsForStaffDate(staffId, dateStr);
    if (cancelledAppointments > 0) await this.cache.invalidateAdminSummary();
    return { ...data, cancelledAppointments };
  }

  async removeBlockedSlot(id: string) {
    const client = this.supabase.getClient();
    const { data: row } = await client.from('blocked_slots').select('staff_id, date, time').eq('id', id).maybeSingle();
    const { error } = await client.from('blocked_slots').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    if (row) {
      const r = row as { staff_id: string; date: string; time: string };
      const timeShort = String(r.time).slice(0, 5);
      void this.waitlist
        .notifyFreedSlot({ staffId: r.staff_id, date: r.date, time: timeShort })
        .catch(() => {});
      await this.cache.invalidateBookingsSlotsForStaffDate(r.staff_id, r.date);
    }
    return { ok: true };
  }

  /**
   * "Currently in effect" blocks only — a block whose time range has already fully elapsed no
   * longer affects availability, so it's excluded here regardless of the requested `from`/`to`
   * (never returns anything before today, and drops today's rows once their end time has passed).
   * The row itself is never deleted — only filtered out of this view — so it stays available for
   * historical reporting.
   */
  async getMyBlockedSlots(
    staffId: string,
    from?: string,
    to?: string,
  ): Promise<{ id: string; date: string; time: string; duration: number }[]> {
    const client = this.supabase.getClient();
    const todayStr = israelTodayYmd();
    const effectiveFrom = from && from > todayStr ? from : todayStr;
    let query = client
      .from('blocked_slots')
      .select('id, date, time, duration')
      .eq('staff_id', staffId)
      .gte('date', effectiveFrom);
    if (to) query = query.lte('date', to);
    const { data, error } = await query.order('date', { ascending: true }).order('time', { ascending: true });
    if (error) return [];

    const nowMins = israelNowMinutesSinceMidnight();
    return (data || [])
      .map((r: { id: string; date: string; time: string; duration: number }) => ({
        id: r.id,
        date: r.date,
        time: r.time,
        duration: r.duration || 40,
      }))
      .filter((r) => {
        if (r.date !== todayStr) return true;
        const endMins = this.timeToMins(String(r.time).slice(0, 5)) + r.duration;
        return endMins > nowMins;
      });
  }

  /** Throws unless this staff member has been explicitly granted permission by an admin to manage their own blocked time. */
  private async assertStaffCanBlockOwnTime(staffId: string): Promise<void> {
    const { data } = await this.supabase
      .getClient()
      .from('staff')
      .select('can_block_own_time')
      .eq('id', staffId)
      .maybeSingle();
    if (!(data as { can_block_own_time?: boolean } | null)?.can_block_own_time) {
      throw new ForbiddenException('אין לך הרשאה לנהל זמנים חסומים — פנה למנהל');
    }
  }

  /** Staff self-service: list own blocked slots, permission-gated. */
  async getMyBlockedSlotsPermissioned(staffId: string, from?: string, to?: string) {
    await this.assertStaffCanBlockOwnTime(staffId);
    return this.getMyBlockedSlots(staffId, from, to);
  }

  /** Staff self-service: block own time, permission-gated — reuses addBlockedSlot's overlap check and appointment cancellation. */
  async addMyBlockedSlot(staffId: string, dateStr: string, startTime: string, endTime: string) {
    await this.assertStaffCanBlockOwnTime(staffId);
    return this.addBlockedSlot(staffId, dateStr, startTime, endTime);
  }

  /** Staff self-service: remove own blocked slot, permission-gated and ownership-checked (can't touch another staff's block). */
  async removeMyBlockedSlot(staffId: string, id: string) {
    await this.assertStaffCanBlockOwnTime(staffId);
    const { data: row } = await this.supabase
      .getClient()
      .from('blocked_slots')
      .select('staff_id')
      .eq('id', id)
      .maybeSingle();
    if (!row || (row as { staff_id: string }).staff_id !== staffId) {
      throw new BadRequestException('לא נמצא או שאין הרשאה');
    }
    return this.removeBlockedSlot(id);
  }

  /** Confirmed appointments overlapping [blockStartMins, blockEndMins) are cancelled; clients get in-app notification; waitlist is notified per slot. */
  private async cancelOverlappingConfirmedAppointments(
    staffId: string,
    dateStr: string,
    blockStartMins: number,
    blockEndMins: number,
  ): Promise<number> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('appointments')
      .select('id, client_phone, service_name, date, time, duration, staff_id, service_id')
      .eq('staff_id', staffId)
      .eq('date', dateStr)
      .eq('status', 'confirmed');

    if (error || !data?.length) return 0;

    type AptRow = {
      id: string;
      client_phone: string | null;
      service_name: string | null;
      date: string;
      time: string;
      duration: number | null;
      staff_id: string;
      service_id: string;
    };

    const overlapping = (data as AptRow[]).filter((row) => {
      const t = typeof row.time === 'string' ? row.time.slice(0, 5) : String(row.time);
      const aptStart = this.timeToMins(t);
      const aptDur = row.duration && row.duration > 0 ? row.duration : 40;
      const aptEnd = aptStart + aptDur;
      return aptStart < blockEndMins && aptEnd > blockStartMins;
    });

    if (overlapping.length === 0) return 0;

    const nowIso = new Date().toISOString();
    const ids = overlapping.map((r) => r.id);
    const { error: upErr } = await client
      .from('appointments')
      .update({ status: 'cancelled', updated_at: nowIso })
      .in('id', ids);

    if (upErr) throw new BadRequestException(upErr.message);

    for (const row of overlapping) {
      const timeShort = typeof row.time === 'string' ? row.time.slice(0, 5) : String(row.time);
      void this.waitlist
        .notifyFreedSlot({
          staffId: row.staff_id,
          date: row.date,
          time: timeShort,
          serviceId: row.service_id,
        })
        .catch(() => {});

      if (row.client_phone) {
        const dateDisplay = formatIsraelDateLabel(row.date);
        const svcName = row.service_name || 'טיפול';
        this.notifications
          .create({
            userPhone: row.client_phone,
            type: 'personal',
            title: 'התור בוטל',
            body: `מצטערים — נאלצנו לבטל את התור ל${svcName} בתאריך ${dateDisplay} בשעה ${timeShort} עקב נסיבות בלתי צפויות. אנו מתנצלים על אי הנוחות ונשמח לעזור לקבוע מועד חדש.`,
          })
          .catch(() => {});
      }
    }

    return overlapping.length;
  }

  /**
   * When a working day's hours shrink (or the day is removed entirely), cancel any confirmed
   * future appointment on that weekday that no longer fits inside the kept window. Mirrors
   * `cancelOverlappingConfirmedAppointments` but scans every future date matching `dayOfWeek`
   * instead of a single date, since a schedule change applies to every future occurrence of that day.
   * `keepWindow: null` means the day has no working hours at all anymore — cancel everything on it.
   */
  private async cancelAppointmentsOutsideWorkingWindow(
    staffId: string,
    dayOfWeek: number,
    keepWindow: { startMins: number; endMins: number } | null,
  ): Promise<number> {
    const client = this.supabase.getClient();
    const today = israelTodayYmd();
    const { data, error } = await client
      .from('appointments')
      .select('id, client_phone, service_name, date, time, duration, staff_id, service_id')
      .eq('staff_id', staffId)
      .eq('status', 'confirmed')
      .gte('date', today);

    if (error || !data?.length) return 0;

    type AptRow = {
      id: string;
      client_phone: string | null;
      service_name: string | null;
      date: string;
      time: string;
      duration: number | null;
      staff_id: string;
      service_id: string;
    };

    const affected = (data as AptRow[]).filter((row) => {
      if (dayOfWeekForYmd(row.date) !== dayOfWeek) return false;
      if (!keepWindow) return true;
      const t = typeof row.time === 'string' ? row.time.slice(0, 5) : String(row.time);
      const aptStart = this.timeToMins(t);
      const aptDur = row.duration && row.duration > 0 ? row.duration : 40;
      const aptEnd = aptStart + aptDur;
      return !(aptStart >= keepWindow.startMins && aptEnd <= keepWindow.endMins);
    });

    if (affected.length === 0) return 0;

    const nowIso = new Date().toISOString();
    const ids = affected.map((r) => r.id);
    const { error: upErr } = await client
      .from('appointments')
      .update({ status: 'cancelled', updated_at: nowIso })
      .in('id', ids);
    if (upErr) throw new BadRequestException(upErr.message);

    for (const row of affected) {
      const timeShort = typeof row.time === 'string' ? row.time.slice(0, 5) : String(row.time);
      void this.waitlist
        .notifyFreedSlot({ staffId: row.staff_id, date: row.date, time: timeShort, serviceId: row.service_id })
        .catch(() => {});

      if (row.client_phone) {
        const dateDisplay = formatIsraelDateLabel(row.date);
        const svcName = row.service_name || 'טיפול';
        this.notifications
          .create({
            userPhone: row.client_phone,
            type: 'personal',
            title: 'התור בוטל',
            body: `מצטערים — נאלצנו לבטל את התור ל${svcName} בתאריך ${dateDisplay} בשעה ${timeShort} עקב שינוי בשעות הפעילות. אנו מתנצלים על אי הנוחות ונשמח לעזור לקבוע מועד חדש.`,
          })
          .catch(() => {});
      }
    }

    return affected.length;
  }

  async getMyWorkingHours(
    staffId: string,
  ): Promise<{ id: string; dayOfWeek: number; startTime: string; endTime: string }[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('staff_working_days')
      .select('id, day_of_week, start_time, end_time')
      .eq('staff_id', staffId)
      .order('day_of_week');
    if (error) return [];
    return (data || []).map(
      (r: { id: string; day_of_week: number; start_time: string | null; end_time: string | null }) => ({
        id: r.id,
        dayOfWeek: r.day_of_week,
        startTime: this.timeToHHMM(r.start_time),
        endTime: this.timeToHHMM(r.end_time),
      }),
    );
  }

  /** Throws unless this staff member has been explicitly granted permission by an admin to set their own working hours. */
  private async assertStaffCanSetOwnWorkingHours(staffId: string): Promise<void> {
    const { data } = await this.supabase
      .getClient()
      .from('staff')
      .select('can_set_own_working_hours')
      .eq('id', staffId)
      .maybeSingle();
    if (!(data as { can_set_own_working_hours?: boolean } | null)?.can_set_own_working_hours) {
      throw new ForbiddenException('אין לך הרשאה לנהל את שעות העבודה שלך — פנה למנהל');
    }
  }

  /** Staff self-service: view own working hours, permission-gated. */
  async getMyWorkingHoursPermissioned(staffId: string) {
    await this.assertStaffCanSetOwnWorkingHours(staffId);
    return this.getMyWorkingHours(staffId);
  }

  /** Staff self-service: add/update own working day, permission-gated — reuses addStaffWorkingDay's cancellation logic. */
  async upsertMyWorkingDay(staffId: string, dayOfWeek: number, startTime: string, endTime: string) {
    await this.assertStaffCanSetOwnWorkingHours(staffId);
    return this.addStaffWorkingDay(staffId, dayOfWeek, startTime, endTime);
  }

  /** Staff self-service: remove own working day, permission-gated. */
  async removeMyWorkingDay(staffId: string, dayOfWeek: number) {
    await this.assertStaffCanSetOwnWorkingHours(staffId);
    return this.removeStaffWorkingDayByDay(staffId, dayOfWeek);
  }

  async getStaffWorkingDays(staffId: string): Promise<number[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('staff_working_days')
      .select('day_of_week')
      .eq('staff_id', staffId);
    if (error) return [];
    return (data || []).map((r: { day_of_week: number }) => r.day_of_week);
  }

  async addStaffWorkingDay(
    staffId: string,
    dayOfWeek: number,
    startTime?: string,
    endTime?: string,
  ) {
    if (dayOfWeek < 0 || dayOfWeek > 6) throw new BadRequestException('dayOfWeek 0-6');
    const start = startTime || '09:00';
    const end = endTime || '19:00';
    if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) {
      throw new BadRequestException('startTime and endTime must be HH:MM');
    }
    const startMins = parseInt(start.split(':')[0], 10) * 60 + parseInt(start.split(':')[1], 10);
    const endMins = parseInt(end.split(':')[0], 10) * 60 + parseInt(end.split(':')[1], 10);
    if (startMins >= endMins) {
      throw new BadRequestException('startTime must be before endTime');
    }
    const client = this.supabase.getClient();
    const { data: before } = await client
      .from('staff_working_days')
      .select('start_time, end_time')
      .eq('staff_id', staffId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();
    const { error } = await client.from('staff_working_days').upsert(
      { staff_id: staffId, day_of_week: dayOfWeek, start_time: start, end_time: end },
      { onConflict: 'staff_id,day_of_week' },
    );
    if (error) throw new BadRequestException(error.message);
    const prevMins = before
      ? {
          startMins: this.timeToMins(this.timeToHHMM((before as { start_time: string | null }).start_time)),
          endMins: this.timeToMins(this.timeToHHMM((before as { end_time: string | null }).end_time)),
        }
      : null;
    void this.waitlist
      .notifyWorkingHoursExpanded(staffId, dayOfWeek, prevMins, { startMins, endMins })
      .catch(() => {});
    const cancelledAppointments = before
      ? await this.cancelAppointmentsOutsideWorkingWindow(staffId, dayOfWeek, { startMins, endMins })
      : 0;
    await this.cache.invalidateBookingsSlotsForStaff(staffId);
    if (cancelledAppointments > 0) await this.cache.invalidateAdminSummary();
    return { ok: true, cancelledAppointments };
  }

  async updateStaffWorkingDay(
    staffId: string,
    dayOfWeek: number,
    startTime: string,
    endTime: string,
  ) {
    if (dayOfWeek < 0 || dayOfWeek > 6) throw new BadRequestException('dayOfWeek 0-6');
    if (!startTime || !endTime) throw new BadRequestException('startTime and endTime required');
    if (!/^\d{1,2}:\d{2}$/.test(startTime) || !/^\d{1,2}:\d{2}$/.test(endTime)) {
      throw new BadRequestException('startTime and endTime must be HH:MM');
    }
    const startMins = parseInt(startTime.split(':')[0], 10) * 60 + parseInt(startTime.split(':')[1], 10);
    const endMins = parseInt(endTime.split(':')[0], 10) * 60 + parseInt(endTime.split(':')[1], 10);
    if (startMins >= endMins) {
      throw new BadRequestException('startTime must be before endTime');
    }
    const client = this.supabase.getClient();
    const { data: before } = await client
      .from('staff_working_days')
      .select('start_time, end_time')
      .eq('staff_id', staffId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();
    const { error } = await client
      .from('staff_working_days')
      .update({ start_time: startTime, end_time: endTime })
      .eq('staff_id', staffId)
      .eq('day_of_week', dayOfWeek);
    if (error) throw new BadRequestException(error.message);
    let cancelledAppointments = 0;
    if (before) {
      const prevMins = {
        startMins: this.timeToMins(this.timeToHHMM((before as { start_time: string | null }).start_time)),
        endMins: this.timeToMins(this.timeToHHMM((before as { end_time: string | null }).end_time)),
      };
      void this.waitlist
        .notifyWorkingHoursExpanded(staffId, dayOfWeek, prevMins, { startMins, endMins })
        .catch(() => {});
      cancelledAppointments = await this.cancelAppointmentsOutsideWorkingWindow(staffId, dayOfWeek, {
        startMins,
        endMins,
      });
    }
    await this.cache.invalidateBookingsSlotsForStaff(staffId);
    if (cancelledAppointments > 0) await this.cache.invalidateAdminSummary();
    return { ok: true, cancelledAppointments };
  }

  async removeStaffWorkingDay(id: string) {
    const client = this.supabase.getClient();
    const { data: row } = await client
      .from('staff_working_days')
      .select('staff_id, day_of_week')
      .eq('id', id)
      .maybeSingle();
    const { error } = await client.from('staff_working_days').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    const r = row as { staff_id?: string; day_of_week?: number } | null;
    let cancelledAppointments = 0;
    if (r?.staff_id && r.day_of_week != null) {
      cancelledAppointments = await this.cancelAppointmentsOutsideWorkingWindow(r.staff_id, r.day_of_week, null);
      await this.cache.invalidateBookingsSlotsForStaff(r.staff_id);
      if (cancelledAppointments > 0) await this.cache.invalidateAdminSummary();
    }
    return { ok: true, cancelledAppointments };
  }

  async removeStaffWorkingDayByDay(staffId: string, dayOfWeek: number) {
    if (dayOfWeek < 0 || dayOfWeek > 6) throw new BadRequestException('dayOfWeek 0-6');
    const { error } = await this.supabase
      .getClient()
      .from('staff_working_days')
      .delete()
      .eq('staff_id', staffId)
      .eq('day_of_week', dayOfWeek);
    if (error) throw new BadRequestException(error.message);
    const cancelledAppointments = await this.cancelAppointmentsOutsideWorkingWindow(staffId, dayOfWeek, null);
    await this.cache.invalidateBookingsSlotsForStaff(staffId);
    if (cancelledAppointments > 0) await this.cache.invalidateAdminSummary();
    return { ok: true, cancelledAppointments };
  }

  async getAllStaffWorkingDays(): Promise<
    Record<string, { id: string; dayOfWeek: number; startTime: string; endTime: string }[]>
  > {
    const { data, error } = await this.supabase
      .getClient()
      .from('staff_working_days')
      .select('id, staff_id, day_of_week, start_time, end_time');
    if (error) return {};
    const map: Record<string, { id: string; dayOfWeek: number; startTime: string; endTime: string }[]> = {};
    for (const r of data || []) {
      const row = r as {
        id: string;
        staff_id: string;
        day_of_week: number;
        start_time: string | null;
        end_time: string | null;
      };
      if (!map[row.staff_id]) map[row.staff_id] = [];
      map[row.staff_id].push({
        id: row.id,
        dayOfWeek: row.day_of_week,
        startTime: this.timeToHHMM(row.start_time),
        endTime: this.timeToHHMM(row.end_time),
      });
    }
    return map;
  }
}

@Controller('admin')
export class AdminScheduleController {
  constructor(private readonly service: AdminScheduleService) {}

  @Get('appointments/by-staff-date')
  @UseGuards(...ADMIN_GUARDS)
  getAppointmentsByStaffAndDate(@Query('staffId') staffId: string, @Query('date') dateStr: string) {
    return this.service.getAppointmentsByStaffAndDate(staffId, dateStr);
  }

  @Get('staff-schedule')
  @UseGuards(...ADMIN_GUARDS)
  getStaffSchedule(
    @Query('staffId') staffId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.getStaffSchedule(staffId, from, to);
  }

  @Get('my-staff-appointments')
  @UseGuards(TokenAuthGuard, StaffGuard)
  getMyStaffAppointments(@RequestUser() user: { staffId?: string }) {
    return this.service.getMyStaffAppointments(user.staffId!);
  }

  @Get('blocked-slots')
  @UseGuards(...ADMIN_GUARDS)
  getBlockedSlots(
    @Query('staffId') staffId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getMyBlockedSlots(staffId, from, to);
  }

  @Post('blocked-slots')
  @UseGuards(...ADMIN_GUARDS)
  addBlockedSlot(@Body() dto: { staffId: string; date: string; startTime: string; endTime: string }) {
    return this.service.addBlockedSlot(dto.staffId, dto.date, dto.startTime, dto.endTime);
  }

  @Delete('blocked-slots/:id')
  @UseGuards(...ADMIN_GUARDS)
  removeBlockedSlot(@Param('id') id: string) {
    return this.service.removeBlockedSlot(id);
  }

  /** Staff self-service — only reachable if the admin has granted staff.can_block_own_time. */
  @Get('my-blocked-slots')
  @UseGuards(TokenAuthGuard, StaffGuard)
  getMyBlockedSlots(
    @RequestUser() user: { staffId?: string },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getMyBlockedSlotsPermissioned(user.staffId!, from, to);
  }

  @Post('my-blocked-slots')
  @UseGuards(TokenAuthGuard, StaffGuard)
  addMyBlockedSlot(
    @RequestUser() user: { staffId?: string },
    @Body() dto: { date: string; startTime: string; endTime: string },
  ) {
    return this.service.addMyBlockedSlot(user.staffId!, dto.date, dto.startTime, dto.endTime);
  }

  @Delete('my-blocked-slots/:id')
  @UseGuards(TokenAuthGuard, StaffGuard)
  removeMyBlockedSlot(@RequestUser() user: { staffId?: string }, @Param('id') id: string) {
    return this.service.removeMyBlockedSlot(user.staffId!, id);
  }

  @Get('staff-working-days')
  @UseGuards(...ADMIN_GUARDS)
  getAllStaffWorkingDays() {
    return this.service.getAllStaffWorkingDays();
  }

  @Get('staff-working-days/:staffId')
  @UseGuards(...ADMIN_GUARDS)
  getStaffWorkingDays(@Param('staffId') staffId: string) {
    return this.service.getStaffWorkingDays(staffId);
  }

  @Post('staff-working-days')
  @UseGuards(...ADMIN_GUARDS)
  addStaffWorkingDay(
    @Body()
    dto: { staffId: string; dayOfWeek: number; startTime?: string; endTime?: string },
  ) {
    return this.service.addStaffWorkingDay(
      dto.staffId,
      dto.dayOfWeek,
      dto.startTime,
      dto.endTime,
    );
  }

  @Patch('staff-working-days')
  @UseGuards(...ADMIN_GUARDS)
  updateStaffWorkingDay(
    @Body()
    dto: { staffId: string; dayOfWeek: number; startTime: string; endTime: string },
  ) {
    return this.service.updateStaffWorkingDay(
      dto.staffId,
      dto.dayOfWeek,
      dto.startTime,
      dto.endTime,
    );
  }

  @Get('my-working-hours')
  @UseGuards(TokenAuthGuard, StaffGuard)
  getMyWorkingHours(@RequestUser() user: { staffId?: string }) {
    return this.service.getMyWorkingHoursPermissioned(user.staffId!);
  }

  @Put('my-working-hours')
  @UseGuards(TokenAuthGuard, StaffGuard)
  upsertMyWorkingHours(
    @RequestUser() user: { staffId?: string },
    @Body() dto: { dayOfWeek: number; startTime: string; endTime: string },
  ) {
    return this.service.upsertMyWorkingDay(
      user.staffId!,
      dto.dayOfWeek,
      dto.startTime,
      dto.endTime,
    );
  }

  @Delete('my-working-hours/:dayOfWeek')
  @UseGuards(TokenAuthGuard, StaffGuard)
  removeMyWorkingDay(
    @RequestUser() user: { staffId?: string },
    @Param('dayOfWeek') dayOfWeekStr: string,
  ) {
    const dayOfWeek = parseInt(dayOfWeekStr, 10);
    if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new BadRequestException('dayOfWeek 0-6 required');
    }
    return this.service.removeMyWorkingDay(user.staffId!, dayOfWeek);
  }

  @Delete('staff-working-days')
  @UseGuards(...ADMIN_GUARDS)
  removeStaffWorkingDayByDay(@Body() dto: { staffId: string; dayOfWeek: number }) {
    return this.service.removeStaffWorkingDayByDay(dto.staffId, dto.dayOfWeek);
  }

  @Delete('staff-working-days/:id')
  @UseGuards(...ADMIN_GUARDS)
  removeStaffWorkingDay(@Param('id') id: string) {
    return this.service.removeStaffWorkingDay(id);
  }
}

@Module({
  imports: [AuthModule, WaitlistModule, NotificationsModule],
  controllers: [AdminScheduleController],
  providers: [AdminScheduleService],
})
export class AdminScheduleModule {}
