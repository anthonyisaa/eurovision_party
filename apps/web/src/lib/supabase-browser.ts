'use client';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@eurojury/db/types';

// We use @supabase/supabase-js's createClient directly rather than
// @supabase/ssr's createBrowserClient because the latter (v0.5.x) imports
// GenericSchema from a path that no longer exists in supabase-js v2.105+,
// which collapses every row inference to `never`. We don't actually need
// Supabase Auth cookies here — there's no logged-in user, and our own
// guest_id cookie is set by middleware.
export const supabaseBrowser = () =>
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
