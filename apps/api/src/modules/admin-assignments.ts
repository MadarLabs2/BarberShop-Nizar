import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CacheService } from '../core/cache.service';
import { SupabaseService } from '../core/supabase';
import { TokenAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { AuthModule } from '../auth';

const GUARDS = [TokenAuthGuard, AdminGuard];

@Injectable()
export class AdminAssignmentsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async addBranchStaff(branchId: string, staffId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('branch_staff')
      .insert({ branch_id: branchId, staff_id: staffId })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.cache.invalidateCatalogAndAdmin();
    await this.cache.invalidateBookingsSlotsForStaff(staffId);
    return data;
  }

  async removeBranchStaff(id: string) {
    const client = this.supabase.getClient();
    const { data: row } = await client.from('branch_staff').select('staff_id').eq('id', id).maybeSingle();
    const staffId = (row as { staff_id?: string } | null)?.staff_id;
    const { error } = await client.from('branch_staff').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await this.cache.invalidateCatalogAndAdmin();
    if (staffId) await this.cache.invalidateBookingsSlotsForStaff(staffId);
    return { ok: true };
  }

  async getBranchStaff(): Promise<{ id: string; branchId: string; staffId: string }[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('branch_staff')
      .select('id, branch_id, staff_id');
    if (error) return [];
    return (data || []).map((r: { id: string; branch_id: string; staff_id: string }) => ({
      id: r.id,
      branchId: r.branch_id,
      staffId: r.staff_id,
    }));
  }

  async getStaffServices(): Promise<{ id: string; staffId: string; serviceId: string; price: number; duration: number }[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('staff_service')
      .select('id, staff_id, service_id, price, duration');
    if (error) return [];
    return (data || []).map((r: { id: string; staff_id: string; service_id: string; price: number; duration: number }) => ({
      id: r.id,
      staffId: r.staff_id,
      serviceId: r.service_id,
      price: r.price,
      duration: r.duration,
    }));
  }

  async addStaffService(staffId: string, serviceId: string, price: number, duration: number) {
    if (typeof price !== 'number' || price < 0) throw new BadRequestException('price must be a non-negative number');
    if (typeof duration !== 'number' || duration < 5 || duration > 180) throw new BadRequestException('duration must be 5–180 minutes');
    const { data, error } = await this.supabase
      .getClient()
      .from('staff_service')
      .insert({ staff_id: staffId, service_id: serviceId, price, duration })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') throw new BadRequestException('Staff already provides this service');
      throw new BadRequestException(error.message);
    }
    await this.cache.invalidateCatalogAndAdmin();
    await this.cache.invalidateBookingsSlotsForStaff(staffId);
    return data;
  }

  async updateStaffService(id: string, dto: { price?: number; duration?: number }) {
    if (!dto.price && dto.price !== 0 && !dto.duration) return { ok: true };
    const updates: { price?: number; duration?: number } = {};
    if (dto.price !== undefined) {
      if (typeof dto.price !== 'number' || dto.price < 0) throw new BadRequestException('price must be non-negative');
      updates.price = dto.price;
    }
    if (dto.duration !== undefined) {
      if (typeof dto.duration !== 'number' || dto.duration < 5 || dto.duration > 180) throw new BadRequestException('duration must be 5–180 minutes');
      updates.duration = dto.duration;
    }
    const client = this.supabase.getClient();
    const { data: row } = await client.from('staff_service').select('staff_id').eq('id', id).maybeSingle();
    const staffId = (row as { staff_id?: string } | null)?.staff_id;
    const { error } = await client.from('staff_service').update(updates).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await this.cache.invalidateCatalogAndAdmin();
    if (staffId) await this.cache.invalidateBookingsSlotsForStaff(staffId);
    return { ok: true };
  }

  async removeStaffService(id: string) {
    const client = this.supabase.getClient();
    const { data: row } = await client.from('staff_service').select('staff_id').eq('id', id).maybeSingle();
    const staffId = (row as { staff_id?: string } | null)?.staff_id;
    const { error } = await client.from('staff_service').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await this.cache.invalidateCatalogAndAdmin();
    if (staffId) await this.cache.invalidateBookingsSlotsForStaff(staffId);
    return { ok: true };
  }
}

@Controller('admin')
export class AdminAssignmentsController {
  constructor(private readonly service: AdminAssignmentsService) {}

  @Post('branch-staff')
  @UseGuards(...GUARDS)
  addBranchStaff(@Body() dto: { branchId: string; staffId: string }) {
    return this.service.addBranchStaff(dto.branchId, dto.staffId);
  }

  @Delete('branch-staff/:id')
  @UseGuards(...GUARDS)
  removeBranchStaff(@Param('id') id: string) {
    return this.service.removeBranchStaff(id);
  }

  @Get('branch-staff')
  @UseGuards(...GUARDS)
  getBranchStaff() {
    return this.service.getBranchStaff();
  }

  @Get('staff-services')
  @UseGuards(...GUARDS)
  getStaffServices() {
    return this.service.getStaffServices();
  }

  @Post('staff-services')
  @UseGuards(...GUARDS)
  addStaffService(@Body() dto: { staffId: string; serviceId: string; price: number; duration: number }) {
    return this.service.addStaffService(dto.staffId, dto.serviceId, dto.price, dto.duration);
  }

  @Patch('staff-services/:id')
  @UseGuards(...GUARDS)
  updateStaffService(@Param('id') id: string, @Body() dto: { price?: number; duration?: number }) {
    return this.service.updateStaffService(id, dto);
  }

  @Delete('staff-services/:id')
  @UseGuards(...GUARDS)
  removeStaffService(@Param('id') id: string) {
    return this.service.removeStaffService(id);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [AdminAssignmentsController],
  providers: [AdminAssignmentsService],
})
export class AdminAssignmentsModule {}
