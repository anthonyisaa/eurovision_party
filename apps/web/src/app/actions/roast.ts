'use server';

import { z } from 'zod';
import { supabaseService } from '@/lib/supabase-service';

export type ActionResult<T> =
  | { ok: true; data: { content: string; speaker: string } }
  | { ok: false; error: string };

const RoastSchema = z.object({
  partyId: z.string().uuid(),
  eventIdx: z.number().int().nonnegative(),
  guestId: z.string().uuid(),
});

/**
 * Atomically claim an unconsumed roast for the current event.
 *
 * Concurrency model: we issue an UPDATE ... RETURNING * with the condition
 * `fired = false` AND `id = <first candidate>`. If two phones race, only
 * one UPDATE flips the row; the other returns zero rows and we retry with
 * the next candidate. Friends-party scale (≤10 guests) means a tiny retry
 * loop is fine — no need for advisory locks.
 *
 * Per the brief: this never displays on the phone. It only inserts a
 * chat_messages row, which the /tv route subscribes to.
 *
 * Agent C will refactor this into a shared lib later; this implementation
 * is intentionally simple and self-contained.
 */
export async function triggerRoast(
  partyId: string,
  eventIdx: number,
  guestId: string,
): Promise<ActionResult<{ content: string; speaker: string }>> {
  const parsed = RoastSchema.safeParse({ partyId, eventIdx, guestId });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid roast trigger',
    };
  }

  const supabase = supabaseService();

  // Try up to 5 candidates — by then the pool is realistically exhausted.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: candidates, error: selErr } = await supabase
      .from('scheduled_commentary')
      .select('id, content, speaker')
      .eq('party_id', parsed.data.partyId)
      .eq('event_idx', parsed.data.eventIdx)
      .eq('category', 'roast')
      .eq('fired', false)
      .limit(1);
    if (selErr) {
      return { ok: false, error: selErr.message };
    }
    if (!candidates || candidates.length === 0) {
      // Fallback line per the plan when the pool is exhausted.
      const generic = 'Nala and Evee are speechless 🐱';
      const { error: chatErr } = await supabase.from('chat_messages').insert({
        party_id: parsed.data.partyId,
        guest_id: parsed.data.guestId,
        is_commentator: true,
        speaker: 'nala',
        content: generic,
        event_idx_at_post: parsed.data.eventIdx,
      });
      if (chatErr) return { ok: false, error: chatErr.message };
      return { ok: true, data: { content: generic, speaker: 'nala' } };
    }

    const cand = candidates[0]!;
    const { data: claimed, error: updErr } = await supabase
      .from('scheduled_commentary')
      .update({ fired: true, fired_at: new Date().toISOString() })
      .eq('id', cand.id)
      .eq('fired', false)
      .select('id, content, speaker')
      .maybeSingle();
    if (updErr) {
      return { ok: false, error: updErr.message };
    }
    if (!claimed) {
      // Someone else claimed it between our SELECT and UPDATE. Retry.
      continue;
    }

    const { error: chatErr } = await supabase.from('chat_messages').insert({
      party_id: parsed.data.partyId,
      guest_id: parsed.data.guestId,
      is_commentator: true,
      speaker: claimed.speaker,
      content: claimed.content,
      event_idx_at_post: parsed.data.eventIdx,
    });
    if (chatErr) return { ok: false, error: chatErr.message };

    return {
      ok: true,
      data: { content: claimed.content, speaker: claimed.speaker },
    };
  }

  return { ok: false, error: 'Could not claim a roast — try again.' };
}
