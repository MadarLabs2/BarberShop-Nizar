import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  Module,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SupabaseService } from './core/supabase';
import { israelTodayYmd } from './core/israel-time';
import { TokenAuthGuard } from './auth/auth.guard';
import { RequestUser } from './auth/auth.decorator';
import type { UserPayload } from './auth';
import { AuthModule } from './auth';
import { PushDeliveryService } from './push-delivery.service';

function normalizePhone(s: string): string {
  return String(s || '').replace(/\D/g, '').slice(-9) || '';
}

const MS_PER_DAY = 86_400_000;
/** Admin broadcasts / megaphone rows — auto-removed from DB after this age. */
const ADMIN_NOTIFICATION_TTL_MS = 7 * MS_PER_DAY;
/** Personal booking/cancel/etc. rows — auto-removed after this age. */
const PERSONAL_NOTIFICATION_TTL_MS = 14 * MS_PER_DAY;

export type CreateNotificationInput = {
  userPhone: string | null;
  type: 'personal' | 'admin';
  title: string;
  body?: string;
  /** Target drawer screen when user opens the push (default Notifications). */
  pushScreen?: 'Notifications' | 'Appointments' | 'Home' | 'Booking';
  /** Merged into Expo push `data` (stringify values for client). */
  pushData?: Record<string, string>;
};

export class RegisterPushTokenDto {
  expoPushToken!: string;
  platform!: string;
}

