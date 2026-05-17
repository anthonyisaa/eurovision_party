'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { supabaseBrowserlessAnon } from '@/lib/supabase-anon-server';
import { GUEST_ID_COOKIE } from '@/lib/guest-id';
import { getPartyId } from '@/lib/party-id';
import type { Database } from '@eurojury/db/types';

type Guest = Database['public']['Tables']['guests']['Row'];

// Server action result envelope — never throw past the boundary.
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, 'Pick a name')
  .max(40, 'Keep it under 40 characters');

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * `joinParty` is the single entry point for /. It's idempotent against the
 * (party_id, guest_id) cookie pair so refreshes don't burn country slots.
 *
 * Race-safety lives inside the Postgres function `assign_guest` — see
 * packages/db/migrations/0004_join_function.sql. We deliberately call it via
 * the anon client (the function is SECURITY DEFINER), which means joins work
 * even before the service-role key is configured.
 */
export async function joinParty(
  displayName: string,
): Promise<ActionResult<Guest>> {
  const parsed = DisplayNameSchema.safeParse(displayName);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid name' };
  }

  const cookieStore = await cookies();
  let guestId = cookieStore.get(GUEST_ID_COOKIE)?.value ?? null;

  // Defensive: middleware sets this cookie, but if something weird is in
  // there reissue a fresh UUID and update the cookie on this response.
  if (!guestId || !UUID_RE.test(guestId)) {
    guestId = crypto.randomUUID();
    cookieStore.set({
      name: GUEST_ID_COOKIE,
      value: guestId,
      httpOnly: false,
      sameSite: 'lax',
      maxAge: ONE_YEAR_SECONDS,
      path: '/',
    });
  }

  const partyId = getPartyId();
  const supabase = supabaseBrowserlessAnon();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('assign_guest', {
    p_party_id: partyId,
    p_guest_id: guestId,
    p_display: parsed.data,
  });

  if (error) {
    // Postgres raises with SQLSTATE 22023 + message 'PARTY_FULL' when fewer
    // than 2 countries remain unassigned, or 'LINEUP_NOT_LOADED' before the
    // producer has ingested the Gemini final.
    if (error.message?.includes('LINEUP_NOT_LOADED')) {
      return {
        ok: false,
        error: 'Lineup not loaded yet — hang tight, the producer is setting up.',
      };
    }
    if (error.message?.includes('PARTY_FULL')) {
      return { ok: false, error: 'Party is full — every country is claimed.' };
    }
    return {
      ok: false,
      error: error.message ?? 'Could not join the party.',
    };
  }

  // The function returns the guests row — Supabase wraps it as a single object
  // (or null when nothing returned). Normalise either shape.
  const guest = (Array.isArray(data) ? data[0] : data) as Guest | null;
  if (!guest) {
    return { ok: false, error: 'Server returned no guest row.' };
  }

  return { ok: true, data: guest };
}
