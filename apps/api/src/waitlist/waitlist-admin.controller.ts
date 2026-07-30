import { Controller, Delete, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TokenAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { StaffGuard } from '../auth/staff.guard';
import { RequestUser } from '../auth/auth.decorator';
import { WaitlistService } from './waitlist.service';

const ADMIN_GUARDS = [TokenAuthGuard, AdminGuard];

@Controller('admin')
export class WaitlistAdminController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get('waitlist')
  @UseGuards(...ADMIN_GUARDS)
  listAdmin(@Query('staffId') staffId?: string) {
    return this.waitlist.listForAdmin(staffId?.trim() || undefined);
  }

  @Get('waitlist/my-staff')
  @UseGuards(TokenAuthGuard, StaffGuard)
  listMyStaff(@RequestUser() user: { staffId?: string }) {
    return this.waitlist.listForStaff(user.staffId!);
  }

  /** Staff must list before `waitlist/:id` so `:id` does not capture `staff`. */
  @Delete('waitlist/staff/:id')
  @UseGuards(TokenAuthGuard, StaffGuard)
  removeMyStaffEntry(@RequestUser() user: { staffId?: string }, @Param('id') id: string) {
    return this.waitlist.removeEntryAsStaff(id, user.staffId!);
  }

  @Delete('waitlist/:id')
  @UseGuards(...ADMIN_GUARDS)
  removeEntryAdmin(@Param('id') id: string) {
    return this.waitlist.removeEntryAsAdmin(id);
  }
}
