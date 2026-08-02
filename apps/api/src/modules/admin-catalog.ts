import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CACHE_KEY_ADMIN_CATALOG, CacheService } from '../core/cache.service';
import { SupabaseService } from '../core/supabase';
import { TokenAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { AuthModule } from '../auth';
import { RequestUser } from '../auth/auth.decorator';
import type { UserPayload } from '../auth/auth.service';
import { NotificationsModule } from '../notifications';
import { PushDeliveryService } from '../push-delivery.service';

const GUARDS = [TokenAuthGuard, AdminGuard];

/** Same bucket as product images; path prefix `staff/` keeps avatars grouped. */
const STAFF_AVATAR_BUCKET = 'product-images';
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function extFromMime(mimetype: string): string {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/webp') return 'webp';
  if (mimetype === 'image/gif') return 'gif';
  return 'jpg';
}

function splitProfileName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(' ');
  if (parts.length === 1) return { firstName: trimmed, lastName: '' };
  return {
    firstName: parts[0] ?? trimmed,
    lastName: parts.slice(1).join(' '),
  };
}

function releasedProfilePhoneValue(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`.slice(-9);
}

type BranchRow = {
  id: string;
  name: string;
  name_he: string;
  name_ar: string;
  address: string | null;
  waze_link: string | null;
  phone: string | null;
  instagram_url: string | null;
  is_active: boolean;
};
type ServiceRow = {
  id: string;
  name: string;
  name_he: string;
  name_ar: string;
  price: number;
  duration: number;
  is_active: boolean;
};
type StaffRow = {
  id: string;
  name: string;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  can_block_own_time?: boolean | null;
  can_set_own_working_hours?: boolean | null;
};
type StaffRowWithProfile = StaffRow & { profile_id?: string | null };

export type AdminStaffDto = {
  id: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  profileId: string | null;
  /** Admin-granted: staff member may manage their own blocked time slots. */
  canBlockOwnTime: boolean;
  /** Admin-granted: staff member may manage their own working days/hours. */
  canSetOwnWorkingHours: boolean;
};

const TTL_ADMIN_CATALOG = 60;

@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
    private readonly push: PushDeliveryService,
  ) {}

  private async fetchCatalogAll(): Promise<{
    branches: {
      id: string;
      name: string;
      nameHe: string;
      nameAr: string;
      address: string | null;
      wazeLink: string | null;
      phone: string | null;
      instagramUrl: string | null;
      isActive: boolean;
    }[];
    services: { id: string; name: string; nameHe: string; nameAr: string; price: number; duration: number; isActive: boolean }[];
    staff: AdminStaffDto[];
  }> {
    const client = this.supabase.getClient();
    const [{ data: branches }, { data: services }, { data: staff }] = await Promise.all([
      client
        .from('branches')
        .select('id, name, name_he, name_ar, address, waze_link, phone, instagram_url, is_active')
        .order('name'),
      client.from('services').select('id, name, name_he, name_ar, price, duration, is_active').order('name'),
      client.from('staff').select('id, name, phone, avatar_url, is_active, profile_id, can_block_own_time, can_set_own_working_hours').order('name'),
    ]);

    return {
      branches: (branches || []).map((r: BranchRow) => ({
        id: r.id,
        name: r.name,
        nameHe: r.name_he,
        nameAr: r.name_ar,
        address: r.address ?? null,
        wazeLink: r.waze_link ?? null,
        phone: r.phone ?? null,
        instagramUrl: r.instagram_url ?? null,
        isActive: r.is_active !== false,
      })),
      services: (services || []).map((r: ServiceRow) => ({
        id: r.id,
        name: r.name,
        nameHe: r.name_he,
        nameAr: r.name_ar,
        price: r.price,
        duration: r.duration,
        isActive: r.is_active !== false,
      })),
      staff: (staff || []).map((r: StaffRowWithProfile) => ({
        id: r.id,
        name: r.name,
        phone: r.phone ?? null,
        avatarUrl: r.avatar_url ?? null,
        isActive: r.is_active !== false,
        profileId: r.profile_id ?? null,
        canBlockOwnTime: !!r.can_block_own_time,
        canSetOwnWorkingHours: !!r.can_set_own_working_hours,
      })),
    };
  }

  async getCatalogAll(): Promise<{
    branches: {
      id: string;
      name: string;
      nameHe: string;
      nameAr: string;
      address: string | null;
      wazeLink: string | null;
      phone: string | null;
      instagramUrl: string | null;
      isActive: boolean;
    }[];
    services: { id: string; name: string; nameHe: string; nameAr: string; price: number; duration: number; isActive: boolean }[];
    staff: AdminStaffDto[];
  }> {
    return this.cache.getOrSet(CACHE_KEY_ADMIN_CATALOG, TTL_ADMIN_CATALOG, () => this.fetchCatalogAll());
  }

  async createBranch(dto: { nameHe: string; nameAr: string; address?: string; wazeLink?: string; phone?: string; instagramUrl?: string }) {
    const nameHe = dto.nameHe?.trim();
    const nameAr = dto.nameAr?.trim();
    if (!nameHe) throw new BadRequestException('Hebrew name required');
    if (!nameAr) throw new BadRequestException('Arabic name required');
    const { data, error } = await this.supabase
      .getClient()
      .from('branches')
      .insert({
        // `name` is a server-maintained mirror of name_he — kept for other read paths
        // (booking-time appointment snapshot, waitlist notifications, reports) that are not
        // being changed here. Never settable directly by the client.
        name: nameHe,
        name_he: nameHe,
        name_ar: nameAr,
        address: dto.address?.trim() || null,
        waze_link: dto.wazeLink?.trim() || null,
        phone: dto.phone?.trim() || null,
        instagram_url: dto.instagramUrl?.trim() || null,
      })
      .select('id, name, name_he, name_ar, address, waze_link, phone, instagram_url, is_active')
      .single();
    if (error) throw new BadRequestException(error.message);
    const r = data as BranchRow;
    const out = {
      id: r.id,
      name: r.name,
      nameHe: r.name_he,
      nameAr: r.name_ar,
      address: r.address ?? null,
      wazeLink: r.waze_link ?? null,
      phone: r.phone ?? null,
      instagramUrl: r.instagram_url ?? null,
      isActive: r.is_active !== false,
    };
    await this.cache.invalidateCatalogAndAdmin();
    return out;
  }

  async updateBranch(
    id: string,
    dto: { nameHe?: string; nameAr?: string; address?: string; wazeLink?: string; phone?: string; instagramUrl?: string; isActive?: boolean },
  ) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.nameHe !== undefined) {
      const nameHe = dto.nameHe.trim();
      if (!nameHe) throw new BadRequestException('Hebrew name required');
      updates.name_he = nameHe;
      updates.name = nameHe; // keep the legacy mirror in sync
    }
    if (dto.nameAr !== undefined) {
      const nameAr = dto.nameAr.trim();
      if (!nameAr) throw new BadRequestException('Arabic name required');
      updates.name_ar = nameAr;
    }
    if (dto.address !== undefined) updates.address = dto.address?.trim() || null;
    if (dto.wazeLink !== undefined) updates.waze_link = dto.wazeLink?.trim() || null;
    if (dto.phone !== undefined) updates.phone = dto.phone?.trim() || null;
    if (dto.instagramUrl !== undefined) updates.instagram_url = dto.instagramUrl?.trim() || null;
    if (dto.isActive !== undefined) updates.is_active = !!dto.isActive;
    const { data, error } = await this.supabase
      .getClient()
      .from('branches')
      .update(updates)
      .eq('id', id)
      .select('id, name, name_he, name_ar, address, waze_link, phone, instagram_url, is_active')
      .single();
    if (error) throw new BadRequestException(error.message);
    const r = data as BranchRow;
    const out = {
      id: r.id,
      name: r.name,
      nameHe: r.name_he,
      nameAr: r.name_ar,
      address: r.address ?? null,
      wazeLink: r.waze_link ?? null,
      phone: r.phone ?? null,
      instagramUrl: r.instagram_url ?? null,
      isActive: r.is_active !== false,
    };
    await this.cache.invalidateCatalogAndAdmin();
    return out;
  }

  async createService(dto: { nameHe: string; nameAr: string; price: number; duration: number }) {
    const nameHe = dto.nameHe?.trim();
    const nameAr = dto.nameAr?.trim();
    if (!nameHe) throw new BadRequestException('Hebrew name required');
    if (!nameAr) throw new BadRequestException('Arabic name required');
    const price = Math.max(0, Math.floor(Number(dto.price) || 0));
    const duration = Math.max(5, Math.min(180, Math.floor(Number(dto.duration) || 40)));
    const { data, error } = await this.supabase
      .getClient()
      .from('services')
      .insert({ name: nameHe, name_he: nameHe, name_ar: nameAr, price, duration })
      .select('id, name, name_he, name_ar, price, duration, is_active')
      .single();
    if (error) throw new BadRequestException(error.message);
    const r = data as ServiceRow;
    const out = {
      id: r.id,
      name: r.name,
      nameHe: r.name_he,
      nameAr: r.name_ar,
      price: r.price,
      duration: r.duration,
      isActive: r.is_active !== false,
    };
    await this.cache.invalidateCatalogAndAdmin();
    await this.cache.invalidateAllBookingsSlots();
    return out;
  }

  async updateService(id: string, dto: { nameHe?: string; nameAr?: string; price?: number; duration?: number; isActive?: boolean }) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.nameHe !== undefined) {
      const nameHe = dto.nameHe.trim();
      if (!nameHe) throw new BadRequestException('Hebrew name required');
      updates.name_he = nameHe;
      updates.name = nameHe; // keep the legacy mirror in sync
    }
    if (dto.nameAr !== undefined) {
      const nameAr = dto.nameAr.trim();
      if (!nameAr) throw new BadRequestException('Arabic name required');
      updates.name_ar = nameAr;
    }
    if (dto.price !== undefined) updates.price = Math.max(0, Math.floor(Number(dto.price)));
    if (dto.duration !== undefined) updates.duration = Math.max(5, Math.min(180, Math.floor(Number(dto.duration))));
    if (dto.isActive !== undefined) updates.is_active = !!dto.isActive;
    const { data, error } = await this.supabase
      .getClient()
      .from('services')
      .update(updates)
      .eq('id', id)
      .select('id, name, name_he, name_ar, price, duration, is_active')
      .single();
    if (error) throw new BadRequestException(error.message);
    const r = data as ServiceRow;
    const out = {
      id: r.id,
      name: r.name,
      nameHe: r.name_he,
      nameAr: r.name_ar,
      price: r.price,
      duration: r.duration,
      isActive: r.is_active !== false,
    };
    await this.cache.invalidateCatalogAndAdmin();
    await this.cache.invalidateAllBookingsSlots();
    return out;
  }

  async createStaff(dto: { name: string; phone?: string }) {
    if (!dto.name?.trim()) throw new BadRequestException('Name required');
    const trimmedName = dto.name.trim();
    const { firstName, lastName } = splitProfileName(trimmedName);
    const phone = dto.phone ? String(dto.phone).replace(/\D/g, '').slice(-9) || null : null;
    if (!phone || phone.length < 9) throw new BadRequestException('Staff phone required (9+ digits)');

    const client = this.supabase.getClient();

    const { data: existingProfile } = await client
      .from('profiles')
      .select('id, is_admin')
      .eq('phone', phone)
      .maybeSingle();
    if (existingProfile) {
      const profile = existingProfile as { id: string; is_admin?: boolean };
      if (profile.is_admin) throw new BadRequestException('PHONE_ALREADY_CUSTOMER_OR_ADMIN');

      const [allStaffRes, activeStaffRes] = await Promise.all([
        client.from('staff').select('id', { head: true, count: 'exact' }).eq('profile_id', profile.id),
        client.from('staff').select('id', { head: true, count: 'exact' }).eq('profile_id', profile.id).eq('is_active', true),
      ]);

      const hadStaffAccount = (allStaffRes.count ?? 0) > 0;
      const hasActiveStaff = (activeStaffRes.count ?? 0) > 0;
      if (hasActiveStaff || !hadStaffAccount) {
        throw new BadRequestException('PHONE_ALREADY_CUSTOMER_OR_ADMIN');
      }

      // Leftover profile from a previously deleted staff account: remove it so the new
      // staff starts completely fresh with no old notifications/tokens/view history.
      const { data: staleWaitlistRows } = await client
        .from('waitlist')
        .select('id')
        .eq('profile_id', profile.id);
      const staleWaitlistIds = (staleWaitlistRows || []).map((r: { id: string }) => r.id);
      if (staleWaitlistIds.length > 0) {
        await client.from('waitlist_slot_offers').delete().in('waitlist_id', staleWaitlistIds);
      }
      const { error: staleWaitlistErr } = await client.from('waitlist').delete().eq('profile_id', profile.id);
      if (staleWaitlistErr) throw new BadRequestException(staleWaitlistErr.message);
      const { error: staleApptErr } = await client
        .from('appointments')
        .delete()
        .eq('profile_id', profile.id);
      if (staleApptErr) throw new BadRequestException(staleApptErr.message);
      const { error: staleTokensErr } = await client.from('device_push_tokens').delete().eq('profile_id', profile.id);
      if (staleTokensErr) throw new BadRequestException(staleTokensErr.message);
      const { error: staleViewsErr } = await client.from('home_story_views').delete().eq('viewer_profile_id', profile.id);
      if (staleViewsErr) throw new BadRequestException(staleViewsErr.message);
      const { error: staleStoriesErr } = await client.from('home_stories').delete().eq('created_by_profile_id', profile.id);
      if (staleStoriesErr) throw new BadRequestException(staleStoriesErr.message);
      const { error: staleNotifErr } = await client.from('notifications').delete().eq('user_phone', phone);
      if (staleNotifErr) throw new BadRequestException(staleNotifErr.message);
      const { data: deletedStaleProfile, error: staleProfileDeleteErr } = await client
        .from('profiles')
        .delete()
        .eq('id', profile.id)
        .select('id');
      if (staleProfileDeleteErr) throw new BadRequestException(staleProfileDeleteErr.message);
      if (!deletedStaleProfile?.length) throw new BadRequestException('Failed to remove deleted staff profile');
    }

    const { data: existingStaff } = await client
      .from('staff')
      .select('id')
      .eq('phone', phone)
      .eq('is_active', true)
      .maybeSingle();
    if (existingStaff) throw new BadRequestException('PHONE_ALREADY_STAFF');

    const { data: profile, error: profileErr } = await client
      .from('profiles')
      .insert({
        phone,
        first_name: firstName,
        last_name: lastName,
        birth_date: null,
        is_admin: false,
      })
      .select('id')
      .single();
    if (profileErr) throw new BadRequestException(profileErr.message || 'Failed to create staff account');
    const profileId = profile.id;

    const { data, error } = await client
      .from('staff')
      .insert({ name: trimmedName, phone, profile_id: profileId })
      .select('id, name, phone, avatar_url, is_active, profile_id')
      .single();
    if (error) {
      if (profileId) {
        const { error: rollbackProfileErr } = await client.from('profiles').delete().eq('id', profileId);
        if (rollbackProfileErr) throw new BadRequestException(rollbackProfileErr.message);
      }
      throw new BadRequestException(error.message || 'Failed to create staff');
    }
    const r = data as StaffRow;
    const created = {
      id: r.id,
      name: r.name,
      phone: r.phone ?? null,
      avatarUrl: r.avatar_url ?? null,
      isActive: r.is_active !== false,
      profileId: (data as StaffRowWithProfile).profile_id ?? null,
      canBlockOwnTime: false,
      canSetOwnWorkingHours: false,
    };
    await this.cache.invalidateCatalogAndAdmin();
    await this.cache.invalidateBookingsSlotsForStaff(created.id);
    return created;
  }

  /**
   * Links the logged-in admin's profile to a staff row (same account, no second user).
   * Creates a new staff row or attaches profile_id to an existing unlinked row with the same phone.
   */
  async linkMyStaffProfile(user: UserPayload): Promise<AdminStaffDto & { alreadyLinked: boolean }> {
    if (!user.isAdmin) throw new ForbiddenException('Admin only');

    const client = this.supabase.getClient();

    const { data: existingByProfile } = await client
      .from('staff')
      .select('id, name, phone, avatar_url, is_active, profile_id, can_block_own_time, can_set_own_working_hours')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (existingByProfile) {
      const r = existingByProfile as StaffRowWithProfile;
      if (r.is_active !== true) {
        const { data: reactivated, error: reErr } = await client
          .from('staff')
          .update({
            is_active: true,
            accepts_bookings: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', r.id)
          .select('id, name, phone, avatar_url, is_active, profile_id, can_block_own_time, can_set_own_working_hours')
          .single();
        if (reErr) throw new BadRequestException(reErr.message);
        const rr = reactivated as StaffRowWithProfile;
        const out = {
          id: rr.id,
          name: rr.name,
          phone: rr.phone ?? null,
          avatarUrl: rr.avatar_url ?? null,
          isActive: true,
          profileId: rr.profile_id ?? user.id,
          canBlockOwnTime: !!rr.can_block_own_time,
          canSetOwnWorkingHours: !!rr.can_set_own_working_hours,
          alreadyLinked: true,
        };
        await this.cache.invalidateCatalogAndAdmin();
        await this.cache.invalidateBookingsSlotsForStaff(out.id);
        return out;
      }
      return {
        id: r.id,
        name: r.name,
        phone: r.phone ?? null,
        avatarUrl: r.avatar_url ?? null,
        isActive: true,
        profileId: r.profile_id ?? user.id,
        canBlockOwnTime: !!r.can_block_own_time,
        canSetOwnWorkingHours: !!r.can_set_own_working_hours,
        alreadyLinked: true,
      };
    }

    const phone = String(user.phone || '')
      .replace(/\D/g, '')
      .slice(-9);
    if (!phone || phone.length < 9) {
      throw new BadRequestException('PROFILE_PHONE_REQUIRED_FOR_STAFF');
    }

    const displayName =
      `${(user.firstName || '').trim()} ${(user.lastName || '').trim()}`.trim() || 'Staff';

    const { data: orphan } = await client.from('staff').select('id, profile_id').eq('phone', phone).maybeSingle();
    if (orphan) {
      const o = orphan as { id: string; profile_id: string | null };
      if (o.profile_id && o.profile_id !== user.id) {
        throw new BadRequestException('STAFF_PHONE_ALREADY_LINKED');
      }
      if (!o.profile_id) {
        const { data: updated, error } = await client
          .from('staff')
          .update({
            profile_id: user.id,
            name: displayName,
            is_active: true,
            accepts_bookings: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', o.id)
          .select('id, name, phone, avatar_url, is_active, profile_id, can_block_own_time, can_set_own_working_hours')
          .single();
        if (error) throw new BadRequestException(error.message);
        const r = updated as StaffRowWithProfile;
        const out = {
          id: r.id,
          name: r.name,
          phone: r.phone ?? null,
          avatarUrl: r.avatar_url ?? null,
          isActive: r.is_active !== false,
          profileId: r.profile_id ?? user.id,
          canBlockOwnTime: !!r.can_block_own_time,
          canSetOwnWorkingHours: !!r.can_set_own_working_hours,
          alreadyLinked: false,
        };
        await this.cache.invalidateCatalogAndAdmin();
        await this.cache.invalidateBookingsSlotsForStaff(out.id);
        return out;
      }
    }

    const insertPayload: Record<string, unknown> = {
      name: displayName,
      phone,
      profile_id: user.id,
      is_active: true,
      accepts_bookings: true,
    };

    const { data: inserted, error: insErr } = await client
      .from('staff')
      .insert(insertPayload)
      .select('id, name, phone, avatar_url, is_active, profile_id, can_block_own_time, can_set_own_working_hours')
      .single();
    if (insErr) throw new BadRequestException(insErr.message || 'Failed to create staff profile');
    const r = inserted as StaffRowWithProfile;
    const out = {
      id: r.id,
      name: r.name,
      phone: r.phone ?? null,
      avatarUrl: r.avatar_url ?? null,
      isActive: r.is_active !== false,
      profileId: r.profile_id ?? user.id,
      canBlockOwnTime: !!r.can_block_own_time,
      canSetOwnWorkingHours: !!r.can_set_own_working_hours,
      alreadyLinked: false,
    };
    await this.cache.invalidateCatalogAndAdmin();
    await this.cache.invalidateBookingsSlotsForStaff(out.id);
    return out;
  }

  /**
   * Admin keeps admin role but removes own staff linkage (staff.profile_id = null).
   * This drops staff access and also deactivates the staff row (soft-delete / hidden).
   */
  async unlinkMyStaffProfile(user: UserPayload): Promise<{ ok: true; unlinked: number }> {
    if (!user.isAdmin) throw new ForbiddenException('Admin only');
    const client = this.supabase.getClient();

    const { data: linked, error: findErr } = await client.from('staff').select('id').eq('profile_id', user.id);
    if (findErr) throw new BadRequestException(findErr.message);
    if (!linked || linked.length === 0) throw new BadRequestException('STAFF_PROFILE_NOT_LINKED');
    const linkedIds = (linked as { id: string }[]).map((r) => r.id).filter(Boolean);

    const { data: updated, error } = await client
      .from('staff')
      .update({
        profile_id: null,
        is_active: false,
        accepts_bookings: false,
        updated_at: new Date().toISOString(),
      })
      .eq('profile_id', user.id)
      .select('id');
    if (error) throw new BadRequestException(error.message);
    await this.cache.invalidateCatalogAndAdmin();
    for (const sid of linkedIds) {
      await this.cache.invalidateBookingsSlotsForStaff(sid);
    }
    return { ok: true, unlinked: Array.isArray(updated) ? updated.length : 1 };
  }

  async updateStaff(
    id: string,
    dto: {
      name?: string;
      phone?: string;
      isActive?: boolean;
      profileId?: string | null;
      avatarUrl?: string | null;
      canBlockOwnTime?: boolean;
      canSetOwnWorkingHours?: boolean;
    },
  ) {
    const client = this.supabase.getClient();
    const trimmedName = dto.name !== undefined ? dto.name.trim() : undefined;

    if (dto.phone !== undefined) {
      const newPhone = dto.phone ? String(dto.phone).replace(/\D/g, '').slice(-9) || null : null;
      if (newPhone && newPhone.length >= 9) {
        const { data: existingProfile } = await client.from('profiles').select('id').eq('phone', newPhone).maybeSingle();
        if (existingProfile) {
          const { data: thisStaff } = await client.from('staff').select('profile_id').eq('id', id).single();
          if (!thisStaff?.profile_id || (thisStaff as { profile_id: string }).profile_id !== existingProfile.id) {
            throw new BadRequestException('PHONE_ALREADY_CUSTOMER_OR_ADMIN');
          }
        }
        const { data: existingStaff } = await client
          .from('staff')
          .select('id')
          .eq('phone', newPhone)
          .eq('is_active', true)
          .neq('id', id)
          .maybeSingle();
        if (existingStaff) throw new BadRequestException('PHONE_ALREADY_STAFF');
      }
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (trimmedName !== undefined) updates.name = trimmedName;
    const newPhone = dto.phone !== undefined ? (dto.phone ? String(dto.phone).replace(/\D/g, '').slice(-9) || null : null) : undefined;
    if (newPhone !== undefined) updates.phone = newPhone;
    if (dto.isActive !== undefined) updates.is_active = !!dto.isActive;
    if (dto.profileId !== undefined) updates.profile_id = dto.profileId || null;
    if (dto.avatarUrl !== undefined) updates.avatar_url = dto.avatarUrl?.trim() || null;
    if (dto.canBlockOwnTime !== undefined) updates.can_block_own_time = !!dto.canBlockOwnTime;
    if (dto.canSetOwnWorkingHours !== undefined) updates.can_set_own_working_hours = !!dto.canSetOwnWorkingHours;

    let previousAvatarUrl: string | null = null;
    if (dto.avatarUrl !== undefined) {
      const { data: cur } = await client.from('staff').select('avatar_url').eq('id', id).maybeSingle();
      previousAvatarUrl = (cur as { avatar_url?: string | null } | null)?.avatar_url ?? null;
    }

    const { data, error } = await client
      .from('staff')
      .update(updates)
      .eq('id', id)
      .select('id, name, phone, avatar_url, is_active, profile_id, can_block_own_time, can_set_own_working_hours')
      .single();
    if (error) throw new BadRequestException(error.message);
    const r = data as StaffRow & { profile_id?: string };

    if (previousAvatarUrl && previousAvatarUrl !== updates.avatar_url) {
      const marker = `/object/public/${STAFF_AVATAR_BUCKET}/`;
      const idx = previousAvatarUrl.indexOf(marker);
      if (idx !== -1) {
        const storagePath = previousAvatarUrl.slice(idx + marker.length);
        await client.storage.from(STAFF_AVATAR_BUCKET).remove([storagePath]).catch(() => {});
      }
    }
    if (r.profile_id && (newPhone !== undefined || trimmedName !== undefined)) {
      const profileUpdates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (newPhone !== undefined) profileUpdates.phone = newPhone;
      if (trimmedName !== undefined) {
        const { firstName, lastName } = splitProfileName(trimmedName);
        profileUpdates.first_name = firstName;
        profileUpdates.last_name = lastName;
      }
      await client.from('profiles').update(profileUpdates).eq('id', r.profile_id);
    }
    const out = {
      id: r.id,
      name: r.name,
      phone: r.phone ?? null,
      avatarUrl: r.avatar_url ?? null,
      isActive: r.is_active !== false,
      profileId: r.profile_id ?? null,
      canBlockOwnTime: !!r.can_block_own_time,
      canSetOwnWorkingHours: !!r.can_set_own_working_hours,
    };
    if ((dto.canBlockOwnTime !== undefined || dto.canSetOwnWorkingHours !== undefined) && r.phone) {
      // Silent data-only push (no alert, no notifications-list entry) — the client refetches
      // /auth/me the instant it arrives while the app is open, so the permission takes effect
      // immediately instead of waiting for the staff member's next natural session refresh.
      this.push
        .sendSilentDataForUserPhone(r.phone, { type: 'permission_updated' })
        .catch(() => {});
    }
    await this.cache.invalidateCatalogAndAdmin();
    await this.cache.invalidateBookingsSlotsForStaff(id);
    return out;
  }

  async deleteStaff(id: string) {
    const client = this.supabase.getClient();
    const { data: existing, error: existingErr } = await client
      .from('staff')
      .select('id, profile_id, phone, avatar_url')
      .eq('id', id)
      .maybeSingle();
    if (existingErr) throw new BadRequestException(existingErr.message);
    if (!existing) throw new NotFoundException('Staff not found');

    const profileId = (existing as { profile_id?: string | null }).profile_id ?? null;
    const phone = (existing as { phone?: string | null }).phone ?? null;
    let shouldDeleteProfile = false;
    if (profileId) {
      const { data: profile, error: profileErr } = await client
        .from('profiles')
        .select('id, is_admin')
        .eq('id', profileId)
        .maybeSingle();
      if (profileErr) throw new BadRequestException(profileErr.message);
      shouldDeleteProfile = !!profile && (profile as { is_admin?: boolean }).is_admin !== true;
    }

    const cleanupDeletes: Array<{ table: string; column: string }> = [
      { table: 'branch_staff', column: 'staff_id' },
      { table: 'staff_service', column: 'staff_id' },
      { table: 'staff_working_days', column: 'staff_id' },
      { table: 'blocked_slots', column: 'staff_id' },
      { table: 'waitlist_slot_offers', column: 'staff_id' },
      { table: 'waitlist', column: 'staff_id' },
      { table: 'home_stories', column: 'staff_id' },
      { table: 'products', column: 'staff_id' },
    ];

    for (const { table, column } of cleanupDeletes) {
      const { error } = await client.from(table).delete().eq(column, id);
      if (error) throw new BadRequestException(error.message);
    }

    const { error: apptErr } = await client
      .from('appointments')
      .delete()
      .eq('staff_id', id);
    if (apptErr) throw new BadRequestException(apptErr.message);

    const { data: deletedStaff, error: delStaffErr } = await client
      .from('staff')
      .delete()
      .eq('id', id)
      .select('id');
    if (delStaffErr) throw new BadRequestException(delStaffErr.message);
    if (!deletedStaff?.length) throw new NotFoundException('Staff not found');

    // Delete avatar from Storage (non-fatal)
    const avatarUrl = (existing as { avatar_url?: string | null }).avatar_url;
    if (avatarUrl) {
      const marker = `/object/public/${STAFF_AVATAR_BUCKET}/`;
      const idx = avatarUrl.indexOf(marker);
      if (idx !== -1) {
        const storagePath = avatarUrl.slice(idx + marker.length);
        await client.storage.from(STAFF_AVATAR_BUCKET).remove([storagePath]).catch(() => {});
      }
    }

    if (profileId && shouldDeleteProfile) {
      const nowIso = new Date().toISOString();
      const { data: profileWaitlistRows } = await client
        .from('waitlist')
        .select('id')
        .eq('profile_id', profileId);
      const profileWaitlistIds = (profileWaitlistRows || []).map((r: { id: string }) => r.id);
      if (profileWaitlistIds.length > 0) {
        const { error: profileOfferDeleteErr } = await client.from('waitlist_slot_offers').delete().in('waitlist_id', profileWaitlistIds);
        if (profileOfferDeleteErr) throw new BadRequestException(profileOfferDeleteErr.message);
      }
      const { error: profileWaitlistDeleteErr } = await client.from('waitlist').delete().eq('profile_id', profileId);
      if (profileWaitlistDeleteErr) throw new BadRequestException(profileWaitlistDeleteErr.message);
      const { error: profileApptClearErr } = await client
        .from('appointments')
        .delete()
        .eq('profile_id', profileId);
      if (profileApptClearErr) throw new BadRequestException(profileApptClearErr.message);
      const { error: profileTokensDeleteErr } = await client.from('device_push_tokens').delete().eq('profile_id', profileId);
      if (profileTokensDeleteErr) throw new BadRequestException(profileTokensDeleteErr.message);
      const { error: profileViewsDeleteErr } = await client.from('home_story_views').delete().eq('viewer_profile_id', profileId);
      if (profileViewsDeleteErr) throw new BadRequestException(profileViewsDeleteErr.message);
      const { error: profileStoriesDeleteErr } = await client.from('home_stories').delete().eq('created_by_profile_id', profileId);
      if (profileStoriesDeleteErr) throw new BadRequestException(profileStoriesDeleteErr.message);
      if (phone) {
        const { error: profileNotifDeleteErr } = await client.from('notifications').delete().eq('user_phone', phone);
        if (profileNotifDeleteErr) throw new BadRequestException(profileNotifDeleteErr.message);
      }
      const { error: releaseProfileErr } = await client
        .from('profiles')
        .update({
          phone: releasedProfilePhoneValue(),
          api_token: null,
          updated_at: nowIso,
        })
        .eq('id', profileId);
      if (releaseProfileErr) throw new BadRequestException(releaseProfileErr.message);
      const { data: deletedProfileRows, error: deleteProfileErr } = await client
        .from('profiles')
        .delete()
        .eq('id', profileId)
        .select('id');
      if (deleteProfileErr) throw new BadRequestException(deleteProfileErr.message);
      if (!deletedProfileRows?.length) {
        throw new BadRequestException('Failed to delete linked staff profile');
      }
    }

    await this.cache.invalidateCatalogAndAdmin();
    await this.cache.invalidateBookingsSlotsForStaff(id);
    await this.cache.invalidateAdminSummary();
    return { ok: true };
  }

  async uploadStaffAvatar(staffId: string, file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('File required');
    if (file.size > MAX_AVATAR_BYTES) throw new BadRequestException('Image too large (max 5MB)');
    const mime = file.mimetype || 'image/jpeg';
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) {
      throw new BadRequestException('Invalid image type');
    }
    const client = this.supabase.getClient();
    const { data: existing, error: findErr } = await client.from('staff').select('id, avatar_url').eq('id', staffId).maybeSingle();
    if (findErr) throw new BadRequestException(findErr.message);
    if (!existing) throw new NotFoundException('Staff not found');
    const previousAvatarUrl = (existing as { avatar_url?: string | null }).avatar_url ?? null;

    const ext = extFromMime(mime);
    const path = `staff/${staffId}/${randomUUID()}.${ext}`;
    const { error: upErr } = await client.storage.from(STAFF_AVATAR_BUCKET).upload(path, file.buffer, {
      contentType: mime,
      upsert: false,
      cacheControl: '31536000',
    });
    if (upErr) throw new BadRequestException(upErr.message);
    const { data: pub } = client.storage.from(STAFF_AVATAR_BUCKET).getPublicUrl(path);
    if (!pub?.publicUrl) throw new BadRequestException('Failed to resolve image URL');

    const { data, error } = await client
      .from('staff')
      .update({ avatar_url: pub.publicUrl, updated_at: new Date().toISOString() })
      .eq('id', staffId)
      .select('id, name, phone, avatar_url, is_active, profile_id')
      .single();
    if (error) throw new BadRequestException(error.message);
    const r = data as StaffRow;

    if (previousAvatarUrl) {
      const marker = `/object/public/${STAFF_AVATAR_BUCKET}/`;
      const idx = previousAvatarUrl.indexOf(marker);
      if (idx !== -1) {
        const storagePath = previousAvatarUrl.slice(idx + marker.length);
        await client.storage.from(STAFF_AVATAR_BUCKET).remove([storagePath]).catch(() => {});
      }
    }

    const out = {
      id: r.id,
      name: r.name,
      phone: r.phone ?? null,
      avatarUrl: r.avatar_url ?? null,
      isActive: r.is_active !== false,
      profileId: (data as StaffRowWithProfile).profile_id ?? null,
    };
    await this.cache.invalidateCatalogAndAdmin();
    await this.cache.invalidateBookingsSlotsForStaff(staffId);
    return out;
  }

  async deleteService(id: string) {
    const { error } = await this.supabase.getClient().from('services').update({ is_active: false }).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await this.cache.invalidateCatalogAndAdmin();
    await this.cache.invalidateAllBookingsSlots();
    return { ok: true };
  }

  async deleteBranch(id: string) {
    const { error } = await this.supabase.getClient().from('branches').update({ is_active: false }).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await this.cache.invalidateCatalogAndAdmin();
    return { ok: true };
  }
}

@Controller('admin')
export class AdminCatalogController {
  constructor(private readonly service: AdminCatalogService) {}

  @Get('catalog')
  @UseGuards(...GUARDS)
  getCatalog() {
    return this.service.getCatalogAll();
  }

  @Post('branches')
  @UseGuards(...GUARDS)
  createBranch(@Body() dto: { nameHe: string; nameAr: string; address?: string; wazeLink?: string; phone?: string; instagramUrl?: string }) {
    return this.service.createBranch(dto);
  }

  @Patch('branches/:id')
  @UseGuards(...GUARDS)
  updateBranch(
    @Param('id') id: string,
    @Body()
    dto: {
      nameHe?: string;
      nameAr?: string;
      address?: string;
      wazeLink?: string;
      phone?: string;
      instagramUrl?: string;
      isActive?: boolean;
    },
  ) {
    return this.service.updateBranch(id, dto);
  }

  @Post('services')
  @UseGuards(...GUARDS)
  createService(@Body() dto: { nameHe: string; nameAr: string; price: number; duration: number }) {
    return this.service.createService(dto);
  }

  @Patch('services/:id')
  @UseGuards(...GUARDS)
  updateService(
    @Param('id') id: string,
    @Body() dto: { nameHe?: string; nameAr?: string; price?: number; duration?: number; isActive?: boolean },
  ) {
    return this.service.updateService(id, dto);
  }

  @Post('staff')
  @UseGuards(...GUARDS)
  createStaff(@Body() dto: { name: string; phone?: string }) {
    return this.service.createStaff(dto);
  }

  @Post('staff/link-my-profile')
  @UseGuards(...GUARDS)
  linkMyStaffProfile(@RequestUser() user: UserPayload) {
    return this.service.linkMyStaffProfile(user);
  }

  @Delete('staff/unlink-my-profile')
  @UseGuards(...GUARDS)
  unlinkMyStaffProfile(@RequestUser() user: UserPayload) {
    return this.service.unlinkMyStaffProfile(user);
  }

  @Patch('staff/:id')
  @UseGuards(...GUARDS)
  updateStaff(
    @Param('id') id: string,
    @Body()
    dto: {
      name?: string;
      phone?: string;
      isActive?: boolean;
      profileId?: string | null;
      avatarUrl?: string | null;
      canBlockOwnTime?: boolean;
      canSetOwnWorkingHours?: boolean;
    },
  ) {
    return this.service.updateStaff(id, dto);
  }

  @Post('staff/:id/avatar')
  @UseGuards(ThrottlerGuard, ...GUARDS)
  @Throttle({ writes: { limit: 36, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AVATAR_BYTES },
    }),
  )
  uploadStaffAvatar(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.service.uploadStaffAvatar(id, file);
  }

  @Delete('staff/:id')
  @UseGuards(...GUARDS)
  deleteStaff(@Param('id') id: string) {
    return this.service.deleteStaff(id);
  }

  @Delete('services/:id')
  @UseGuards(...GUARDS)
  deleteService(@Param('id') id: string) {
    return this.service.deleteService(id);
  }

  @Delete('branches/:id')
  @UseGuards(...GUARDS)
  deleteBranch(@Param('id') id: string) {
    return this.service.deleteBranch(id);
  }
}

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [AdminCatalogController],
  providers: [AdminCatalogService],
})
export class AdminCatalogModule {}
