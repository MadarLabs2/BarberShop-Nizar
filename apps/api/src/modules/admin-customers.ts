import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../core/supabase';
import { israelTodayYmd } from '../core/israel-time';
import { TokenAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { AuthModule } from '../auth';

const GUARDS = [TokenAuthGuard, AdminGuard];
const PHONE_LEN_MIN = 9;

function normalizePhone(s: string | null | undefined): string {
  return String(s || '')
    .replace(/\D/g, '')
    .slice(-9);
}

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  birth_date: string | null;
  created_at: string | null;
  is_admin: boolean | null;
  api_token: string | null;
};

type StaffExclusion = { profile_id: string | null; phone: string | null };

export type AdminCustomerUpdateDto = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  /** YYYY-MM-DD or null to clear */
  birthDate?: string | null;
};

@Injectable()
export class AdminCustomersService {
  constructor(private readonly supabase: SupabaseService) {}

  private async loadStaffExclusions(): Promise<{ profileIds: Set<string>; phones: Set<string> }> {
    const { data, error } = await this.supabase
      .getClient()
      .from('staff')
      .select('profile_id, phone')
      .eq('is_active', true);
    if (error) throw new BadRequestException(error.message);
    const profileIds = new Set<string>();
    const phones = new Set<string>();
    for (const r of (data || []) as StaffExclusion[]) {
      if (r.profile_id) profileIds.add(r.profile_id);
      const n = normalizePhone(r.phone);
      if (n.length >= 9) phones.add(n);
    }
    return { profileIds, phones };
  }

  /**
   * `profiles` rows are only ever created via the OTP-verify registration flow, so any non-admin,
   * non-staff row is a real customer regardless of whether they currently hold a live session —
   * requiring `api_token` here used to hide every customer the moment they logged out.
   */
  private isEligibleCustomer(p: ProfileRow, ex: { profileIds: Set<string>; phones: Set<string> }): boolean {
    if (p.is_admin) return false;
    if (ex.profileIds.has(p.id)) return false;
    const pn = normalizePhone(p.phone);
    if (pn.length >= 9 && ex.phones.has(pn)) return false;
    return true;
  }

