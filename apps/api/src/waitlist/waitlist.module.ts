import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { NotificationsModule } from '../notifications';
import { WaitlistService } from './waitlist.service';
import { WaitlistCustomerController } from './waitlist-customer.controller';
import { WaitlistAdminController } from './waitlist-admin.controller';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [WaitlistCustomerController, WaitlistAdminController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
