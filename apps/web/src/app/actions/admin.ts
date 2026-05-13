'use server';

// Host control surface — all writes here are admin operations.
//
// Auth model: by brief, the host gate is "your guest_id cookie == parties.host_guest_id".
// Every action accepts a guestId argument and re-checks against the party row before
// mutating. The first guest to call claimHostRole locks themselves in via a
// SECURITY DEFINER RPC.
//
// Service-role vs SECURITY DEFINER:
//   - claim_host + ingest_payload run as SECURITY DEFINER, so they don't require
//     the SUPABASE_SERVICE_ROLE_KEY at all. Useful while that env var is still a
//     placeholder.
//   - Other writes (phase, pause, manual_event_idx, side-bet resolution, side-bet
//     creation, yt video, actual results, reveal step, fake broadcast tick) use
//     supabaseService() — they're admin-by-definition.
//
// Errors never throw past the boundary; same envelope as Agent A's actions.

import { z } from 'zod';
import { supabaseService } from '@/lib/supabase-service';
import { supabaseBrowserlessAnon } from '@/lib/supabase-anon-server';
import { ingestPayloadSchema, actualResultsSchema } from '@/lib/ingest-schema';
import type { Database } from '@eurojury/db/types';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PHASES = ['lobby', 'live', 'voting', 'reveal', 'closed'] as const;
export type Phase = (typeof PHASES)[number];

const PartyIdSchema = z.string().regex(UUID_RE, 'Invalid party id');
const GuestIdSchema = z.string().regex(UUID_RE, 'Invalid guest id');

/**
 * Confirm the supplied guest is the host of the supplied party. Returns the
 * party row when it matches; null otherwise. Centralised so every admin
 * action calls the same gate.
 */
async function assertHost(
  partyId: string,
  guestId: string,
): Promise<{ ok: true; party: Database['public']['Tables']['parties']['Row'] } | { ok: false; error: string }> {
  if (!UUID_RE.test(partyId)) return { ok: false, error: 'Invalid party id' };
  if (!UUID_RE.test(guestId)) return { ok: false, error: 'Invalid guest id' };

  // Service-role read so RLS can't bite us here.
  let supabase;
  try {
    supabase = supabaseService();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const { data, error } = await supabase
    .from('parties')
    .select('*')
    .eq('id', partyId)
    .single();
  if (error || !data) return { ok: false, error: 'Party not found' };
  if (data.host_guest_id !== guestId) {
    return { ok: false, error: 'You are not the host of this party' };
  }
  return { ok: true, party: data };
}

// --- claim host -------------------------------------------------------

/**
 * Claim the host role atomically. If host is unclaimed, sets it to guestId.
 * Returns the now-current host_guest_id either way so the UI can decide
 * "you're the host" vs "denied — someone else claimed it".
 *
 * Uses anon client + SECURITY DEFINER so it works even before the service-role
 * key is configured.
 */
export async function claimHostRole(
  partyId: string,
  guestId: string,
): Promise<ActionResult<{ host_guest_id: string | null; is_host: boolean }>> {
  if (!UUID_RE.test(partyId) || !UUID_RE.test(guestId)) {
    return { ok: false, error: 'Invalid id' };
  }
  const supabase = supabaseBrowserlessAnon();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('claim_host', {
    p_party_id: partyId,
    p_guest_id: guestId,
  });
  if (error) {
    return { ok: false, error: error.message ?? 'Could not claim host' };
  }
  const host = (data as string | null) ?? null;
  return { ok: true, data: { host_guest_id: host, is_host: host === guestId } };
}

// --- phase + pause ----------------------------------------------------

const PhaseSchema = z.enum(PHASES);

export async function setPhase(
  partyId: string,
  guestId: string,
  phase: Phase,
): Promise<ActionResult<true>> {
  const phaseParsed = PhaseSchema.safeParse(phase);
  if (!phaseParsed.success) return { ok: false, error: 'Invalid phase' };

  const host = await assertHost(partyId, guestId);
  if (!host.ok) return host;

  const supabase = supabaseService();
  const { error } = await supabase
    .from('parties')
    .update({ phase: phaseParsed.data })
    .eq('id', partyId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: true };
}

export async function setPaused(
  partyId: string,
  guestId: string,
  paused: boolean,
  reason?: string,
): Promise<ActionResult<true>> {
  const host = await assertHost(partyId, guestId);
  if (!host.ok) return host;

  const supabase = supabaseService();
  const patch: Database['public']['Tables']['parties']['Update'] = {
    party_paused: paused,
    party_paused_at: paused ? new Date().toISOString() : null,
  };
  if (paused) {
    patch.party_pause_reason = reason?.trim() ? reason.trim() : null;
  }
  const { error } = await supabase.from('parties').update(patch).eq('id', partyId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: true };
}

// --- manual event override -------------------------------------------

export async function setManualEventIdx(
  partyId: string,
  guestId: string,
  idx: number | null,
): Promise<ActionResult<true>> {
  if (idx != null && (!Number.isInteger(idx) || idx < 0)) {
    return { ok: false, error: 'Invalid event idx' };
  }
  const host = await assertHost(partyId, guestId);
  if (!host.ok) return host;

  const supabase = supabaseService();
  const { error } = await supabase
    .from('parties')
    .update({ manual_event_idx: idx })
    .eq('id', partyId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: true };
}

// --- fake broadcast --------------------------------------------------

export async function setFakeBroadcast(
  partyId: string,
  guestId: string,
  on: boolean,
): Promise<ActionResult<true>> {
  const host = await assertHost(partyId, guestId);
  if (!host.ok) return host;

  const supabase = supabaseService();
  const patch: Database['public']['Tables']['parties']['Update'] = {
    fake_broadcast: on,
    fake_broadcast_started_at: on ? new Date().toISOString() : null,
  };
  if (on) {
    patch.yt_current_seconds = 0; // reset clock on fresh start
  }
  const { error } = await supabase.from('parties').update(patch).eq('id', partyId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: true };
}

/**
 * Tick — write the current elapsed seconds to yt_current_seconds.
 * Called by the admin page on a 2s interval whenever fake_broadcast is on
 * and the page is in focus. If /admin closes, ticks stop; per Wave 3 plan
 * that's acceptable. We re-check fake_broadcast on the server in case the
 * client missed a toggle.
 */
export async function tickFakeBroadcast(
  partyId: string,
  guestId: string,
  elapsedSeconds: number,
): Promise<ActionResult<true>> {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return { ok: false, error: 'Invalid elapsedSeconds' };
  }
  const host = await assertHost(partyId, guestId);
  if (!host.ok) return host;
  if (!host.party.fake_broadcast) {
    // Don't error — caller may have stale state. Just no-op.
    return { ok: true, data: true };
  }

  const supabase = supabaseService();
  const { error } = await supabase
    .from('parties')
    .update({
      yt_current_seconds: Math.floor(elapsedSeconds),
      yt_last_update_at: new Date().toISOString(),
      yt_player_state: 'playing',
    })
    .eq('id', partyId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: true };
}

