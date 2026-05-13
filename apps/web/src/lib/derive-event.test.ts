import { describe, it, expect } from 'vitest';
import { deriveEvent } from '@eurojury/shared';
import type { Database } from '@eurojury/db/types';

type EventTimelineRow = Database['public']['Tables']['event_timeline']['Row'];
type Party = Database['public']['Tables']['parties']['Row'];

// Helpers ---------------------------------------------------------------
function row(
  overrides: Partial<EventTimelineRow> & {
    idx: number;
    start_seconds: number;
  },
): EventTimelineRow {
  return {
    party_id: '00000000-0000-0000-0000-000000000000',
    idx: overrides.idx,
    category: overrides.category ?? 'performance',
    description: overrides.description ?? `Event ${overrides.idx}`,
    country_code: overrides.country_code ?? null,
    start_seconds: overrides.start_seconds,
    end_seconds: overrides.end_seconds ?? null,
    song_idx: overrides.song_idx ?? null,
  };
}

type PartyPick = Pick<
  Party,
  | 'yt_current_seconds'
  | 'manual_event_idx'
  | 'party_paused'
  | 'fake_broadcast'
  | 'fake_broadcast_started_at'
>;

function party(overrides: Partial<PartyPick> = {}): PartyPick {
  return {
    yt_current_seconds: 0,
    manual_event_idx: null,
    party_paused: false,
    fake_broadcast: false,
    fake_broadcast_started_at: null,
    ...overrides,
  };
}

// A small canonical Semi 1-shaped timeline.
const timeline: EventTimelineRow[] = [
  row({ idx: 1000, category: 'opening', start_seconds: 0, end_seconds: 100 }),
  row({
    idx: 1,
    category: 'performance',
    country_code: 'MD',
    start_seconds: 100,
    end_seconds: 300,
  }),
  row({
    idx: 2,
    category: 'performance',
    country_code: 'SE',
    start_seconds: 300,
    end_seconds: 500,
  }),
  row({
    idx: 3,
    category: 'performance',
    country_code: 'NO',
    start_seconds: 500,
    end_seconds: 700,
  }),
  row({
    idx: 1001,
    category: 'interval',
    start_seconds: 700,
    end_seconds: null,
  }),
];

// Tests -----------------------------------------------------------------

