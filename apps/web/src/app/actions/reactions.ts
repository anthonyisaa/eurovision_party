'use server';

import { z } from 'zod';
import { supabaseService } from '@/lib/supabase-service';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const ReactionSchema = z.object({
  guestId: z.string().uuid(),
  countryCode: z.string().min(2).max(3),
  rating: z.number().int().min(1).max(5),
});

/**
 * Upsert a gut reaction. Primary key is (guest_id, country_code) so the
 * second tap just bumps the rating — exactly what we want when guests tap
 * twice during the 90s window.
 *
 * The 90s window check lives client-side because it's UX-driven; server
 * accepts whatever comes in. (Pre-empting a determined guest who curls the
 * action with the wrong country is out of scope for a friends party.)
 */
export async function submitReaction(
  guestId: string,
  countryCode: string,
  rating: number,
): Promise<ActionResult<true>> {
  const parsed = ReactionSchema.safeParse({ guestId, countryCode, rating });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid reaction',
    };
  }

  const supabase = supabaseService();
  const { error } = await supabase.from('reactions').upsert(
    {
      guest_id: parsed.data.guestId,
      country_code: parsed.data.countryCode,
      rating: parsed.data.rating,
    },
    { onConflict: 'guest_id,country_code' },
  );

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, data: true };
}
