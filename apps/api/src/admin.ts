import { Module } from '@nestjs/common';
import { AdminDashboardModule } from './modules/admin-dashboard';
import { AdminCatalogModule } from './modules/admin-catalog';
import { AdminScheduleModule } from './modules/admin-schedule';
import { AdminAssignmentsModule } from './modules/admin-assignments';
import { AdminCustomersModule } from './modules/admin-customers';
import { StaffReportsModule } from './modules/staff-reports';

@Module({
  imports: [
    AdminDashboardModule,
    AdminCatalogModule,
    AdminScheduleModule,
    AdminAssignmentsModule,
    AdminCustomersModule,
    StaffReportsModule,
  ],
})
export class AdminModule {}