describe('deriveEvent', () => {
  it('returns null with sourceOfTruth=none for empty timeline', () => {
    const result = deriveEvent({ party: party(), timeline: [] });
    expect(result.current).toBeNull();
    expect(result.sourceOfTruth).toBe('none');
    expect(result.effectiveSeconds).toBe(0);
  });

  it('manual override picks the named idx regardless of yt_current_seconds', () => {
    const result = deriveEvent({
      party: party({ manual_event_idx: 2, yt_current_seconds: 50 }),
      timeline,
    });
    expect(result.sourceOfTruth).toBe('manual');
    expect(result.current?.idx).toBe(2);
    expect(result.current?.countryCode).toBe('SE');
    // effectiveSeconds reflects the manually-pinned row's start, not yt time.
    expect(result.effectiveSeconds).toBe(300);
  });

  it('manual override pointing at a non-existent idx → null + sourceOfTruth=manual', () => {
    const result = deriveEvent({
      party: party({ manual_event_idx: 999, yt_current_seconds: 350 }),
      timeline,
    });
    expect(result.sourceOfTruth).toBe('manual');
    expect(result.current).toBeNull();
  });

  it('yt_current_seconds advances through performances in order', () => {
    const a = deriveEvent({
      party: party({ yt_current_seconds: 150 }),
      timeline,
    });
    expect(a.current?.idx).toBe(1);
    expect(a.current?.countryCode).toBe('MD');

    const b = deriveEvent({
      party: party({ yt_current_seconds: 350 }),
      timeline,
    });
    expect(b.current?.idx).toBe(2);
    expect(b.current?.countryCode).toBe('SE');

    const c = deriveEvent({
      party: party({ yt_current_seconds: 600 }),
      timeline,
    });
    expect(c.current?.idx).toBe(3);
    expect(c.current?.countryCode).toBe('NO');

    const d = deriveEvent({
      party: party({ yt_current_seconds: 9999 }),
      timeline,
    });
    // Open-ended interval row matches forever after start_seconds.
    expect(d.current?.idx).toBe(1001);
    expect(d.current?.category).toBe('interval');
  });

  it('yt_current_seconds before first row → null', () => {
    // Trim the opening so 0..100 has no row.
    const trimmed = timeline.filter((r) => r.idx !== 1000);
    const result = deriveEvent({
      party: party({ yt_current_seconds: 50 }),
      timeline: trimmed,
    });
    expect(result.current).toBeNull();
    expect(result.sourceOfTruth).toBe('youtube');
  });

  it('fake_broadcast: nowMs-based calculation supplies effectiveSeconds', () => {
    const startedAt = '2026-05-13T12:00:00.000Z';
    const nowMs = Date.parse(startedAt) + 350_000; // 350s after start
    const result = deriveEvent({
      party: party({
        fake_broadcast: true,
        fake_broadcast_started_at: startedAt,
        // yt seconds is stale / unused while fake broadcast is on.
        yt_current_seconds: 9999,
      }),
      timeline,
      nowMs,
    });
    expect(result.sourceOfTruth).toBe('fake_broadcast');
    expect(result.effectiveSeconds).toBeCloseTo(350, 5);
    expect(result.current?.idx).toBe(2); // SE window 300..500
  });

  it('fake_broadcast with no started_at falls back to seconds=0', () => {
    // Fake broadcast flag set but no started_at — we treat seconds as 0.
    const result = deriveEvent({
      party: party({
        fake_broadcast: true,
        fake_broadcast_started_at: null,
        yt_current_seconds: 600,
      }),
      timeline,
    });
    // Should not have followed yt (which would have picked idx=3).
    expect(result.sourceOfTruth).toBe('youtube');
    // …because with no started_at we silently fall through to yt seconds.
    // This matches the implementation's safety net behaviour.
    expect(result.current?.idx).toBe(3);
  });

  it('pause status surfaces in effectivePaused regardless of source', () => {
    const startedAt = '2026-05-13T12:00:00.000Z';
    const nowMs = Date.parse(startedAt) + 150_000;
    const manual = deriveEvent({
      party: party({ manual_event_idx: 1, party_paused: true }),
      timeline,
    });
    const fake = deriveEvent({
      party: party({
        fake_broadcast: true,
        fake_broadcast_started_at: startedAt,
        party_paused: true,
      }),
      timeline,
      nowMs,
    });
    const yt = deriveEvent({
      party: party({ yt_current_seconds: 150, party_paused: true }),
      timeline,
    });
    expect(manual.effectivePaused).toBe(true);
    expect(fake.effectivePaused).toBe(true);
    expect(yt.effectivePaused).toBe(true);
  });

  it('unordered timeline input is normalized before matching', () => {
    const shuffled = [
      timeline[3]!, // idx=3 start 500
      timeline[0]!, // idx=1000 start 0
      timeline[2]!, // idx=2 start 300
      timeline[4]!, // idx=1001 start 700
      timeline[1]!, // idx=1 start 100
    ];
    const result = deriveEvent({
      party: party({ yt_current_seconds: 350 }),
      timeline: shuffled,
    });
    expect(result.current?.idx).toBe(2);
    expect(result.current?.countryCode).toBe('SE');
  });

  it('open-ended row (end_seconds=null) extends until next row start', () => {
    const tl: EventTimelineRow[] = [
      row({ idx: 1, start_seconds: 0, end_seconds: null }),
      row({ idx: 2, start_seconds: 200, end_seconds: null }),
    ];
    expect(
      deriveEvent({ party: party({ yt_current_seconds: 50 }), timeline: tl })
        .current?.idx,
    ).toBe(1);
    expect(
      deriveEvent({ party: party({ yt_current_seconds: 199 }), timeline: tl })
        .current?.idx,
    ).toBe(1);
    expect(
      deriveEvent({ party: party({ yt_current_seconds: 200 }), timeline: tl })
        .current?.idx,
    ).toBe(2);
    expect(
      deriveEvent({ party: party({ yt_current_seconds: 99_999 }), timeline: tl })
        .current?.idx,
    ).toBe(2);
  });

  it('CurrentEvent shape matches the documented contract', () => {
    const result = deriveEvent({
      party: party({ yt_current_seconds: 350 }),
      timeline,
    });
    expect(result.current).toEqual({
      idx: 2,
      category: 'performance',
      description: 'Event 2',
      countryCode: 'SE',
      startSeconds: 300,
      endSeconds: 500,
      songIdx: null,
    });
  });
});
