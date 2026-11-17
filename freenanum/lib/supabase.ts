import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isConfigured = Boolean(url && anonKey);

let browserClient: SupabaseClient | null = null;

/** Browser client. The session lives in this device's storage. */
export function supabase(): SupabaseClient {
  if (!isConfigured) {
    throw new Error('NOT_CONFIGURED');
  }
  if (!browserClient) {
    browserClient = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  }
  return browserClient;
}

/** Server-side anonymous client (public data only, e.g. share-card metadata). */
export function serverAnonClient(): SupabaseClient | null {
  if (!isConfigured) return null;
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
