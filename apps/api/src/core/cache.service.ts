import { Injectable } from '@nestjs/common';

export const CACHE_KEY_CATALOG_ALL = 'catalog:all';
export const CACHE_KEY_CATALOG_BRANCHES = 'catalog:branches';
export const CACHE_KEY_CATALOG_SERVICES = 'catalog:services';
export const CACHE_KEY_CATALOG_STAFF = 'catalog:staff';
export const CACHE_KEY_CATALOG_STAFF_BOOKABLE = 'catalog:staff_bookable';
export const CACHE_KEY_CATALOG_PRODUCTS = 'catalog:products';
export const CACHE_KEY_ADMIN_CATALOG = 'admin:catalog';
export const CACHE_KEY_ADMIN_SUMMARY = 'admin:summary';

export function cacheKeyBookingsSlots(staffId: string, serviceId: string, date: string): string {
  return `bookings:slots:${staffId}:${serviceId}:${date}`;
}

@Injectable()
export class CacheService {
  isEnabled(): boolean {
    return false;
  }

  async getOrSet<T>(_key: string, _ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    return loader();
  }

  async del(_key: string): Promise<void> {}

  async delPattern(_pattern: string): Promise<number> {
    return 0;
  }

  async invalidateCatalogAndAdmin(): Promise<void> {}
  async invalidateAdminSummary(): Promise<void> {}
  async invalidateBookingsSlotsForStaff(_staffId: string): Promise<void> {}
  async invalidateBookingsSlotsForStaffDate(_staffId: string, _date: string): Promise<void> {}
  async invalidateAllBookingsSlots(): Promise<void> {}
}
