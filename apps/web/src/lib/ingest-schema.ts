// Zod schema for the producer JSON that the host pastes into /admin/setup.
//
// Shape is fixed by the plan ("JSON ingest contract" section). The schema
// here validates that contract before we touch the database — the ingest
// RPC trusts whatever this lets through, so the validation must be strict.
//
// Refinements beyond plain shape:
//  - performances must have monotonically non-decreasing start_seconds
//  - performances must not duplicate country_code (a country only performs
//    once in the broadcast)
//  - scheduled_commentary trigger_seconds must be monotonically non-decreasing
//  - other_events start_seconds also monotonically non-decreasing
//  - country_code is exactly 2 chars (matches ISO-3166 alpha-2 used in seed)
//
// We keep the error paths precise (`['performances', i, 'start_seconds']`)
// so the UI can highlight the broken row.
import { z } from 'zod';

const speakerSchema = z.enum(['nala', 'evee']);

const performanceSchema = z.object({
  running_order: z.number().int().positive(),
  country_code: z.string().length(2, 'country_code must be 2 letters'),
  artist: z.string().min(1),
  song_title: z.string().min(1),
  start_seconds: z.number().int().nonnegative(),
  end_seconds: z.number().int().nonnegative(),
  vibe_blurb: z.string().min(1),
  fun_fact: z.string().min(1),
});

const otherEventSchema = z.object({
  category: z.enum(['opening', 'interval', 'voting', 'result']),
  start_seconds: z.number().int().nonnegative(),
  description: z.string().min(1),
});

const scheduledCommentarySchema = z.object({
  trigger_seconds: z.number().int().nonnegative(),
  speaker: speakerSchema,
  content: z.string().min(1),
  event_idx: z.number().int().positive().optional(),
});

const reactionKindSchema = z.enum(['roast', 'celebrate']);

const reactionEntrySchema = z.object({
  event_idx: z.number().int().positive(),
  kind: reactionKindSchema,
  speaker: speakerSchema,
  content: z.string().min(1),
});

// Legacy: pre-celebrate payloads used a roast_pool without `kind`.
// Accepted for back-compat; the RPC tags each entry as 'roast'.
const legacyRoastEntrySchema = z.object({
  event_idx: z.number().int().positive(),
  speaker: speakerSchema,
  content: z.string().min(1),
});