  private async assertEligibleProfileId(id: string): Promise<ProfileRow> {
    const ex = await this.loadStaffExclusions();
    const { data: profile, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id, first_name, last_name, phone, birth_date, created_at, is_admin, api_token')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!profile) throw new NotFoundException();
    const pr = profile as ProfileRow;
    if (!this.isEligibleCustomer(pr, ex)) throw new NotFoundException();
    return pr;
  }

  /** Active staff row using this exact phone string match (DB stores normalized digits). */
  private async isPhoneBelongingToActiveStaff(phone: string): Promise<boolean> {
    const { data } = await this.supabase
      .getClient()
      .from('staff')
      .select('id')
      .eq('phone', phone)
      .eq('is_active', true)
      .maybeSingle();
    return !!data;
  }

  async listCustomers(search: string | undefined, page: number, limit: number) {
    const pg = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const lim = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 20;
    const s = search?.trim() || null;

    const { data, error } = await this.supabase.getClient().rpc('admin_customers_list', {
      p_search: s,
      p_page: pg,
      p_limit: lim,
    });
    if (error) throw new BadRequestException(error.message);
    const raw = data as {
      items?: unknown[];
      total?: number;
      page?: number;
      limit?: number;
    } | null;
    if (!raw || typeof raw !== 'object') {
      return { items: [], total: 0, page: pg, limit: lim };
    }
    return {
      items: Array.isArray(raw.items) ? raw.items : [],
      total: typeof raw.total === 'number' ? raw.total : 0,
      page: typeof raw.page === 'number' ? raw.page : pg,
      limit: typeof raw.limit === 'number' ? raw.limit : lim,
    };
  }

  async getCustomerDetails(id: string) {
    const client = this.supabase.getClient();
    const ex = await this.loadStaffExclusions();

    const { data: profile, error: pErr } = await client
      .from('profiles')
      .select('id, first_name, last_name, phone, birth_date, created_at, is_admin, api_token')
      .eq('id', id)
      .maybeSingle();

    if (pErr) throw new BadRequestException(pErr.message);
    if (!profile) throw new NotFoundException();
    const pr = profile as ProfileRow;
    if (!this.isEligibleCustomer(pr, ex)) throw new NotFoundException();

    const today = israelTodayYmd();

    const [
      totalRes,
      upcomingRes,
      cancelledRes,
      recentRes,
      lastRes,
    ] = await Promise.all([
      client.from('appointments').select('*', { count: 'exact', head: true }).eq('profile_id', id),
      client
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', id)
        .eq('status', 'confirmed')
        .gte('date', today),
      client.from('appointments').select('*', { count: 'exact', head: true }).eq('profile_id', id).eq('status', 'cancelled'),
      client
        .from('appointments')
        .select('id, date, time, status, service_name, staff_name, branch_name')
        .eq('profile_id', id)
        .order('date', { ascending: false })
        .order('time', { ascending: false })
        .limit(10),
      client
        .from('appointments')
        .select('date, time')
        .eq('profile_id', id)
        .order('date', { ascending: false })
        .order('time', { ascending: false })
        .limit(1),
    ]);

    const totalAppointments = totalRes.count ?? 0;
    const upcomingAppointments = upcomingRes.count ?? 0;
    const cancelledAppointments = cancelledRes.count ?? 0;

    const lastRow = Array.isArray(lastRes.data) && lastRes.data[0] ? lastRes.data[0] : null;
    let lastAppointmentAt: string | null = null;
    if (lastRow && lastRow.date) {
      const t = typeof lastRow.time === 'string' ? lastRow.time.slice(0, 8) : String(lastRow.time);
      lastAppointmentAt = `${lastRow.date}T${t}`;
    }

    const recent = (recentRes.data || []) as {
      id: string;
      date: string;
      time: string;
      status: string;
      service_name: string | null;
      staff_name: string | null;
      branch_name: string | null;
    }[];

    const fmtTime = (t: string) => (typeof t === 'string' ? t.slice(0, 5) : String(t).slice(0, 5));

    return {
      id: pr.id,
      firstName: pr.first_name ?? '',
      lastName: pr.last_name ?? '',
      fullName: `${pr.first_name ?? ''} ${pr.last_name ?? ''}`.trim(),
      phone: pr.phone ?? '',
      birthDate: pr.birth_date ?? null,
      createdAt: pr.created_at ?? null,
      totalAppointments,
      upcomingAppointments,
      cancelledAppointments,
      lastAppointmentAt,
      recentAppointments: recent.map((a) => ({
        id: a.id,
        date: a.date,
        time: fmtTime(a.time),
        status: a.status,
        serviceName: a.service_name ?? '',
        staffName: a.staff_name ?? '',
        branchName: a.branch_name ?? '',
      })),
    };
  }

  async updateCustomer(id: string, dto: AdminCustomerUpdateDto) {
    const hasAny =
      dto.firstName !== undefined ||
      dto.lastName !== undefined ||
      dto.phone !== undefined ||
      dto.birthDate !== undefined;
    if (!hasAny) throw new BadRequestException('אין שדות לעדכון');

    await this.assertEligibleProfileId(id);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.firstName !== undefined) {
      const t = dto.firstName.trim();
      if (!t) throw new BadRequestException('שם פרטי חובה');
      if (t.length > 100) throw new BadRequestException('שם פרטי ארוך מדי');
      updates.first_name = t;
    }
    if (dto.lastName !== undefined) {
      const t = dto.lastName.trim();
      if (!t) throw new BadRequestException('שם משפחה חובה');
      if (t.length > 100) throw new BadRequestException('שם משפחה ארוך מדי');
      updates.last_name = t;
    }

    if (dto.phone !== undefined) {
      const phone = normalizePhone(dto.phone);
      if (!phone || phone.length < PHONE_LEN_MIN) throw new BadRequestException('מספר טלפון לא תקין');
      const { data: other } = await this.supabase
        .getClient()
        .from('profiles')
        .select('id')
        .eq('phone', phone)
        .neq('id', id)
        .maybeSingle();
      if (other) throw new BadRequestException('PHONE_IN_USE');
      if (await this.isPhoneBelongingToActiveStaff(phone)) {
        throw new BadRequestException('PHONE_BELONGS_TO_STAFF');
      }
      updates.phone = phone;
    }

    if (dto.birthDate !== undefined) {
      if (dto.birthDate === null || dto.birthDate === '') {
        updates.birth_date = null;
      } else {
        const s = String(dto.birthDate).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException('תאריך לידה חייב להיות בפורמט YYYY-MM-DD');
        updates.birth_date = s;
      }
    }

    const { error: uErr } = await this.supabase.getClient().from('profiles').update(updates).eq('id', id);
    if (uErr) throw new BadRequestException(uErr.message);

    return this.getCustomerDetails(id);
  }

