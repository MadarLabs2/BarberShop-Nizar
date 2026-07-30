import { Controller, Get, Injectable, Module, NotFoundException, Param } from '@nestjs/common';
import {
  CACHE_KEY_CATALOG_ALL,
  CACHE_KEY_CATALOG_BRANCHES,
  CACHE_KEY_CATALOG_SERVICES,
  CACHE_KEY_CATALOG_STAFF,
  CACHE_KEY_CATALOG_STAFF_BOOKABLE,
  CacheService,
} from './core/cache.service';
import { SupabaseService } from './core/supabase';

export type BranchDto = { id: string; name: string; address: string | null; wazeLink: string | null };
export type ServiceDto = { id: string; name: string; price: number; duration: number };
export type StaffDto = {
  id: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  /** Only on GET /catalog/staff/bookable — branches + services for instant booking UI without per-staff booking-context first. */
  bookingSummary?: { branches: BranchDto[]; services: ServiceDto[] };
};
type StaffCatalogRow = { id: string; name: string; phone: string | null; avatar_url: string | null };

const TTL_CATALOG_DEFAULT = 300;
/** Shorter TTL so staff removed (incl. direct DB) reflects sooner when Redis is used. */
const TTL_CATALOG_STAFF_BOOKABLE = 45;

@Injectable()
export class CatalogService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  private async fetchBranches(): Promise<BranchDto[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('branches')
      .select('id, name, address, waze_link')
      .eq('is_active', true)
      .order('name');
    if (error) return [];
    return (data || []).map((r: { id: string; name: string; address: string | null; waze_link: string | null }) => ({
      id: r.id,
      name: r.name,
      address: r.address ?? null,
      wazeLink: r.waze_link ?? null,
    }));
  }

  async getBranches(): Promise<BranchDto[]> {
    return this.cache.getOrSet(CACHE_KEY_CATALOG_BRANCHES, TTL_CATALOG_DEFAULT, () => this.fetchBranches());
  }

  private async fetchServices(): Promise<ServiceDto[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('services')
      .select('id, name, price, duration')
      .eq('is_active', true)
      .order('name');
    if (error) return [];
    return (data || []).map((r: { id: string; name: string; price: number; duration: number }) => ({
      id: r.id,
      name: r.name,
      price: r.price,
      duration: r.duration,
    }));
  }

  async getServices(): Promise<ServiceDto[]> {
    return this.cache.getOrSet(CACHE_KEY_CATALOG_SERVICES, TTL_CATALOG_DEFAULT, () => this.fetchServices());
  }

  private async fetchStaff(): Promise<StaffDto[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('staff')
      .select('id, name, phone, avatar_url')
      .eq('is_active', true)
      .order('name');
    if (error) return [];
    return (data || []).map((r: { id: string; name: string; phone: string | null; avatar_url: string | null }) => ({
      id: r.id,
      name: r.name,
      phone: r.phone ?? null,
      avatarUrl: r.avatar_url ?? null,
    }));
  }

  async getStaff(): Promise<StaffDto[]> {
    return this.cache.getOrSet(CACHE_KEY_CATALOG_STAFF, TTL_CATALOG_DEFAULT, () => this.fetchStaff());
  }

  /**
   * Staff who may appear in the customer booking flow:
   * active, accepts_bookings, avatar uploaded, at least one active branch,
   * at least one working day, at least one assigned active service.
   * Not tied to profile admin flag.
   */
  private async getBookableStaffRows(): Promise<StaffCatalogRow[]> {
    const client = this.supabase.getClient();
    const { data: staffRows } = await client
      .from('staff')
      .select('id, name, phone, avatar_url')
      .eq('is_active', true)
      .order('name')
      .eq('accepts_bookings', true);
    if (!staffRows?.length) return [];
    const withAvatar = (staffRows || []).filter((r: { id: string; avatar_url?: string | null }) =>
      !!String(r.avatar_url || '').trim(),
    ) as StaffCatalogRow[];
    if (withAvatar.length === 0) return [];

    const staffIds = withAvatar.map((r) => r.id);
    const [{ data: branchRows }, { data: svcRows }, { data: branchLinks }, { data: ssRows }, { data: wdRows }] = await Promise.all([
      client.from('branches').select('id').eq('is_active', true),
      client.from('services').select('id').eq('is_active', true),
      client.from('branch_staff').select('staff_id, branch_id').in('staff_id', staffIds),
      client.from('staff_service').select('staff_id, service_id').in('staff_id', staffIds),
      client.from('staff_working_days').select('staff_id').in('staff_id', staffIds),
    ]);

    const activeBranchIds = new Set((branchRows || []).map((r: { id: string }) => r.id));
    if (activeBranchIds.size === 0) return [];
    const activeSvcIds = new Set((svcRows || []).map((r: { id: string }) => r.id));
    if (activeSvcIds.size === 0) return [];

    const withBranch = new Set<string>();
    for (const r of branchLinks || []) {
      const row = r as { staff_id: string; branch_id: string };
      if (activeBranchIds.has(row.branch_id)) withBranch.add(row.staff_id);
    }
    if (withBranch.size === 0) return [];

    const withService = new Set<string>();
    for (const r of ssRows || []) {
      const row = r as { staff_id: string; service_id: string };
      if (activeSvcIds.has(row.service_id)) withService.add(row.staff_id);
    }
    if (withService.size === 0) return [];

    const withDays = new Set((wdRows || []).map((r: { staff_id: string }) => r.staff_id));
    if (withDays.size === 0) return [];

    return withAvatar.filter((row) => withBranch.has(row.id) && withService.has(row.id) && withDays.has(row.id));
  }

  private async computeBookableStaffIds(): Promise<Set<string>> {
    return new Set((await this.getBookableStaffRows()).map((row) => row.id));
  }

  /**
   * Batched branches + services per staff (same shapes as getStaffBookingContext, without workingDays).
   * Used only for bookable staff list so the mobile app can paint סניף/טיפול before N× booking-context.
   */
  private async buildBookingSummariesForStaffIds(
    staffIds: string[],
  ): Promise<Map<string, { branches: BranchDto[]; services: ServiceDto[] }>> {
    const out = new Map<string, { branches: BranchDto[]; services: ServiceDto[] }>();
    if (staffIds.length === 0) return out;
    const client = this.supabase.getClient();

    const [{ data: branchLinks }, { data: staffServiceRows }] = await Promise.all([
      client.from('branch_staff').select('staff_id, branch_id').in('staff_id', staffIds),
      client.from('staff_service').select('staff_id, service_id, price, duration').in('staff_id', staffIds),
    ]);

    const branchIds = [...new Set((branchLinks || []).map((r: { branch_id: string }) => r.branch_id).filter(Boolean))];
    const { data: brRows } =
      branchIds.length > 0
        ? await client
            .from('branches')
            .select('id, name, address, waze_link')
            .in('id', branchIds)
            .eq('is_active', true)
        : { data: [] };

    const branchById = new Map(
      (brRows || []).map((r: { id: string; name: string; address: string | null; waze_link: string | null }) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          address: r.address ?? null,
          wazeLink: r.waze_link ?? null,
        } satisfies BranchDto,
      ]),
    );

    const serviceIds = [...new Set((staffServiceRows || []).map((r: { service_id: string }) => r.service_id))];
    const { data: servicesRows } =
      serviceIds.length > 0
        ? await client.from('services').select('id, name').in('id', serviceIds).eq('is_active', true)
        : { data: [] };
    const activeServiceIds = new Set((servicesRows || []).map((r: { id: string }) => r.id));
    const serviceNameMap: Record<string, string> = {};
    for (const r of servicesRows || []) {
      const row = r as { id: string; name: string };
      serviceNameMap[row.id] = row.name;
    }

    const staffBranchIds = new Map<string, Set<string>>();
    for (const r of branchLinks || []) {
      const row = r as { staff_id: string; branch_id: string };
      if (!branchById.has(row.branch_id)) continue;
      if (!staffBranchIds.has(row.staff_id)) staffBranchIds.set(row.staff_id, new Set());
      staffBranchIds.get(row.staff_id)!.add(row.branch_id);
    }

    const staffServices = new Map<string, ServiceDto[]>();
    for (const r of staffServiceRows || []) {
      const row = r as { staff_id: string; service_id: string; price: number; duration: number };
      if (!activeServiceIds.has(row.service_id)) continue;
      if (!staffServices.has(row.staff_id)) staffServices.set(row.staff_id, []);
      staffServices.get(row.staff_id)!.push({
        id: row.service_id,
        name: serviceNameMap[row.service_id] ?? 'טיפול',
        price: row.price,
        duration: row.duration,
      });
    }

    for (const sid of staffIds) {
      const bset = staffBranchIds.get(sid);
      const branches = bset
        ? [...bset]
            .map((bid) => branchById.get(bid))
            .filter((b): b is BranchDto => !!b)
            .sort((a, b) => a.name.localeCompare(b.name, 'he'))
        : [];
      const services = (staffServices.get(sid) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, 'he'));
      if (branches.length > 0 && services.length > 0) {
        out.set(sid, { branches, services });
      }
    }

    return out;
  }

  async getBookableStaff(): Promise<StaffDto[]> {
    return this.cache.getOrSet(CACHE_KEY_CATALOG_STAFF_BOOKABLE, TTL_CATALOG_STAFF_BOOKABLE, async () => {
      const rows = await this.getBookableStaffRows();
      const ids = rows.map((r) => r.id);
      const summaries = await this.buildBookingSummariesForStaffIds(ids);
      return rows.map((r: { id: string; name: string; phone: string | null; avatar_url: string | null }) => ({
        id: r.id,
        name: r.name,
        phone: r.phone ?? null,
        avatarUrl: r.avatar_url ?? null,
        bookingSummary: summaries.get(r.id),
      }));
    });
  }

  private timeToHHMM(t: string | null): string {
    if (!t) return '09:00';
    const s = String(t).slice(0, 8);
    const [h, m] = s.split(':').map(Number);
    return `${String(h ?? 9).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
  }

  async getStaffForBranch(
    branchId: string,
  ): Promise<
    { id: string; name: string; avatarUrl: string | null; workingDays: { dayOfWeek: number; startTime: string; endTime: string }[]; services: { id: string; name: string; price: number; duration: number }[] }[]
  > {
    const { data: links, error } = await this.supabase
      .getClient()
      .from('branch_staff')
      .select('staff_id')
      .eq('branch_id', branchId);
    if (error || !links?.length) return [];
    const { data: branchMeta } = await this.supabase.getClient().from('branches').select('id').eq('id', branchId).eq('is_active', true).maybeSingle();
    if (!branchMeta) return [];

    let staffIds = links.map((r: { staff_id: string }) => r.staff_id).filter(Boolean);
    if (staffIds.length === 0) return [];
    const bookable = await this.computeBookableStaffIds();
    staffIds = staffIds.filter((id) => bookable.has(id));
    if (staffIds.length === 0) return [];

    const [{ data: staffRows }, { data: workingDaysRows }, { data: staffServiceRows }] = await Promise.all([
      this.supabase
        .getClient()
        .from('staff')
        .select('id, name, avatar_url')
        .in('id', staffIds)
        .eq('is_active', true)
        .order('name'),
      this.supabase
        .getClient()
        .from('staff_working_days')
        .select('staff_id, day_of_week, start_time, end_time')
        .in('staff_id', staffIds),
      this.supabase
        .getClient()
        .from('staff_service')
        .select('staff_id, service_id, price, duration')
        .in('staff_id', staffIds),
    ]);
    const serviceIds = [...new Set((staffServiceRows || []).map((r: { service_id: string }) => r.service_id))];
    const { data: servicesRows } =
      serviceIds.length > 0
        ? await this.supabase
            .getClient()
            .from('services')
            .select('id, name')
            .in('id', serviceIds)
            .eq('is_active', true)
        : { data: [] };
    const serviceNameMap: Record<string, string> = {};
    for (const r of servicesRows || []) {
      const row = r as { id: string; name: string };
      serviceNameMap[row.id] = row.name;
    }
    const workMap: Record<string, { dayOfWeek: number; startTime: string; endTime: string }[]> = {};
    for (const r of workingDaysRows || []) {
      const row = r as { staff_id: string; day_of_week: number; start_time: string | null; end_time: string | null };
      if (!workMap[row.staff_id]) workMap[row.staff_id] = [];
      workMap[row.staff_id].push({
        dayOfWeek: row.day_of_week,
        startTime: this.timeToHHMM(row.start_time),
        endTime: this.timeToHHMM(row.end_time),
      });
    }
    const serviceMap: Record<string, { id: string; name: string; price: number; duration: number }[]> = {};
    for (const r of staffServiceRows || []) {
      const row = r as { staff_id: string; service_id: string; price: number; duration: number };
      if (!serviceMap[row.staff_id]) serviceMap[row.staff_id] = [];
      serviceMap[row.staff_id].push({
        id: row.service_id,
        name: serviceNameMap[row.service_id] ?? 'טיפול',
        price: row.price,
        duration: row.duration,
      });
    }
    return (staffRows || [])
      .map((s: { id: string; name: string; avatar_url: string | null }) => ({
        id: s.id,
        name: s.name,
        avatarUrl: s.avatar_url ?? null,
        workingDays: workMap[s.id] ?? [],
        services: serviceMap[s.id] ?? [],
      }))
      .filter((row) => row.workingDays.length > 0 && row.services.length > 0);
  }

  /**
   * Staff-first booking: branches where this staff is assigned, plus their working days and offered services.
   */
  async getStaffBookingContext(staffId: string): Promise<{
    staff: { id: string; name: string; avatarUrl: string | null };
    branches: BranchDto[];
    workingDays: { dayOfWeek: number; startTime: string; endTime: string }[];
    services: { id: string; name: string; price: number; duration: number }[];
  } | null> {
    const { data: staffRow, error: staffErr } = await this.supabase
      .getClient()
      .from('staff')
      .select('id, name, avatar_url, accepts_bookings')
      .eq('id', staffId)
      .eq('is_active', true)
      .maybeSingle();
    if (staffErr || !staffRow) return null;

    const s = staffRow as { id: string; name: string; avatar_url: string | null; accepts_bookings?: boolean };
    if (s.accepts_bookings === false) return null;
    if (!String(s.avatar_url || '').trim()) return null;

    const { data: branchLinks } = await this.supabase
      .getClient()
      .from('branch_staff')
      .select('branch_id')
      .eq('staff_id', staffId);
    const branchIds = [...new Set((branchLinks || []).map((r: { branch_id: string }) => r.branch_id).filter(Boolean))];

    let branches: BranchDto[] = [];
    if (branchIds.length > 0) {
      const { data: brRows } = await this.supabase
        .getClient()
        .from('branches')
        .select('id, name, address, waze_link')
        .in('id', branchIds)
        .eq('is_active', true)
        .order('name');
      branches = (brRows || []).map((r: { id: string; name: string; address: string | null; waze_link: string | null }) => ({
        id: r.id,
        name: r.name,
        address: r.address ?? null,
        wazeLink: r.waze_link ?? null,
      }));
    }

    const { data: workingDaysRows } = await this.supabase
      .getClient()
      .from('staff_working_days')
      .select('day_of_week, start_time, end_time')
      .eq('staff_id', staffId);

    const workingDays: { dayOfWeek: number; startTime: string; endTime: string }[] = [];
    for (const r of workingDaysRows || []) {
      const row = r as { day_of_week: number; start_time: string | null; end_time: string | null };
      workingDays.push({
        dayOfWeek: row.day_of_week,
        startTime: this.timeToHHMM(row.start_time),
        endTime: this.timeToHHMM(row.end_time),
      });
    }

    const { data: staffServiceRows } = await this.supabase
      .getClient()
      .from('staff_service')
      .select('service_id, price, duration')
      .eq('staff_id', staffId);
    const serviceIds = [...new Set((staffServiceRows || []).map((r: { service_id: string }) => r.service_id))];
    const { data: servicesRows } =
      serviceIds.length > 0
        ? await this.supabase.getClient().from('services').select('id, name').in('id', serviceIds).eq('is_active', true)
        : { data: [] };
    const serviceNameMap: Record<string, string> = {};
    for (const r of servicesRows || []) {
      const row = r as { id: string; name: string };
      serviceNameMap[row.id] = row.name;
    }
    const services: { id: string; name: string; price: number; duration: number }[] = [];
    for (const r of staffServiceRows || []) {
      const row = r as { service_id: string; price: number; duration: number };
      services.push({
        id: row.service_id,
        name: serviceNameMap[row.service_id] ?? 'טיפול',
        price: row.price,
        duration: row.duration,
      });
    }
    services.sort((a, b) => a.name.localeCompare(b.name, 'he'));

    if (branches.length === 0 || workingDays.length === 0 || services.length === 0) return null;

    return {
      staff: { id: s.id, name: s.name, avatarUrl: s.avatar_url ?? null },
      branches,
      workingDays,
      services,
    };
  }

  async getAll(): Promise<{ branches: BranchDto[]; services: ServiceDto[]; staff: StaffDto[] }> {
    return this.cache.getOrSet(CACHE_KEY_CATALOG_ALL, TTL_CATALOG_DEFAULT, async () => {
      const [branches, services, staff] = await Promise.all([
        this.fetchBranches(),
        this.fetchServices(),
        this.fetchStaff(),
      ]);
      return { branches, services, staff };
    });
  }
}

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  async getAll() {
    return this.catalog.getAll();
  }

  @Get('branches')
  async getBranches() {
    return this.catalog.getBranches();
  }

  @Get('services')
  async getServices() {
    return this.catalog.getServices();
  }

  @Get('staff')
  async getStaff() {
    return this.catalog.getStaff();
  }

  @Get('staff/bookable')
  async getBookableStaff() {
    return this.catalog.getBookableStaff();
  }

  @Get('staff/:staffId/booking-context')
  async getStaffBookingContext(@Param('staffId') staffId: string) {
    const ctx = await this.catalog.getStaffBookingContext(staffId);
    if (!ctx) throw new NotFoundException('Staff not found');
    return ctx;
  }

  @Get('branches/:branchId/staff')
  async getStaffForBranch(@Param('branchId') branchId: string) {
    return this.catalog.getStaffForBranch(branchId);
  }
}

@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
