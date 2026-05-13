import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@eurojury/db/types';

/**
 * Anon-key Supabase client suitable for server-side RPC calls that don't need
 * any per-user session. We use this for `assign_guest`, which is a
 * SECURITY DEFINER Postgres function with EXECUTE granted to anon — so the
 * function performs the privileged work, but we don't ship the service-role
 * key over the wire.
 *
 * Distinct from supabase-server.ts (which is cookie-aware via @supabase/ssr)
 * because that client tries to mutate cookies, which we don't want from a
 * server action that runs after the response headers are constructed.
 */
let cached: SupabaseClient<Database> | null = null;

export const supabaseBrowserlessAnon = (): SupabaseClient<Database> => {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'supabaseBrowserlessAnon: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
  }
  cached = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
};
