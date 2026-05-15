import { describe, it, expect } from 'vitest';
import { ingestPayloadSchema, actualResultsSchema } from './ingest-schema';

// Build a minimal valid payload and let each test mutate one field.
const baseValid = () => ({
  yt_video_id: 'Yy510SZZDw4',
  performances: [
    {
      running_order: 1,
      country_code: 'MD',
      artist: 'Satoshi',
      song_title: 'Big Money',
      start_seconds: 788,
      end_seconds: 990,
      vibe_blurb: 'crypto goblincore',
      fun_fact: 'first MD entry to mention NFTs',
    },
    {
      running_order: 2,
      country_code: 'SE',
      artist: 'FELICIA',
      song_title: 'Mango',
      start_seconds: 1025,
      end_seconds: 1206,
      vibe_blurb: 'tropical malaise',
      fun_fact: 'recorded in three studios over one weekend',
    },
  ],
  other_events: [
    { category: 'opening' as const, start_seconds: 0, description: 'Hosts open the show' },
    { category: 'interval' as const, start_seconds: 5400, description: 'Interval act' },
    { category: 'voting' as const, start_seconds: 7200, description: 'Lines are open' },
    { category: 'result' as const, start_seconds: 9000, description: 'Results begin' },
  ],
  scheduled_commentary: [
    {
      trigger_seconds: 800,
      speaker: 'nala' as const,
      content: 'Here we go.',
      event_idx: 1,
    },
    {
      trigger_seconds: 1100,
      speaker: 'evee' as const,
      content: 'A mango supremacy.',
      event_idx: 2,
    },
  ],
  reaction_pool: [
    { event_idx: 1, kind: 'roast' as const, speaker: 'evee' as const, content: 'If they win, I quit.' },
    { event_idx: 1, kind: 'celebrate' as const, speaker: 'nala' as const, content: 'Iconic. Anthem of the year.' },
    { event_idx: 2, kind: 'roast' as const, speaker: 'nala' as const, content: 'No notes. Truly.' },
  ],
});

describe('ingestPayloadSchema', () => {
  it('accepts a valid payload', () => {
    const res = ingestPayloadSchema.safeParse(baseValid());
    expect(res.success).toBe(true);
  });

  it('rejects a missing required field with a helpful path', () => {
    const bad = baseValid() as Record<string, unknown>;
    delete bad.yt_video_id;
    const res = ingestPayloadSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) => i.path[0] === 'yt_video_id');
      expect(issue).toBeDefined();
    }
  });

  it('rejects out-of-order performance start_seconds', () => {
    const bad = baseValid();
    // Flip second performance behind first
    bad.performances[1]!.start_seconds = 500;
    bad.performances[1]!.end_seconds = 700;
    const res = ingestPayloadSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find(
        (i) =>
          i.path[0] === 'performances' &&
          i.path[1] === 1 &&
          i.path[2] === 'start_seconds',
      );
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/non-decreasing/);
    }
  });

  it('rejects duplicate country_code in performances', () => {
    const bad = baseValid();
    bad.performances[1]!.country_code = 'MD';
    const res = ingestPayloadSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find(
        (i) =>
          i.path[0] === 'performances' &&
          i.path[2] === 'country_code' &&
          /duplicate/.test(i.message),
      );
      expect(issue).toBeDefined();
    }
  });

  it('rejects a country_code that is not exactly 2 chars', () => {
    const bad = baseValid();
    bad.performances[0]!.country_code = 'MDA';
    const res = ingestPayloadSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find(
        (i) => i.path[0] === 'performances' && i.path[2] === 'country_code',
      );
      expect(issue).toBeDefined();
    }
  });

  it('rejects out-of-order scheduled_commentary trigger_seconds', () => {
    const bad = baseValid();
    bad.scheduled_commentary[1]!.trigger_seconds = 700;
    const res = ingestPayloadSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find(
        (i) =>
          i.path[0] === 'scheduled_commentary' &&
          i.path[2] === 'trigger_seconds',
      );
      expect(issue).toBeDefined();
    }
  });

  it('rejects performance with end_seconds < start_seconds', () => {
    const bad = baseValid();
    bad.performances[0]!.end_seconds = 500;
    const res = ingestPayloadSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find(
        (i) => i.path[0] === 'performances' && i.path[2] === 'end_seconds',
      );
      expect(issue).toBeDefined();
    }
  });

  it('rejects an empty performances array', () => {
    const bad = baseValid();
    bad.performances = [];
    const res = ingestPayloadSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it('accepts a payload with empty optional arrays (other_events, scheduled, reaction)', () => {
    const ok = baseValid();
    ok.other_events = [];
    ok.scheduled_commentary = [];
    ok.reaction_pool = [];
    const res = ingestPayloadSchema.safeParse(ok);
    expect(res.success).toBe(true);
  });

  it('rejects a reaction_pool entry with an unknown kind', () => {
    const bad = baseValid() as Record<string, unknown>;
    (bad.reaction_pool as Array<Record<string, unknown>>).push({
      event_idx: 2,
      kind: 'shrug',
      speaker: 'nala',
      content: 'meh',
    });
    const res = ingestPayloadSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find(
        (i) => i.path[0] === 'reaction_pool' && i.path[2] === 'kind',
      );
      expect(issue).toBeDefined();
    }
  });

  it('accepts a legacy roast_pool (back-compat)', () => {
    const legacy = {
      yt_video_id: 'abc12345678',
      performances: [
        {
          running_order: 1,
          country_code: 'MD',
          artist: 'Satoshi',
          song_title: 'Viva',
          start_seconds: 100,
          end_seconds: 200,
          vibe_blurb: 'wild',
          fun_fact: 'won the rehearsal',
        },
      ],
      other_events: [],
      scheduled_commentary: [],
      roast_pool: [
        { event_idx: 1, speaker: 'nala', content: 'classic' },
      ],
    };
    const res = ingestPayloadSchema.safeParse(legacy);
    expect(res.success).toBe(true);
  });
});

describe('actualResultsSchema', () => {
  it('accepts a valid results array', () => {
    const ok = [
      { position: 1, country_code: 'SE' },
      { position: 2, country_code: 'IT' },
      { position: 3, country_code: 'FR' },
    ];
    expect(actualResultsSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects duplicate position', () => {
    const bad = [
      { position: 1, country_code: 'SE' },
      { position: 1, country_code: 'IT' },
    ];
    const res = actualResultsSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it('rejects duplicate country', () => {
    const bad = [
      { position: 1, country_code: 'SE' },
      { position: 2, country_code: 'SE' },
    ];
    const res = actualResultsSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });
});
