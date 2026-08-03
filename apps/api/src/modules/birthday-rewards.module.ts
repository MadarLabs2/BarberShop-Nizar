import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications';
import { BirthdayRewardsService } from './birthday-rewards.service';

@Module({
  imports: [NotificationsModule],
  providers: [BirthdayRewardsService],
  exports: [BirthdayRewardsService],
})
export class BirthdayRewardsModule {}