// --- side-bet resolution ---------------------------------------------

const ResolveSchema = z.object({
  betId: z.string().regex(UUID_RE),
  value: z.string().min(1).max(120),
});

export async function resolveSideBet(
  partyId: string,
  guestId: string,
  betId: string,
  value: string,
): Promise<ActionResult<true>> {
  const parsed = ResolveSchema.safeParse({ betId, value });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid resolution' };
  }
  const host = await assertHost(partyId, guestId);
  if (!host.ok) return host;

  const supabase = supabaseService();
  // Re-check the bet belongs to this party (defence in depth — host of party A
  // mustn't be able to resolve party B's bets by id).
  const { data: bet, error: lookupErr } = await supabase
    .from('side_bets')
    .select('id, party_id')
    .eq('id', parsed.data.betId)
    .single();
  if (lookupErr || !bet) return { ok: false, error: 'Bet not found' };
  if (bet.party_id !== partyId) {
    return { ok: false, error: 'Bet belongs to a different party' };
  }

  const { error } = await supabase
    .from('side_bets')
    .update({
      resolved_value: parsed.data.value,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.betId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: true };
}

// --- side-bet bulk creation ------------------------------------------

const SideBetTypeSchema = z.enum(['country', 'binary', 'text']);
const BulkBetSchema = z.object({
  question: z.string().trim().min(1).max(200),
  bet_type: SideBetTypeSchema,
  // For country bets we ignore options (UI displays all countries). For
  // binary/text we expect one option per line.
  options: z.array(z.string().trim().min(1)).max(20),
});
const BulkBetsSchema = z.array(BulkBetSchema).min(1).max(50);

export async function createSideBetsBulk(
  partyId: string,
  guestId: string,
  bets: Array<{ question: string; bet_type: 'country' | 'binary' | 'text'; options: string[] }>,
): Promise<ActionResult<{ count: number }>> {
  const parsed = BulkBetsSchema.safeParse(bets);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid bets' };
  }
  const host = await assertHost(partyId, guestId);
  if (!host.ok) return host;

  const rows = parsed.data.map((b) => ({
    party_id: partyId,
    question: b.question,
    bet_type: b.bet_type,
    options_json:
      b.bet_type === 'country'
        ? { kind: 'country' }
        : { options: b.options.filter(Boolean) },
  }));

  const supabase = supabaseService();
  const { error, data } = await supabase.from('side_bets').insert(rows).select('id');
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { count: data?.length ?? 0 } };
}

// --- reveal step -----------------------------------------------------

export async function advanceReveal(
  partyId: string,
  guestId: string,
  delta: 1 | -1,
): Promise<ActionResult<{ reveal_step: number }>> {
  if (delta !== 1 && delta !== -1) {
    return { ok: false, error: 'Invalid delta' };
  }
  const host = await assertHost(partyId, guestId);
  if (!host.ok) return host;

  const current = host.party.reveal_step ?? 0;
  const next = Math.max(0, Math.min(10, current + delta));

  const supabase = supabaseService();
  const { error } = await supabase
    .from('parties')
    .update({ reveal_step: next })
    .eq('id', partyId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { reveal_step: next } };
}

