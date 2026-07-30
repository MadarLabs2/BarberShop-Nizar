import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { isAppProduction } from './production-env';

const GENERIC_CLIENT = 'Unable to complete this request. Please try again later.';

function extractMessage(payload: string | object): string {
  if (typeof payload === 'string') return payload;
  const m = (payload as { message?: unknown }).message;
  if (Array.isArray(m)) return m.map(String).join('; ');
  if (typeof m === 'string') return m;
  return GENERIC_CLIENT;
}

function looksLikeDbOrOtpLeak(message: string): boolean {
  const m = message.trim();
  if (/OTP_DB_INSERT_FAILED/i.test(m)) return true;
  if (/^\s*\d{5}\s*[|]/m.test(m)) return true;
  if (/violates|constraint|relation\s|duplicate key|column\s|internal server|postgres/i.test(m)) return true;
  return false;
}

/** Preserves throttle / structured OTP cooldown payloads; strips DB internals in production. */
@Catch(HttpException)
export class SanitizeHttpExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(SanitizeHttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (!isAppProduction()) {
      res.status(status).json(payload);
      return;
    }

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      res.status(status).json(payload);
      return;
    }

    const msg = typeof payload === 'string' ? payload : extractMessage(payload as object);

    if (status >= 500) {
      this.log.warn(`HTTP ${status} (sanitized for client): ${msg}`);
      res.status(status).json({ statusCode: status, message: GENERIC_CLIENT });
      return;
    }

    if (status >= 400 && typeof payload === 'object' && payload !== null && looksLikeDbOrOtpLeak(msg)) {
      this.log.warn(`HTTP ${status} DB/OTP detail hidden from client: ${msg}`);
      const body = payload as Record<string, unknown>;
      const next = { ...body, message: GENERIC_CLIENT };
      res.status(status).json(next);
      return;
    }

    res.status(status).json(payload);
  }
}
