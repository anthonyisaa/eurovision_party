'use server';

import { z } from 'zod';
import { supabaseService } from '@/lib/supabase-service';

export type ReactionKind = 'roast' | 'celebrate';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const ReactionSchema = z.object({
  partyId: z.string().uuid(),
  eventIdx: z.number().int().nonnegative(),
  guestId: z.string().uuid(),
  kind: z.enum(['roast', 'celebrate']),
});

const FALLBACK_BY_KIND: Record<ReactionKind, string> = {
  roast: 'Nala and Evee are speechless 🐱',
  celebrate: "Nala and Evee are on their feet 🎉",
};

/**
 * Atomically claim an unconsumed reaction line (roast or celebrate) for the
 * current event. Concurrency: SELECT + UPDATE ... WHERE fired=false; if two
 * phones race the second retries with the next candidate.
 *
 * Inserts into chat_messages so /tv renders the bubble; never displays on
 * the phone that triggered it (phones are dumb).
 */
export async function triggerReaction(
  partyId: string,
  eventIdx: number,
  guestId: string,
  kind: ReactionKind,
): Promise<ActionResult<{ content: string; speaker: string; kind: ReactionKind }>> {
  const parsed = ReactionSchema.safeParse({ partyId, eventIdx, guestId, kind });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid reaction trigger',
    };
  }

  const supabase = supabaseService();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: candidates, error: selErr } = await supabase
      .from('scheduled_commentary')
      .select('id, content, speaker')
      .eq('party_id', parsed.data.partyId)
      .eq('event_idx', parsed.data.eventIdx)
      .eq('category', parsed.data.kind)
      .eq('fired', false)
      .limit(1);
    if (selErr) {
      return { ok: false, error: selErr.message };
    }
    if (!candidates || candidates.length === 0) {
      const generic = FALLBACK_BY_KIND[parsed.data.kind];
      const { error: chatErr } = await supabase.from('chat_messages').insert({
        party_id: parsed.data.partyId,
        guest_id: parsed.data.guestId,
        is_commentator: true,
        speaker: 'nala',
        content: generic,
        event_idx_at_post: parsed.data.eventIdx,
        kind: parsed.data.kind,
      });
      if (chatErr) return { ok: false, error: chatErr.message };
      return { ok: true, data: { content: generic, speaker: 'nala', kind: parsed.data.kind } };
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
      continue;
    }

    const { error: chatErr } = await supabase.from('chat_messages').insert({
      party_id: parsed.data.partyId,
      guest_id: parsed.data.guestId,
      is_commentator: true,
      speaker: claimed.speaker,
      content: claimed.content,
      event_idx_at_post: parsed.data.eventIdx,
      kind: parsed.data.kind,
    });
    if (chatErr) return { ok: false, error: chatErr.message };

    return {
      ok: true,
      data: { content: claimed.content, speaker: claimed.speaker, kind: parsed.data.kind },
    };
  }

  return { ok: false, error: `Could not claim a ${kind} — try again.` };
}

/** Back-compat shim: previous callers (and any cached client bundles) used triggerRoast. */
export async function triggerRoast(
  partyId: string,
  eventIdx: number,
  guestId: string,
): Promise<ActionResult<{ content: string; speaker: string; kind: ReactionKind }>> {
  return triggerReaction(partyId, eventIdx, guestId, 'roast');
}
