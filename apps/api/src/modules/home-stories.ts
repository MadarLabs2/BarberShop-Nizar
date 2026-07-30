import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SupabaseService } from '../core/supabase';
import { TokenAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { StaffGuard } from '../auth/staff.guard';
import { RequestUser } from '../auth/auth.decorator';
import { AuthService, type UserPayload } from '../auth/auth.service';
import { AuthModule } from '../auth';

const BUCKET = 'home-stories';
const MAX_BYTES = 5 * 1024 * 1024;
const STORY_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ADMIN_GUARDS = [TokenAuthGuard, AdminGuard] as const;
const STAFF_GUARDS = [TokenAuthGuard, StaffGuard] as const;

export type HomeStoryItemDto = {
  id: string;
  imageUrl: string;
  createdAt: string;
  viewsCount: number;
};

export type HomeStoryAuthorDto = {
  authorKey: string;
  kind: 'salon' | 'staff';
  displayName: string;
  avatarUrl: string | null;
  stories: HomeStoryItemDto[];
};

function extFromMime(mimetype: string): string {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/webp') return 'webp';
  if (mimetype === 'image/gif') return 'gif';
  return 'jpg';
}

function normalizeStoryMime(mimetype: string | undefined): string {
  const base = (mimetype || '').split(';')[0].trim().toLowerCase();
  return base;
}

type StoryRow = {
  id: string;
  image_url: string;
  staff_id: string | null;
  created_at: string;
  views_count?: number | null;
  staff?: { name: string; avatar_url: string | null } | { name: string; avatar_url: string | null }[] | null;
};

function extractStoragePath(url: string, bucket: string): string | null {
  try {
    const marker = `/object/public/${bucket}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return url.slice(idx + marker.length);
  } catch {
    return null;
  }
}

@Injectable()
export class HomeStoriesService {
  constructor(private readonly supabase: SupabaseService) {}

  async listGroupedForHome(): Promise<{ authors: HomeStoryAuthorDto[] }> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('home_stories')
      .select('id, image_url, staff_id, created_at, views_count, staff(name, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error || !data?.length) return { authors: [] };

    const salonItems: HomeStoryItemDto[] = [];
    const byStaff = new Map<string, { name: string; avatarUrl: string | null; items: HomeStoryItemDto[] }>();

    for (const raw of data as StoryRow[]) {
      const item: HomeStoryItemDto = {
        id: raw.id,
        imageUrl: raw.image_url,
        createdAt: raw.created_at,
        viewsCount: Math.max(0, Number(raw.views_count || 0)),
      };
      const sid = raw.staff_id;
      if (!sid) {
        salonItems.push(item);
        continue;
      }
      const st = raw.staff;
      const name = Array.isArray(st) ? st[0]?.name : st?.name;
      const av = Array.isArray(st) ? st[0]?.avatar_url : st?.avatar_url;
      if (!byStaff.has(sid)) {
        byStaff.set(sid, { name: name || '', avatarUrl: av ?? null, items: [] });
      }
      byStaff.get(sid)!.items.push(item);
    }

    const authors: HomeStoryAuthorDto[] = [];
    if (salonItems.length) {
      authors.push({
        authorKey: 'salon',
        kind: 'salon',
        displayName: '',
        avatarUrl: null,
        stories: salonItems,
      });
    }
    const staffEntries = [...byStaff.entries()].sort((a, b) =>
      (a[1].name || '').localeCompare(b[1].name || '', 'he'),
    );
    for (const [staffId, { name, avatarUrl, items }] of staffEntries) {
      authors.push({
        authorKey: staffId,
        kind: 'staff',
        displayName: name,
        avatarUrl,
        stories: items,
      });
    }
    return { authors };
  }

  private async uploadBuffer(file: Express.Multer.File): Promise<string> {
    if (!file?.buffer?.length) throw new BadRequestException('Missing file');
    if (file.size > MAX_BYTES) throw new BadRequestException('Image too large (max 5MB)');
    const mime = normalizeStoryMime(file.mimetype);
    if (!STORY_IMAGE_MIMES.has(mime)) {
      throw new BadRequestException('Invalid image type');
    }
    const ext = extFromMime(mime);
    const path = `${randomUUID()}.${ext}`;
    const client = this.supabase.getClient();
    const { error } = await client.storage.from(BUCKET).upload(path, file.buffer, {
      contentType: mime,
      upsert: false,
      cacheControl: '31536000',
    });
    if (error) throw new BadRequestException(error.message);
    const { data: pub } = client.storage.from(BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  }

  async createSalonStory(user: UserPayload, file: Express.Multer.File): Promise<HomeStoryItemDto> {
    if (!user.isAdmin) throw new ForbiddenException('Admin only');
    const imageUrl = await this.uploadBuffer(file);
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('home_stories')
      .insert({
        image_url: imageUrl,
        staff_id: null,
        created_by_profile_id: user.id,
      })
      .select('id, image_url, created_at, views_count')
      .single();
    if (error || !data) throw new BadRequestException(error?.message || 'Insert failed');
    return {
      id: (data as { id: string }).id,
      imageUrl: (data as { image_url: string }).image_url,
      createdAt: (data as { created_at: string }).created_at,
      viewsCount: Math.max(0, Number((data as { views_count?: number | null }).views_count || 0)),
    };
  }

  async createStaffStory(user: UserPayload, file: Express.Multer.File): Promise<HomeStoryItemDto> {
    const staffId = user.staffId;
    if (!staffId) throw new ForbiddenException('Staff only');
    const imageUrl = await this.uploadBuffer(file);
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('home_stories')
      .insert({
        image_url: imageUrl,
        staff_id: staffId,
        created_by_profile_id: user.id,
      })
      .select('id, image_url, created_at, views_count')
      .single();
    if (error || !data) throw new BadRequestException(error?.message || 'Insert failed');
    return {
      id: (data as { id: string }).id,
      imageUrl: (data as { image_url: string }).image_url,
      createdAt: (data as { created_at: string }).created_at,
      viewsCount: Math.max(0, Number((data as { views_count?: number | null }).views_count || 0)),
    };
  }

  async listAdmin(): Promise<
    (HomeStoryItemDto & { staffId: string | null; authorLabel: string })[]
  > {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('home_stories')
      .select('id, image_url, created_at, views_count, staff_id, staff(name)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error || !data) return [];
    return (data as StoryRow[]).map((r) => {
      const st = r.staff;
      const staffName = Array.isArray(st) ? st[0]?.name : st?.name;
      return {
        id: r.id,
        imageUrl: r.image_url,
        createdAt: r.created_at,
        viewsCount: Math.max(0, Number(r.views_count || 0)),
        staffId: r.staff_id,
        authorLabel: r.staff_id ? (staffName || 'Staff') : 'Salon',
      };
    });
  }

  async listMineStaff(staffId: string): Promise<HomeStoryItemDto[]> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('home_stories')
      .select('id, image_url, created_at, views_count')
      .eq('staff_id', staffId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error || !data) return [];
    return (data as { id: string; image_url: string; created_at: string }[]).map((r) => ({
      id: r.id,
      imageUrl: r.image_url,
      createdAt: r.created_at,
      viewsCount: Math.max(0, Number((r as { views_count?: number | null }).views_count || 0)),
    }));
  }

  async registerStoryView(storyId: string, viewerProfileId: string | null, viewerKey: string | null): Promise<{ ok: boolean; viewsCount: number }> {
    const client = this.supabase.getClient();
    const trimmedKey = (viewerKey || '').trim().slice(0, 80) || null;

    const insertPayload = {
      story_id: storyId,
      viewer_profile_id: viewerProfileId,
      viewer_key: viewerProfileId ? null : trimmedKey,
    };

    let inserted = false;
    if (viewerProfileId) {
      const { data, error } = await client
        .from('home_story_views')
        .upsert(insertPayload, { onConflict: 'story_id,viewer_profile_id', ignoreDuplicates: true })
        .select('id')
        .limit(1);
      if (error) throw new BadRequestException(error.message);
      inserted = !!data?.length;
    } else if (trimmedKey) {
      const { data, error } = await client
        .from('home_story_views')
        .upsert(insertPayload, { onConflict: 'story_id,viewer_key', ignoreDuplicates: true })
        .select('id')
        .limit(1);
      if (error) throw new BadRequestException(error.message);
      inserted = !!data?.length;
    } else {
      const { error } = await client
        .from('home_story_views')
        .insert(insertPayload);
      if (error) throw new BadRequestException(error.message);
      inserted = true;
    }

    if (inserted) {
      const { error: sqlErr } = await client.rpc('increment_home_story_views_count', { p_story_id: storyId });
      if (sqlErr) throw new BadRequestException(sqlErr.message);
    }

    const { data: row, error: rowErr } = await client
      .from('home_stories')
      .select('views_count')
      .eq('id', storyId)
      .maybeSingle();
    if (rowErr || !row) throw new NotFoundException();
    return {
      ok: true,
      viewsCount: Math.max(0, Number((row as { views_count?: number | null }).views_count || 0)),
    };
  }

  async deleteAsAdmin(id: string): Promise<{ ok: boolean }> {
    const client = this.supabase.getClient();
    const { error } = await client.from('home_stories').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async deleteAsStaff(staffId: string, id: string): Promise<{ ok: boolean }> {
    const client = this.supabase.getClient();
    const { data: row } = await client.from('home_stories').select('staff_id, image_url').eq('id', id).maybeSingle();
    if (!row) throw new NotFoundException();
    if ((row as { staff_id: string | null }).staff_id !== staffId) throw new ForbiddenException();
    const { error } = await client.from('home_stories').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    const imageUrl = (row as { image_url?: string }).image_url;
    if (imageUrl) {
      const storagePath = extractStoragePath(imageUrl, BUCKET);
      if (storagePath) await client.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    }
    return { ok: true };
  }
}

@Controller('catalog')
export class HomeStoriesCatalogController {
  constructor(
    private readonly stories: HomeStoriesService,
    private readonly auth: AuthService,
  ) {}

  @Get('home-stories')
  listPublic() {
    return this.stories.listGroupedForHome();
  }

  @Post('home-stories/:id/view')
  async markViewed(
    @Param('id') id: string,
    @Headers('authorization') authHeader?: string,
    @Headers('x-story-viewer-key') viewerKey?: string,
  ) {
    const token = authHeader?.replace(/^Bearer\s+/i, '')?.trim();
    const user = token ? await this.auth.me(token) : null;
    return this.stories.registerStoryView(id, user?.id ?? null, viewerKey ?? null);
  }
}

@Controller('admin')
export class AdminHomeStoriesWriteController {
  constructor(private readonly stories: HomeStoriesService) {}

  @Post('home-stories')
  @UseGuards(ThrottlerGuard, ...ADMIN_GUARDS)
  @Throttle({ writes: { limit: 36, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES },
    }),
  )
  createSalon(@RequestUser() user: UserPayload, @UploadedFile() file: Express.Multer.File) {
    return this.stories.createSalonStory(user, file);
  }

  @Get('home-stories')
  @UseGuards(...ADMIN_GUARDS)
  listAdmin() {
    return this.stories.listAdmin();
  }

  @Delete('home-stories/:id')
  @UseGuards(...ADMIN_GUARDS)
  remove(@Param('id') id: string) {
    return this.stories.deleteAsAdmin(id);
  }
}

@Controller('admin')
export class StaffHomeStoriesWriteController {
  constructor(private readonly stories: HomeStoriesService) {}

  @Post('my-home-stories')
  @UseGuards(ThrottlerGuard, ...STAFF_GUARDS)
  @Throttle({ writes: { limit: 36, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES },
    }),
  )
  createMine(@RequestUser() user: UserPayload, @UploadedFile() file: Express.Multer.File) {
    return this.stories.createStaffStory(user, file);
  }

  @Get('my-home-stories')
  @UseGuards(...STAFF_GUARDS)
  listMine(@RequestUser() user: UserPayload) {
    return this.stories.listMineStaff(user.staffId!);
  }

  @Delete('my-home-stories/:id')
  @UseGuards(...STAFF_GUARDS)
  removeMine(@RequestUser() user: UserPayload, @Param('id') id: string) {
    return this.stories.deleteAsStaff(user.staffId!, id);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [HomeStoriesCatalogController, AdminHomeStoriesWriteController, StaffHomeStoriesWriteController],
  providers: [HomeStoriesService],
  exports: [HomeStoriesService],
})
export class HomeStoriesModule {}
