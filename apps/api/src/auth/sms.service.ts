import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { isAppProduction } from '../core/production-env';
import { existsSync, readFileSync } from 'fs';
import * as https from 'https';
import { isAbsolute, join, resolve } from 'path';
import { URL } from 'url';

export type OtpSmsSendResult = { status: 'sent' | 'skipped_dev' | 'failed'; error?: string };

@Injectable()
export class SmsService {
  private readonly log = new Logger(SmsService.name);

  /**
   * Trims and strips a single pair of outer ASCII quotes if present.
   * Dotenv usually strips `"..."` itself; this covers pasted values and avoids sending literal quote chars in headers.
   */
  private normalizeEnvSecret(raw: string | undefined): string {
    if (raw == null) return '';
    let v = String(raw).replace(/^\uFEFF/, '').trim();
    if (v.length >= 2) {
      const q = v[0];
      if ((q === '"' || q === "'") && v[v.length - 1] === q) {
        v = v.slice(1, -1).trim();
      }
    }
    return v;
  }

  /** Safe diagnostics when Pulseem rejects the key — never logs key material or previews. */
  private logPulseemApiKeyDiagnostics(apiKey: string, reason: string): void {
    const len = apiKey.length;
    const hasNl = /[\r\n]/.test(apiKey);
    const hadHash = apiKey.includes('#');
    this.log.warn(
      `Pulseem API key diagnostics (${reason}): len=${len} hasNewline=${hasNl} containsHash=${hadHash}. ` +
        `Re-copy the key from Pulseem (file/B64/plain env) if configuration looks wrong.`,
    );
  }

  /** Monorepo root: `src/auth` or `dist/auth` → four `..` segments. */
  private pulseemRepoRootDir(): string {
    return resolve(join(__dirname, '../../../..'));
  }

  /** Optional raw key file (UTF-8, one line) — highest precedence over B64/plain .env. */
  private readPulseemApiKeyFromOptionalFile(rawPath: string): string {
    const p = rawPath.trim();
    if (!p) return '';
    const abs = isAbsolute(p) ? p : resolve(join(this.pulseemRepoRootDir(), p));
    try {
      if (!existsSync(abs)) {
        this.log.warn(`PULSEEM_API_KEY_FILE not found: ${abs}`);
        return '';
      }
      return readFileSync(abs, 'utf8').replace(/^\uFEFF/, '').trim();
    } catch (e) {
      this.log.warn(`PULSEEM_API_KEY_FILE read failed: ${e instanceof Error ? e.message : String(e)}`);
      return '';
    }
  }

