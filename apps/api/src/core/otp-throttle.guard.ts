import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * IP + normalized phone (last 9 digits) for OTP routes so one IP cannot exhaust
 * limits across many target numbers without each number having its own budget.
 */
@Injectable()
export class OtpThrottleGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const base = await super.getTracker(req);
    const raw = req.body?.phone;
    const digits = typeof raw === 'string' ? raw.replace(/\D/g, '').slice(-9) : '';
    if (digits.length >= 9) return `${base}|${digits}`;
    return `${base}|_`;
  }
}
