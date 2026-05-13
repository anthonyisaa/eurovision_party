// Pure event derivation. No React, no Supabase — kept dependency-free so /live
// (phone) and /tv (Electron overlay) share identical "what's playing right now"
// logic, and so the unit tests run fast.
//
// Three sources-of-truth, in priority order:
//   1. manual_event_idx — host explicitly forced an event
//   2. fake_broadcast   — admin sim, time-since-start drives seconds
//   3. yt_current_seconds — real Electron / YouTube tick
//
// "paused" is independent of source and surfaced verbatim so the UI can show a
// pause pill regardless of how we picked the event.

import type { Database } from '@eurojury/db/types';
import type { CurrentEvent, EventCategory } from './index';

type Party = Database['public']['Tables']['parties']['Row'];
type EventTimelineRow = Database['public']['Tables']['event_timeline']['Row'];

export interface DeriveEventInput {
  party: Pick<
    Party,
    | 'yt_current_seconds'
    | 'manual_event_idx'
    | 'party_paused'
    | 'fake_broadcast'
    | 'fake_broadcast_started_at'
  >;
  timeline: ReadonlyArray<EventTimelineRow>;
  /** "now" in ms epoch — only used when fake_broadcast is on. Default Date.now(). */
  nowMs?: number;
}

export interface DeriveEventOutput {
  current: CurrentEvent | null;
  effectiveSeconds: number;
  effectivePaused: boolean;
  sourceOfTruth: 'manual' | 'fake_broadcast' | 'youtube' | 'none';
}

function toCurrentEvent(row: EventTimelineRow): CurrentEvent {
  return {
    idx: row.idx,
    category: row.category as EventCategory,
    description: row.description,
    countryCode: row.country_code,
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
    songIdx: row.song_idx,
  };
}

/**
 * Find the latest row whose start_seconds <= effectiveSeconds and whose
 * end_seconds (or implicit next-row boundary) is still ahead of effectiveSeconds.
 * Sorts defensively — don't trust input order.
 */
function findRowForSeconds(
  timeline: ReadonlyArray<EventTimelineRow>,
  effectiveSeconds: number,
): EventTimelineRow | null {
  if (timeline.length === 0) return null;
  const sorted = [...timeline].sort(
    (a, b) => a.start_seconds - b.start_seconds,
  );
  let match: EventTimelineRow | null = null;
  for (let i = 0; i < sorted.length; i += 1) {
    const r = sorted[i]!;
    if (r.start_seconds > effectiveSeconds) break;
    const explicitEnd = r.end_seconds;
    const next = sorted[i + 1];
    const implicitEnd =
      explicitEnd ?? next?.start_seconds ?? Number.POSITIVE_INFINITY;
    if (effectiveSeconds < implicitEnd) {
      match = r;
    }
  }
  return match;
}

export function deriveEvent(input: DeriveEventInput): DeriveEventOutput {
  const { party, timeline } = input;
  const nowMs = input.nowMs ?? Date.now();
  const effectivePaused = party.party_paused === true;

  // Empty timeline — nothing we can do regardless of source.
  if (timeline.length === 0) {
    return {
      current: null,
      effectiveSeconds: 0,
      effectivePaused,
      sourceOfTruth: 'none',
    };
  }

  // 1. Manual override wins outright.
  if (party.manual_event_idx != null) {
    const row = timeline.find((r) => r.idx === party.manual_event_idx) ?? null;
    return {
      current: row ? toCurrentEvent(row) : null,
      effectiveSeconds: row?.start_seconds ?? 0,
      effectivePaused,
      sourceOfTruth: 'manual',
    };
  }

  // 2. Fake broadcast — synthesize seconds from wall clock.
  if (party.fake_broadcast === true && party.fake_broadcast_started_at) {
    const started = Date.parse(party.fake_broadcast_started_at);
    const effectiveSeconds = Number.isFinite(started)
      ? Math.max(0, (nowMs - started) / 1000)
      : 0;
    const row = findRowForSeconds(timeline, effectiveSeconds);
    return {
      current: row ? toCurrentEvent(row) : null,
      effectiveSeconds,
      effectivePaused,
      sourceOfTruth: 'fake_broadcast',
    };
  }

  // 3. YouTube — real Electron tick (or 0 if not yet started).
  const effectiveSeconds = party.yt_current_seconds ?? 0;
  const row = findRowForSeconds(timeline, effectiveSeconds);
  return {
    current: row ? toCurrentEvent(row) : null,
    effectiveSeconds,
    effectivePaused,
    sourceOfTruth: 'youtube',
  };
}
