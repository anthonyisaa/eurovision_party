'use server';

import { z } from 'zod';
import { supabaseService } from '@/lib/supabase-service';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const PickSchema = z.object({
  betId: z.string().uuid(),
  guestId: z.string().uuid(),
  pick: z.string().min(1).max(120),
});

/**
 * Upsert a guest's pick for one side bet. PK is (bet_id, guest_id) so a guest
 * can change their pick any time before the host resolves the bet. We don't
 * gate on a phase here — let people backfill picks until the bet's resolved.
 */
export async function submitSideBetPick(
  betId: string,
  guestId: string,
  pick: string,
): Promise<ActionResult<true>> {
  const parsed = PickSchema.safeParse({ betId, guestId, pick });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid pick',
    };
  }

  const supabase = supabaseService();
  const { error } = await supabase.from('side_bet_picks').upsert(
    {
      bet_id: parsed.data.betId,
      guest_id: parsed.data.guestId,
      pick: parsed.data.pick,
    },
    { onConflict: 'bet_id,guest_id' },
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, data: true };
}