  /** Delete all appointments for a customer from admin customer-details. */
  async deleteCustomerAppointments(customerId: string) {
    await this.assertEligibleProfileId(customerId);
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('appointments')
      .delete()
      .eq('profile_id', customerId)
      .select('id');
    if (error) throw new BadRequestException(error.message);
    return { ok: true as const, deleted: Array.isArray(data) ? data.length : 0 };
  }

  /**
   * Hard-delete eligible customer profile. Safe for this schema:
   * - appointments.profile_id → ON DELETE SET NULL (history kept)
   * - staff.profile_id → ON DELETE SET NULL
   * Notifications use user_phone only (no FK).
   */
  async deleteCustomer(id: string) {
    const profile = await this.assertEligibleProfileId(id);
    const client = this.supabase.getClient();
    const phone = normalizePhone(profile.phone);

    const { data: waitlistRows, error: waitlistRowsErr } = await client
      .from('waitlist')
      .select('id')
      .eq('profile_id', id);
    if (waitlistRowsErr) throw new BadRequestException(waitlistRowsErr.message);

    const waitlistIds = (waitlistRows || []).map((r: { id: string }) => r.id);
    if (waitlistIds.length > 0) {
      const { error: waitlistOffersErr } = await client
        .from('waitlist_slot_offers')
        .delete()
        .in('waitlist_id', waitlistIds);
      if (waitlistOffersErr) throw new BadRequestException(waitlistOffersErr.message);
    }

    const cleanupDeletes: Array<{ table: string; column: string; value: string }> = [
      { table: 'waitlist', column: 'profile_id', value: id },
      { table: 'appointments', column: 'profile_id', value: id },
      { table: 'device_push_tokens', column: 'profile_id', value: id },
      { table: 'home_story_views', column: 'viewer_profile_id', value: id },
      { table: 'home_stories', column: 'created_by_profile_id', value: id },
    ];
    for (const { table, column, value } of cleanupDeletes) {
      const { error: cleanupErr } = await client.from(table).delete().eq(column, value);
      if (cleanupErr) throw new BadRequestException(cleanupErr.message);
    }

    if (phone.length >= PHONE_LEN_MIN) {
      const { error: notificationsErr } = await client.from('notifications').delete().eq('user_phone', phone);
      if (notificationsErr) throw new BadRequestException(notificationsErr.message);
    }

    const { data, error } = await client
      .from('profiles')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) throw new BadRequestException(error.message);
    if (!data || data.length === 0) throw new NotFoundException();

    return { ok: true as const, id };
  }
}

@Controller('admin')
export class AdminCustomersController {
  constructor(private readonly service: AdminCustomersService) {}

  @Get('customers')
  @UseGuards(...GUARDS)
  list(
    @Query('search') search?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = pageStr ? parseInt(pageStr, 10) : 1;
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    return this.service.listCustomers(search, page, limit);
  }

  @Get('customers/:id')
  @UseGuards(...GUARDS)
  getOne(@Param('id') id: string) {
    return this.service.getCustomerDetails(id);
  }

  @Patch('customers/:id')
  @UseGuards(...GUARDS)
  patch(@Param('id') id: string, @Body() body: AdminCustomerUpdateDto) {
    return this.service.updateCustomer(id, body);
  }

  @Delete('customers/:id')
  @UseGuards(...GUARDS)
  remove(@Param('id') id: string) {
    return this.service.deleteCustomer(id);
  }

  @Delete('customers/:id/appointments')
  @UseGuards(...GUARDS)
  removeAppointments(@Param('id') id: string) {
    return this.service.deleteCustomerAppointments(id);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [AdminCustomersController],
  providers: [AdminCustomersService],
})
export class AdminCustomersModule {}
