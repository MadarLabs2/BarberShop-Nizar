import { Global, Injectable, Module } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isAppProduction } from './production-env';

function assertNonPlaceholderUrl(url: string): void {
  if (!url || /placeholder\.supabase\.co/i.test(url)) {
    throw new Error('SUPABASE_URL must be set to a real project URL (not a placeholder).');
  }
}

@Injectable()
export class SupabaseService {
  private client: SupabaseClient;

  constructor() {
    const urlRaw = process.env.SUPABASE_URL?.trim() || '';
    const serviceRaw = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
    const anonRaw = process.env.SUPABASE_ANON_KEY?.trim() || '';

    if (isAppProduction()) {
      if (!urlRaw || !serviceRaw) {
        throw new Error(
          'Production requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role only; anon key is not a substitute).',
        );
      }
      assertNonPlaceholderUrl(urlRaw);
      if (serviceRaw.length < 32) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY appears invalid (too short).');
      }
      this.client = createClient(urlRaw, serviceRaw);
      return;
    }

    const url = urlRaw || 'https://placeholder.supabase.co';
    const serviceKey = serviceRaw || anonRaw || 'placeholder';
    this.client = createClient(url, serviceKey);
  }

  getClient(): SupabaseClient {
    return this.client;
  }
}

@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class CoreModule {}
