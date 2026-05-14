import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@eurojury/db/types';

/**
 * Server-side Supabase client used by server actions.
 *
 * Originally intended to use the service-role key to bypass RLS. After the
 * 0008_anon_writes migration opened permissive write policies for the anon
 * role (the friends-of-friends party threat model), we use the anon key
 * here too. Kept as a separate `supabaseService()` export so the call sites
 * don't need to change and so we can swap back to service-role later by
 * setting SUPABASE_SERVICE_ROLE_KEY in env — the code prefers it if present.
 *
 * IMPORTANT: only import from server modules (server-only enforces this).
 */
let cached: SupabaseClient<Database> | null = null;

export const supabaseService = (): SupabaseClient<Database> => {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'supabaseService: missing NEXT_PUBLIC_SUPABASE_URL or a key (SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    );
  }
  cached = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
};
