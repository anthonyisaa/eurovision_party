'use server';

import { z } from 'zod';
import { supabaseService } from '@/lib/supabase-service';
import { getPartyId } from '@/lib/party-id';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const PicksSchema = z
  .object({
    1: z.string().min(2),
    2: z.string().min(2),
    3: z.string().min(2),
  })
  .refine(
    (picks) =>
      new Set([picks[1], picks[2], picks[3]]).size === 3,
    { message: 'Pick three distinct countries' },
  );

/**
 * Replaces a guest's existing 3 prediction rows with the supplied top-3.
 * Locks once the party advances past lobby phase. We re-check ownership of
 * the assigned countries server-side so a tampered client can't pick its own.
 *
 * Uses service-role: predictions are written cross-cutting and the cookie
 * doesn't carry the kind of auth Supabase RLS expects. The action verifies
 * the guest exists before any write so this isn't a wide-open hole.
 */
export async function submitPredictions(
  guestId: string,
  picks: { 1: string; 2: string; 3: string },
): Promise<ActionResult<true>> {
  const parsed = PicksSchema.safeParse(picks);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid picks' };
  }

  const partyId = getPartyId();
  const supabase = supabaseService();

  // Lock guard — refuse if the party has moved past lobby.
  const { data: party, error: partyErr } = await supabase
    .from('parties')
    .select('phase')
    .eq('id', partyId)
    .single();
  if (partyErr || !party) {
    return { ok: false, error: 'Could not load party' };
  }
  if (party.phase !== 'lobby') {
    return { ok: false, error: 'Predictions are locked' };
  }

  // Verify guest exists in this party & not picking own country.
  const { data: guest, error: guestErr } = await supabase
    .from('guests')
    .select('id, assigned_country_1, assigned_country_2')
    .eq('id', guestId)
    .eq('party_id', partyId)
    .single();
  if (guestErr || !guest) {
    return { ok: false, error: 'Join the party first' };
  }
  const own = new Set(
    [guest.assigned_country_1, guest.assigned_country_2].filter(
      (x): x is string => Boolean(x),
    ),
  );
  for (const code of [parsed.data[1], parsed.data[2], parsed.data[3]]) {
    if (own.has(code)) {
      return { ok: false, error: "Can't predict your own country" };
    }
  }

  // Atomic replace: delete prior 3 rows then insert the new ones.
  const { error: delErr } = await supabase
    .from('predictions')
    .delete()
    .eq('guest_id', guestId);
  if (delErr) {
    return { ok: false, error: delErr.message };
  }

  const rows = [1, 2, 3].map((pos) => ({
    guest_id: guestId,
    position: pos,
    country_code: parsed.data[pos as 1 | 2 | 3],
  }));
  const { error: insErr } = await supabase.from('predictions').insert(rows);
  if (insErr) {
    return { ok: false, error: insErr.message };
  }

  return { ok: true, data: true };
}
