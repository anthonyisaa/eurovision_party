'use server';

import { z } from 'zod';
import { supabaseService } from '@/lib/supabase-service';
import { getPartyId } from '@/lib/party-id';
import { POINTS_POOL } from '../vote/points-pool';

const RankingItemSchema = z.object({
  points: z.number().int().refine((p) => POINTS_POOL.includes(p as 12)),
  country_code: z.string().min(2).max(3),
});
const RankingSchema = z
  .array(RankingItemSchema)
  .length(10)
  .refine(
    (rows) => new Set(rows.map((r) => r.country_code)).size === 10,
    { message: 'Each country can only appear once' },
  )
  .refine(
    (rows) => new Set(rows.map((r) => r.points)).size === 10,
    { message: 'Each point value can only be used once' },
  );

/**
 * Locks in a guest's vote.
 *
 * Why delete-then-insert rather than upsert? Eurovision votes are a strict
 * permutation: each point value 1..12 appears at most once per guest. The
 * unique constraint (guest_id, points) means upserts would 50/50 hit conflict
 * on rearrangements. Wipe + re-insert is simpler and the table is tiny.
 *
 * RLS-bypass via service-role: same reasoning as predictions — friends party,
 * no real auth, but we re-check guest membership and own-country exclusion.
 */
export async function lockVotes(
  guestId: string,
  ranking: Array<{ points: number; country_code: string }>,
): Promise<ActionResult<true>> {
  const parsed = RankingSchema.safeParse(ranking);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid ranking',
    };
  }

  const partyId = getPartyId();
  const supabase = supabaseService();

  const { data: party, error: partyErr } = await supabase
    .from('parties')
    .select('phase')
    .eq('id', partyId)
    .single();
  if (partyErr || !party) {
    return { ok: false, error: 'Could not load party' };
  }
  if (party.phase !== 'voting') {
    return { ok: false, error: 'Voting is closed' };
  }

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
  for (const r of parsed.data) {
    if (own.has(r.country_code)) {
      return { ok: false, error: "Can't vote for your own country" };
    }
  }

  const { error: delErr } = await supabase
    .from('votes')
    .delete()
    .eq('guest_id', guestId);
  if (delErr) {
    return { ok: false, error: delErr.message };
  }

  const rows = parsed.data.map((r) => ({
    guest_id: guestId,
    country_code: r.country_code,
    points: r.points,
  }));
  const { error: insErr } = await supabase.from('votes').insert(rows);
  if (insErr) {
    return { ok: false, error: insErr.message };
  }
  return { ok: true, data: true };
}
