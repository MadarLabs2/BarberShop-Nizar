import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../core/supabase';
import { isAppProduction } from '../core/production-env';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { SmsService } from './sms.service';

const PHONE_LEN_MIN = 9;
/** New registrations must complete verify using an OTP requested within this window (ms). */
const REGISTRATION_OTP_MAX_AGE_MS = 10 * 60 * 1000;

export type OtpDeliveryProvider = 'sms_pulseem' | 'dev_log';

/** PostgREST / Postgres error text for OTP insert failures (logged + returned to client). */
function formatOtpDbError(err: {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
} | null): string {
  if (!err) return 'unknown';
  return [err.code, err.message, err.details, err.hint]
    .filter((x) => x != null && String(x).trim().length > 0)
    .map(String)
    .join(' | ');
}

function resolveOtpDeliveryProvider(): OtpDeliveryProvider {
  const raw = process.env.AUTH_OTP_PROVIDER?.trim().toLowerCase();

  if (isAppProduction()) {
    if (raw && raw !== 'sms_pulseem') {
      throw new ServiceUnavailableException('AUTH_OTP_PROVIDER must be sms_pulseem in production');
    }
    return 'sms_pulseem';
  }

  if (raw === 'sms_pulseem') return 'sms_pulseem';
  if (!raw || raw === 'dev_log') return 'dev_log';
  throw new ServiceUnavailableException('AUTH_OTP_PROVIDER must be dev_log or sms_pulseem outside production');
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getOtpCodeLength(): number {
  const n = readIntEnv('OTP_CODE_LENGTH', 6);
  return Math.min(10, Math.max(4, n));
}

function getOtpTtlMinutes(): number {
  return readIntEnv('OTP_TTL_MINUTES', 10);
}

function getOtpResendCooldownSeconds(): number {
  return readIntEnv('OTP_RESEND_COOLDOWN_SECONDS', 60);
}

function getOtpMaxVerifyAttempts(): number {
  return readIntEnv('OTP_MAX_VERIFY_ATTEMPTS', 5);
}

/** Min interval between writes to api_token_last_used_at (rolling “activity” without per-request DB spam). */
function getApiTokenTouchMinMs(): number {
  const hours = readIntEnv('API_TOKEN_TOUCH_MIN_HOURS', 12);
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function getOtpHashSecret(): string {
  const s = process.env.OTP_HASH_SECRET?.trim();
  if (!s) throw new ServiceUnavailableException('OTP_HASH_SECRET is not configured');
  if (s.length < 16) throw new ServiceUnavailableException('OTP_HASH_SECRET is too short');
  return s;
}

function hashOtp(phone: string, code: string, secret: string): string {
  return createHmac('sha256', secret).update(`${phone}\n${code}`).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function generateNumericOtp(length: number): string {
  const max = 10 ** length;
  return String(randomInt(0, max)).padStart(length, '0');
}

/** Stored profile phone key: last 9 digits (existing app convention). */
function toIsraelE164FromStoredPhone(phone9: string): string {
  return `+972${phone9}`;
}

type ProfileRow = {
  id: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  is_admin: boolean;
  /** Present on some selects; not required for `toUserPayload`. */
  api_token?: string | null;
};

export type Role = 'customer' | 'staff' | 'admin';

export type UserPayload = {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  isAdmin: boolean;
  staffId?: string;
  avatarUrl?: string | null;
  /** Admin-granted: staff member may manage their own blocked time slots. */
  canBlockOwnTime?: boolean;
  /** Admin-granted: staff member may manage their own working days/hours. */
  canSetOwnWorkingHours?: boolean;
  /** All roles for this account (admin + staff may both be true). */
  roles: Role[];
  /** Primary shell: admin > staff > customer (legacy clients use this alone). */
  role: Role;
};

export class RegisterDto {
  phone!: string;
  firstName!: string;
  lastName!: string;
  birthDate?: string;
}

function resolveRole(isAdmin: boolean, staffId: string | null): Role {
  if (isAdmin) return 'admin';
  if (staffId) return 'staff';
  return 'customer';
}

function resolveRoles(isAdmin: boolean, staffId: string | null): Role[] {
  const roles: Role[] = [];
  if (isAdmin) roles.push('admin');
  if (staffId) roles.push('staff');
  if (roles.length === 0) roles.push('customer');
  return roles;
}

function toUserPayload(
  r: ProfileRow,
  staffProfile: {
    id: string;
    avatarUrl: string | null;
    canBlockOwnTime: boolean;
    canSetOwnWorkingHours: boolean;
  } | null,
): UserPayload {
  const isAdmin = !!r.is_admin;
  const staffId = staffProfile?.id ?? null;
  const role = resolveRole(isAdmin, staffId);
  return {
    id: r.id,
    phone: r.phone || '',
    firstName: r.first_name || '',
    lastName: r.last_name || '',
    birthDate: r.birth_date || null,
    isAdmin,
    ...(staffId && { staffId }),
    ...(staffProfile?.avatarUrl ? { avatarUrl: staffProfile.avatarUrl } : {}),
    ...(staffId && { canBlockOwnTime: !!staffProfile?.canBlockOwnTime }),
    ...(staffId && { canSetOwnWorkingHours: !!staffProfile?.canSetOwnWorkingHours }),
    roles: resolveRoles(isAdmin, staffId),
    role,
  };
}

function parseBirthDate(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (typeof v === 'object' && v && 'year' in v && 'month' in v && 'day' in v) {
    const y = String((v as { year: string }).year).padStart(4, '0');
    const m = String((v as { month: string }).month).padStart(2, '0');
    const d = String((v as { day: string }).day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function normalizePhone(s: string): string {
  return String(s || '').replace(/\D/g, '').slice(-9) || '';
}

async function getStaffProfileForProfile(
  supabase: SupabaseService,
  profileId: string,
): Promise<{
  id: string;
  avatarUrl: string | null;
  canBlockOwnTime: boolean;
  canSetOwnWorkingHours: boolean;
} | null> {
  const { data } = await supabase
    .getClient()
    .from('staff')
    .select('id, avatar_url, can_block_own_time, can_set_own_working_hours')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string;
    avatar_url: string | null;
    can_block_own_time: boolean | null;
    can_set_own_working_hours: boolean | null;
  };
  return {
    id: row.id,
    avatarUrl: row.avatar_url ?? null,
    canBlockOwnTime: !!row.can_block_own_time,
    canSetOwnWorkingHours: !!row.can_set_own_working_hours,
  };
}

async function isPhoneInStaff(supabase: SupabaseService, phone: string): Promise<boolean> {
  const { data } = await supabase
    .getClient()
    .from('staff')
    .select('id')
    .eq('phone', phone)
    .eq('is_active', true)
    .maybeSingle();
  return !!data;
}

export type RequestOtpResult = {
  ok: true;
  resendAvailableAt: string;
  otpCodeLength: number;
  /** Only in non-production when AUTH_OTP_PROVIDER=dev_log and OTP_ALLOW_DEV_CODE_RESPONSE=true. */
  devCode?: string;
};

export type VerifyOtpInput = {
  phone: string;
  code: string;
  firstName?: string;
  lastName?: string;
  birthDate?: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly sms: SmsService,
  ) {}

  async checkRegistered(phone: string): Promise<boolean> {
    const p = normalizePhone(phone);
    if (!p || p.length < PHONE_LEN_MIN) return false;
    const { data } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id')
      .eq('phone', p)
      .maybeSingle();
    return !!data;
  }

  /**
   * Validates registration eligibility only — profile row is created in `verifyOtp` after OTP proof.
   */
  async register(dto: RegisterDto): Promise<{ ok: true; phone: string }> {
    const phone = normalizePhone(dto.phone);
    if (!phone || phone.length < PHONE_LEN_MIN) throw new BadRequestException('Invalid phone');
    const firstName = (dto.firstName || '').trim();
    const lastName = (dto.lastName || '').trim();
    if (!firstName || !lastName) throw new BadRequestException('First and last name required');

    const { data: existingProfile } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (existingProfile) {
      throw new BadRequestException('PHONE_ALREADY_REGISTERED');
    }

    const phoneInStaff = await isPhoneInStaff(this.supabase, phone);
    if (phoneInStaff) {
      throw new BadRequestException('PHONE_BELONGS_TO_STAFF');
    }

    return { ok: true, phone };
  }

  async requestOtp(dto: { phone: string }): Promise<RequestOtpResult> {
    const phone = normalizePhone(dto.phone);
    if (!phone || phone.length < PHONE_LEN_MIN) throw new BadRequestException('Invalid phone');

    const provider = resolveOtpDeliveryProvider();
    return this.requestOtpSecureSms(phone, provider);
  }

  /** Hashed OTP + SMS transport (Pulseem in production, dev_log mock in development). */
  private async requestOtpSecureSms(phone: string, provider: OtpDeliveryProvider): Promise<RequestOtpResult> {
    const secret = getOtpHashSecret();
    const otpLen = getOtpCodeLength();
    const ttlMin = getOtpTtlMinutes();
    const cooldownSec = getOtpResendCooldownSeconds();
    const maxAttempts = getOtpMaxVerifyAttempts();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const { data: lastRow } = await this.supabase
      .getClient()
      .from('otp_requests')
      .select('resend_available_at')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const ra = lastRow && (lastRow as { resend_available_at: string | null }).resend_available_at;
    if (ra) {
      const until = new Date(ra).getTime();
      if (until > now) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'OTP_RESEND_COOLDOWN',
            resendAvailableAt: new Date(until).toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    await this.supabase
      .getClient()
      .from('otp_requests')
      .update({ expires_at: nowIso })
      .eq('phone', phone)
      .is('verified_at', null);

    const code = generateNumericOtp(otpLen);
    const otpHash = hashOtp(phone, code, secret);
    const expiresAt = new Date(now + ttlMin * 60 * 1000).toISOString();
    const resendAt = new Date(now + cooldownSec * 1000).toISOString();

    const { data: insertedRows, error: insErr } = await this.supabase
      .getClient()
      .from('otp_requests')
      .insert({
        phone,
        code: null,
        otp_code_hash: otpHash,
        expires_at: expiresAt,
        resend_available_at: resendAt,
        attempt_count: 0,
        max_verify_attempts: maxAttempts,
        provider,
        delivery_status: 'pending',
        delivery_error: null,
      })
      .select('id');

    if (insErr) {
      this.logger.warn(`OTP secure DB insert failed (provider=${provider}): ${formatOtpDbError(insErr)}`);
      throw new BadRequestException(`OTP_DB_INSERT_FAILED: ${formatOtpDbError(insErr)}`);
    }
    const inserted = insertedRows?.[0] as { id: string } | undefined;
    if (!inserted?.id) {
      this.logger.warn(`OTP secure DB insert returned no row (provider=${provider})`);
      throw new BadRequestException('OTP_DB_INSERT_FAILED: no row returned');
    }

    const e164 = toIsraelE164FromStoredPhone(phone);
    const body = `Your login code is ${code}`;
    const sendRes = await this.sms.sendLoginOtpSms({
      delivery: provider,
      e164Destination: e164,
      body,
      otpRequestId: inserted.id,
    });

    if (sendRes.status === 'failed') {
      this.logger.warn(
        `OTP SMS send failed after DB row created id=${inserted.id} provider=${provider}: ${sendRes.error || 'unknown'}`,
      );
      await this.supabase
        .getClient()
        .from('otp_requests')
        .update({
          delivery_status: 'failed',
          delivery_error: sendRes.error || 'send_failed',
          expires_at: nowIso,
          resend_available_at: nowIso,
        })
        .eq('id', inserted.id);
      throw new BadRequestException('SMS_SEND_FAILED');
    }

    await this.supabase
      .getClient()
      .from('otp_requests')
      .update({
        delivery_status: sendRes.status === 'skipped_dev' ? 'skipped_dev' : 'sent',
        delivery_error: null,
      })
      .eq('id', inserted.id);

    const allowDevCode =
      provider === 'dev_log' &&
      process.env.OTP_ALLOW_DEV_CODE_RESPONSE === 'true' &&
      !isAppProduction();

    return {
      ok: true,
      resendAvailableAt: resendAt,
      otpCodeLength: otpLen,
      ...(allowDevCode ? { devCode: code } : {}),
    };
  }

  private async verifyOtpSecureRow(
    phone: string,
    code: string,
    r: {
      id: string;
      otp_code_hash: string;
      attempt_count: number;
      max_verify_attempts: number;
      expires_at: string | null;
    },
    nowIso: string,
  ): Promise<void> {
    const otpLen = getOtpCodeLength();
    if (code.length !== otpLen) throw new BadRequestException('Invalid code');
    if (r.expires_at && new Date(r.expires_at).getTime() <= new Date(nowIso).getTime()) {
      throw new BadRequestException('Invalid or expired code');
    }
    if (r.attempt_count >= r.max_verify_attempts) {
      throw new BadRequestException('Too many attempts');
    }
    const secret = getOtpHashSecret();
    const expectedHash = hashOtp(phone, code, secret);
    const match = timingSafeEqualHex(expectedHash, r.otp_code_hash);
    if (!match) {
      await this.supabase
        .getClient()
        .from('otp_requests')
        .update({ attempt_count: r.attempt_count + 1 })
        .eq('id', r.id);
      throw new BadRequestException('Invalid or expired code');
    }
    await this.supabase.getClient().from('otp_requests').update({ verified_at: nowIso }).eq('id', r.id);
  }

  async verifyOtp(dto: VerifyOtpInput): Promise<{ user: UserPayload; token: string }> {
    const phone = normalizePhone(dto.phone);
    const code = (dto.code || '').trim();
    if (!phone || phone.length < PHONE_LEN_MIN) throw new BadRequestException('Invalid phone');
    if (!code || !/^\d+$/.test(code)) throw new BadRequestException('Invalid code');

    const nowIso = new Date().toISOString();
    const { data: row } = await this.supabase
      .getClient()
      .from('otp_requests')
      .select('id, otp_code_hash, attempt_count, max_verify_attempts, expires_at, created_at')
      .eq('phone', phone)
      .is('verified_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const r = row as {
      id: string;
      otp_code_hash: string | null;
      attempt_count: number;
      max_verify_attempts: number;
      expires_at: string | null;
      created_at: string;
    } | null;

    if (!r?.otp_code_hash) {
      throw new BadRequestException('Invalid or expired code');
    }

    await this.verifyOtpSecureRow(phone, code, { ...r, otp_code_hash: r.otp_code_hash }, nowIso);

    const { data: profile } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id, phone, first_name, last_name, birth_date, is_admin')
      .eq('phone', phone)
      .maybeSingle();

    let profileRow = profile as ProfileRow | null;

    if (!profileRow) {
      const fn = dto.firstName?.trim() || '';
      const ln = dto.lastName?.trim() || '';
      if (!fn || !ln) {
        throw new BadRequestException('Profile not found');
      }
      const createdMs = new Date(r.created_at).getTime();
      if (!Number.isFinite(createdMs) || Date.now() - createdMs > REGISTRATION_OTP_MAX_AGE_MS) {
        throw new BadRequestException('Registration code expired; request a new code');
      }
      if (await isPhoneInStaff(this.supabase, phone)) {
        throw new BadRequestException('PHONE_BELONGS_TO_STAFF');
      }
      const birthDate = dto.birthDate ? parseBirthDate(dto.birthDate) : null;
      const { data: inserted, error: insErr } = await this.supabase
        .getClient()
        .from('profiles')
        .insert({ phone, first_name: fn, last_name: ln, birth_date: birthDate })
        .select('id, phone, first_name, last_name, birth_date, is_admin')
        .single();
      if (insErr) {
        this.logger.warn(`register-after-otp insert failed: ${formatOtpDbError(insErr)}`);
        const msg = typeof insErr.message === 'string' ? insErr.message : 'Registration failed';
        throw new BadRequestException(msg);
      }
      profileRow = inserted as ProfileRow;
    }

    const token = randomUUID();
    const sessionIso = new Date().toISOString();
    await this.supabase
      .getClient()
      .from('profiles')
      .update({
        api_token: token,
        updated_at: sessionIso,
        api_token_issued_at: sessionIso,
        api_token_last_used_at: sessionIso,
      })
      .eq('id', profileRow.id);

    const staffProfile = await getStaffProfileForProfile(this.supabase, profileRow.id);
    return { user: toUserPayload(profileRow, staffProfile), token };
  }

  async me(token: string): Promise<UserPayload | null> {
    if (!token?.trim()) return null;
    const { data } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id, phone, first_name, last_name, birth_date, is_admin, api_token_last_used_at')
      .eq('api_token', token.trim())
      .maybeSingle();
    if (!data) return null;

    const row = data as ProfileRow & { api_token_last_used_at?: string | null };
    const lastUsedMs = row.api_token_last_used_at ? new Date(row.api_token_last_used_at).getTime() : 0;
    const touchMinMs = getApiTokenTouchMinMs();
    if (!lastUsedMs || Date.now() - lastUsedMs >= touchMinMs) {
      const nowIso = new Date().toISOString();
      const { error } = await this.supabase
        .getClient()
        .from('profiles')
        .update({ api_token_last_used_at: nowIso, updated_at: nowIso })
        .eq('id', row.id)
        .eq('api_token', token.trim());
      if (error) {
        this.logger.warn(`api_token_last_used_at touch failed: ${error.message}`);
      }
    }

    const staffProfile = await getStaffProfileForProfile(this.supabase, data.id);
    return toUserPayload(data as ProfileRow, staffProfile);
  }

  /** Invalidate the current api_token (single-device style; new login replaces token anyway). */
  async logoutApiToken(token: string): Promise<{ ok: boolean }> {
    const t = token?.trim();
    if (!t) return { ok: true };
    const nowIso = new Date().toISOString();
    const { error } = await this.supabase
      .getClient()
      .from('profiles')
      .update({
        api_token: null,
        api_token_issued_at: null,
        api_token_last_used_at: null,
        updated_at: nowIso,
      })
      .eq('api_token', t);
    if (error) {
      this.logger.warn(`logoutApiToken: ${error.message}`);
      return { ok: false };
    }
    return { ok: true };
  }

  /**
   * App Store–style account closure for pure customers: anonymize PII, clear session, keep appointment history.
   * Admin and staff-linked accounts cannot use this path (use admin tooling instead).
   */
  async closeCustomerAccount(user: UserPayload): Promise<{ ok: boolean }> {
    if (user.isAdmin || user.staffId) {
      throw new ForbiddenException('ACCOUNT_DELETE_NOT_ALLOWED');
    }

    const client = this.supabase.getClient();
    const profilePhone = normalizePhone(user.phone ?? '');
    const nowIso = new Date().toISOString();

    const { error: tokErr } = await client.from('device_push_tokens').delete().eq('profile_id', user.id);
    if (tokErr) {
      this.logger.warn(`closeCustomerAccount device_push_tokens: ${tokErr.message}`);
      throw new BadRequestException('Failed to remove device tokens');
    }

    if (profilePhone) {
      const { error: nErr } = await client.from('notifications').delete().eq('user_phone', profilePhone);
      if (nErr) {
        this.logger.warn(`closeCustomerAccount notifications: ${nErr.message}`);
      }
    }

    const { error: wlErr } = await client.from('waitlist').delete().eq('profile_id', user.id);
    if (wlErr) {
      this.logger.warn(`closeCustomerAccount waitlist: ${wlErr.message}`);
    }

    const { error: vErr } = await client
      .from('home_story_views')
      .update({ viewer_profile_id: null })
      .eq('viewer_profile_id', user.id);
    if (vErr) {
      this.logger.warn(`closeCustomerAccount home_story_views: ${vErr.message}`);
    }

    const { error: hsErr } = await client
      .from('home_stories')
      .update({ created_by_profile_id: null })
      .eq('created_by_profile_id', user.id);
    if (hsErr) {
      this.logger.warn(`closeCustomerAccount home_stories: ${hsErr.message}`);
    }

    const { error: upErr } = await client
      .from('profiles')
      .update({
        phone: null,
        first_name: 'Deleted',
        last_name: 'User',
        birth_date: null,
        api_token: null,
        api_token_issued_at: null,
        api_token_last_used_at: null,
        updated_at: nowIso,
      })
      .eq('id', user.id);

    if (upErr) {
      this.logger.warn(`closeCustomerAccount profile: ${upErr.message}`);
      throw new BadRequestException('Failed to close account');
    }

    return { ok: true };
  }
}
