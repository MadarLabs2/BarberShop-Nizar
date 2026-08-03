import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../core/supabase';
import { NotificationsService } from '../notifications';
import type { UserPayload } from '../auth/auth.service';
import { israelTodayYmd } from '../core/israel-time';
import { findActiveBirthdayWindow } from './birthday-rewards.util';

export type BirthdayRewardStatus = { active: boolean; expiresAt: string | null };

export type RedeemBirthdayRewardParams = {
  profileId: string;
  clientPhone: string;
  clientName: string;
  branchId: string;
  staffId: string;
  serviceId: string;
  date: string;
  time: string;
  duration: number;
  serviceName: string;
  staffName: string;
  branchName: string;
  serviceNameHe: string;
  serviceNameAr: string;
  branchNameHe: string;
  branchNameAr: string;
};

/** Returned row shape matches `create_or_reschedule_appointment`'s RETURNS TABLE exactly. */
export type RedeemedAppointmentRow = {
  id: string;
  date: string;
  time: string;
  service_name: string;
  staff_name: string;
  branch_name: string;
  price: number;
  created_at: string;
  service_name_he: string | null;
  service_name_ar: string | null;
  branch_name_he: string | null;
  branch_name_ar: string | null;
};

@Injectable()
export class BirthdayRewardsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Lazy check, called whenever the customer interacts with the app (see `GET
   * /bookings/birthday-reward`): grants this year's/last year's birthday reward if the customer is
   * currently inside their window and hasn't already received one for that occurrence, then returns
   * their current redeemable status regardless of whether this call just granted it or it already
   * existed. Idempotent at the DB level (`birthday_rewards` UNIQUE(profile_id, birthday_year)) —
   * concurrent/repeated calls can never create a duplicate row or send a duplicate notification.
   */
  async reconcileAndGetStatus(user: UserPayload): Promise<BirthdayRewardStatus> {
    const window = findActiveBirthdayWindow(user.birthDate, israelTodayYmd());
    if (window) {
      const client = this.supabase.getClient();
      const { data: insertedRows, error } = await client
        .from('birthday_rewards')
        .upsert(
          {
            profile_id: user.id,
            birthday_year: window.birthdayYear,
            granted_at: new Date().toISOString(),
            expires_at: window.expiresAt,
          },
          { onConflict: 'profile_id,birthday_year', ignoreDuplicates: true },
        )
        .select('id');

      // A non-empty result means this call genuinely inserted a brand-new row (ignoreDuplicates
      // makes Postgres do INSERT ... ON CONFLICT DO NOTHING RETURNING) -- an empty array means the
      // reward for this birthday year already existed, so this is a repeat check, not a new grant.
      if (!error && Array.isArray(insertedRows) && insertedRows.length > 0) {
        await this.notifications
          .create({
            userPhone: user.phone,
            type: 'personal',
            title: '🎂 מזל טוב ליום הולדתך!',
            body: 'קיבלת תור חינם לרגל יום ההולדת שלך. בתוקף ל-30 יום — קבעו תור מתי שנוח לכם.',
            pushScreen: 'Booking',
          })
          .catch(() => {});
      }
    }

    return this.getCurrentStatus(user.id);
  }

  private async getCurrentStatus(profileId: string): Promise<BirthdayRewardStatus> {
    const { data } = await this.supabase
      .getClient()
      .from('birthday_rewards')
      .select('expires_at')
      .eq('profile_id', profileId)
      .is('redeemed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('granted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return { active: false, expiresAt: null };
    return { active: true, expiresAt: (data as { expires_at: string }).expires_at };
  }

  /**
   * Atomic redemption: delegates entirely to the `redeem_birthday_reward_and_book_appointment`
   * Postgres function (migration 049), which locks + validates the reward, books the appointment
   * via the existing `create_or_reschedule_appointment` RPC with price forced to 0 (never accepted
   * as a parameter here), and marks the reward redeemed -- all in one DB transaction. If booking
   * fails for any reason, the whole call rolls back and the reward is left untouched.
   */
  async redeem(params: RedeemBirthdayRewardParams): Promise<RedeemedAppointmentRow> {
    const { data, error } = await this.supabase.getClient().rpc('redeem_birthday_reward_and_book_appointment', {
      p_profile_id: params.profileId,
      p_client_phone: params.clientPhone,
      p_client_name: params.clientName,
      p_branch_id: params.branchId,
      p_staff_id: params.staffId,
      p_service_id: params.serviceId,
      p_date: params.date,
      p_time: params.time,
      p_duration: params.duration,
      p_service_name: params.serviceName,
      p_staff_name: params.staffName,
      p_branch_name: params.branchName,
      p_service_name_he: params.serviceNameHe,
      p_service_name_ar: params.serviceNameAr,
      p_branch_name_he: params.branchNameHe,
      p_branch_name_ar: params.branchNameAr,
    });

    if (error) {
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message || '';
      if (message.includes('NO_BIRTHDAY_REWARD')) {
        throw new BadRequestException('אין ברשותך תור חינם פעיל ליום הולדת');
      }
      if (code === '23505' || code === '23P01' || message.includes('SLOT_BLOCKED')) {
        throw new BadRequestException('השעה נתפסה על ידי לקוח אחר — נסו שוב או בחרו שעה אחרת.');
      }
      if (message.includes('MAX_UPCOMING_APPOINTMENTS')) {
        throw new BadRequestException(
          'ניתן להחזיק עד שני תורים עתידיים בלבד. בטלו או השלימו תור לפני קביעת תור נוסף.',
        );
      }
      throw new BadRequestException('Failed to redeem birthday reward');
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new BadRequestException('Failed to redeem birthday reward');
    return row as RedeemedAppointmentRow;
  }
}
