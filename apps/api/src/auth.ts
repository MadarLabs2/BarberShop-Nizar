import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Module,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { OtpThrottleGuard } from './core/otp-throttle.guard';
import { AuthService } from './auth/auth.service';
import { SmsService } from './auth/sms.service';
import type { UserPayload } from './auth/auth.service';
import { TokenAuthGuard } from './auth/auth.guard';
import { AdminGuard } from './auth/admin.guard';
import { StaffGuard } from './auth/staff.guard';
import { RequestUser } from './auth/auth.decorator';

export class RequestOtpDto {
  phone!: string;
}

export class VerifyOtpDto {
  phone!: string;
  code!: string;
  firstName?: string;
  lastName?: string;
  birthDate?: string;
}

export class RegisterDto {
  phone!: string;
  firstName!: string;
  lastName!: string;
  birthDate?: string;
}

export type { UserPayload };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('check-registered')
  @HttpCode(HttpStatus.OK)
  async checkRegistered(@Body() dto: RequestOtpDto) {
    const ok = await this.auth.checkRegistered(dto.phone);
    return { registered: ok };
  }

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ writes: { limit: 24, ttl: 60_000 } })
  async register(@Body() dto: RegisterDto) {
    return this.auth.register({
      phone: dto.phone,
      firstName: dto.firstName,
      lastName: dto.lastName,
      birthDate: dto.birthDate,
    });
  }

  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OtpThrottleGuard)
  @Throttle({ otp: { limit: 8, ttl: 60_000 } })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp({ phone: dto.phone });
  }

  @Post('verify-otp')
  @UseGuards(OtpThrottleGuard)
  @Throttle({ otp: { limit: 12, ttl: 60_000 } })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp({
      phone: dto.phone,
      code: dto.code,
      firstName: dto.firstName,
      lastName: dto.lastName,
      birthDate: dto.birthDate,
    });
  }

  /** Alias for POST /auth/request-otp (same contract). */
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OtpThrottleGuard)
  @Throttle({ otp: { limit: 8, ttl: 60_000 } })
  async otpSend(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp({ phone: dto.phone });
  }

  /** Alias for POST /auth/verify-otp (same contract). */
  @Post('otp/verify')
  @UseGuards(OtpThrottleGuard)
  @Throttle({ otp: { limit: 12, ttl: 60_000 } })
  async otpVerify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp({
      phone: dto.phone,
      code: dto.code,
      firstName: dto.firstName,
      lastName: dto.lastName,
      birthDate: dto.birthDate,
    });
  }

  @Get('me')
  async me(@Headers('authorization') auth?: string) {
    const token = auth?.replace(/^Bearer\s+/i, '')?.trim();
    if (!token) throw new UnauthorizedException('Missing token');
    const user = await this.auth.me(token);
    if (!user) throw new UnauthorizedException('Invalid token');
    return { user };
  }

  /** Clears api_token for the authenticated profile (invalidates this device session). */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Headers('authorization') auth?: string) {
    const token = auth?.replace(/^Bearer\s+/i, '')?.trim();
    if (!token) throw new UnauthorizedException('Missing token');
    const user = await this.auth.me(token);
    if (!user) throw new UnauthorizedException('Invalid token');
    await this.auth.logoutApiToken(token);
    return { ok: true };
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TokenAuthGuard)
  async deleteMe(@RequestUser() user: UserPayload) {
    return this.auth.closeCustomerAccount(user);
  }

  @Delete('account')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TokenAuthGuard)
  async deleteAccount(@RequestUser() user: UserPayload) {
    return this.auth.closeCustomerAccount(user);
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService, SmsService, TokenAuthGuard, AdminGuard, StaffGuard, OtpThrottleGuard],
  exports: [AuthService, TokenAuthGuard, AdminGuard, StaffGuard],
})
export class AuthModule {}
