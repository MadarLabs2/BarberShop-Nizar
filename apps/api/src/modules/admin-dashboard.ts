import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, Query, UseGuards } from '@nestjs/common';
import { CACHE_KEY_ADMIN_SUMMARY, CacheService } from '../core/cache.service';
import { SupabaseService } from '../core/supabase';
import { israelTodayYmd } from '../core/israel-time';
import { TokenAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { StaffGuard } from '../auth/staff.guard';
import { RequestUser } from '../auth/auth.decorator';
import type { UserPayload } from '../auth';
import { AuthModule } from '../auth';
import { NotificationsModule, NotificationsService } from '../notifications';

const GUARDS = [TokenAuthGuard, AdminGuard];
const TTL_ADMIN_SUMMARY = 30;

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService,
  ) {}

  private async fetchSummary(): Promise<{
    branches: number;
    services: number;
    staff: number;
    upcomingAppointments: number;
  }> {
    const client = this.supabase.getClient();
    const today = israelTodayYmd();

    const headCount = { count: 'exact' as const, head: true as const };
    const [
      { count: branchesCount },
      { count: servicesCount },
      { count: staffCount },
      { count: appointmentsCount },
    ] = await Promise.all([
      client.from('branches').select('id', headCount).eq('is_active', true),
      client.from('services').select('id', headCount).eq('is_active', true),
      client.from('staff').select('id', headCount).eq('is_active', true),
      client.from('appointments').select('id', headCount).eq('status', 'confirmed').gte('date', today),
    ]);

    return {
      branches: branchesCount ?? 0,
      services: servicesCount ?? 0,
      staff: staffCount ?? 0,
      upcomingAppointments: appointmentsCount ?? 0,
    };
  }

  async getSummary(): Promise<{
    branches: number;
    services: number;
    staff: number;
    upcomingAppointments: number;
  }> {
    return this.cache.getOrSet(CACHE_KEY_ADMIN_SUMMARY, TTL_ADMIN_SUMMARY, () => this.fetchSummary());
  }

  async getUpdatesFeed(limit = 50): Promise<
    { id: string; clientName: string; serviceName: string; staffName: string; date: string; time: string }[]
  > {
    const { data, error } = await this.supabase
      .getClient()
      .from('appointments')
      .select('id, client_name, service_name, staff_name, date, time')
      .eq('status', 'confirmed')
      .order('date', { ascending: false })
      .order('time', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []).map((r: { id: string; client_name: string | null; service_name: string | null; staff_name: string | null; date: string; time: string }) => ({
      id: r.id,
      clientName: r.client_name || 'לקוח',
      serviceName: r.service_name || 'טיפול',
      staffName: r.staff_name || '',
      date: r.date,
      time: typeof r.time === 'string' ? r.time.slice(0, 5) : r.time,
    }));
  }

  async createBroadcast(title: string, body?: string) {
    if (!title?.trim()) throw new BadRequestException('Title required');
    await this.notifications.create({
      userPhone: null,
      type: 'admin',
      title: title.trim(),
      body: body?.trim() || '',
    });
    return { ok: true };
  }

  /** Notify only customers with an active waitlist row (in-app notifications). */
  async createBroadcastWaitlist(title: string, body?: string) {
    if (!title?.trim()) throw new BadRequestException('Title required');
    const { data, error } = await this.supabase
      .getClient()
      .from('waitlist')
      .select('client_phone')
      .eq('status', 'active');
    if (error) throw new BadRequestException(error.message);
    const phones = (data || []).map((r: { client_phone: string }) => r.client_phone).filter(Boolean);
    const { sent } = await this.notifications.broadcastToPhones(title.trim(), (body ?? '').trim(), phones);
    return { ok: true, sent };
  }

  /** Queue waitlist broadcast for a specific staff member and return immediately. */
  async createBroadcastWaitlistForStaff(staffId: string, title: string, body?: string) {
    if (!staffId?.trim()) throw new BadRequestException('staffId required');
    if (!title?.trim()) throw new BadRequestException('Title required');
    const { data, error } = await this.supabase
      .getClient()
      .from('waitlist')
      .select('client_phone')
      .eq('status', 'active')
      .eq('staff_id', staffId.trim());
    if (error) throw new BadRequestException(error.message);
    const phones = (data || []).map((r: { client_phone: string }) => r.client_phone).filter(Boolean);
    const uniqueCount = new Set(phones).size;
    // Fire-and-forget so admin gets instant response; delivery continues in background.
    void this.notifications.broadcastToPhones(title.trim(), (body ?? '').trim(), phones).catch(() => {});
    return { ok: true, queued: uniqueCount };
  }

  /** Queue waitlist broadcast for the signed-in staff member and return immediately. */
  async createBroadcastWaitlistForMyStaff(staffId: string, title: string, body?: string) {
    return this.createBroadcastWaitlistForStaff(staffId, title, body);
  }
}

@Controller('admin')
export class AdminDashboardController {
  constructor(private readonly service: AdminDashboardService) {}

  @Get('summary')
  @UseGuards(...GUARDS)
  getSummary() {
    return this.service.getSummary();
  }

  @Get('updates')
  @UseGuards(...GUARDS)
  getUpdatesFeed(@Query('limit') limit?: string) {
    return this.service.getUpdatesFeed(limit ? Math.min(100, parseInt(limit, 10) || 50) : 50);
  }

  @Post('broadcast')
  @UseGuards(...GUARDS)
  createBroadcast(@Body() dto: { title: string; body?: string }) {
    return this.service.createBroadcast(dto.title, dto.body);
  }

  @Post('broadcast/waitlist')
  @UseGuards(...GUARDS)
  createBroadcastWaitlist(@Body() dto: { title: string; body?: string }) {
    return this.service.createBroadcastWaitlist(dto.title, dto.body);
  }

  @Post('broadcast/waitlist/staff')
  @UseGuards(...GUARDS)
  createBroadcastWaitlistForStaff(@Body() dto: { staffId: string; title: string; body?: string }) {
    return this.service.createBroadcastWaitlistForStaff(dto.staffId, dto.title, dto.body);
  }

  @Post('broadcast/waitlist/my-staff')
  @UseGuards(TokenAuthGuard, StaffGuard)
  createBroadcastWaitlistForMyStaff(@RequestUser() user: UserPayload, @Body() dto: { title: string; body?: string }) {
    if (!user.staffId) throw new BadRequestException('Staff profile required');
    return this.service.createBroadcastWaitlistForMyStaff(user.staffId, dto.title, dto.body);
  }
}

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
