import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from './core/cache.module';
import { CoreModule } from './core/supabase';
import { AuthModule } from './auth';
import { CatalogModule } from './catalog';
import { BookingsModule } from './bookings';
import { AdminModule } from './admin';
import { NotificationsModule } from './notifications';
import { ProductsModule } from './modules/products';
import { HomeStoriesModule } from './modules/home-stories';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'otp', ttl: 60_000, limit: 12 },
      { name: 'writes', ttl: 60_000, limit: 72 },
    ]),
    CoreModule,
    CacheModule,
    AuthModule,
    CatalogModule,
    BookingsModule,
    AdminModule,
    NotificationsModule,
    ProductsModule,
    HomeStoriesModule,
  ],
})
export class AppModule {}
