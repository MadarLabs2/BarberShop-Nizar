import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { TokenAuthGuard } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.decorator';
import type { UserPayload } from '../auth';
import { WaitlistService } from './waitlist.service';

@Controller('bookings')
export class WaitlistCustomerController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Post('waitlist')
  @UseGuards(TokenAuthGuard)
  join(
    @RequestUser() user: UserPayload,
    @Body()
    dto: {
      branchId?: string;
      staffId?: string;
      serviceId?: string;
      date?: string;
      preferMorning?: boolean;
      preferAfternoon?: boolean;
      preferEvening?: boolean;
    },
  ) {
    if (!dto.branchId || !dto.staffId || !dto.serviceId || !dto.date) {
      throw new BadRequestException('branchId, staffId, serviceId, date required');
    }
    return this.waitlist.join(user, {
      branchId: dto.branchId,
      staffId: dto.staffId,
      serviceId: dto.serviceId,
      date: dto.date,
      preferMorning: !!dto.preferMorning,
      preferAfternoon: !!dto.preferAfternoon,
      preferEvening: !!dto.preferEvening,
    });
  }

  @Get('waitlist/my')
  @UseGuards(TokenAuthGuard)
  my(@RequestUser() user: UserPayload) {
    return this.waitlist.listMine(user);
  }

  @Get('waitlist/offers/pending')
  @UseGuards(TokenAuthGuard)
  pendingOffers(@RequestUser() user: UserPayload) {
    return this.waitlist.listPendingOffers(user);
  }

  @Delete('waitlist/:id')
  @UseGuards(TokenAuthGuard)
  leave(@RequestUser() user: UserPayload, @Param('id') id: string) {
    return this.waitlist.leave(user, id);
  }
}
