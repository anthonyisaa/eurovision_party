import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@eurojury/db/types';

/**
 * SERVICE-ROLE Supabase client. Bypasses RLS.
 *
 * IMPORTANT: only import this from server actions, route handlers, or other
 * server-only modules. Never from a `'use client'` component. The
 * `server-only` import above will fail the build if that happens.
 */
let cached: SupabaseClient<Database> | null = null;

export const supabaseService = (): SupabaseClient<Database> => {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'supabaseService: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  cached = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
};
