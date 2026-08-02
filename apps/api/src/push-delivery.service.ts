import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from './core/supabase';
import type { UserPayload } from './auth';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function isLikelyExpoPushToken(t: string): boolean {
  return t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[');
}

export type ExpoPushMessage = {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
};

function normalizePhone(s: string): string {
  return String(s || '').replace(/\D/g, '').slice(-9) || '';
}

@Injectable()
export class PushDeliveryService {
  private readonly log = new Logger(PushDeliveryService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async registerToken(user: UserPayload, expoPushToken: string, platform: string): Promise<{ ok: boolean }> {
    const token = (expoPushToken || '').trim();
    if (!isLikelyExpoPushToken(token)) {
      throw new BadRequestException('Invalid expo push token');
    }
    const plat = (platform || 'unknown').toLowerCase().slice(0, 20);
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .getClient()
      .from('device_push_tokens')
      .upsert(
        {
          profile_id: user.id,
          expo_push_token: token,
          platform: plat,
          is_active: true,
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: 'profile_id,expo_push_token' },
      );
    if (error) {
      this.log.warn(`push token upsert failed: ${error.message}`);
      throw new BadRequestException('Failed to register push token');
    }
    this.log.log(`push token registered profile=${user.id} platform=${plat}`);
    return { ok: true };
  }

  async deactivateToken(user: UserPayload, expoPushToken?: string): Promise<{ ok: boolean }> {
    let q = this.supabase
      .getClient()
      .from('device_push_tokens')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('profile_id', user.id);
    if (expoPushToken?.trim()) {
      q = q.eq('expo_push_token', expoPushToken.trim());
    }
    await q;
    this.log.log(`push tokens deactivated profile=${user.id}`);
    return { ok: true };
  }

  /** After persisting an in-app notification, send Expo push to that user's devices. */
  async sendForUserPhone(userPhone: string | null, title: string, body: string, data: Record<string, unknown>): Promise<void> {
    const phone = userPhone ? normalizePhone(userPhone) : '';
    if (!phone) return;

    const { data: profile } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();
    if (!profile) return;

    const profileId = (profile as { id: string }).id;
    const { data: tokens, error } = await this.supabase
      .getClient()
      .from('device_push_tokens')
      .select('id, expo_push_token')
      .eq('profile_id', profileId)
      .eq('is_active', true);
    if (error || !tokens?.length) return;

    const messages: ExpoPushMessage[] = (tokens as { id: string; expo_push_token: string }[]).map((t) => ({
      to: t.expo_push_token,
      title,
      body: body || ' ',
      data: { ...data, screen: data.screen ?? 'Notifications' },
      sound: 'default',
      channelId: 'default',
      // Expo maps this to FCM priority (Android) and apns-priority (iOS) — without it, both
      // default to normal priority, which either platform can delay or batch. A user-visible
      // alert like this one needs immediate/high delivery.
      priority: 'high',
    }));

    await this.sendExpoBatch(messages, (tokens as { id: string }[]).map((t) => t.id));
  }

  /**
   * Data-only wake-up push — no title/body/sound, never shown as an alert or banner, and no row
   * is written to `notifications` (so it never appears in the user's notification list either).
   * Used purely to signal the client to silently refresh state (e.g. a permission change) the
   * instant it arrives while the app is foregrounded.
   */
  async sendSilentDataForUserPhone(userPhone: string | null, data: Record<string, unknown>): Promise<void> {
    const phone = userPhone ? normalizePhone(userPhone) : '';
    if (!phone) return;

    const { data: profile } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();
    if (!profile) return;

    const profileId = (profile as { id: string }).id;
    const { data: tokens, error } = await this.supabase
      .getClient()
      .from('device_push_tokens')
      .select('id, expo_push_token')
      .eq('profile_id', profileId)
      .eq('is_active', true);
    if (error || !tokens?.length) return;

    const messages: ExpoPushMessage[] = (tokens as { id: string; expo_push_token: string }[]).map((t) => ({
      to: t.expo_push_token,
      data,
      sound: null,
      priority: 'high',
    }));

    await this.sendExpoBatch(messages, (tokens as { id: string }[]).map((t) => t.id));
  }

  /** Broadcast admin message to every unique active Expo token (one device gets at most one push). */
  async sendBroadcastToAllDevices(title: string, body: string, data: Record<string, unknown>): Promise<void> {
    const client = this.supabase.getClient();
    const pageSize = 1000;
    let offset = 0;
    const rows: { id: string; expo_push_token: string }[] = [];
    for (;;) {
      const { data: batch, error } = await client
        .from('device_push_tokens')
        .select('id, expo_push_token')
        .eq('is_active', true)
        .range(offset, offset + pageSize - 1);
      if (error) {
        this.log.warn(`broadcast push list failed: ${error.message}`);
        return;
      }
      if (!batch?.length) break;
      rows.push(...(batch as { id: string; expo_push_token: string }[]));
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
    if (!rows.length) return;

    const firstIdByToken = new Map<string, string>();
    for (const r of rows) {
      if (!firstIdByToken.has(r.expo_push_token)) firstIdByToken.set(r.expo_push_token, r.id);
    }
    const payload = { ...data, screen: data.screen ?? 'Notifications' };
    const entries = [...firstIdByToken.entries()];
    const chunk = 100;
    for (let i = 0; i < entries.length; i += chunk) {
      const slice = entries.slice(i, i + chunk);
      const messages: ExpoPushMessage[] = slice.map(([token]) => ({
        to: token,
        title,
        body: body || ' ',
        data: payload,
        sound: 'default',
        channelId: 'default',
        priority: 'high',
      }));
      const ids = slice.map(([, id]) => id);
      await this.sendExpoBatch(messages, ids);
    }
  }

  private async sendExpoBatch(messages: ExpoPushMessage[], tokenRowIds: string[]): Promise<void> {
    if (!messages.length) return;
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN?.trim()
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN.trim()}` }
            : {}),
        },
        body: JSON.stringify(messages),
      });
      const json = (await res.json()) as { data?: unknown };
      if (!res.ok) {
        this.log.warn(`Expo push HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
        return;
      }
      const tickets = Array.isArray(json.data)
        ? json.data
        : json.data != null
          ? [json.data]
          : [];
      for (let i = 0; i < tickets.length; i++) {
        const t = tickets[i] as { status?: string; details?: { error?: string } };
        if (t?.status === 'error' && tokenRowIds[i]) {
          const err = t.details?.error || '';
          if (err === 'DeviceNotRegistered' || err === 'InvalidCredentials') {
            await this.supabase
              .getClient()
              .from('device_push_tokens')
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq('id', tokenRowIds[i]);
            this.log.warn(`push token deactivated row=${tokenRowIds[i]} reason=${err}`);
          }
        }
      }
    } catch (e) {
      this.log.warn(`Expo push request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

}