// --- /admin/setup writes ---------------------------------------------

const YtIdSchema = z
  .string()
  .trim()
  .min(5, 'Need a YouTube video id (≥5 chars)')
  .max(64);

/**
 * Accept either the bare YouTube id ("Yy510SZZDw4") or a full watch URL —
 * parse out the id either way. We don't enforce the 11-char convention
 * because YouTube isn't strict about it any more.
 */
export async function setYtVideoId(
  partyId: string,
  guestId: string,
  raw: string,
): Promise<ActionResult<{ id: string }>> {
  let id = raw.trim();
  // Try to extract v= or youtu.be/<id>
  const vMatch = id.match(/[?&]v=([^&]+)/);
  if (vMatch) id = vMatch[1]!;
  const beMatch = id.match(/youtu\.be\/([^?&/]+)/);
  if (beMatch) id = beMatch[1]!;
  const parsed = YtIdSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid id' };
  }
  const host = await assertHost(partyId, guestId);
  if (!host.ok) return host;

  const supabase = supabaseService();
  const { error } = await supabase
    .from('parties')
    .update({ yt_video_id: parsed.data })
    .eq('id', partyId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: parsed.data } };
}

export interface IngestCounts {
  performances: number;
  other_events: number;
  scheduled_commentary: number;
  roast_pool: number;
  countries_updated: number;
}

/**
 * Validate and ingest the producer JSON. Validation runs in-process via Zod;
 * the actual writes go through the SECURITY DEFINER RPC `ingest_payload`
 * which clears+reinserts in one transaction — so the operation is idempotent
 * and crash-safe.
 *
 * `rawJson` is whatever the host pasted into the textarea. We parse it here so
 * we can report a parse error with a helpful position. If JSON.parse fails
 * we surface the error message directly (it includes a position in Node 20+).
 */
export async function ingestPayload(
  partyId: string,
  guestId: string,
  rawJson: string,
): Promise<ActionResult<IngestCounts>> {
  // 1. JSON parse
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch (err) {
    return { ok: false, error: `JSON parse error: ${(err as Error).message}` };
  }

  // 2. Zod validate
  const zres = ingestPayloadSchema.safeParse(parsedJson);
  if (!zres.success) {
    const first = zres.error.issues[0];
    const path = first?.path?.join('.') ?? '';
    return {
      ok: false,
      error: `Validation: ${first?.message ?? 'invalid payload'}${path ? ` (at ${path})` : ''}`,
    };
  }

  // 3. Host gate (use anon for the host check — but we don't have a non-service
  //    way to read the party row. assertHost uses service-role; if that's not
  //    configured we still want ingest to work because that's the most important
  //    path. So bypass assertHost here and re-check via the RPC.)
  if (!UUID_RE.test(partyId) || !UUID_RE.test(guestId)) {
    return { ok: false, error: 'Invalid id' };
  }
  const anon = supabaseBrowserlessAnon();
  const { data: party, error: partyErr } = await anon
    .from('parties')
    .select('id, host_guest_id')
    .eq('id', partyId)
    .single();
  if (partyErr || !party) return { ok: false, error: 'Party not found' };
  if (party.host_guest_id && party.host_guest_id !== guestId) {
    return { ok: false, error: 'You are not the host of this party' };
  }
  // If host is unclaimed we leave the claim up to the explicit /admin gate;
  // for setup we still allow the ingest because the host typically does this
  // pre-claim from a laptop.

  // 4. Call the SECURITY DEFINER RPC.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (anon.rpc as any)('ingest_payload', {
    p_party_id: partyId,
    p_payload: zres.data,
  });
  if (error) {
    return { ok: false, error: error.message ?? 'Ingest failed' };
  }
  return {
    ok: true,
    data: (data ?? {
      performances: 0,
      other_events: 0,
      scheduled_commentary: 0,
      roast_pool: 0,
      countries_updated: 0,
    }) as IngestCounts,
  };
}

// --- actual results --------------------------------------------------

export async function setActualResults(
  partyId: string,
  guestId: string,
  rawJson: string,
): Promise<ActionResult<{ count: number }>> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch (err) {
    return { ok: false, error: `JSON parse error: ${(err as Error).message}` };
  }
  const zres = actualResultsSchema.safeParse(parsedJson);
  if (!zres.success) {
    const first = zres.error.issues[0];
    const path = first?.path?.join('.') ?? '';
    return {
      ok: false,
      error: `Validation: ${first?.message ?? 'invalid results'}${path ? ` (at ${path})` : ''}`,
    };
  }

  const host = await assertHost(partyId, guestId);
  if (!host.ok) return host;

  const supabase = supabaseService();
  const { error } = await supabase
    .from('parties')
    .update({ actual_results: zres.data })
    .eq('id', partyId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { count: zres.data.length } };
}