export class DeletePushTokenDto {
  expoPushToken?: string;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly push: PushDeliveryService,
  ) {}

  /** Deletes expired rows so they disappear for everyone (broadcasts) and stay bounded. */
  async pruneExpired(): Promise<void> {
    const client = this.supabase.getClient();
    const adminCutoff = new Date(Date.now() - ADMIN_NOTIFICATION_TTL_MS).toISOString();
    const personalCutoff = new Date(Date.now() - PERSONAL_NOTIFICATION_TTL_MS).toISOString();
    await Promise.all([
      client.from('notifications').delete().eq('type', 'admin').lt('created_at', adminCutoff),
      client.from('notifications').delete().eq('type', 'personal').lt('created_at', personalCutoff),
    ]);
  }

  async listForUser(
    userPhone: string,
    profileId: string | null,
    opts?: { limit?: number; page?: number; unreadOnly?: boolean },
  ) {
    await this.pruneExpired();
    const phone = normalizePhone(userPhone);
    const limitRaw = opts?.limit;
    const pageRaw = opts?.page;
    const limit = Math.min(100, Math.max(1, limitRaw != null && Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 30));
    const page = Math.max(1, pageRaw != null && Number.isFinite(pageRaw) ? Math.floor(pageRaw) : 1);
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const fetchTop = Math.max(60, to + 20);

    const client = this.supabase.getClient();

    // Row-keyed, not clock-keyed: which specific broadcast ids this profile has permanently
    // deleted. No dependency on device/server clock agreement, and a broadcast created after the
    // delete is never in this set, so it always shows normally.
    let dismissedIds: Set<string> = new Set();
    if (profileId) {
      const { data: dismissedRows, error: dismissedErr } = await client
        .from('notification_dismissals')
        .select('notification_id')
        .eq('profile_id', profileId);
      if (dismissedErr) {
        this.log.warn(`listForUser dismissals lookup failed: ${dismissedErr.message}`);
      } else {
        dismissedIds = new Set((dismissedRows || []).map((r) => (r as { notification_id: string }).notification_id));
      }
    }

    // Second guard alongside create()'s refusal to insert: even a stray user_phone-IS-NULL row
    // that isn't a real admin broadcast should never surface to every customer as one.
    const { data: broadcastRows, error: broadcastErr } = await client
      .from('notifications')
      .select('id, user_phone, type, title, body, created_at')
      .is('user_phone', null)
      .eq('type', 'admin')
      .order('created_at', { ascending: false })
      .range(0, fetchTop);
    if (broadcastErr) {
      this.log.warn(`listForUser broadcast query failed: ${broadcastErr.message}`);
      throw new InternalServerErrorException(broadcastErr.message);
    }
    const visibleBroadcastRows = ((broadcastRows || []) as NotificationRow[]).filter(
      (r) => !dismissedIds.has(r.id),
    );

    let personalRows: NotificationRow[] = [];
    if (phone) {
      const { data: personalData, error: personalErr } = await client
        .from('notifications')
        .select('id, user_phone, type, title, body, created_at')
        .eq('user_phone', phone)
        .order('created_at', { ascending: false })
        .range(0, fetchTop);
      if (personalErr) {
        this.log.warn(`listForUser personal query failed: ${personalErr.message}`);
        throw new InternalServerErrorException(personalErr.message);
      }
      personalRows = (personalData || []) as NotificationRow[];
    }

    const merged = [...personalRows, ...visibleBroadcastRows]
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const deduped: NotificationRow[] = [];
    const seen = new Set<string>();
    for (const row of merged) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      deduped.push(row);
    }
    if (opts?.unreadOnly) {
      /** No read_at column in schema; unreadOnly is accepted for forward compatibility and ignored. */
    }
    return deduped.slice(from, to + 1);
  }

  /**
   * Permanently deletes this user's notifications — not a hide/cutoff, an actual delete:
   * 1) Hard-deletes every personal row owned by their phone.
   * 2) Permanently dismisses every broadcast currently visible to them (per-row record in
   *    `notification_dismissals`, scoped to their profile only — the broadcast row itself is
   *    untouched so other users keep seeing it).
   * Both steps run inside the `notifications_delete_all_for_profile` DB function, so they commit
   * atomically. The identity used is `profileId`, resolved server-side from the auth token —
   * never a client-supplied id.
   */
  async deleteAllForUser(profileId: string): Promise<{ deletedPersonal: number; dismissedBroadcasts: number }> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .rpc('notifications_delete_all_for_profile', { p_profile_id: profileId })
      .single();
    if (error) {
      this.log.warn(`notifications_delete_all_for_profile RPC failed: ${error.message}`);
      throw new InternalServerErrorException('Failed to delete notifications');
    }
    const row = data as { deleted_personal: number; dismissed_broadcasts: number } | null;
    return {
      deletedPersonal: row?.deleted_personal ?? 0,
      dismissedBroadcasts: row?.dismissed_broadcasts ?? 0,
    };
  }

  /**
   * Persists row and sends device push when applicable. Returns false if DB insert failed.
   *
   * `user_phone IS NULL` means "broadcast to every customer" (see `listForUser`) — a `personal`
   * notification whose phone fails to resolve/normalize must never be allowed to fall through to
   * that, or a message meant for one customer (e.g. "your appointment was cancelled") would
   * silently become visible to everyone. Refuse to insert rather than risk that.
   */
  async create(input: CreateNotificationInput): Promise<boolean> {
    const phone = input.userPhone ? normalizePhone(input.userPhone) : null;
    if (input.type === 'personal' && !phone) {
      this.log.warn(`notification create refused: type=personal with no resolvable phone (title="${input.title}")`);
      return false;
    }
    const { error } = await this.supabase
      .getClient()
      .from('notifications')
      .insert({
        user_phone: phone || null,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
      });
    if (error) {
      this.log.warn(`notification insert failed: ${error.message}`);
      return false;
    }
    const pushPayload: Record<string, unknown> = {
      type: input.type,
      screen: input.pushScreen ?? 'Notifications',
    };
    if (input.pushData) {
      for (const [k, v] of Object.entries(input.pushData)) {
        pushPayload[k] = v;
      }
    }
    if (phone) {
      await this.push
        .sendForUserPhone(phone, input.title, input.body ?? '', pushPayload)
        .catch((e) => this.log.warn(`push send failed: ${e instanceof Error ? e.message : String(e)}`));
    } else if (input.type === 'admin') {
      await this.push
        .sendBroadcastToAllDevices(input.title, input.body ?? '', pushPayload)
        .catch((e) => this.log.warn(`broadcast push failed: ${e instanceof Error ? e.message : String(e)}`));
    }
    return true;
  }

  /** Server-side appointment-day reminders (cron). Requires `APPOINTMENT_REMINDER_SECRET` header. */
  async runAppointmentDayReminders(cronSecret: string | undefined): Promise<{ processed: number }> {
    const expected = process.env.APPOINTMENT_REMINDER_SECRET?.trim();
    if (!expected || cronSecret !== expected) {
      throw new UnauthorizedException('Invalid appointment reminder secret');
    }
    const dateStr = israelTodayYmd();
    const { data: rows, error } = await this.supabase
      .getClient()
      .from('appointments')
      .select('id, client_phone, profile_id, date, time, service_name, status, day_reminder_sent_at')
      .eq('date', dateStr)
      .eq('status', 'confirmed')
      .is('day_reminder_sent_at', null);

    if (error) {
      this.log.warn(`day reminders query failed: ${error.message}`);
      return { processed: 0 };
    }

    const candidates = rows?.length ?? 0;
    if (candidates) this.log.log(`appointment day reminders candidates=${candidates} date=${dateStr}`);

    let processed = 0;
    for (const raw of rows || []) {
      const row = raw as {
        id: string;
        client_phone: string | null;
        profile_id: string | null;
        time: string;
        service_name: string | null;
      };
      let p = row.client_phone ? normalizePhone(row.client_phone) : '';
      if (!p && row.profile_id) {
        const { data: prof } = await this.supabase
          .getClient()
          .from('profiles')
          .select('phone')
          .eq('id', row.profile_id)
          .maybeSingle();
        p = prof?.phone ? normalizePhone((prof as { phone: string }).phone) : '';
      }
      if (!p) continue;

      const timeShort = typeof row.time === 'string' ? row.time.slice(0, 5) : String(row.time);
      const svc = row.service_name || 'תור';
      const created = await this.create({
        userPhone: p,
        type: 'personal',
        title: 'תזכורת לתור היום',
        body: `${svc} בשעה ${timeShort}`,
        pushScreen: 'Appointments',
      });
      if (!created) continue;

      const { error: upErr } = await this.supabase
        .getClient()
        .from('appointments')
        .update({ day_reminder_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (upErr) {
        this.log.warn(`day_reminder_sent_at update failed id=${row.id}: ${upErr.message}`);
      } else {
        processed++;
      }
    }
    if (processed) this.log.log(`appointment day reminders processed=${processed} date=${dateStr}`);
    return { processed };
  }

  /** One admin-style notification per distinct normalized phone (e.g. waitlist customers only). */
  async broadcastToPhones(title: string, body: string, rawPhones: string[]): Promise<{ sent: number }> {
    const unique = new Set<string>();
    for (const p of rawPhones) {
      const n = normalizePhone(p);
      if (n) unique.add(n);
    }
    let sent = 0;
    for (const phone of unique) {
      if (await this.create({ userPhone: phone, type: 'admin', title, body })) sent++;
    }
    return { sent };
  }
}

type NotificationRow = {
  id: string;
  user_phone: string | null;
  type: string;
  title: string;
  body: string | null;
  created_at: string;
};

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly push: PushDeliveryService,
  ) {}

  @Get('my')
  @UseGuards(TokenAuthGuard)
  async getMy(
    @RequestUser() user: UserPayload,
    @Query('limit') limitRaw?: string,
    @Query('page') pageRaw?: string,
    @Query('unreadOnly') unreadOnlyRaw?: string,
  ) {
    const phone = normalizePhone(user.phone || '');
    let limit: number | undefined;
    if (limitRaw != null && String(limitRaw).trim() !== '') {
      const l = parseInt(String(limitRaw), 10);
      if (!Number.isFinite(l) || l < 1) {
        throw new BadRequestException('limit must be a positive number');
      }
      limit = l;
    }
    let page: number | undefined;
    if (pageRaw != null && String(pageRaw).trim() !== '') {
      const p = parseInt(String(pageRaw), 10);
      if (!Number.isFinite(p) || p < 1 || Math.floor(p) !== p) {
        throw new BadRequestException('page must be a positive integer');
      }
      page = p;
    }
    const unreadOnly = unreadOnlyRaw === 'true' || unreadOnlyRaw === '1';
    return this.notifications.listForUser(phone, user.id, {
      limit,
      page,
      unreadOnly,
    });
  }

  @Delete('my')
  @UseGuards(TokenAuthGuard)
  async deleteMy(@RequestUser() user: UserPayload) {
    return this.notifications.deleteAllForUser(user.id);
  }

  @Post('push-token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard, TokenAuthGuard)
  @Throttle({ writes: { limit: 32, ttl: 60_000 } })
  async registerPushToken(@RequestUser() user: UserPayload, @Body() dto: RegisterPushTokenDto) {
    return this.push.registerToken(user, dto.expoPushToken, dto.platform);
  }

  @Delete('push-token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TokenAuthGuard)
  async deletePushToken(@RequestUser() user: UserPayload, @Body() dto?: DeletePushTokenDto) {
    return this.push.deactivateToken(user, dto?.expoPushToken);
  }

  /** Cron: `POST /notifications/reminders/appointments-day` with header `x-appointment-reminder-secret`. */
  @Post('reminders/appointments-day')
  @HttpCode(HttpStatus.OK)
  async appointmentsDayReminders(@Headers('x-appointment-reminder-secret') secret: string | undefined) {
    return this.notifications.runAppointmentDayReminders(secret);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushDeliveryService],
  exports: [NotificationsService, PushDeliveryService],
})
export class NotificationsModule {}