export const ingestPayloadSchema = z
  .object({
    yt_video_id: z.string().min(5),
    performances: z.array(performanceSchema).min(1),
    other_events: z.array(otherEventSchema),
    scheduled_commentary: z.array(scheduledCommentarySchema),
    reaction_pool: z.array(reactionEntrySchema).optional().default([]),
    roast_pool: z.array(legacyRoastEntrySchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    // Performances: start_seconds <= end_seconds (sanity) and the array
    // overall is sorted ascending by start_seconds.
    let lastPerfStart = -1;
    const seenCountries = new Set<string>();
    data.performances.forEach((p, i) => {
      if (p.start_seconds > p.end_seconds) {
        ctx.addIssue({
          code: 'custom',
          path: ['performances', i, 'end_seconds'],
          message: 'end_seconds must be >= start_seconds',
        });
      }
      if (p.start_seconds < lastPerfStart) {
        ctx.addIssue({
          code: 'custom',
          path: ['performances', i, 'start_seconds'],
          message: 'performances must be ordered by start_seconds (non-decreasing)',
        });
      }
      lastPerfStart = Math.max(lastPerfStart, p.start_seconds);

      const cc = p.country_code.toUpperCase();
      if (seenCountries.has(cc)) {
        ctx.addIssue({
          code: 'custom',
          path: ['performances', i, 'country_code'],
          message: `duplicate country_code '${cc}'`,
        });
      }
      seenCountries.add(cc);
    });

    // other_events: monotonically non-decreasing start_seconds.
    let lastOtherStart = -1;
    data.other_events.forEach((e, i) => {
      if (e.start_seconds < lastOtherStart) {
        ctx.addIssue({
          code: 'custom',
          path: ['other_events', i, 'start_seconds'],
          message: 'other_events must be ordered by start_seconds (non-decreasing)',
        });
      }
      lastOtherStart = Math.max(lastOtherStart, e.start_seconds);
    });

    // scheduled_commentary: monotonically non-decreasing trigger_seconds.
    let lastTrigger = -1;
    data.scheduled_commentary.forEach((s, i) => {
      if (s.trigger_seconds < lastTrigger) {
        ctx.addIssue({
          code: 'custom',
          path: ['scheduled_commentary', i, 'trigger_seconds'],
          message: 'scheduled_commentary must be ordered by trigger_seconds (non-decreasing)',
        });
      }
      lastTrigger = Math.max(lastTrigger, s.trigger_seconds);
    });
  });

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;
export type IngestPerformance = z.infer<typeof performanceSchema>;
export type IngestOtherEvent = z.infer<typeof otherEventSchema>;
export type IngestScheduledCommentary = z.infer<typeof scheduledCommentarySchema>;
export type IngestReactionEntry = z.infer<typeof reactionEntrySchema>;
/** @deprecated Use IngestReactionEntry with kind='roast'. */
export type IngestRoastEntry = z.infer<typeof legacyRoastEntrySchema>;

// -- Split ingest (Gemini + ChatGPT pasted separately) -----------------
//
// ChatGPT can't reliably emit one combined payload at the sizes we need
// (≥10 reactions per kitten per performance ≈ 500+ lines of content).
// So we split:
//   1. Structure   — yt_video_id + performances + other_events (from Gemini)
//   2. Commentary  — scheduled_commentary + reaction_pool, keyed by
//                    country_code instead of event_idx (from ChatGPT)
// The UI validates each independently then merges them client-side into
// the same `ingestPayloadSchema` shape the RPC already understands. No
// DB/RPC changes required.

export const structurePayloadSchema = z
  .object({
    yt_video_id: z.string().min(5),
    performances: z.array(performanceSchema).min(1),
    other_events: z.array(otherEventSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    let lastPerfStart = -1;
    const seenCountries = new Set<string>();
    data.performances.forEach((p, i) => {
      if (p.start_seconds > p.end_seconds) {
        ctx.addIssue({
          code: 'custom',
          path: ['performances', i, 'end_seconds'],
          message: 'end_seconds must be >= start_seconds',
        });
      }
      if (p.start_seconds < lastPerfStart) {
        ctx.addIssue({
          code: 'custom',
          path: ['performances', i, 'start_seconds'],
          message: 'performances must be ordered by start_seconds (non-decreasing)',
        });
      }
      lastPerfStart = Math.max(lastPerfStart, p.start_seconds);

      const cc = p.country_code.toUpperCase();
      if (seenCountries.has(cc)) {
        ctx.addIssue({
          code: 'custom',
          path: ['performances', i, 'country_code'],
          message: `duplicate country_code '${cc}'`,
        });
      }
      seenCountries.add(cc);
    });

    let lastOtherStart = -1;
    data.other_events.forEach((e, i) => {
      if (e.start_seconds < lastOtherStart) {
        ctx.addIssue({
          code: 'custom',
          path: ['other_events', i, 'start_seconds'],
          message: 'other_events must be ordered by start_seconds (non-decreasing)',
        });
      }
      lastOtherStart = Math.max(lastOtherStart, e.start_seconds);
    });
  });

const commentaryEntrySchema = z.object({
  trigger_seconds: z.number().int().nonnegative(),
  speaker: speakerSchema,
  content: z.string().min(1),
  // Optional — lines tied to opening/interval/voting/result can omit it.
  country_code: z.string().length(2).optional(),
});

const reactionEntryByCountrySchema = z.object({
  country_code: z.string().length(2),
  kind: reactionKindSchema,
  speaker: speakerSchema,
  content: z.string().min(1),
});

export const commentaryPayloadSchema = z
  .object({
    scheduled_commentary: z.array(commentaryEntrySchema).optional().default([]),
    reaction_pool: z.array(reactionEntryByCountrySchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    let lastTrigger = -1;
    data.scheduled_commentary.forEach((s, i) => {
      if (s.trigger_seconds < lastTrigger) {
        ctx.addIssue({
          code: 'custom',
          path: ['scheduled_commentary', i, 'trigger_seconds'],
          message: 'scheduled_commentary must be ordered by trigger_seconds (non-decreasing)',
        });
      }
      lastTrigger = Math.max(lastTrigger, s.trigger_seconds);
    });
  });

export type StructurePayload = z.infer<typeof structurePayloadSchema>;
export type CommentaryPayload = z.infer<typeof commentaryPayloadSchema>;

export type MergeResult =
  | { ok: true; payload: IngestPayload }
  | { ok: false; error: string };

/**
 * Merge a Gemini structure payload with a ChatGPT commentary payload into the
 * combined `IngestPayload` shape the RPC expects. Maps each commentary entry's
 * `country_code` to the matching performance's `running_order` (event_idx).
 *
 * Returns an envelope rather than throwing because callers surface errors as
 * inline UI rather than catching exceptions.
 */
export function mergeStructureAndCommentary(
  structure: StructurePayload,
  commentary: CommentaryPayload,
): MergeResult {
  const ccToIdx = new Map<string, number>();
  for (const p of structure.performances) {
    ccToIdx.set(p.country_code.toUpperCase(), p.running_order);
  }

  const scheduled: IngestScheduledCommentary[] = [];
  for (let i = 0; i < commentary.scheduled_commentary.length; i++) {
    const c = commentary.scheduled_commentary[i]!;
    const entry: IngestScheduledCommentary = {
      trigger_seconds: c.trigger_seconds,
      speaker: c.speaker,
      content: c.content,
    };
    if (c.country_code) {
      const idx = ccToIdx.get(c.country_code.toUpperCase());
      if (idx == null) {
        return {
          ok: false,
          error: `scheduled_commentary[${i}] references unknown country_code '${c.country_code}' (not in structure)`,
        };
      }
      entry.event_idx = idx;
    }
    scheduled.push(entry);
  }

  const reactions: IngestReactionEntry[] = [];
  for (let i = 0; i < commentary.reaction_pool.length; i++) {
    const r = commentary.reaction_pool[i]!;
    const idx = ccToIdx.get(r.country_code.toUpperCase());
    if (idx == null) {
      return {
        ok: false,
        error: `reaction_pool[${i}] references unknown country_code '${r.country_code}' (not in structure)`,
      };
    }
    reactions.push({
      event_idx: idx,
      kind: r.kind,
      speaker: r.speaker,
      content: r.content,
    });
  }

  const merged = {
    yt_video_id: structure.yt_video_id,
    performances: structure.performances,
    other_events: structure.other_events,
    scheduled_commentary: scheduled,
    reaction_pool: reactions,
    roast_pool: [],
  };
  // Re-run the combined schema as a final defence (catches any cross-refinement
  // the individual schemas missed — e.g. malformed numbers slipping through).
  const final = ingestPayloadSchema.safeParse(merged);
  if (!final.success) {
    const first = final.error.issues[0];
    const path = first?.path?.join('.') ?? '';
    return {
      ok: false,
      error: `merged payload invalid: ${first?.message ?? 'unknown'}${path ? ` (at ${path})` : ''}`,
    };
  }
  return { ok: true, payload: final.data };
}

// Actual results paste format — used at reveal time.
export const actualResultsSchema = z
  .array(
    z.object({
      position: z.number().int().min(1).max(26),
      country_code: z.string().length(2),
    }),
  )
  .min(1)
  .superRefine((rows, ctx) => {
    const seenPos = new Set<number>();
    const seenCc = new Set<string>();
    rows.forEach((r, i) => {
      if (seenPos.has(r.position)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'position'],
          message: `duplicate position ${r.position}`,
        });
      }
      seenPos.add(r.position);
      const cc = r.country_code.toUpperCase();
      if (seenCc.has(cc)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'country_code'],
          message: `duplicate country_code ${cc}`,
        });
      }
      seenCc.add(cc);
    });
  });

export type ActualResults = z.infer<typeof actualResultsSchema>;