  private readBoolEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  }

  private getPulseemConfig(): {
    url: string;
    apiKey: string;
    apiKeySource: 'file' | 'b64' | 'plain';
    fromNumber: string;
    sendId: string;
    isAsync: boolean;
    cbkUrl: string | undefined;
  } {
    const url = this.normalizeEnvSecret(process.env.PULSEEM_SMS_URL);
    const keyFilePath = this.normalizeEnvSecret(process.env.PULSEEM_API_KEY_FILE);
    let apiKey = this.readPulseemApiKeyFromOptionalFile(keyFilePath);
    let apiKeySource: 'file' | 'b64' | 'plain' = 'plain';

    if (apiKey.length >= 8) {
      apiKeySource = 'file';
    } else {
      const apiKeyB64Raw = this.normalizeEnvSecret(process.env.PULSEEM_API_KEY_B64);
      const apiKeyB64 = apiKeyB64Raw.replace(/\s+/g, '');
      const apiKeyPlain = this.normalizeEnvSecret(process.env.PULSEEM_API_KEY);
      apiKey = '';
      if (apiKeyB64.length > 0) {
        try {
          const decoded = Buffer.from(apiKeyB64, 'base64').toString('utf8').replace(/^\uFEFF/, '').trim();
          if (decoded.length >= 8) {
            apiKey = decoded;
            apiKeySource = 'b64';
          }
        } catch {
          apiKey = '';
        }
      }
      if (!apiKey) {
        apiKey = apiKeyPlain;
        apiKeySource = 'plain';
      }
    }
    const fromNumber = this.normalizeEnvSecret(process.env.PULSEEM_FROM_NUMBER);
    const sendId = this.normalizeEnvSecret(process.env.PULSEEM_SEND_ID);
    const isAsync = this.readBoolEnv('PULSEEM_IS_ASYNC', false);
    const cbkUrlRaw = this.normalizeEnvSecret(process.env.PULSEEM_CBK_URL);
    const cbkUrl = cbkUrlRaw.length > 0 ? cbkUrlRaw : undefined;

    if (!url) {
      throw new ServiceUnavailableException('PULSEEM_SMS_URL is not configured');
    }
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'PULSEEM_API_KEY_FILE, PULSEEM_API_KEY_B64, or PULSEEM_API_KEY is not configured / file missing',
      );
    }
    if (!fromNumber) {
      throw new ServiceUnavailableException('PULSEEM_FROM_NUMBER is not configured');
    }
    if (!sendId) {
      throw new ServiceUnavailableException('PULSEEM_SEND_ID is not configured');
    }

    return { url, apiKey, apiKeySource, fromNumber, sendId, isAsync, cbkUrl };
  }

  /**
   * Pulseem `toNumberList` (Swagger source of truth): digits only, no `+`.
   * - `+972…` → `972…`
   * - leading `0` (IL national) → `972…`
   * - 9-digit local → `972` + digits
   */
  private formatToPulseemDestination(e164: string): string {
    const digitsOnly = String(e164 || '').replace(/\D/g, '');
    if (!digitsOnly) return '';
    if (digitsOnly.startsWith('972')) return digitsOnly;
    if (digitsOnly.startsWith('0') && digitsOnly.length >= 9) {
      return `972${digitsOnly.slice(1)}`;
    }
    if (digitsOnly.length === 9) {
      return `972${digitsOnly}`;
    }
    return digitsOnly;
  }

  /** Match Swagger: omit optional fields instead of sending `null` / empty strings. */
  private buildPulseemSendSmsBody(
    cfg: ReturnType<SmsService['getPulseemConfig']>,
    params: { toNumberList0: string; body: string; otpRequestId: string },
  ): Record<string, unknown> {
    const smsSendData: Record<string, unknown> = {
      /** Swagger uses numeric sender string (e.g. `0526867838`); strip non-digits only. */
      fromNumber: cfg.fromNumber.replace(/\D/g, ''),
      toNumberList: [params.toNumberList0],
      referenceList: [params.otpRequestId],
      textList: [params.body],
      isAutomaticUnsubscribeLink: false,
    };
    const root: Record<string, unknown> = {
      sendId: cfg.sendId,
      isAsync: cfg.isAsync,
      smsSendData,
    };
    if (cfg.cbkUrl) {
      root.cbkUrl = cfg.cbkUrl;
    }
    return root;
  }

  private maskDestinationDigits(digits: string): string {
    const d = digits.replace(/\D/g, '');
    if (d.length <= 4) return '****';
    return `****${d.slice(-4)}`;
  }

  private logPulseemRuntimeMeta(
    cfg: ReturnType<SmsService['getPulseemConfig']>,
    toNumberList0: string,
  ): void {
    const destMasked = this.maskDestinationDigits(toNumberList0);
    try {
      const u = new URL(cfg.url);
      this.log.debug(
        `Pulseem runtime: urlHost=${u.host} path=${u.pathname} sendId=${cfg.sendId} apiKeySource=${cfg.apiKeySource} apiKeyConfigured=true fromNumberDigitsLen=${cfg.fromNumber.replace(/\D/g, '').length} destinationMasked=${destMasked} transport=https.request cwd=${process.cwd()}`,
      );
    } catch {
      this.log.debug(
        `Pulseem runtime: urlParseFailed sendId=${cfg.sendId} apiKeySource=${cfg.apiKeySource} apiKeyConfigured=true destinationMasked=${destMasked} cwd=${process.cwd()}`,
      );
    }
  }

  /** Native HTTPS POST with explicit Content-Length (closer to curl than fetch for this path). */
  private pulseemHttpsJsonPost(urlStr: string, apiKey: string, bodyStr: string): Promise<{ statusCode: number; raw: string }> {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      if (u.protocol !== 'https:') {
        reject(new Error(`Pulseem URL must use https:, got ${u.protocol}`));
        return;
      }
      const opts: https.RequestOptions = {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr, 'utf8'),
          /** OpenAPI `securitySchemes.APIKey.name` — only this header (duplicate X-Api-Key can break some hosts). */
          APIKey: apiKey,
        },
      };

      const req = https.request(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, raw: Buffer.concat(chunks).toString('utf8') });
        });
      });
      req.on('error', reject);
      req.write(bodyStr, 'utf8');
      req.end();
    });
  }

  private interpretPulseemResponse(
    statusCode: number,
    raw: string,
    cfg: ReturnType<SmsService['getPulseemConfig']>,
  ): OtpSmsSendResult {
    let parsed: { status?: unknown } | null = null;
    try {
      parsed = JSON.parse(raw) as { status?: unknown };
    } catch {
      parsed = null;
    }
    const bodyStatus =
      typeof parsed?.status === 'string' ? (parsed.status as string) : String(parsed?.status ?? '');
    const httpOk = statusCode >= 200 && statusCode < 300;

    if (!httpOk) {
      const msg = raw || `Pulseem SMS error: ${statusCode}`;
      const safeBody = msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
      this.log.error(`Pulseem SMS HTTP error: status=${statusCode} body=${safeBody}`);
      if (statusCode === 401 || statusCode === 403 || /invalid api key/i.test(msg)) {
        this.logPulseemApiKeyDiagnostics(cfg.apiKey, 'auth rejected');
      }
      return { status: 'failed', error: msg };
    }

    if (bodyStatus.toLowerCase() === 'success') {
      return { status: 'sent' };
    }
    if (bodyStatus.toLowerCase() === 'error') {
      const safeRaw = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
      this.log.error(`Pulseem SMS business error: body=${safeRaw}`);
      if (/invalid api key/i.test(raw)) {
        this.logPulseemApiKeyDiagnostics(cfg.apiKey, 'Pulseem status=Error (API key)');
      }
      return { status: 'failed', error: raw || 'Pulseem status=Error' };
    }

    this.log.warn(`Pulseem SMS unexpected 2xx body (no status=Success): body=${raw.slice(0, 500)}`);
    return { status: 'failed', error: 'Unexpected Pulseem response' };
  }

  /**
   * Sends transactional OTP SMS via Pulseem Direct Send API.
   * Swagger: POST /api/v1/SmsApi/SendSms with APIKey header and SmsSendInputModel body.
   */
  async sendLoginOtpSms(params: {
    delivery: 'sms_pulseem' | 'dev_log';
    e164Destination: string;
    body: string;
    otpRequestId: string;
  }): Promise<OtpSmsSendResult> {
    if (params.delivery === 'dev_log') {
      if (isAppProduction()) {
        this.log.error('[OTP dev_log] misconfiguration: dev_log provider must not run in production');
        return { status: 'failed', error: 'dev_log_disabled' };
      }
      this.log.warn(
        `[OTP dev_log] otpRequestId=${params.otpRequestId} to=${this.maskDestinationDigits(params.e164Destination)} body=${params.body}`,
      );
      return { status: 'skipped_dev' };
    }

    try {
      const cfg = this.getPulseemConfig();
      const toNumberList0 = this.formatToPulseemDestination(params.e164Destination);
      this.logPulseemRuntimeMeta(cfg, toNumberList0);

      const bodyJson = this.buildPulseemSendSmsBody(cfg, {
        toNumberList0,
        body: params.body,
        otpRequestId: params.otpRequestId,
      });
      const bodyStr = JSON.stringify(bodyJson);
      const { statusCode, raw } = await this.pulseemHttpsJsonPost(cfg.url, cfg.apiKey, bodyStr);
      return this.interpretPulseemResponse(statusCode, raw, cfg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error(`Pulseem SMS send failed: ${msg}`);
      return { status: 'failed', error: msg };
    }
  }
}
