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

const roastEntrySchema = z.object({
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
    roast_pool: z.array(roastEntrySchema),
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
export type IngestRoastEntry = z.infer<typeof roastEntrySchema>;

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
