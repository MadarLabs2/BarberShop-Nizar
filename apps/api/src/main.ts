import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

// Monorepo root `.env` — resolve from this file so it works regardless of `process.cwd()`
// (`src/main.ts` and `dist/main.js` both live under `apps/api/{src|dist}/`).
const envPath = resolve(join(__dirname, '../../../.env'));
if (!existsSync(envPath)) {
  console.warn(`[dotenv] .env not found at ${envPath} (cwd=${process.cwd()})`);
}
// Dotenv does not override existing `process.env` by default. A stale `PULSEEM_API_KEY` from
// Windows User/System env (or `NODE_ENV=production` globally) would then win over this file.
// Default: monorepo `.env` wins. Opt out with `DOTENV_PRESERVE_EXISTING=true` (e.g. CI secrets).
const envResult = config({
  path: envPath,
  override: process.env.DOTENV_PRESERVE_EXISTING !== 'true',
});
if (envResult.error) {
  console.warn(`[dotenv] ${envResult.error.message}`);
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { isAppProduction } from './core/production-env';
import { SanitizeHttpExceptionFilter } from './core/sanitize-http-exception.filter';

function assertProductionSecurityEnv(): void {
  if (!isAppProduction()) return;
  const otp = process.env.AUTH_OTP_PROVIDER?.trim().toLowerCase();
  if (otp === 'dev_log') {
    throw new Error('AUTH_OTP_PROVIDER=dev_log is forbidden when APP_ENV=production or NODE_ENV=production.');
  }
  if (process.env.OTP_ALLOW_DEV_CODE_RESPONSE?.trim() === 'true') {
    throw new Error('OTP_ALLOW_DEV_CODE_RESPONSE=true is forbidden when APP_ENV=production or NODE_ENV=production.');
  }
  const cors = process.env.APP_CORS_ORIGINS?.trim();
  if (!cors) {
    throw new Error('APP_CORS_ORIGINS must list allowed origins (comma-separated) in production.');
  }
}

assertProductionSecurityEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new SanitizeHttpExceptionFilter());

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);

  if (isAppProduction()) {
    const origins = (process.env.APP_CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    app.enableCors({
      origin: origins,
      credentials: true,
    });
  } else {
    app.enableCors({
      origin: true,
      credentials: true,
    });
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();
