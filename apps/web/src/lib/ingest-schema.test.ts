import { describe, it, expect } from 'vitest';
import {
  ingestPayloadSchema,
  actualResultsSchema,
  structurePayloadSchema,
  commentaryPayloadSchema,
  mergeStructureAndCommentary,
} from './ingest-schema';

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

// --- Split-ingest (Gemini structure + ChatGPT commentary) -------------

const baseStructure = () => ({
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
    { category: 'opening' as const, start_seconds: 0, description: 'Hosts open' },
  ],
});

const baseCommentary = () => ({
  scheduled_commentary: [
    {
      trigger_seconds: 800,
      speaker: 'nala' as const,
      content: 'Here we go.',
      country_code: 'MD',
    },
    {
      trigger_seconds: 1100,
      speaker: 'evee' as const,
      content: 'A mango supremacy.',
      country_code: 'SE',
    },
  ],
  reaction_pool: [
    { country_code: 'MD', kind: 'roast' as const, speaker: 'evee' as const, content: 'If they win, I quit.' },
    { country_code: 'MD', kind: 'celebrate' as const, speaker: 'nala' as const, content: 'Iconic.' },
    { country_code: 'SE', kind: 'roast' as const, speaker: 'nala' as const, content: 'No notes.' },
  ],
});

describe('structurePayloadSchema', () => {
  it('accepts a valid structure-only payload', () => {
    const res = structurePayloadSchema.safeParse(baseStructure());
    expect(res.success).toBe(true);
  });

  it('defaults other_events to []', () => {
    const minimal = baseStructure() as Record<string, unknown>;
    delete minimal.other_events;
    const res = structurePayloadSchema.safeParse(minimal);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.other_events).toEqual([]);
  });

  it('rejects duplicate country_code', () => {
    const bad = baseStructure();
    bad.performances[1]!.country_code = 'MD';
    const res = structurePayloadSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });
});

describe('commentaryPayloadSchema', () => {
  it('accepts a valid commentary-only payload', () => {
    const res = commentaryPayloadSchema.safeParse(baseCommentary());
    expect(res.success).toBe(true);
  });

  it('accepts commentary without country_code (opening/interval lines)', () => {
    const ok = {
      scheduled_commentary: [
        { trigger_seconds: 0, speaker: 'nala' as const, content: 'Show starts.' },
      ],
      reaction_pool: [],
    };
    const res = commentaryPayloadSchema.safeParse(ok);
    expect(res.success).toBe(true);
  });

  it('rejects reaction_pool entry missing country_code', () => {
    const bad = {
      scheduled_commentary: [],
      reaction_pool: [
        { kind: 'roast', speaker: 'nala', content: 'no key' },
      ],
    };
    const res = commentaryPayloadSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it('rejects out-of-order scheduled_commentary', () => {
    const bad = baseCommentary();
    bad.scheduled_commentary[1]!.trigger_seconds = 500;
    const res = commentaryPayloadSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });
});

describe('mergeStructureAndCommentary', () => {
  it('merges country_code to event_idx correctly', () => {
    const sRes = structurePayloadSchema.safeParse(baseStructure());
    const cRes = commentaryPayloadSchema.safeParse(baseCommentary());
    expect(sRes.success && cRes.success).toBe(true);
    if (!sRes.success || !cRes.success) return;
    const out = mergeStructureAndCommentary(sRes.data, cRes.data);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.payload.scheduled_commentary[0]!.event_idx).toBe(1);
    expect(out.payload.scheduled_commentary[1]!.event_idx).toBe(2);
    expect(out.payload.reaction_pool[0]!.event_idx).toBe(1);
    expect(out.payload.reaction_pool[2]!.event_idx).toBe(2);
  });

  it('matches country_code case-insensitively', () => {
    const sRes = structurePayloadSchema.safeParse(baseStructure());
    const commentary = {
      scheduled_commentary: [],
      reaction_pool: [
        { country_code: 'md', kind: 'roast' as const, speaker: 'nala' as const, content: 'x' },
      ],
    };
    const cRes = commentaryPayloadSchema.safeParse(commentary);
    expect(sRes.success && cRes.success).toBe(true);
    if (!sRes.success || !cRes.success) return;
    const out = mergeStructureAndCommentary(sRes.data, cRes.data);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.payload.reaction_pool[0]!.event_idx).toBe(1);
  });

  it('rejects commentary referencing a country_code missing from structure', () => {
    const sRes = structurePayloadSchema.safeParse(baseStructure());
    const commentary = {
      scheduled_commentary: [],
      reaction_pool: [
        { country_code: 'IT', kind: 'roast' as const, speaker: 'nala' as const, content: 'x' },
      ],
    };
    const cRes = commentaryPayloadSchema.safeParse(commentary);
    expect(sRes.success && cRes.success).toBe(true);
    if (!sRes.success || !cRes.success) return;
    const out = mergeStructureAndCommentary(sRes.data, cRes.data);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/IT/);
  });

  it('handles an empty commentary payload', () => {
    const sRes = structurePayloadSchema.safeParse(baseStructure());
    const cRes = commentaryPayloadSchema.safeParse({});
    expect(sRes.success && cRes.success).toBe(true);
    if (!sRes.success || !cRes.success) return;
    const out = mergeStructureAndCommentary(sRes.data, cRes.data);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.payload.scheduled_commentary).toEqual([]);
      expect(out.payload.reaction_pool).toEqual([]);
    }
  });

  it('preserves scheduled_commentary entries without country_code (no event_idx)', () => {
    const sRes = structurePayloadSchema.safeParse(baseStructure());
    const commentary = {
      scheduled_commentary: [
        { trigger_seconds: 0, speaker: 'nala' as const, content: 'Welcome!' },
      ],
      reaction_pool: [],
    };
    const cRes = commentaryPayloadSchema.safeParse(commentary);
    expect(sRes.success && cRes.success).toBe(true);
    if (!sRes.success || !cRes.success) return;
    const out = mergeStructureAndCommentary(sRes.data, cRes.data);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.payload.scheduled_commentary[0]!.event_idx).toBeUndefined();
    }
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
